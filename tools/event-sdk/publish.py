#!/usr/bin/env python3
"""Minimal Catrace Event SDK publisher (stdlib only)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

def main() -> int:
    p = argparse.ArgumentParser(description="Publish an event to Catrace Event API")
    p.add_argument("--base", default=os.environ.get("CATRACE_EVENT_BASE", "http://127.0.0.1:23457"))
    p.add_argument("--token", default=os.environ.get("CATRACE_EVENT_TOKEN", ""))
    p.add_argument("--title", default="Hello from Event SDK")
    p.add_argument("--body", default="")
    p.add_argument("--level", default="info")
    p.add_argument("--dedupe-key", default="")
    p.add_argument("--sticky", action="store_true")
    args = p.parse_args()

    if not args.token:
        print("Missing token. Pass --token or set CATRACE_EVENT_TOKEN.", file=sys.stderr)
        return 1

    payload = {
        "title": args.title,
        "level": args.level,
    }
    if args.body:
        payload["body"] = args.body
    if args.sticky:
        payload["sticky"] = True
    if args.dedupe_key:
        payload["dedupe_key"] = args.dedupe_key

    base = args.base.rstrip("/")
    req = urllib.request.Request(
        f"{base}/v1/events",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {args.token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            print(body)
            return 0
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"{e.code} {err}", file=sys.stderr)
        return 1
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
