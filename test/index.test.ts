import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

const OP = `paths:
  /x:
    get:
      responses:
        "200": {description: ok}
`;

const OP_POST = `paths:
  /x:
    post:
      responses:
        "200": {description: ok}
`;

const STR = "{type: string}";
const INT = "{type: integer}";
const NUM = "{type: number}";
const RO_STR = "{type: string, readOnly: true}";
const WO_STR = "{type: string, writeOnly: true}";
const RESP_SCHEMA = "/paths/~1x/get/responses/200/content/application~1json/schema";
const REQ_SCHEMA = "/paths/~1x/post/requestBody/content/application~1json/schema";

const COMPONENTS = `components:
  schemas:
    Wrap:
      allOf:
        - {type: string}
`;

const COMPONENTS_INT = `components:
  schemas:
    Wrap:
      allOf:
        - {type: integer}
`;

function spec(body: string, version = '3.1.0"'.slice(0, 5)): api.OpenApiDocument {
  const head = `openapi: ${version}\ninfo: {title: t, version: "1"}\n`;
  return api.loadSpec(`${head}${body}`);
}

function diff(
  base: string,
  head: string,
  baseVersion = "3.1.0",
  headVersion = "3.1.0",
): api.Change[] {
  const left = spec(base, baseVersion);
  const right = spec(head, headVersion);
  return api.diffSpecs(left, right).changes;
}

