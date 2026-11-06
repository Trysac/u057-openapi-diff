import { readFile, stat } from "node:fs/promises";
import * as api from "./index.js";

/** Output sinks used by {@link run}. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

type FailOn = "breaking" | "warning" | "none";

interface CliOptions {
  base: string;
  head: string;
  format: api.ReportFormat;
  failOn: FailOn;
}

type Parsed =
  | { kind: "run"; options: CliOptions }
  | { kind: "help" }
  | { kind: "error"; message: string };

const USAGE = `Usage: openapi-diff <base> <head> [options]

Options:
  --format text|json                 Output format (default: text)
  --fail-on breaking|warning|none    Exit 1 at this severity (default: breaking)
  -h, --help                         Show this help

Exit codes: 0 no failing change, 1 failing change found, 2 usage or input error
`;

function isFormat(value: string): value is api.ReportFormat {
  return value === "text" || value === "json";
}

function isFailOn(value: string): value is FailOn {
  return value === "breaking" || value === "warning" || value === "none";
}

function usageError(message: string): Parsed {
  return { kind: "error", message: message.slice(0, 120) };
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  let format: api.ReportFormat = "text";
  let failOn: FailOn = "breaking";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg : arg.slice(0, eq);
    let value = eq < 0 ? undefined : arg.slice(eq + 1);
    if (name !== "--format" && name !== "--fail-on") {
      return usageError(`Unknown option ${arg}`);
    }
    if (value === undefined) {
      i += 1;
      value = argv[i];
    }
    if (value === undefined) {
      return usageError(`Missing value for ${name}`);
    }
    if (name === "--format" && isFormat(value)) {
      format = value;
    } else if (name === "--fail-on" && isFailOn(value)) {
      failOn = value;
    } else {
      return usageError(`Invalid value for ${name}`);
    }
  }
  const [base, head] = positional;
  if (positional.length !== 2 || base === undefined || head === undefined) {
    return usageError("Expected exactly two files: <base> <head>");
  }
  return { kind: "run", options: { base, head, format, failOn } };
}

async function readSpecFile(path: string): Promise<string> {
  const label = JSON.stringify(path.slice(0, 100));
  try {
    const info = await stat(path);
    if (info.size > api.MAX_SPEC_BYTES) {
      throw new api.OpenApiDiffError("too_large", `File ${label} is too large`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof api.OpenApiDiffError) {
      throw error;
    }
    throw new api.OpenApiDiffError("parse_error", `Cannot read ${label}`);
  }
}

function exitCode(report: api.DiffReport, failOn: FailOn): number {
  if (failOn === "none") {
    return 0;
  }
  const { breaking, warning } = report.summary;
  const failing = failOn === "breaking" ? breaking : breaking + warning;
  return failing > 0 ? 1 : 0;
}

/**
 * Runs the command line interface.
 *
 * @param argv - Arguments without the program name.
 * @param io - Output sinks for standard output and standard error.
 * @returns The exit code: 0 when no change reaches `--fail-on`, 1 when one
 * does, 2 on usage errors or unreadable, unparsable or oversized input.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    io.stdout(USAGE);
    return 0;
  }
  if (parsed.kind === "error") {
    io.stderr(`${parsed.message}\n${USAGE}`);
    return 2;
  }
  const { base, head, format, failOn } = parsed.options;
  try {
    const baseDoc = api.loadSpec(await readSpecFile(base));
    const headDoc = api.loadSpec(await readSpecFile(head));
    const report = api.diffSpecs(baseDoc, headDoc);
    io.stdout(`${api.formatReport(report, format)}\n`);
    return exitCode(report, failOn);
  } catch (error) {
    if (!(error instanceof api.OpenApiDiffError)) {
      throw error;
    }
    io.stderr(`error [${error.code}]: ${error.message}\n`);
    return 2;
  }
}
