import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { getPackageVersion } from "./version.js";

describe("version", () => {
  it("matches package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(getPackageVersion()).toBe(packageJson.version);
  });
});
