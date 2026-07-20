#!/usr/bin/env node
/**
 * Publish a demo-timer plugin event via Event HTTP.
 * Usage:
 *   node publish.mjs --token <t> [--title "..."] [--body "..."]
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
const title = flag("title", "Demo Timer");
const body = flag("body", "Hello from the demo-timer plugin card.");
const sticky = args.includes("--sticky");

if (!token) {
  console.error("Missing token. Pass --token or set CATRACE_EVENT_TOKEN.");
  process.exit(1);
}

const payload = {
  plugin_id: "demo-timer",
  kind: "demo-timer",
  event_type: "demo-timer.tick",
  title,
  body,
  level: "success",
  sticky: sticky || undefined,
  progress: { current: 3, total: 10, label: "3 / 10 ticks" },
  actions: [
    { id: "snooze", label: "Snooze" },
    { id: "done", label: "Done" },
  ],
  dedupe_key: "demo-timer.main",
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
