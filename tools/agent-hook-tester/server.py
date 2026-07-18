#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
可选：用本地 HTTP 打开测试页（也直接双击 index.html 即可）。

  python tools/agent-hook-tester/server.py
  → http://127.0.0.1:8765

页面直连 Catrace :23456（需 Catrace 带回 CORS 头）。
仅标准库。
"""

from __future__ import annotations

import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[tester] " + (fmt % args) + "\n")

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.path = "/index.html"
        return super().do_GET()


def main():
    httpd = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    url = f"http://{LISTEN_HOST}:{LISTEN_PORT}"
    print(f"测试页: {url}")
    print("先启动 Catrace，再在页面点「探测服务」。Ctrl+C 退出。")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        httpd.server_close()


if __name__ == "__main__":
    main()
