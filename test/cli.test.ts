import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

const FX = "test/fixtures";
const BASE = `${FX}/base.yaml`;

interface Captured {
  code: number;
  out: string;
  err: string;
}

async function exec(args: string[]): Promise<Captured> {
  let out = "";
  let err = "";
  const code = await run(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe("run exit codes", () => {
  it("returns 1 when a breaking change exists", async () => {
    const result = await exec([BASE, `${FX}/head-breaking.yaml`]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("[breaking] operation-removed GET");
    expect(result.out).toContain("1 breaking, 0 warning, 0 info");
    expect(result.err).toBe("");
  });

  it("returns 0 for identical documents", async () => {
    const result = await exec([BASE, BASE]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("0 breaking, 0 warning, 0 info");
  });

  it("honours --fail-on for warnings", async () => {
    const head = `${FX}/head-warning.yaml`;
    expect((await exec([BASE, head])).code).toBe(0);
    expect((await exec([BASE, head, "--fail-on", "warning"])).code).toBe(1);
    expect((await exec([BASE, head, "--fail-on=none"])).code).toBe(0);
  });

  it("honours --fail-on none for breaking changes", async () => {
    const head = `${FX}/head-breaking.yaml`;
    expect((await exec([BASE, head, "--fail-on", "none"])).code).toBe(0);
    expect((await exec([BASE, head, "--fail-on", "warning"])).code).toBe(1);
  });

  it("does not fail on info changes", async () => {
    const head = `${FX}/head-info.yaml`;
    expect((await exec([BASE, head, "--fail-on", "warning"])).code).toBe(0);
    expect((await exec([BASE, head])).out).toContain("operation-added");
  });
});

describe("run output", () => {
  it("prints JSON whose summary equals the changes", async () => {
    const head = `${FX}/head-breaking.yaml`;
    const result = await exec(["--format", "json", BASE, head]);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out) as {
      changes: { severity: string }[];
      summary: Record<string, number>;
    };
    expect(report.changes.length).toBeGreaterThan(0);
    for (const severity of ["breaking", "warning", "info"]) {
      const count = report.changes.filter((c) => c.severity === severity).length;
      expect(report.summary[severity]).toBe(count);
    }
  });

  it("accepts --format=json", async () => {
    const result = await exec([BASE, `${FX}/head-warning.yaml`, "--format=json"]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out) as { summary: { warning: number } };
    expect(report.summary.warning).toBe(1);
  });

  it("prints usage for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const result = await exec([flag]);
      expect(result.code).toBe(0);
      expect(result.out).toContain("Usage: openapi-diff");
    }
  });
});

describe("run errors", () => {
  it("returns 2 for unparsable input", async () => {
    const result = await exec([BASE, `${FX}/bad.yaml`]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("parse_error");
    expect(result.out).toBe("");
  });

  it("returns 2 for unsupported versions", async () => {
    const result = await exec([`${FX}/swagger2.yaml`, BASE]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unsupported_version");
  });

  it("returns 2 for missing files and directories", async () => {
    const missing = await exec([BASE, `${FX}/missing.yaml`]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("Cannot read");
    const directory = await exec([BASE, FX]);
    expect(directory.code).toBe(2);
  });

  it("returns 2 for files over the size limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openapi-diff-"));
    try {
      const big = join(dir, "big.yaml");
      await writeFile(big, "a".repeat(10_485_761));
      const result = await exec([big, BASE]);
      expect(result.code).toBe(2);
      expect(result.err).toContain("too_large");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 2 for usage errors", async () => {
    const cases = [
      [],
      [BASE],
      [BASE, BASE, BASE],
      [BASE, BASE, "--verbose"],
      [BASE, BASE, "--format"],
      [BASE, BASE, "--format", "xml"],
      [BASE, BASE, "--fail-on"],
      [BASE, BASE, "--fail-on", "maybe"],
    ];
    for (const args of cases) {
      const result = await exec(args);
      expect(result.code).toBe(2);
      expect(result.err).toContain("Usage: openapi-diff");
    }
  });
});
