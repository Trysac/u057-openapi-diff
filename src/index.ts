/**
 * Semantic diff of OpenAPI 3.0 and 3.1 documents.
 *
 * The public API is `loadSpec`, `diffSpecs` and `formatReport`, together with
 * `OpenApiDiffError` and the types they exchange.
 */
import { parse } from "yaml";

/** Maximum accepted size of a specification text, in UTF-8 bytes. */
export const MAX_SPEC_BYTES = 10_485_760;

/** Default maximum number of schema-pair comparisons in one diff. */
export const DEFAULT_MAX_COMPARISONS = 100_000;

const MAX_SCHEMA_DEPTH = 64;
const MAX_DOCUMENT_DEPTH = 256;
const MAX_REF_HOPS = 64;
const MAX_ALIAS_COUNT = 100;
const MAX_QUOTE = 100;
const MAX_MESSAGE = 200;
const VERSION_PATTERN = /^3\.[01]\.\d+(?:[-+][0-9A-Za-z.+-]*)?$/;
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;
const COMPOSITION_KEYS = ["allOf", "oneOf", "anyOf", "not"] as const;
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

const RULES = {
  opRemoved: "operation-removed",
  opAdded: "operation-added",
  paramAdded: "param-added",
  paramRemoved: "param-removed",
  paramRequired: "param-became-required",
  propRequired: "request-property-became-required",
  enumRemoved: "request-enum-value-removed",
  propRemoved: "response-property-removed",
  enumAdded: "response-enum-value-added",
  typeChanged: "type-changed",
} as const;

/** Machine-readable error codes of {@link OpenApiDiffError}. */
export type ErrorCode =
  | "parse_error"
  | "too_large"
  | "unsupported_version"
  | "unresolved_ref"
  | "too_deep";

/** Severity of a change. */
export type Severity = "breaking" | "warning" | "info";

/** Identifier of a classification rule. */
export type RuleId =
  | "operation-removed"
  | "operation-added"
  | "param-added"
  | "param-removed"
  | "param-became-required"
  | "request-property-became-required"
  | "request-enum-value-removed"
  | "response-property-removed"
  | "response-enum-value-added"
  | "type-changed";

/** Output format accepted by {@link formatReport}. */
export type ReportFormat = "text" | "json";

/** A parsed OpenAPI 3.0.x or 3.1.x document. */
export interface OpenApiDocument {
  readonly openapi: string;
  readonly [key: string]: unknown;
}

/** One classified difference between two documents. */
export interface Change {
  readonly rule: RuleId;
  readonly severity: Severity;
  /** RFC 6901 pointer into the head document (base document for removals). */
  readonly pointer: string;
  readonly method?: string;
  readonly path?: string;
  readonly message: string;
}

/** Number of changes per severity. */
export interface DiffSummary {
  readonly breaking: number;
  readonly warning: number;
  readonly info: number;
}

/** Result of {@link diffSpecs}. */
export interface DiffReport {
  readonly changes: Change[];
  readonly summary: DiffSummary;
}

/** Options of {@link diffSpecs}. */
export interface DiffOptions {
  /** Maximum schema-pair comparisons before `too_large` is raised. */
  readonly maxComparisons?: number;
}

/** Error raised by every failure of this library. */
export class OpenApiDiffError extends Error {
  /** Stable machine-readable error code. */
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(truncate(message, MAX_MESSAGE));
    this.name = "OpenApiDiffError";
    this.code = code;
  }
}

type Rec = Record<string, unknown>;
type Direction = "request" | "response";
type TypeSet = Set<string> | undefined;

interface Loc {
  readonly value: unknown;
  readonly pointer: string;
}

interface Finding {
  readonly rule: RuleId;
  readonly severity: Severity;
  readonly pointer: string;
  readonly message: string;
}

interface Frame {
  readonly value: unknown;
  readonly depth: number;
}

interface OpEntry {
  readonly method: string;
  readonly path: string;
  readonly names: readonly string[];
  readonly item: Loc;
  readonly op: Loc;
}

interface ParamInfo {
  readonly label: string;
  readonly required: boolean;
  readonly pointer: string;
  readonly schema: Loc | undefined;
}

