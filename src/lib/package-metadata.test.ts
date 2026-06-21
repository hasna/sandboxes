import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

// Agent note: keep package metadata honest for parallel release work.
describe("package metadata", () => {
  function readPackageJson(): {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  } {
    return JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
  }

  function stripTrailingCommas(input: string): string {
    let output = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i]!;

      if (inString) {
        output += char;
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        output += char;
        continue;
      }

      if (char === ",") {
        let next = i + 1;
        while (/\s/.test(input[next] ?? "")) {
          next++;
        }
        if (input[next] === "}" || input[next] === "]") {
          continue;
        }
      }

      output += char;
    }

    return output;
  }

  test("package does not depend on itself", () => {
    const packageJson = readPackageJson();

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

  test("bun lockfile root workspace dependencies match package.json", () => {
    const packageJson = readPackageJson();
    const lockText = readFileSync(new URL("../../bun.lock", import.meta.url), "utf8");
    const lockfile = JSON.parse(stripTrailingCommas(lockText)) as {
      workspaces?: {
        ""?: {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
      };
    };
    const rootWorkspace = lockfile.workspaces?.[""];

    expect(rootWorkspace?.dependencies ?? {}).toEqual(packageJson.dependencies ?? {});
    expect(rootWorkspace?.devDependencies ?? {}).toEqual(packageJson.devDependencies ?? {});
    expect(rootWorkspace?.peerDependencies ?? {}).toEqual(packageJson.peerDependencies ?? {});
    expect(rootWorkspace?.optionalDependencies ?? {}).toEqual(packageJson.optionalDependencies ?? {});
  });
});
