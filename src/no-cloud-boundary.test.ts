import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function retiredMarker(parts: string[]): string {
  return parts.join("");
}

const retiredMarkers = [
  retiredMarker(["@hasna", "/", "cloud"]),
  retiredMarker(["open", "-", "cloud"]),
  retiredMarker(["cloud", "-", "mcp"]),
  retiredMarker(["register", "Cloud", "Tools"]),
  retiredMarker(["register", "Cloud", "Commands"]),
  retiredMarker(["HASNA", "_", "CLOUD"]),
  retiredMarker(["OPEN", "_", "CLOUD"]),
  retiredMarker([".", "hasna", "/", "cloud"]),
  retiredMarker(["cloud", " sync"]),
  retiredMarker(["Cloud", " Sync"]),
];

describe("no-cloud package boundary", () => {
  test("package metadata and lock do not depend on the retired shared cloud runtime", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const lock = readFileSync("bun.lock", "utf8");
    const combined = `${packageJson}\n${lock}`;

    for (const marker of retiredMarkers) {
      expect(combined).not.toContain(marker);
    }
  });
});