interface Ctx {
  readonly base: Rec;
  readonly head: Rec;
  readonly max: number;
  count: number;
  readonly memo: Map<string, Finding[]>;
  readonly active: Set<string>;
  readonly hits: Set<string>;
}

const EMPTY: Rec = {};

function fail(code: ErrorCode, message: string): never {
  throw new OpenApiDiffError(code, message);
}

function isObj(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRec(value: unknown): Rec {
  return isObj(value) ? value : EMPTY;
}

function esc(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function quote(text: string): string {
  return JSON.stringify(truncate(text, MAX_QUOTE));
}

function isLocalRef(ref: string): boolean {
  return ref === "#" || ref.startsWith("#/");
}

function unresolvedError(ref: string): OpenApiDiffError {
  return new OpenApiDiffError("unresolved_ref", `Unresolved reference ${quote(ref)}`);
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > MAX_SPEC_BYTES) {
      return bytes;
    }
  }
  return bytes;
}

function parseText(text: string): unknown {
  try {
    if (text.trimStart().startsWith("{")) {
      return JSON.parse(text);
    }
    return parse(text, { maxAliasCount: MAX_ALIAS_COUNT, uniqueKeys: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid input";
    const first = reason.split("\n")[0] ?? "";
    fail("parse_error", `Cannot parse specification: ${truncate(first, 150)}`);
  }
}

function pushFrame(stack: Frame[], value: unknown, depth: number): void {
  if (typeof value === "object" && value !== null) {
    stack.push({ value, depth });
  }
}

function checkRefs(root: unknown): void {
  const stack: Frame[] = [];
  pushFrame(stack, root, 0);
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { value, depth } = item;
    if (depth > MAX_DOCUMENT_DEPTH) {
      fail("too_deep", "Document is nested too deeply");
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        pushFrame(stack, entry, depth + 1);
      }
    } else if (isObj(value)) {
      const ref = value.$ref;
      if (typeof ref === "string" && !isLocalRef(ref)) {
        throw unresolvedError(ref);
      }
      for (const key of Object.keys(value)) {
        pushFrame(stack, value[key], depth + 1);
      }
    }
  }
}

/**
 * Parses an OpenAPI 3.0.x or 3.1.x document from YAML or JSON text.
 *
 * Text whose first non-space character is `{` is parsed as JSON, anything else
 * as YAML 1.2 (core schema, unique keys, at most 100 alias expansions).
 *
 * @param text - The document text, at most {@link MAX_SPEC_BYTES} UTF-8 bytes.
 * @returns The parsed document.
 * @throws {OpenApiDiffError} `too_large`, `parse_error`, `unsupported_version`,
 * `unresolved_ref` (any non-local `$ref`) or `too_deep`.
 */
export function loadSpec(text: string): OpenApiDocument {
  if (typeof text !== "string") {
    fail("parse_error", "Specification must be text");
  }
  if (text.length > MAX_SPEC_BYTES || utf8Length(text) > MAX_SPEC_BYTES) {
    fail("too_large", `Specification exceeds ${MAX_SPEC_BYTES} bytes`);
  }
  const parsed = parseText(text);
  if (!isObj(parsed)) {
    fail("parse_error", "Specification must be a mapping");
  }
  const found = parsed.openapi;
  if (typeof found !== "string" || !VERSION_PATTERN.test(found)) {
    const label = String(found ?? parsed.swagger ?? "missing");
    fail("unsupported_version", `Unsupported version ${quote(label)}; expected 3.0.x or 3.1.x`);
  }
  checkRefs(parsed);
  return parsed as OpenApiDocument;
}