function fails(fn: () => unknown): api.OpenApiDiffError {
  try {
    fn();
  } catch (error) {
    if (error instanceof api.OpenApiDiffError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected an OpenApiDiffError");
}

function brief(changes: api.Change[]): string[] {
  const out: string[] = [];
  for (const change of changes) {
    out.push(`${change.rule}:${change.severity}`);
  }
  return out;
}

function obj(props: Record<string, string>, required: string[] = []): string {
  const entries: string[] = [];
  for (const [name, schema] of Object.entries(props)) {
    entries.push(`${name}: ${schema}`);
  }
  const needed = required.length > 0 ? `, required: [${required.join(", ")}]` : "";
  return `{type: object, properties: {${entries.join(", ")}}${needed}}`;
}

function resp(schema: string, media = "application/json"): string {
  return `paths:
  /x:
    get:
      responses:
        "200":
          description: ok
          content:
            "${media}":
              schema: ${schema}
`;
}

function req(schema: string, media = "application/json"): string {
  return `paths:
  /x:
    post:
      requestBody:
        content:
          "${media}":
            schema: ${schema}
      responses:
        "200": {description: ok}
`;
}

function reqBody(flag: string): string {
  return `paths:
  /x:
    post:
      requestBody:
        required: ${flag}
        content:
          application/json:
            schema: ${STR}
      responses:
        "200": {description: ok}
`;
}

function pathBody(path: string): string {
  return `paths:
  "${path}":
    get:
      responses:
        "200": {description: ok}
`;
}

function withParams(...defs: string[]): string {
  const items = defs.map((def) => `        - {${def}}`).join("\n");
  return `paths:
  /x:
    get:
      parameters:
${items}
      responses:
        "200": {description: ok}
`;
}

function pathParam(path: string, name: string): string {
  return `paths:
  "${path}":
    get:
      parameters:
        - {name: ${name}, in: path, required: true, schema: ${STR}}
      responses:
        "200": {description: ok}
`;
}

function chain(levels: number, leaf: string): string {
  let schema = leaf;
  for (let i = 0; i < levels; i += 1) {
    schema = `{type: object, properties: {p: ${schema}}}`;
  }
  return schema;
}

function wide(count: number): string {
  const props: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    props[`p${i}`] = STR;
  }
  return resp(obj(props));
}

function nodeSpec(properties: string): string {
  return `paths:
  /n:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: {$ref: "#/components/schemas/Node"}
components:
  schemas:
    Node:
      type: object
      properties:
${properties}
        children:
          type: array
          items: {$ref: "#/components/schemas/Node"}
`;
}

function sharedSpec(props: string): string {
  return `paths:
  /a:
    get:
      responses:
        "200":
          content:
            application/json:
              schema: {$ref: "#/components/schemas/S"}
  /b:
    get:
      responses:
        "200":
          content:
            application/json:
              schema: {$ref: "#/components/schemas/S"}
components:
  schemas:
    S:
      type: object
      properties:
${props}
`;
}

function billionLaughs(): string {
  const seed = Array.from({ length: 9 }, () => '"lol"').join(", ");
  const lines = [`a: &a [${seed}]`];
  let previous = "a";
  for (const name of "bcdefghi".split("")) {
    const refs = Array.from({ length: 9 }, () => `*${previous}`).join(", ");
    lines.push(`${name}: &${name} [${refs}]`);
    previous = name;
  }
  return `${lines.join("\n")}\n`;
}

describe("loadSpec", () => {
  it("parses YAML and JSON documents", () => {
    expect(spec(OP, "3.0.3").openapi).toBe("3.0.3");
    const json = api.loadSpec('  {"openapi": "3.1.0", "paths": {}}');
    expect(json.openapi).toBe("3.1.0");
    expect(api.loadSpec("openapi: 3.1.0-rc1\n").openapi).toBe("3.1.0-rc1");
  });

  it("accepts local references", () => {
    const body = `${resp('{$ref: "#"}')}${COMPONENTS}`;
    expect(spec(body).openapi).toBe("3.1.0");
  });

  it("rejects unsupported versions", () => {
    const inputs = [
      'swagger: "2.0"\ninfo: {title: t, version: "1"}\npaths: {}\n',
      "info: {title: t}\n",
      "openapi: 4.0.0\n",
      "openapi: 3.1\n",
      "openapi: 3.2.0\n",
    ];
    for (const input of inputs) {
      expect(fails(() => api.loadSpec(input)).code).toBe("unsupported_version");
    }
    const long = `openapi: ${"9".repeat(1000)}.0.0\n`;
    const error = fails(() => api.loadSpec(long));
    expect(error.code).toBe("unsupported_version");
    expect(error.message.length).toBeLessThanOrEqual(200);
  });

  it("rejects external and malformed references", () => {
    const refs = ["other.yaml#/Foo", "https://example.com/x.json", "#foo"];
    for (const ref of refs) {
      const text = resp(`{$ref: "${ref}"}`);
      expect(fails(() => spec(text)).code).toBe("unresolved_ref");
    }
    const long = resp(`{$ref: "${"x".repeat(1000)}.yaml"}`);
    const error = fails(() => spec(long));
    expect(error.code).toBe("unresolved_ref");
    expect(error.message.length).toBeLessThanOrEqual(200);
  });

  it("enforces the size limit in UTF-8 bytes", () => {
    const huge = "a".repeat(10_485_761);
    expect(fails(() => api.loadSpec(huge)).code).toBe("too_large");
    const twoByte = "é".repeat(5_242_881);
    expect(fails(() => api.loadSpec(twoByte)).code).toBe("too_large");
    const threeByte = "€".repeat(3_495_254);
    expect(fails(() => api.loadSpec(threeByte)).code).toBe("too_large");
    const astral = "😀".repeat(2_621_441);
    expect(fails(() => api.loadSpec(astral)).code).toBe("too_large");
    const lone = "\ud800".repeat(3_495_254);
    expect(fails(() => api.loadSpec(lone)).code).toBe("too_large");
  });

  it("accepts a document of exactly the maximum size", () => {
    const core = '{"openapi":"3.0.0"}';
    const text = core + " ".repeat(api.MAX_SPEC_BYTES - core.length);
    expect(api.loadSpec(text).openapi).toBe("3.0.0");
    const exact = "é".repeat(5_242_880);
    expect(fails(() => api.loadSpec(exact)).code).toBe("parse_error");
  });

  it("reports parse errors", () => {
    const inputs = ["a: 1\na: 2\n", billionLaughs(), '{"openapi": ', "just text", "", "- a\n"];
    for (const input of inputs) {
      expect(fails(() => api.loadSpec(input)).code).toBe("parse_error");
    }
    const notText = 42 as unknown as string;
    expect(fails(() => api.loadSpec(notText)).code).toBe("parse_error");
  });

  it("rejects documents nested too deeply", () => {
    const nested = `${"[".repeat(300)}${"]".repeat(300)}`;
    const deep = `{"openapi":"3.0.0","x":${nested}}`;
    expect(fails(() => api.loadSpec(deep)).code).toBe("too_deep");
  });
});

describe("OpenApiDiffError", () => {
  it("carries a code and caps the message length", () => {
    const error = new api.OpenApiDiffError("too_large", "x".repeat(500));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OpenApiDiffError");
    expect(error.code).toBe("too_large");
    expect(error.message.length).toBeLessThanOrEqual(200);
  });
});

describe("diffSpecs operations", () => {
  it("reports a removed operation", () => {
    const base = `paths:
  /users:
    get:
      responses:
        "200": {description: ok}
  /users/{id}:
    get:
      responses:
        "200": {description: ok}
`;
    const head = `paths:
  /users:
    get:
      responses:
        "200": {description: ok}
`;
    const changes = diff(base, head);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "operation-removed",
      severity: "breaking",
      method: "get",
      path: "/users/{id}",
      pointer: "/paths/~1users~1{id}/get",
    });
  });

  it("reports an added operation as info", () => {
    const head = `${OP}  /y:
    get:
      responses:
        "200": {description: ok}
`;
    const changes = diff(OP, head);
    expect(brief(changes)).toEqual(["operation-added:info"]);
    expect(changes[0]?.pointer).toBe("/paths/~1y/get");
  });

  it("matches paths after normalising template names", () => {
    expect(diff(pathBody("/users/{id}"), pathBody("/users/{userId}"))).toEqual([]);
  });

  it("treats a trailing slash as a different path", () => {
    const changes = diff(pathBody("/users/{id}"), pathBody("/users/{id}/"));
    expect(brief(changes)).toEqual(["operation-removed:breaking", "operation-added:info"]);
  });

  it("escapes ~ and / in pointers", () => {
    const changes = diff(pathBody("/a~b/c"), "paths: {}\n");
    expect(changes[0]?.pointer).toBe("/paths/~1a~0b~1c/get");
  });

  it("ignores extension keys and unknown methods", () => {
    const body = `paths:
  x-internal: {get: {}}
  /x:
    summary: s
    get:
      responses:
        "200": {description: ok}
`;
    expect(diff(body, body)).toEqual([]);
  });

  it("sorts changes by path, method and pointer", () => {
    const base = `paths:
  /b:
    get:
      responses:
        "200": {description: ok}
  /a:
    post:
      responses:
        "200": {description: ok}
    get:
      responses:
        "200": {description: ok}
`;
    const changes = diff(base, "paths: {}\n");
    const order = changes.map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual(["get /a", "post /a", "get /b"]);
  });

  it("summarises changes per severity", () => {
    const base = `paths:
  /x:
    get:
      parameters:
        - {name: q, in: query}
      responses:
        "200": {description: ok}
  /gone:
    get:
      responses:
        "200": {description: ok}
`;
    const head = `paths:
  /x:
    get:
      responses:
        "200": {description: ok}
  /new:
    get:
      responses:
        "200": {description: ok}
`;
    const report = api.diffSpecs(spec(base), spec(head));
    expect(report.summary).toEqual({ breaking: 1, warning: 1, info: 1 });
    expect(api.diffSpecs(spec(base), spec(base)).summary).toEqual({
      breaking: 0,
      warning: 0,
      info: 0,
    });
  });
});

