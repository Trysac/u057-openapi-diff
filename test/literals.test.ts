import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { diffSpecs, loadSpec } from "../src/index.js";

const FX = "test/fixtures/";

describe("acceptance literals", () => {
  const reqSpec = (values: unknown[]): string =>
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t", version: "1" },
      paths: {
        "/x": {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: { enum: values } },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });

  it.each([
    [["a", "b"], ["a"]],
    [["1"], [1]],
  ])("request enum %j to %j is request-enum-value-removed", (from, to) => {
    const report = diffSpecs(loadSpec(reqSpec(from)), loadSpec(reqSpec(to)));
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]?.rule).toBe("request-enum-value-removed");
    expect(report.changes[0]?.severity).toBe("breaking");
    expect(report.changes[0]?.pointer.endsWith("/enum")).toBe(true);
  });

  it("reports operation-removed with the full change shape", () => {
    const mk = (withOp: boolean): string =>
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t", version: "1" },
        paths: {
          "/users/{id}": withOp ? { get: { responses: { "200": { description: "ok" } } } } : {},
        },
      });
    const report = diffSpecs(loadSpec(mk(true)), loadSpec(mk(false)));
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]).toMatchObject({
      rule: "operation-removed",
      severity: "breaking",
      method: "get",
      path: "/users/{id}",
      pointer: "/paths/~1users~1{id}/get",
    });
  });

  it("runs with --format json", async () => {
    let out = "";
    const code = await run(["--format", "json", `${FX}base.yaml`, `${FX}head-breaking.yaml`], {
      stdout: (s) => {
        out += s;
      },
      stderr: () => {},
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(out);
    expect(parsed.changes.length).toBe(
      parsed.summary.breaking + parsed.summary.warning + parsed.summary.info,
    );
  });
});
