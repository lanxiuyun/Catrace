#!/usr/bin/env node
/**
 * Sticky progress demo: publish → patch 0..N → resolve.
 * Usage: node progress.mjs --token <t> [--steps 5] [--ms 400]
 */
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] != null) return args[i + 1];
  return fallback;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (flag("base", process.env.CATRACE_EVENT_BASE || "http://127.0.0.1:23457")).replace(/\/$/, "");
const token = flag("token", process.env.CATRACE_EVENT_TOKEN || "");
const steps = Number(flag("steps", "5")) || 5;
const ms = Number(flag("ms", "400")) || 400;
const title = flag("title", "SDK progress demo");

if (!token) {
  console.error("Missing token. Pass --token or set CATRACE_EVENT_TOKEN.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

const created = await api("POST", "/v1/events", {
  title,
  body: "starting…",
  level: "info",
  sticky: true,
  dedupe_key: `sdk-progress-demo-${Date.now()}`,
  progress: { current: 0, total: steps, label: `0/${steps}` },
});
const id = created.id;
console.log("created", id);

for (let i = 1; i <= steps; i++) {
  await sleep(ms);
  await api("PATCH", `/v1/events/${id}`, {
    body: `step ${i}/${steps}`,
    progress: { current: i, total: steps, label: `${i}/${steps}` },
    level: i === steps ? "success" : "info",
  });
  console.log("patched", i);
}

await sleep(ms);
await api("POST", `/v1/events/${id}/resolve`, { kind: "completed" });
console.log("resolved", id);