function canon(value: unknown, depth: number): string {
  if (depth > MAX_DOCUMENT_DEPTH) {
    fail("too_deep", "Value is nested too deeply");
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const entry of value) {
      items.push(canon(entry, depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (isObj(value)) {
    const parts: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const inner = canon(value[key], depth + 1);
      parts.push(`${JSON.stringify(key)}:${inner}`);
    }
    return `{${parts.join(",")}}`;
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function lookup(doc: Rec, ref: string): Loc {
  if (!isLocalRef(ref)) {
    throw unresolvedError(ref);
  }
  let pointer: string;
  try {
    pointer = decodeURIComponent(ref.slice(1));
  } catch {
    throw unresolvedError(ref);
  }
  let value: unknown = doc;
  if (pointer !== "") {
    for (const raw of pointer.slice(1).split("/")) {
      const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      const index = ARRAY_INDEX.test(token) ? Number(token) : -1;
      if (Array.isArray(value) && index >= 0 && index < value.length) {
        value = value[index];
      } else if (isObj(value) && Object.hasOwn(value, token)) {
        value = value[token];
      } else {
        throw unresolvedError(ref);
      }
    }
  }
  return { value, pointer };
}

function deref(doc: Rec, loc: Loc): Loc {
  let current = loc;
  for (let hops = 0; hops <= MAX_REF_HOPS; hops += 1) {
    const value = current.value;
    if (!isObj(value) || typeof value.$ref !== "string") {
      return current;
    }
    current = lookup(doc, value.$ref);
  }
  return fail("too_deep", "Reference chain is too long");
}

function at(doc: Rec, parent: Loc, key: string): Loc | undefined {
  const rec = asRec(parent.value);
  if (!Object.hasOwn(rec, key)) {
    return undefined;
  }
  const pointer = `${parent.pointer}/${esc(key)}`;
  return deref(doc, { value: rec[key], pointer });
}

function breaking(rule: RuleId, pointer: string, message: string): Finding {
  return { rule, severity: "breaking", pointer, message };
}

function warn(rule: RuleId, pointer: string, message: string): Finding {
  return { rule, severity: "warning", pointer, message };
}

function info(rule: RuleId, pointer: string, message: string): Finding {
  return { rule, severity: "info", pointer, message };
}

function extend(target: Finding[], source: readonly Finding[]): void {
  for (const finding of source) {
    target.push(finding);
  }
}

function typeSet(schema: Rec): TypeSet {
  const raw = schema.type;
  let set: TypeSet;
  if (typeof raw === "string") {
    set = new Set([raw]);
  } else if (Array.isArray(raw)) {
    set = new Set(raw.filter((t): t is string => typeof t === "string"));
  }
  if (set !== undefined && schema.nullable === true) {
    set.add("null");
  }
  return set;
}

function formatTypes(set: TypeSet): string {
  return set === undefined ? "any" : [...set].sort().join("|");
}

function covers(set: Set<string>, type: string): boolean {
  return set.has(type) || (type === "integer" && set.has("number"));
}

function lostTypes(from: TypeSet, to: TypeSet): string[] {
  if (to === undefined) {
    return [];
  }
  if (from === undefined) {
    return ["any"];
  }
  return [...from].filter((type) => !covers(to, type));
}

function diffTypes(dir: Direction, bs: Rec, hs: Rec, pointer: string, out: Finding[]): void {
  const bt = typeSet(bs);
  const ht = typeSet(hs);
  const lost = dir === "request" ? lostTypes(bt, ht) : lostTypes(ht, bt);
  if (lost.length === 0) {
    return;
  }
  const message = `Type changed from ${formatTypes(bt)} to ${formatTypes(ht)}`;
  out.push(breaking(RULES.typeChanged, pointer, message));
}

function compositionKey(schema: Rec): string {
  const parts: string[] = [];
  for (const key of COMPOSITION_KEYS) {
    parts.push(Object.hasOwn(schema, key) ? canon(schema[key], 0) : "-");
  }
  return parts.join("\u0001");
}

function diffComposition(bs: Rec, hs: Rec, pointer: string, out: Finding[]): void {
  if (compositionKey(bs) !== compositionKey(hs)) {
    const message = "composition changed, not analysed";
    out.push(warn(RULES.typeChanged, pointer, message));
  }
}

function diffEnum(dir: Direction, bs: Rec, hs: Rec, pointer: string, out: Finding[]): void {
  const benum = bs.enum;
  const henum = hs.enum;
  if (!Array.isArray(benum) || !Array.isArray(henum)) {
    return;
  }
  const bkeys = new Set<string>();
  for (const value of benum) {
    bkeys.add(canon(value, 0));
  }
  const hkeys = new Set<string>();
  for (const value of henum) {
    hkeys.add(canon(value, 0));
  }
  const enumPointer = `${pointer}/enum`;
  if (dir === "request") {
    for (const key of bkeys) {
      if (!hkeys.has(key)) {
        const message = `Enum value ${truncate(key, MAX_QUOTE)} removed`;
        out.push(breaking(RULES.enumRemoved, enumPointer, message));
      }
    }
    return;
  }
  for (const key of hkeys) {
    if (!bkeys.has(key)) {
      const message = `Enum value ${truncate(key, MAX_QUOTE)} added`;
      out.push(warn(RULES.enumAdded, enumPointer, message));
    }
  }
}

function isIgnored(dir: Direction, schema: unknown): boolean {
  const flag = dir === "request" ? "readOnly" : "writeOnly";
  return asRec(schema)[flag] === true;
}

function stringSet(value: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        out.add(item);
      }
    }
  }
  return out;
}

function propLoc(parent: Loc, props: Rec, name: string): Loc {
  const pointer = `${parent.pointer}/properties/${esc(name)}`;
  return { value: props[name], pointer };
}

function diffProperties(
  ctx: Ctx,
  dir: Direction,
  b: Loc,
  h: Loc,
  depth: number,
  out: Finding[],
): void {
  const bprops = asRec(asRec(b.value).properties);
  const hprops = asRec(asRec(h.value).properties);
  for (const name of Object.keys(bprops)) {
    const braw = propLoc(b, bprops, name);
    const bloc = deref(ctx.base, braw);
    if (!Object.hasOwn(hprops, name)) {
      if (dir === "response" && !isIgnored(dir, bloc.value)) {
        const message = `Property ${quote(name)} removed`;
        out.push(breaking(RULES.propRemoved, braw.pointer, message));
      }
      continue;
    }
    const hloc = deref(ctx.head, propLoc(h, hprops, name));
    if (isIgnored(dir, bloc.value) || isIgnored(dir, hloc.value)) {
      continue;
    }
    extend(out, compareSchemas(ctx, dir, bloc, hloc, depth + 1));
  }
  if (dir !== "request") {
    return;
  }
  const breq = stringSet(asRec(b.value).required);
  const hreq = stringSet(asRec(h.value).required);
  for (const name of hreq) {
    if (breq.has(name)) {
      continue;
    }
    if (Object.hasOwn(hprops, name)) {
      const hloc = deref(ctx.head, propLoc(h, hprops, name));
      if (isIgnored(dir, hloc.value)) {
        continue;
      }
    }
    const pointer = `${h.pointer}/required`;
    const message = `Property ${quote(name)} is now required`;
    out.push(breaking(RULES.propRequired, pointer, message));
  }
}

function diffItems(ctx: Ctx, dir: Direction, b: Loc, h: Loc, depth: number, out: Finding[]): void {
  const bitems = asRec(b.value).items;
  const hitems = asRec(h.value).items;
  if (!isObj(bitems) || !isObj(hitems)) {
    return;
  }
  const bloc = { value: bitems, pointer: `${b.pointer}/items` };
  const hloc = { value: hitems, pointer: `${h.pointer}/items` };
  extend(out, compareSchemas(ctx, dir, bloc, hloc, depth + 1));
}

function analyse(ctx: Ctx, dir: Direction, b: Loc, h: Loc, depth: number): Finding[] {
  const out: Finding[] = [];
  const bs = asRec(b.value);
  const hs = asRec(h.value);
  diffTypes(dir, bs, hs, h.pointer, out);
  diffComposition(bs, hs, h.pointer, out);
  diffEnum(dir, bs, hs, h.pointer, out);
  diffProperties(ctx, dir, b, h, depth, out);
  diffItems(ctx, dir, b, h, depth, out);
  return out;
}

function compareSchemas(ctx: Ctx, dir: Direction, base: Loc, head: Loc, depth: number): Finding[] {
  const b = deref(ctx.base, base);
  const h = deref(ctx.head, head);
  const key = `${dir}\u0000${b.pointer}\u0000${h.pointer}`;
  if (ctx.active.has(key)) {
    ctx.hits.add(key);
    return [];
  }
  const cached = ctx.memo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    fail("too_deep", `Schema nesting exceeds ${MAX_SCHEMA_DEPTH} levels`);
  }
  ctx.count += 1;
  if (ctx.count > ctx.max) {
    fail("too_large", `More than ${ctx.max} schema comparisons`);
  }
  ctx.active.add(key);
  try {
    const found = analyse(ctx, dir, b, h, depth);
    ctx.hits.delete(key);
    // Only memoise results that did not depend on an unfinished ancestor.
    if (ctx.hits.size === 0) {
      ctx.memo.set(key, found);
    }
    return found;
  } finally {
    ctx.active.delete(key);
  }
}

