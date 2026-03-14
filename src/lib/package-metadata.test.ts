import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

// Agent note: keep package metadata honest for parallel release work.
describe("package metadata", () => {
  test("package does not depend on itself", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    const dependencySections = [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.peerDependencies,
      packageJson.optionalDependencies,
    ];

    for (const deps of dependencySections) {
      expect(deps?.[packageJson.name]).toBeUndefined();
    }
  });
});
