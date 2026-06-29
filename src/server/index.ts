#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { startServer } from "./serve.js";
import { getPackageVersion } from "../lib/version.js";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log("Usage: sandboxes-serve [options]");
  console.log("");
  console.log("Options:");
  console.log("  -p, --port <port>  Port to listen on (default: 19430)");
  console.log("  -V, --version      Display version");
  console.log("  -h, --help         Display help");
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(getPackageVersion());
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const { values } = parseArgs({
  args,
  options: {
    port: { type: "string", short: "p", default: "19430" },
  },
});

const port = parseInt(values.port || "19430", 10);
startServer(port);