function parseTemplate(path: string): {
  normalized: string;
  names: string[];
} {
  let normalized = "";
  const names: string[] = [];
  let i = 0;
  while (i < path.length) {
    const open = path.indexOf("{", i);
    if (open < 0) {
      break;
    }
    const close = path.indexOf("}", open + 1);
    if (close < 0) {
      break;
    }
    normalized += `${path.slice(i, open)}{}`;
    names.push(path.slice(open + 1, close));
    i = close + 1;
  }
  return { normalized: normalized + path.slice(i), names };
}

function collectOps(doc: Rec): Map<string, OpEntry> {
  const ops = new Map<string, OpEntry>();
  const paths = asRec(doc.paths);
  for (const path of Object.keys(paths)) {
    if (!path.startsWith("/")) {
      continue;
    }
    const template = parseTemplate(path);
    const raw: Loc = { value: paths[path], pointer: `/paths/${esc(path)}` };
    const item = deref(doc, raw);
    const itemRec = asRec(item.value);
    for (const method of METHODS) {
      const value = itemRec[method];
      const key = `${method} ${template.normalized}`;
      if (!isObj(value) || ops.has(key)) {
        continue;
      }
      const pointer = `${item.pointer}/${method}`;
      const op = { value, pointer };
      ops.set(key, { method, path, names: template.names, item, op });
    }
  }
  return ops;
}

