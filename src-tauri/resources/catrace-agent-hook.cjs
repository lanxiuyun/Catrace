#!/usr/bin/env node
// Catrace Agent Hook — Claude Code 状态通知脚本
// 用法：node catrace-agent-hook.js（事件名由 Claude Code 作为第一个参数传入）
// 从 stdin 读取 Claude Code 的 JSON payload，把状态 POST 给本地 Catrace 服务。
// 任何失败都静默退出，绝不阻塞或打断 agent。

const http = require("http");

const CATRACE_PORT = 23456;
const STDIN_READ_TIMEOUT_MS = 2000;
const POST_TIMEOUT_MS = 500;

// 各 agent 事件名归一化到 Claude Code 语义（未列出的事件直接忽略）
const EVENT_ALIASES = {
  // Gemini CLI
  BeforeAgent: "UserPromptSubmit",
  AfterAgent: "Stop",
  // Kimi（旧 CLI 无 StopFailure，用工具失败兜底）
  PostToolUseFailure: "StopFailure",
};

// 未映射的事件（PreToolUse 等高频事件）直接忽略
const EVENT_TO_STATE = {
  SessionStart: "idle",
  UserPromptSubmit: "thinking",
  Stop: "attention",
  StopFailure: "error",
  Notification: "notification",
};

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function main() {
  const raw = await readStdin(STDIN_READ_TIMEOUT_MS);
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    // stdin 没有内容或不是 JSON，也继续上报（session_id 用 unknown）
  }

  // Claude Code 不会把事件名放在 argv，而是放在 stdin JSON 的 hook_event_name 里；
  // argv[2] 仅作为手动调试时的兜底。Gemini/Kimi 事件名先归一化。
  const rawEvent = process.argv[2] || payload.hook_event_name;
  const event = EVENT_ALIASES[rawEvent] || rawEvent;
  const state = EVENT_TO_STATE[event];
  if (!state) process.exit(0);

  const body = JSON.stringify({
    event,
    state,
    session_id: payload.session_id || "unknown",
    cwd: payload.cwd || "",
    transcript_path: payload.transcript_path || "",
    prompt: payload.prompt || "",
  });

  const req = http.request(
    {
      hostname: "127.0.0.1",
      port: CATRACE_PORT,
      path: "/state",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: POST_TIMEOUT_MS,
    },
    () => process.exit(0)
  );
  req.on("error", () => process.exit(0));
  req.on("timeout", () => {
    req.destroy();
    process.exit(0);
  });
  req.write(body);
  req.end();
}

main().catch(() => process.exit(0));