describe("diffSpecs parameters", () => {
  it("flags a new required parameter as breaking", () => {
    const added = withParams("name: limit, in: query, required: true");
    const changes = diff(OP, added);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "param-added",
      severity: "breaking",
      pointer: "/paths/~1x/get/parameters/0",
    });
  });

  it("flags a new optional parameter as info", () => {
    const added = withParams("name: limit, in: query");
    const changes = diff(OP, added);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "param-added",
      severity: "info",
    });
  });

  it("compares header names case-insensitively", () => {
    const upper = withParams("name: X-Trace, in: header");
    const lower = withParams("name: x-trace, in: header");
    expect(diff(upper, lower)).toEqual([]);
  });

  it("compares query names case-sensitively", () => {
    const upper = withParams("name: Q, in: query");
    const lower = withParams("name: q, in: query");
    expect(brief(diff(upper, lower))).toEqual(["param-removed:warning", "param-added:info"]);
  });

  it("flags a removed parameter as warning", () => {
    const base = withParams("name: q, in: query");
    const changes = diff(base, OP);
    expect(brief(changes)).toEqual(["param-removed:warning"]);
    expect(changes[0]?.pointer).toBe("/paths/~1x/get/parameters/0");
  });

  it("flags a parameter that became required", () => {
    const base = withParams("name: q, in: query");
    const head = withParams("name: q, in: query, required: true");
    expect(brief(diff(base, head))).toEqual(["param-became-required:breaking"]);
  });

  it("does not flag a parameter that stopped being required", () => {
    const base = withParams("name: q, in: query, required: true");
    const head = withParams("name: q, in: query");
    expect(diff(base, head)).toEqual([]);
  });

  it("lets operation-level parameters override path-level ones", () => {
    const base = `paths:
  /x:
    parameters:
      - {name: q, in: query, required: false}
    get:
      responses:
        "200": {description: ok}
`;
    const head = `paths:
  /x:
    parameters:
      - {name: q, in: query, required: false}
    get:
      parameters:
        - {name: q, in: query, required: true}
      responses:
        "200": {description: ok}
`;
    const changes = diff(base, head);
    expect(brief(changes)).toEqual(["param-became-required:breaking"]);
    expect(changes[0]?.pointer).toBe("/paths/~1x/get/parameters/0");
  });

  it("matches path parameters by position", () => {
    const base = pathParam("/users/{id}", "id");
    const head = pathParam("/users/{userId}", "userId");
    expect(diff(base, head)).toEqual([]);
  });

  it("keeps path parameters that are not in the template by name", () => {
    const base = pathParam("/users", "id");
    const head = pathParam("/users", "other");
    expect(brief(diff(base, head))).toEqual(["param-removed:warning", "param-added:breaking"]);
  });

  it("resolves referenced parameters", () => {
    const head = `paths:
  /x:
    get:
      parameters:
        - $ref: "#/components/parameters/Limit"
      responses:
        "200": {description: ok}
components:
  parameters:
    Limit: {name: limit, in: query, required: true}
`;
    const changes = diff(OP, head);
    expect(brief(changes)).toEqual(["param-added:breaking"]);
    expect(changes[0]?.pointer).toBe("/components/parameters/Limit");
  });

  it("skips parameters without a name or location", () => {
    const body = withParams("in: query", "name: q");
    expect(diff(body, body)).toEqual([]);
  });

  it("compares parameter schemas as request schemas", () => {
    const base = withParams(`name: n, in: query, schema: ${NUM}`);
    const head = withParams(`name: n, in: query, schema: ${INT}`);
    const changes = diff(base, head);
    expect(brief(changes)).toEqual(["type-changed:breaking"]);
    expect(changes[0]?.pointer).toBe("/paths/~1x/get/parameters/0/schema");
  });
});