function opLabel(entry: OpEntry): string {
  return `${entry.method.toUpperCase()} ${truncate(entry.path, MAX_QUOTE)}`;
}

function removedChange(entry: OpEntry): Change {
  return {
    rule: RULES.opRemoved,
    severity: "breaking",
    pointer: entry.op.pointer,
    method: entry.method,
    path: entry.path,
    message: `Operation ${opLabel(entry)} removed`,
  };
}

function addedChange(entry: OpEntry): Change {
  return {
    rule: RULES.opAdded,
    severity: "info",
    pointer: entry.op.pointer,
    method: entry.method,
    path: entry.path,
    message: `Operation ${opLabel(entry)} added`,
  };
}

function paramKey(location: string, name: string, names: readonly string[]): string {
  if (location === "header") {
    return `header:${name.toLowerCase()}`;
  }
  if (location === "path") {
    const index = names.indexOf(name);
    return index < 0 ? `path:${name}` : `pathpos:${index}`;
  }
  return `${location}:${name}`;
}

function collectParams(doc: Rec, entry: OpEntry): Map<string, ParamInfo> {
  const params = new Map<string, ParamInfo>();
  for (const owner of [entry.item, entry.op]) {
    const list = asRec(owner.value).parameters;
    if (!Array.isArray(list)) {
      continue;
    }
    for (let i = 0; i < list.length; i += 1) {
      const raw: Loc = {
        value: list[i],
        pointer: `${owner.pointer}/parameters/${i}`,
      };
      const loc = deref(doc, raw);
      const rec = asRec(loc.value);
      const name = rec.name;
      const location = rec.in;
      if (typeof name !== "string" || typeof location !== "string") {
        continue;
      }
      const schema = isObj(rec.schema)
        ? { value: rec.schema, pointer: `${loc.pointer}/schema` }
        : undefined;
      params.set(paramKey(location, name, entry.names), {
        label: `${quote(name)} in ${truncate(location, 20)}`,
        required: location === "path" || rec.required === true,
        pointer: loc.pointer,
        schema,
      });
    }
  }
  return params;
}

