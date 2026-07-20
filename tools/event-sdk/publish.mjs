#!/usr/bin/env node
/**
 * Minimal Catrace Event SDK publisher (Node, no deps).
 * Usage:
 *   node publish.mjs --token <t> --title "Hi" [--body "..."] [--level info]
 * Env: CATRACE_EVENT_TOKEN, CATRACE_EVENT_BASE
 */
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] != null) return args[i + 1];
  return fallback;
}
const base = (flag("base", process.env.CATRACE_EVENT_BASE || "http://127.0.0.1:23457")).replace(/\/$/, "");
const token = flag("token", process.env.CATRACE_EVENT_TOKEN || "");
const title = flag("title", "Hello from Event SDK");
const body = flag("body", "");
const level = flag("level", "info");
const dedupe = flag("dedupe-key", "");
const sticky = args.includes("--sticky");

if (!token) {
  console.error("Missing token. Pass --token or set CATRACE_EVENT_TOKEN.");
  process.exit(1);
}

const payload = {
  title,
  body: body || undefined,
  level,
  sticky: sticky || undefined,
  dedupe_key: dedupe || undefined,
};

const res = await fetch(`${base}/v1/events`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = text; }
if (!res.ok) {
  console.error(res.status, data);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