describe("diffSpecs schemas", () => {
  it("treats 3.0 nullable like a 3.1 null type", () => {
    const old30 = resp("{type: string, nullable: true}");
    const new31 = resp('{type: [string, "null"]}');
    expect(diff(old30, new31, "3.0.3", "3.1.0")).toEqual([]);
    expect(diff(new31, old30, "3.1.0", "3.0.3")).toEqual([]);
    const oldReq30 = req("{type: string, nullable: true}");
    const newReq31 = req('{type: [string, "null"]}');
    expect(diff(oldReq30, newReq31, "3.0.3", "3.1.0")).toEqual([]);
  });

  it("flags a removed response property", () => {
    const before = resp(obj({ a: STR, b: STR }));
    const after = resp(obj({ a: STR }));
    const changes = diff(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "response-property-removed",
      severity: "breaking",
      pointer: `${RESP_SCHEMA}/properties/b`,
    });
  });

  it("does not flag a removed request property", () => {
    const before = req(obj({ a: STR, b: STR }));
    const after = req(obj({ a: STR }));
    expect(diff(before, after)).toEqual([]);
  });

  it("ignores readOnly request and writeOnly response properties", () => {
    const before = req(obj({ id: RO_STR, name: STR }));
    const after = req(obj({ name: STR }));
    expect(diff(before, after)).toEqual([]);
    const respBefore = resp(obj({ a: STR, secret: WO_STR }));
    const respAfter = resp(obj({ a: STR }));
    expect(diff(respBefore, respAfter)).toEqual([]);
    const kept = resp(obj({ a: STR, secret: WO_STR }));
    const changed = resp(obj({ a: STR, secret: INT }));
    expect(diff(kept, changed)).toEqual([]);
  });

  it("reports a removed readOnly response property", () => {
    const before = resp(obj({ a: STR, id: RO_STR }));
    const after = resp(obj({ a: STR }));
    expect(brief(diff(before, after))).toEqual(["response-property-removed:breaking"]);
  });

  it("flags a response that gains null", () => {
    const before = resp(STR);
    const after = resp('{type: [string, "null"]}');
    expect(brief(diff(before, after))).toEqual(["type-changed:breaking"]);
  });

  it("applies the integer subset rule to requests", () => {
    expect(diff(req(INT), req(NUM))).toEqual([]);
    const changes = diff(req(NUM), req(INT));
    expect(brief(changes)).toEqual(["type-changed:breaking"]);
    expect(changes[0]?.pointer).toBe(REQ_SCHEMA);
  });

  it("applies the integer subset rule to responses", () => {
    expect(diff(resp(NUM), resp(INT))).toEqual([]);
    expect(brief(diff(resp(INT), resp(NUM)))).toEqual(["type-changed:breaking"]);
  });

  it("does not flag a request that accepts more types", () => {
    expect(diff(req(STR), req('{type: [string, "null"]}'))).toEqual([]);
  });

  it("treats a missing type as every type", () => {
    const changes = diff(req("{description: d}"), req(STR));
    expect(brief(changes)).toEqual(["type-changed:breaking"]);
    expect(changes[0]?.message).toContain("any");
    expect(brief(diff(req(STR), req("{description: d}")))).toEqual([]);
    expect(brief(diff(resp(STR), resp("{description: d}")))).toEqual(["type-changed:breaking"]);
  });

  it("flags a new required request property", () => {
    const before = req(obj({ a: STR }));
    const after = req(obj({ a: STR, b: STR }, ["b"]));
    const changes = diff(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "request-property-became-required",
      severity: "breaking",
      pointer: `${REQ_SCHEMA}/required`,
    });
  });

  it("flags an existing request property that became required", () => {
    const before = req(obj({ a: STR }));
    const after = req(obj({ a: STR }, ["a"]));
    expect(brief(diff(before, after))).toEqual(["request-property-became-required:breaking"]);
  });

  it("ignores readOnly properties that became required", () => {
    const before = req(obj({ id: RO_STR, n: STR }));
    const after = req(obj({ id: RO_STR, n: STR }, ["id"]));
    expect(diff(before, after)).toEqual([]);
  });

  it("flags a request body that became required", () => {
    const changes = diff(reqBody("false"), reqBody("true"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "request-property-became-required",
      pointer: "/paths/~1x/post/requestBody/required",
    });
    expect(brief(diff(OP_POST, reqBody("true")))).toEqual([
      "request-property-became-required:breaking",
    ]);
    expect(diff(reqBody("true"), reqBody("false"))).toEqual([]);
    expect(diff(reqBody("true"), OP_POST)).toEqual([]);
  });

  it("flags removed request enum values", () => {
    const before = req("{type: string, enum: [a, b]}");
    const after = req("{type: string, enum: [a]}");
    const changes = diff(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "request-enum-value-removed",
      severity: "breaking",
      pointer: `${REQ_SCHEMA}/enum`,
    });
  });

  it("compares enum values as JSON values", () => {
    const strings = req('{enum: ["1"]}');
    const numbers = req("{enum: [1]}");
    expect(brief(diff(strings, numbers))).toEqual(["request-enum-value-removed:breaking"]);
    expect(diff(resp("{enum: [1]}"), resp("{enum: [1.0]}"))).toEqual([]);
  });

  it("warns about added response enum values", () => {
    const changes = diff(resp("{enum: [1]}"), resp("{enum: [1, 2]}"));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "response-enum-value-added",
      severity: "warning",
    });
    expect(diff(resp("{enum: [1, 2]}"), resp("{enum: [1]}"))).toEqual([]);
    expect(diff(req("{enum: [a]}"), req("{enum: [a, b]}"))).toEqual([]);
  });

  it("ignores enums that exist on only one side", () => {
    expect(diff(req(STR), req("{type: string, enum: [a]}"))).toEqual([]);
  });

  it("reports composition changes once as a warning", () => {
    const before = resp("{oneOf: [{type: string}, {type: integer}]}");
    const after = resp("{oneOf: [{type: string}]}");
    const changes = diff(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "type-changed",
      severity: "warning",
      message: "composition changed, not analysed",
    });
    expect(diff(before, before)).toEqual([]);
    const notBefore = resp("{not: {type: string}}");
    const notAfter = resp("{not: {type: integer}}");
    expect(brief(diff(notBefore, notAfter))).toEqual(["type-changed:warning"]);
  });

  it("compares array items", () => {
    const before = resp(`{type: array, items: ${obj({ a: STR })}}`);
    const after = resp(`{type: array, items: ${obj({})}}`);
    const changes = diff(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.pointer).toBe(`${RESP_SCHEMA}/items/properties/a`);
  });

  it("only compares JSON media types", () => {
    expect(diff(resp(STR, "text/plain"), resp(INT, "text/plain"))).toEqual([]);
    const vnd = diff(resp(STR, "application/vnd.api+json"), resp(INT, "application/vnd.api+json"));
    expect(brief(vnd)).toEqual(["type-changed:breaking"]);
    expect(vnd[0]?.pointer).toContain("application~1vnd.api+json");
    const withCharset = diff(resp(STR, "application/json; charset=utf-8"), resp(INT));
    expect(brief(withCharset)).toEqual(["type-changed:breaking"]);
  });

  it("skips media types without a schema or present on one side", () => {
    const noSchema = `paths:
  /x:
    get:
      responses:
        "200":
          content:
            application/json: {}
`;
    expect(diff(noSchema, resp(STR))).toEqual([]);
    expect(diff(resp(STR), noSchema)).toEqual([]);
    expect(diff(resp(STR, "application/json"), resp(INT, "text/plain"))).toEqual([]);
  });

  it("only compares response statuses present on both sides", () => {
    const base = `paths:
  /x:
    get:
      responses:
        "200":
          content:
            application/json: {schema: {type: string}}
`;
    const head = `paths:
  /x:
    get:
      responses:
        "201":
          content:
            application/json: {schema: {type: integer}}
`;
    expect(diff(base, head)).toEqual([]);
    expect(diff(base, OP)).toEqual([]);
  });
});