function diffParams(ctx: Ctx, b: OpEntry, h: OpEntry, out: Finding[]): void {
  const bparams = collectParams(ctx.base, b);
  const hparams = collectParams(ctx.head, h);
  for (const [key, bp] of bparams) {
    const hp = hparams.get(key);
    if (hp === undefined) {
      const message = `Parameter ${bp.label} removed`;
      out.push(warn(RULES.paramRemoved, bp.pointer, message));
      continue;
    }
    if (!bp.required && hp.required) {
      const message = `Parameter ${hp.label} became required`;
      out.push(breaking(RULES.paramRequired, hp.pointer, message));
    }
    if (bp.schema !== undefined && hp.schema !== undefined) {
      extend(out, compareSchemas(ctx, "request", bp.schema, hp.schema, 0));
    }
  }
  for (const [key, hp] of hparams) {
    if (bparams.has(key)) {
      continue;
    }
    const rule = RULES.paramAdded;
    if (hp.required) {
      const message = `Required parameter ${hp.label} added`;
      out.push(breaking(rule, hp.pointer, message));
    } else {
      const message = `Optional parameter ${hp.label} added`;
      out.push(info(rule, hp.pointer, message));
    }
  }
}

function normalizeMedia(name: string): string {
  const semi = name.indexOf(";");
  return (semi < 0 ? name : name.slice(0, semi)).trim().toLowerCase();
}

function isJsonMedia(name: string): boolean {
  return name === "application/json" || name.endsWith("+json");
}

function jsonMedia(content: Loc): Map<string, Loc> {
  const media = new Map<string, Loc>();
  for (const [name, entry] of Object.entries(asRec(content.value))) {
    const normalized = normalizeMedia(name);
    if (!isJsonMedia(normalized) || media.has(normalized)) {
      continue;
    }
    if (!isObj(entry) || !Object.hasOwn(entry, "schema")) {
      continue;
    }
    const pointer = `${content.pointer}/${esc(name)}/schema`;
    media.set(normalized, { value: entry.schema, pointer });
  }
  return media;
}

function compareContent(ctx: Ctx, dir: Direction, base: Loc, head: Loc, out: Finding[]): void {
  const bcontent = at(ctx.base, base, "content");
  const hcontent = at(ctx.head, head, "content");
  if (bcontent === undefined || hcontent === undefined) {
    return;
  }
  const hmedia = jsonMedia(hcontent);
  for (const [name, bschema] of jsonMedia(bcontent)) {
    const hschema = hmedia.get(name);
    if (hschema !== undefined) {
      extend(out, compareSchemas(ctx, dir, bschema, hschema, 0));
    }
  }
}

function diffBody(ctx: Ctx, b: OpEntry, h: OpEntry, out: Finding[]): void {
  const hbody = at(ctx.head, h.op, "requestBody");
  if (hbody === undefined) {
    return;
  }
  const bbody = at(ctx.base, b.op, "requestBody");
  const wasRequired = asRec(bbody?.value).required === true;
  if (asRec(hbody.value).required === true && !wasRequired) {
    const pointer = `${hbody.pointer}/required`;
    const message = "Request body became required";
    out.push(breaking(RULES.propRequired, pointer, message));
  }
  if (bbody !== undefined) {
    compareContent(ctx, "request", bbody, hbody, out);
  }
}

function diffResps(ctx: Ctx, b: OpEntry, h: OpEntry, out: Finding[]): void {
  const bres = at(ctx.base, b.op, "responses");
  const hres = at(ctx.head, h.op, "responses");
  if (bres === undefined || hres === undefined) {
    return;
  }
  const hrec = asRec(hres.value);
  for (const status of Object.keys(asRec(bres.value))) {
    if (!Object.hasOwn(hrec, status)) {
      continue;
    }
    const bresp = at(ctx.base, bres, status);
    const hresp = at(ctx.head, hres, status);
    if (bresp !== undefined && hresp !== undefined) {
      compareContent(ctx, "response", bresp, hresp, out);
    }
  }
}

