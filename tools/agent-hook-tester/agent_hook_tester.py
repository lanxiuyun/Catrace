#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Catrace Agent Hook 可视化测试器

模拟 Claude Code / hook 脚本向 Catrace 发 POST：
  - /state       非阻塞状态事件（Stop / StopFailure / Notification / …）
  - /permission  阻塞审批（P6），挂起直到 UI 点 Allow/Deny/前往终端 或超时

前置：Catrace 已启动，Agent 通知总开关开启，端口 23456。

依赖：
  pip install PyQt5 requests
"""

from __future__ import annotations

import json
import sys
import time
import traceback
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

import requests
from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtGui import QFont, QTextCursor
from PyQt5.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QSpinBox,
    QSplitter,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

# ---------------------------------------------------------------------------
# 常量 — 与 src-tauri/src/agent_hook.rs 对齐
# ---------------------------------------------------------------------------

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 23456

# /state 事件与默认 state 映射（见 catrace-agent-hook.cjs EVENT_TO_STATE）
STATE_EVENTS = [
    ("Stop", "attention", "sticky（默认）· 任务完成 / 等你"),
    ("StopFailure", "error", "sticky（默认）· 出错"),
    ("Notification", "notification", "sticky（默认）· 助手喊你"),
    ("SessionStart", "idle", "off（默认）· 不弹，除非设置改 auto/sticky"),
    ("UserPromptSubmit", "thinking", "off（默认）· 不弹，但销 sticky + timeout 审批"),
]

# 真实 Claude PermissionRequest http hook body 字段（无 event，只有 hook_event_name）
SAMPLE_TOOL_INPUTS = {
    "Bash": {"command": "git status", "description": "Show working tree status"},
    "Edit": {"file_path": "src/main.rs", "old_string": "foo", "new_string": "bar"},
    "Write": {"file_path": "notes.md", "content": "# hello"},
    "Read": {"file_path": "README.md"},
    "WebFetch": {"url": "https://example.com"},
}


def now_ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


# ---------------------------------------------------------------------------
# 网络 worker（避免阻塞 UI）
# ---------------------------------------------------------------------------


class RequestWorker(QThread):
    """在后台线程发 HTTP 请求，permission 可阻塞很久。"""

    finished_ok = pyqtSignal(str, int, float, object)  # label, status, elapsed_s, body
    finished_err = pyqtSignal(str, str)  # label, error

    def __init__(
        self,
        label: str,
        method: str,
        url: str,
        body: Dict[str, Any],
        timeout: float,
        parent=None,
    ):
        super().__init__(parent)
        self.label = label
        self.method = method
        self.url = url
        self.body = body
        self.timeout = timeout
        self._session = requests.Session()

    def run(self):
        t0 = time.perf_counter()
        try:
            resp = self._session.request(
                self.method,
                self.url,
                json=self.body,
                headers={"Content-Type": "application/json"},
                timeout=self.timeout,
            )
            elapsed = time.perf_counter() - t0
            try:
                parsed = resp.json() if resp.content else None
            except Exception:
                parsed = resp.text
            self.finished_ok.emit(self.label, resp.status_code, elapsed, parsed)
        except Exception as e:
            self.finished_err.emit(self.label, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# 主窗口
# ---------------------------------------------------------------------------


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Catrace Agent Hook Tester")
        self.resize(980, 720)
        self._workers: list[RequestWorker] = []
        self._build_ui()
        self._log("就绪。先点「探测服务」，确认 Catrace 在 23456 监听。")

    # ---- UI 构建 ----

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)

        # 连接栏
        conn = QHBoxLayout()
        conn.addWidget(QLabel("Host"))
        self.host_edit = QLineEdit(DEFAULT_HOST)
        self.host_edit.setFixedWidth(120)
        conn.addWidget(self.host_edit)
        conn.addWidget(QLabel("Port"))
        self.port_spin = QSpinBox()
        self.port_spin.setRange(1, 65535)
        self.port_spin.setValue(DEFAULT_PORT)
        conn.addWidget(self.port_spin)
        self.btn_ping = QPushButton("探测服务")
        self.btn_ping.clicked.connect(self.on_ping)
        conn.addWidget(self.btn_ping)
        self.ping_label = QLabel("未探测")
        conn.addWidget(self.ping_label)
        conn.addStretch()
        layout.addLayout(conn)

        # 公共 session / cwd
        common = QGroupBox("公共字段（所有请求共用）")
        form = QFormLayout(common)
        self.session_edit = QLineEdit(f"test-{uuid.uuid4().hex[:8]}")
        form.addRow("session_id", self.session_edit)
        sess_btns = QHBoxLayout()
        b_new = QPushButton("新 session")
        b_new.clicked.connect(self.on_new_session)
        b_copy = QPushButton("复制")
        b_copy.clicked.connect(lambda: QApplication.clipboard().setText(self.session_edit.text()))
        sess_btns.addWidget(b_new)
        sess_btns.addWidget(b_copy)
        sess_btns.addStretch()
        form.addRow("", self._wrap(sess_btns))
        self.cwd_edit = QLineEdit(r"C:\work_sapce\Catrace")
        form.addRow("cwd", self.cwd_edit)
        self.prompt_edit = QLineEdit("")
        form.addRow("prompt", self.prompt_edit)
        self.transcript_edit = QLineEdit("")
        form.addRow("transcript_path", self.transcript_edit)
        layout.addWidget(common)

        splitter = QSplitter(Qt.Vertical)

        # Tabs
        tabs = QTabWidget()
        tabs.addTab(self._build_state_tab(), "/state 事件")
        tabs.addTab(self._build_permission_tab(), "/permission 审批")
        tabs.addTab(self._build_scenario_tab(), "场景脚本")
        tabs.addTab(self._build_raw_tab(), "原始 JSON")
        splitter.addWidget(tabs)

        # 日志
        log_box = QGroupBox("请求日志")
        log_layout = QVBoxLayout(log_box)
        self.log_view = QPlainTextEdit()
        self.log_view.setReadOnly(True)
        self.log_view.setFont(QFont("Consolas", 9))
        self.log_view.setMaximumBlockCount(2000)
        log_layout.addWidget(self.log_view)
        log_btns = QHBoxLayout()
        b_clear = QPushButton("清空日志")
        b_clear.clicked.connect(self.log_view.clear)
        log_btns.addWidget(b_clear)
        log_btns.addStretch()
        log_layout.addLayout(log_btns)
        splitter.addWidget(log_box)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        layout.addWidget(splitter, 1)

    def _wrap(self, layout) -> QWidget:
        w = QWidget()
        w.setLayout(layout)
        return w

    def _build_state_tab(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        tip = QLabel(
            "POST /state 立即 200，不阻塞。默认 sticky：Stop / StopFailure / Notification；"
            "SessionStart / UserPromptSubmit 默认 off（后者仍会销 sticky + timeout 审批）。"
        )
        tip.setWordWrap(True)
        tip.setStyleSheet("color:#555;")
        v.addWidget(tip)

        row = QHBoxLayout()
        row.addWidget(QLabel("事件"))
        self.state_event = QComboBox()
        for name, state, desc in STATE_EVENTS:
            self.state_event.addItem(f"{name}  ·  {desc}", (name, state))
        row.addWidget(self.state_event, 1)
        self.state_override = QLineEdit()
        self.state_override.setPlaceholderText("可选：覆盖 state（默认用映射）")
        row.addWidget(self.state_override)
        v.addLayout(row)

        self.btn_state = QPushButton("发送 /state")
        self.btn_state.clicked.connect(self.on_send_state)
        v.addWidget(self.btn_state)

        quick = QHBoxLayout()
        for name, state, _ in STATE_EVENTS:
            b = QPushButton(name)
            b.clicked.connect(lambda _=False, n=name, s=state: self._send_state(n, s))
            quick.addWidget(b)
        v.addLayout(quick)
        v.addStretch()
        return w

    def _build_permission_tab(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        tip = QLabel(
            "POST /permission 阻塞，直到 Catrace 审批卡点 Allow/Deny/前往终端，或 ~540s 超时回 {}。"
            "默认 body 对齐真实 Claude：只有 hook_event_name，没有 event。"
        )
        tip.setWordWrap(True)
        tip.setStyleSheet("color:#555;")
        v.addWidget(tip)

        form = QFormLayout()
        self.tool_combo = QComboBox()
        for t in SAMPLE_TOOL_INPUTS:
            self.tool_combo.addItem(t)
        self.tool_combo.currentTextChanged.connect(self._fill_tool_input)
        form.addRow("tool_name", self.tool_combo)
        self.tool_input_edit = QTextEdit()
        self.tool_input_edit.setAcceptRichText(False)
        self.tool_input_edit.setMaximumHeight(120)
        self.tool_input_edit.setFont(QFont("Consolas", 9))
        form.addRow("tool_input (JSON)", self.tool_input_edit)
        self.use_real_body = QCheckBox("真实 Claude body（只用 hook_event_name，不发 event）")
        self.use_real_body.setChecked(True)
        form.addRow("", self.use_real_body)
        self.perm_timeout = QSpinBox()
        self.perm_timeout.setRange(5, 700)
        self.perm_timeout.setValue(600)
        self.perm_timeout.setSuffix(" s")
        form.addRow("客户端超时", self.perm_timeout)
        v.addLayout(form)
        self._fill_tool_input(self.tool_combo.currentText())

        btn_row = QHBoxLayout()
        self.btn_perm = QPushButton("发送 /permission（阻塞）")
        self.btn_perm.setStyleSheet("background:#f59e0b; color:#111; font-weight:600;")
        self.btn_perm.clicked.connect(self.on_send_permission)
        btn_row.addWidget(self.btn_perm)
        self.btn_perm2 = QPushButton("再发一个同 session（测顶替）")
        self.btn_perm2.clicked.connect(self.on_send_permission_supersede)
        btn_row.addWidget(self.btn_perm2)
        v.addLayout(btn_row)

        self.perm_status = QLabel("空闲")
        v.addWidget(self.perm_status)
        v.addStretch()
        return w

    def _build_scenario_tab(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        tip = QLabel("一键跑完整链路。每步结果进日志；阻塞步骤会等你点审批卡。")
        tip.setWordWrap(True)
        tip.setStyleSheet("color:#555;")
        v.addWidget(tip)

        scenarios = [
            ("S1 · sticky 待办", "Stop → sticky 卡", self.sc_sticky),
            ("S2 · 多 session 合并", "两 session Stop → 一张卡两条", self.sc_multi_session),
            ("S3 · UserPrompt 销 sticky", "Stop → UserPromptSubmit → 卡消失", self.sc_dismiss_sticky),
            ("S4 · 审批 Allow/Deny", "弹审批卡，点完看决策 JSON", self.sc_permission_decide),
            ("S5 · 审批被 prompt 取消", "弹审批 → UserPromptSubmit → timeout 回 {}", self.sc_permission_cancel),
            ("S6 · 同 session 新审批顶替", "两个 /permission 并行，旧的应 timeout", self.sc_permission_supersede),
            ("S7 · StopFailure + Notification", "错误 + 喊你 两条 sticky", self.sc_fail_notify),
            ("S8 · 真实 Claude body 缺 event", "只有 hook_event_name，测解析兜底", self.sc_real_claude_body),
            ("S9 · 坏请求 / 未知路径", "缺字段 / 404，看服务是否稳", self.sc_bad_requests),
        ]
        for title, desc, fn in scenarios:
            row = QHBoxLayout()
            b = QPushButton(title)
            b.setMinimumWidth(220)
            b.clicked.connect(fn)
            row.addWidget(b)
            row.addWidget(QLabel(desc))
            row.addStretch()
            v.addLayout(row)
        v.addStretch()
        return w

    def _build_raw_tab(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        path_row = QHBoxLayout()
        path_row.addWidget(QLabel("路径"))
        self.raw_path = QComboBox()
        self.raw_path.setEditable(True)
        self.raw_path.addItems(["/state", "/permission", "/nope"])
        path_row.addWidget(self.raw_path)
        self.raw_timeout = QSpinBox()
        self.raw_timeout.setRange(1, 700)
        self.raw_timeout.setValue(10)
        self.raw_timeout.setSuffix(" s")
        path_row.addWidget(QLabel("超时"))
        path_row.addWidget(self.raw_timeout)
        v.addLayout(path_row)
        self.raw_body = QTextEdit()
        self.raw_body.setAcceptRichText(False)
        self.raw_body.setFont(QFont("Consolas", 9))
        self.raw_body.setPlainText(
            json.dumps(
                {
                    "event": "Stop",
                    "state": "attention",
                    "session_id": "raw-test",
                    "cwd": r"C:\work_sapce\Catrace",
                    "prompt": "",
                    "transcript_path": "",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        v.addWidget(self.raw_body)
        b = QPushButton("发送原始请求")
        b.clicked.connect(self.on_send_raw)
        v.addWidget(b)
        return w

    # ---- 基础 ----

    def base_url(self) -> str:
        return f"http://{self.host_edit.text().strip()}:{self.port_spin.value()}"

    def common_fields(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_edit.text().strip() or "unknown",
            "cwd": self.cwd_edit.text().strip(),
            "prompt": self.prompt_edit.text(),
            "transcript_path": self.transcript_edit.text().strip(),
        }

    def on_new_session(self):
        self.session_edit.setText(f"test-{uuid.uuid4().hex[:8]}")
        self._log(f"新 session_id = {self.session_edit.text()}")

    def _fill_tool_input(self, tool: str):
        sample = SAMPLE_TOOL_INPUTS.get(tool, {})
        self.tool_input_edit.setPlainText(json.dumps(sample, ensure_ascii=False, indent=2))

    def _log(self, msg: str, level: str = "INFO"):
        color = {
            "INFO": "#111",
            "OK": "#059669",
            "ERR": "#dc2626",
            "WAIT": "#b45309",
            "SEND": "#2563eb",
        }.get(level, "#111")
        self.log_view.appendHtml(
            f'<span style="color:#888">[{now_ts()}]</span> '
            f'<span style="color:{color}">{self._esc(msg)}</span>'
        )
        self.log_view.moveCursor(QTextCursor.End)

    @staticmethod
    def _esc(s: str) -> str:
        return (
            s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br>")
        )

    def _set_busy(self, busy: bool):
        # permission 阻塞时仍允许发 /state（测取消），所以不全局 disable
        self.btn_perm.setEnabled(not busy)
        if busy:
            self.perm_status.setText("等待 Catrace 审批决策…（可点场景里的 UserPrompt 取消）")
            self.perm_status.setStyleSheet("color:#b45309; font-weight:600;")
        else:
            self.perm_status.setText("空闲")
            self.perm_status.setStyleSheet("")

    def _dispatch(
        self,
        label: str,
        path: str,
        body: Dict[str, Any],
        timeout: float,
        on_done=None,
    ):
        url = self.base_url() + path
        self._log(f"→ {label}\n  POST {url}\n  {json.dumps(body, ensure_ascii=False)}", "SEND")
        worker = RequestWorker(label, "POST", url, body, timeout, self)

        def ok(lbl, status, elapsed, parsed):
            self._workers = [w for w in self._workers if w is not worker]
            pretty = json.dumps(parsed, ensure_ascii=False) if parsed is not None else "(empty)"
            self._log(f"← {lbl}  HTTP {status}  {elapsed:.2f}s\n  body={pretty}", "OK")
            if path == "/permission":
                self._set_busy(False)
            if on_done:
                on_done(True, status, parsed)

        def err(lbl, msg):
            self._workers = [w for w in self._workers if w is not worker]
            self._log(f"← {lbl}  ERROR  {msg}", "ERR")
            if path == "/permission":
                self._set_busy(False)
            if on_done:
                on_done(False, None, msg)

        worker.finished_ok.connect(ok)
        worker.finished_err.connect(err)
        self._workers.append(worker)
        if path == "/permission":
            self._set_busy(True)
            self._log("阻塞等待审批…", "WAIT")
        worker.start()

    # ---- 操作 ----

    def on_ping(self):
        body = {
            "event": "Ping",
            "state": "idle",
            "session_id": "ping-check",
            "cwd": self.cwd_edit.text().strip(),
            "prompt": "",
            "transcript_path": "",
        }
        url = self.base_url() + "/state"
        try:
            r = requests.post(url, json=body, timeout=3)
            if r.status_code == 200:
                self.ping_label.setText("在线 ✓")
                self.ping_label.setStyleSheet("color:#059669; font-weight:600;")
                self._log(f"探测 OK  {url}", "OK")
            else:
                self.ping_label.setText(f"HTTP {r.status_code}")
                self.ping_label.setStyleSheet("color:#dc2626;")
                self._log(f"探测异常 HTTP {r.status_code}", "ERR")
        except Exception as e:
            self.ping_label.setText("离线")
            self.ping_label.setStyleSheet("color:#dc2626;")
            self._log(f"探测失败：{e}\n请确认 Catrace 已启动且 Agent 通知开启。", "ERR")

    def on_send_state(self):
        name, state = self.state_event.currentData()
        override = self.state_override.text().strip()
        if override:
            state = override
        self._send_state(name, state)

    def _send_state(self, event: str, state: str, session_id: Optional[str] = None):
        body = {
            "event": event,
            "state": state,
            **self.common_fields(),
        }
        if session_id is not None:
            body["session_id"] = session_id
        self._dispatch(f"/state {event}", "/state", body, timeout=5)

    def _parse_tool_input(self) -> Any:
        raw = self.tool_input_edit.toPlainText().strip()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            QMessageBox.warning(self, "tool_input JSON 无效", str(e))
            return "__invalid__"

    def _build_permission_body(self) -> Optional[Dict[str, Any]]:
        tool_input = self._parse_tool_input()
        if tool_input == "__invalid__":
            return None
        tool = self.tool_combo.currentText()
        common = self.common_fields()
        if self.use_real_body.isChecked():
            # 对齐真实 Claude http hook：无 event，有 hook_event_name
            body = {
                "hook_event_name": "PermissionRequest",
                "session_id": common["session_id"],
                "cwd": common["cwd"],
                "transcript_path": common["transcript_path"],
                "tool_name": tool,
                "tool_input": tool_input,
                # 真实请求还会带这些，服务端应忽略
                "permission_mode": "default",
                "prompt_id": uuid.uuid4().hex,
            }
        else:
            body = {
                "event": "PermissionRequest",
                "state": "permission",
                "tool_name": tool,
                "tool_input": tool_input,
                **common,
            }
        return body

    def on_send_permission(self):
        body = self._build_permission_body()
        if body is None:
            return
        self._dispatch(
            "/permission",
            "/permission",
            body,
            timeout=float(self.perm_timeout.value()),
        )

    def on_send_permission_supersede(self):
        """同 session 再发一个审批，测顶替旧 pending。"""
        body = self._build_permission_body()
        if body is None:
            return
        # 改一下 command 方便区分
        if isinstance(body.get("tool_input"), dict):
            body = dict(body)
            ti = dict(body["tool_input"])
            ti["command"] = ti.get("command", "echo") + " # supersede"
            body["tool_input"] = ti
        self._dispatch(
            "/permission (supersede)",
            "/permission",
            body,
            timeout=float(self.perm_timeout.value()),
        )

    def on_send_raw(self):
        try:
            body = json.loads(self.raw_body.toPlainText())
        except json.JSONDecodeError as e:
            QMessageBox.warning(self, "JSON 无效", str(e))
            return
        path = self.raw_path.currentText().strip() or "/state"
        if not path.startswith("/"):
            path = "/" + path
        self._dispatch(f"raw {path}", path, body, timeout=float(self.raw_timeout.value()))

    # ---- 场景 ----

    def sc_sticky(self):
        self._log("=== S1 sticky 待办：应弹常驻 agent 卡 ===")
        self._send_state("Stop", "attention")

    def sc_multi_session(self):
        self._log("=== S2 多 session：两张条目合并到一张 sticky 卡 ===")
        s1 = self.session_edit.text().strip()
        s2 = f"test-{uuid.uuid4().hex[:8]}"
        self._send_state("Stop", "attention", session_id=s1)
        # 稍后再发第二条，让第一条先入栈
        def later():
            time.sleep(0.4)
            self._send_state("Stop", "attention", session_id=s2)
            self._log(f"第二 session = {s2}（看卡片是否显示 2 个会话）")

        # 用 worker 线程只是为了 sleep 不卡 UI；请求本身仍走 _dispatch
        class _T(QThread):
            def run(self_inner):
                later()

        t = _T(self)
        t.finished.connect(lambda: None)
        self._workers.append(t)  # type: ignore
        t.start()

    def sc_dismiss_sticky(self):
        self._log("=== S3 销 sticky：先 Stop，再 UserPromptSubmit 同 session ===")
        sid = self.session_edit.text().strip()
        self._send_state("Stop", "attention", session_id=sid)

        def step2(_ok=None, _st=None, _b=None):
            pass

        # 延迟发 UserPromptSubmit
        class _T(QThread):
            tick = pyqtSignal()

            def run(self_inner):
                time.sleep(0.8)
                self_inner.tick.emit()

        t = _T(self)
        t.tick.connect(
            lambda: (
                self._log("发送 UserPromptSubmit → sticky 应消失"),
                self._send_state("UserPromptSubmit", "thinking", session_id=sid),
            )
        )
        self._workers.append(t)  # type: ignore
        t.start()

    def sc_permission_decide(self):
        self._log("=== S4 审批决策：请在 Catrace 琥珀色卡点 Allow 或 Deny ===")
        self.use_real_body.setChecked(True)
        self.on_send_permission()

    def sc_permission_cancel(self):
        self._log(
            "=== S5 审批被 prompt 取消：先弹审批，1.2s 后发 UserPromptSubmit，"
            "期望 /permission 回 {} 且卡消失 ==="
        )
        self.use_real_body.setChecked(True)
        sid = self.session_edit.text().strip()
        body = self._build_permission_body()
        if body is None:
            return
        self._dispatch(
            "/permission (will cancel)",
            "/permission",
            body,
            timeout=float(self.perm_timeout.value()),
        )

        class _T(QThread):
            tick = pyqtSignal()

            def run(self_inner):
                time.sleep(1.2)
                self_inner.tick.emit()

        t = _T(self)
        t.tick.connect(
            lambda: (
                self._log("发送 UserPromptSubmit → 应 timeout 挂起审批"),
                self._send_state("UserPromptSubmit", "thinking", session_id=sid),
            )
        )
        self._workers.append(t)  # type: ignore
        t.start()

    def sc_permission_supersede(self):
        self._log(
            "=== S6 同 session 顶替：连发两个 /permission，"
            "旧请求应先回 timeout/{}，新卡保留 ==="
        )
        self.use_real_body.setChecked(True)
        body1 = self._build_permission_body()
        if body1 is None:
            return
        self._dispatch(
            "/permission #1",
            "/permission",
            body1,
            timeout=float(self.perm_timeout.value()),
        )

        class _T(QThread):
            tick = pyqtSignal()

            def run(self_inner):
                time.sleep(0.6)
                self_inner.tick.emit()

        t = _T(self)
        t.tick.connect(self.on_send_permission_supersede)
        self._workers.append(t)  # type: ignore
        t.start()

    def sc_fail_notify(self):
        self._log("=== S7 StopFailure + Notification ===")
        sid = self.session_edit.text().strip()
        self._send_state("StopFailure", "error", session_id=sid)

        class _T(QThread):
            tick = pyqtSignal()

            def run(self_inner):
                time.sleep(0.4)
                self_inner.tick.emit()

        t = _T(self)
        t.tick.connect(
            lambda: self._send_state(
                "Notification", "notification", session_id=f"test-{uuid.uuid4().hex[:8]}"
            )
        )
        self._workers.append(t)  # type: ignore
        t.start()

    def sc_real_claude_body(self):
        self._log("=== S8 真实 Claude body（无 event 字段）===")
        self.use_real_body.setChecked(True)
        self.on_send_permission()

    def sc_bad_requests(self):
        self._log("=== S9 坏请求：空 JSON / 未知路径 / 缺字段 ===")
        # 空对象到 /state — 应 200（字段都有 default）
        self._dispatch("empty /state", "/state", {}, timeout=5)
        # 未知路径
        self._dispatch("unknown path", "/nope", {"event": "Stop"}, timeout=5)
        # 缺 session 的 permission（session=空 → 仍应弹卡，但不参与按 session 清理）
        body = {
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "tool_input": {"command": "echo no-session"},
        }
        self._dispatch("permission no session", "/permission", body, timeout=30)

    def closeEvent(self, event):
        # 不强制 kill worker；permission 可能还在等，进程退出会断连接 → Catrace 侧写响应失败但会超时清
        for w in list(self._workers):
            if isinstance(w, QThread) and w.isRunning():
                w.quit()
                w.wait(200)
        super().closeEvent(event)


def main():
    # Windows 控制台 UTF-8
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    win = MainWindow()
    win.show()
    try:
        sys.exit(app.exec_())
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
