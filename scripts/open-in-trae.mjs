#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";

// Vite launch-editor unknown editors get: <file> <line> <column>
// (and may pass `file:line:col` as a single arg from other callers).
const raw = process.argv.slice(2);
if (!raw.length) {
  console.error("open-in-trae: missing file path");
  process.exit(1);
}

let file;
let line = "1";
let column = "1";

if (raw.length === 1) {
  const m = raw[0].match(/^(.*?)(?::(\d+))?(?::(\d+))?$/);
  file = m?.[1] ?? raw[0];
  line = m?.[2] ?? "1";
  column = m?.[3] ?? "1";
} else {
  [file, line = "1", column = "1"] = raw;
}

// Normalize for Trae CLI on Windows (avoid backslash + :line ambiguity).
const target = `${path.resolve(file).replace(/\\/g, "/")}:${line}:${column}`;
const traeBin = process.platform === "win32" ? "trae.cmd" : "trae";

const child = spawn(traeBin, ["-r", "-g", target], {
  stdio: "inherit",
  shell: true,
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error("open-in-trae: failed to launch trae", err);
  process.exit(1);
});