function toChange(finding: Finding, method: string, path: string): Change {
  return {
    rule: finding.rule,
    severity: finding.severity,
    pointer: finding.pointer,
    method,
    path,
    message: finding.message,
  };
}

function diffOperation(ctx: Ctx, b: OpEntry, h: OpEntry, changes: Change[]): void {
  const found: Finding[] = [];
  diffParams(ctx, b, h, found);
  diffBody(ctx, b, h, found);
  diffResps(ctx, b, h, found);
  for (const finding of found) {
    changes.push(toChange(finding, h.method, h.path));
  }
}

function cmp(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function compareChanges(a: Change, b: Change): number {
  return (
    cmp(a.path ?? "", b.path ?? "") ||
    cmp(a.method ?? "", b.method ?? "") ||
    cmp(a.pointer, b.pointer)
  );
}

function changeKey(change: Change): string {
  const parts = [change.path, change.method, change.pointer, change.rule];
  return `${parts.join("\u0000")}\u0000${change.message}`;
}

function finish(changes: readonly Change[]): DiffReport {
  const unique = new Map<string, Change>();
  for (const change of changes) {
    const key = changeKey(change);
    if (!unique.has(key)) {
      unique.set(key, change);
    }
  }
  const sorted = [...unique.values()].sort(compareChanges);
  const counts = { breaking: 0, warning: 0, info: 0 };
  for (const change of sorted) {
    counts[change.severity] += 1;
  }
  return { changes: sorted, summary: counts };
}

/**
 * Diffs two documents and classifies every change.
 *
 * @param base - The previous document, from {@link loadSpec}.
 * @param head - The new document, from {@link loadSpec}.
 * @param options - Optional limits.
 * @returns The changes sorted by path, method and pointer, with a summary.
 * @throws {OpenApiDiffError} `unresolved_ref`, `too_deep` or `too_large`.
 * @throws {TypeError} When `maxComparisons` is not a non-negative integer.
 */
export function diffSpecs(
  base: OpenApiDocument,
  head: OpenApiDocument,
  options: DiffOptions = {},
): DiffReport {
  const max = options.maxComparisons ?? DEFAULT_MAX_COMPARISONS;
  if (!Number.isInteger(max) || max < 0) {
    throw new TypeError("maxComparisons must be a non-negative integer");
  }
  const ctx: Ctx = {
    base,
    head,
    max,
    count: 0,
    memo: new Map(),
    active: new Set(),
    hits: new Set(),
  };
  const baseOps = collectOps(base);
  const headOps = collectOps(head);
  const changes: Change[] = [];
  for (const [key, baseOp] of baseOps) {
    const headOp = headOps.get(key);
    if (headOp === undefined) {
      changes.push(removedChange(baseOp));
    } else {
      diffOperation(ctx, baseOp, headOp, changes);
    }
  }
  for (const [key, headOp] of headOps) {
    if (!baseOps.has(key)) {
      changes.push(addedChange(headOp));
    }
  }
  return finish(changes);
}

/**
 * Renders a report as plain text or as pretty-printed JSON.
 *
 * @param report - The report from {@link diffSpecs}.
 * @param format - `text` or `json`.
 * @returns The rendered report without a trailing newline.
 * @throws {TypeError} When `format` is neither `text` nor `json`.
 */
export function formatReport(report: DiffReport, format: ReportFormat): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }
  if (format !== "text") {
    throw new TypeError("format must be text or json");
  }
  const lines: string[] = [];
  for (const change of report.changes) {
    const subject = [change.rule, change.method?.toUpperCase(), change.path];
    const head = subject.filter((part) => part !== undefined).join(" ");
    const text = `${head}: ${change.message}`;
    lines.push(`[${change.severity}] ${text} (${change.pointer})`);
  }
  const s = report.summary;
  lines.push(`${s.breaking} breaking, ${s.warning} warning, ${s.info} info`);
  return lines.join("\n");
}