describe("diffSpecs references", () => {
  it("diffs a self-referencing schema and reports a change once", () => {
    const before = nodeSpec("        name: {type: string}");
    const after = nodeSpec("");
    const changes = diff(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      rule: "response-property-removed",
      pointer: "/components/schemas/Node/properties/name",
    });
    expect(diff(before, before)).toEqual([]);
  });

  it("compares shared references once but reports every operation", () => {
    const before = sharedSpec("        a: {type: string}");
    const after = sharedSpec("");
    const report = api.diffSpecs(spec(before), spec(after), {
      maxComparisons: 1,
    });
    expect(report.changes).toHaveLength(2);
    expect(report.changes.map((c) => c.path)).toEqual(["/a", "/b"]);
    for (const change of report.changes) {
      expect(change.pointer).toBe("/components/schemas/S/properties/a");
    }
  });

  it("resolves array indexes and reports the target pointer", () => {
    const ref = '{$ref: "#/components/schemas/Wrap/allOf/0"}';
    const changes = diff(`${resp(ref)}${COMPONENTS}`, `${resp(ref)}${COMPONENTS_INT}`);
    expect(brief(changes)).toEqual(["type-changed:breaking"]);
    expect(changes[0]?.pointer).toBe("/components/schemas/Wrap/allOf/0");
  });

  it("raises unresolved_ref for bad local references", () => {
    const refs = [
      "#/components/schemas/Missing",
      "#/components/schemas/%E0%A4%A",
      "#/components/schemas/Wrap/allOf/5",
      "#/components/schemas/Wrap/allOf/x",
      "#/components/schemas/Wrap/allOf/0/type/deeper",
      "#/",
    ];
    for (const ref of refs) {
      const body = `${resp(`{$ref: "${ref}"}`)}${COMPONENTS}`;
      expect(fails(() => diff(body, body)).code).toBe("unresolved_ref");
    }
  });

  it("raises unresolved_ref for external references in raw documents", () => {
    const raw = {
      openapi: "3.1.0",
      paths: { "/x": { $ref: "other.yaml#/x" } },
    };
    const error = fails(() => api.diffSpecs(raw, raw));
    expect(error.code).toBe("unresolved_ref");
  });

  it("stops on reference loops", () => {
    const loop = `components:
  schemas:
    A: {$ref: "#/components/schemas/A"}
`;
    const body = `${resp('{$ref: "#/components/schemas/A"}')}${loop}`;
    expect(fails(() => diff(body, body)).code).toBe("too_deep");
  });

  it("limits the schema depth", () => {
    const deep = resp(chain(70, STR));
    expect(fails(() => diff(deep, deep)).code).toBe("too_deep");
    const shallow = resp(chain(30, STR));
    expect(diff(shallow, shallow)).toEqual([]);
  });

  it("limits the number of schema comparisons", () => {
    const doc = wide(12);
    const error = fails(() => api.diffSpecs(spec(doc), spec(doc), { maxComparisons: 10 }));
    expect(error.code).toBe("too_large");
    expect(fails(() => api.diffSpecs(spec(doc), spec(doc), { maxComparisons: 12 })).code).toBe(
      "too_large",
    );
    const report = api.diffSpecs(spec(doc), spec(doc), { maxComparisons: 13 });
    expect(report.changes).toEqual([]);
    expect(api.diffSpecs(spec(doc), spec(doc)).changes).toEqual([]);
  });

  it("validates the maxComparisons option", () => {
    const doc = spec(OP);
    expect(() => api.diffSpecs(doc, doc, { maxComparisons: -1 })).toThrow(TypeError);
    expect(() => api.diffSpecs(doc, doc, { maxComparisons: 1.5 })).toThrow(TypeError);
  });
});

