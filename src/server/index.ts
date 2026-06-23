#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { startServer } from "./serve.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: "19430" },
    host: { type: "string", default: "127.0.0.1" },
  },
});

const port = parseInt(values.port || "19430", 10);
startServer(port, { hostname: values.host });
