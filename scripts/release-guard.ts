import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const retiredMarkers = [
  ["@hasna", "/", "cloud"],
  ["open", "-", "cloud"],
  ["cloud", "-", "mcp"],
  ["register", "Cloud", "Tools"],
  ["register", "Cloud", "Commands"],
  ["HASNA", "_", "CLOUD"],
  ["OPEN", "_", "CLOUD"],
  [".", "hasna", "/", "cloud"],
  ["cloud", " sync"],
  ["Cloud", " Sync"],
].map((parts) => parts.join(""));

const secretPatterns = [
  new RegExp(["sk", "-", "ant", "-"].join(""), "i"),
  new RegExp(["sk", "-", "proj", "-"].join(""), "i"),
  new RegExp(["npm", "_", "[a-zA-Z]"].join("")),
  new RegExp(["g", "ho", "_"].join("")),
  new RegExp(["g", "hp", "_"].join("")),
  new RegExp(["secret", "-", "token", ":"].join(""), "i"),
  new RegExp(["ctx", "7", "sk", "-"].join(""), "i"),
  new RegExp(["x", "ai", "-"].join(""), "i"),
  new RegExp(["AI", "za", "[a-zA-Z0-9]"].join("")),
  new RegExp(["AK", "IA", "[A-Z0-9]"].join("")),
];

const roots = ["package.json", "bun.lock", "README.md", "src", "dist"];
const ignoreDirs = new Set(["node_modules", ".git"]);
const extensions = new Set([".json", ".md", ".ts", ".tsx", ".js", ".d.ts"]);

function shouldRead(path: string): boolean {
  if (!path.includes(".")) return true;
  for (const ext of extensions) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

function* walk(path: string): Generator<string> {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (ignoreDirs.has(entry)) continue;
      yield* walk(join(path, entry));
    }
    return;
  }
  if (stat.isFile() && shouldRead(path)) yield path;
}

const failures: string[] = [];

for (const root of roots) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const marker of retiredMarkers) {
      if (text.includes(marker)) failures.push(`${file}: retired marker ${marker}`);
    }
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) failures.push(`${file}: token-shaped secret pattern ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("sandboxes release guard passed");