describe("formatReport", () => {
  const removed = api.diffSpecs(spec(pathBody("/users")), spec("paths: {}\n"));

  it("renders text", () => {
    const text = api.formatReport(removed, "text");
    expect(text).toContain("[breaking] operation-removed GET /users");
    expect(text).toContain("/paths/~1users/get");
    expect(text).toContain("1 breaking, 0 warning, 0 info");
  });

  it("renders an empty report", () => {
    const empty = api.diffSpecs(spec(OP), spec(OP));
    expect(api.formatReport(empty, "text")).toBe("0 breaking, 0 warning, 0 info");
  });

  it("renders changes without a method or path", () => {
    const report: api.DiffReport = {
      changes: [
        {
          rule: "type-changed",
          severity: "warning",
          pointer: "/a",
          message: "m",
        },
      ],
      summary: { breaking: 0, warning: 1, info: 0 },
    };
    const lines = api.formatReport(report, "text").split("\n");
    expect(lines[0]).toBe("[warning] type-changed: m (/a)");
  });

  it("renders JSON", () => {
    const json = api.formatReport(removed, "json");
    expect(json).toBe(JSON.stringify(removed, null, 2));
    const parsed = JSON.parse(json) as api.DiffReport;
    expect(parsed.summary.breaking).toBe(1);
    expect(parsed.changes).toHaveLength(1);
  });

  it("rejects unknown formats", () => {
    expect(() => api.formatReport(removed, "xml" as "text")).toThrow(TypeError);
  });
});
