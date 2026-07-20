# Catrace Event SDK (HTTP) — demo kit

Local-only HTTP API for external scripts to publish Toast events into Catrace.

| Item | Value |
|------|--------|
| Base URL | `http://127.0.0.1:23457` |
| Auth | `Authorization: Bearer <token>` |
| Default | **Enabled** on app start |
| Scope | Loopback only; no CORS; no SSE/webhook in M9 |

Get the token from **Debug → Event SDK**, or via Tauri command `get_event_sdk_status`.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/v1/health` | no | Probe; works when SDK disabled |
| `POST` | `/v1/events` | yes | Publish (`201`) |
| `GET` | `/v1/events` | yes | Active **sdk** events only |
| `GET` | `/v1/events/:id` | yes | SDK event by id |
| `PATCH` | `/v1/events/:id` | yes | Update title/body/progress/… |
| `POST` | `/v1/events/:id/resolve` | yes | Dismiss or action |

### Publish body

```json
{
  "title": "Build finished",
  "body": "exit 0",
  "event_type": "sdk.notify",
  "level": "success",
  "sticky": false,
  "dedupe_key": "my-job-1",
  "progress": { "current": 3, "total": 10, "label": "3/10" },
  "actions": [{ "id": "open", "label": "Open" }],
  "payload": { "any": "json" }
}
```

- `title` required.
- Server **forces** `source=sdk`, `kind=sdk`, `display_mode=toast`.
- Reserved kinds rejected (`403`): `rest`, `water`, `eye`, `agent`, `permission`, `update`, `rest-timer`.
- Rate limit: **10 req/s**, **5 publish/s**.

### Resolve body

```json
{ "kind": "dismissed" }
```

or action:

```json
{ "action_id": "open", "payload": {} }
```

Action clicks in the Toast call the same resolve path locally (no webhook callback in M9). Poll `GET /v1/events/:id` if you need status.

## curl

```bash
# health (no token)
curl -s http://127.0.0.1:23457/v1/health

export TOKEN='paste-from-debug'
export H="Authorization: Bearer $TOKEN"

# publish
curl -s -X POST http://127.0.0.1:23457/v1/events \
  -H "$H" -H "Content-Type: application/json" \
  -d '{"title":"Hello from curl","body":"M9 demo","level":"info"}'

# list
curl -s http://127.0.0.1:23457/v1/events -H "$H"
```

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:23457/v1/health
$token = "paste-from-debug"
$h = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:23457/v1/events -Headers $h -Body '{"title":"Hello","body":"PS demo","level":"info"}'
```

## Scripts in this folder

| File | Usage |
|------|--------|
| `publish.mjs` | `node publish.mjs --token <t> --title "..."` |
| `publish.py` | `python publish.py --token <t> --title "..."` |
| `progress.mjs` | Demo sticky progress bar + resolve |

Environment: `CATRACE_EVENT_TOKEN`, optional `CATRACE_EVENT_BASE` (default `http://127.0.0.1:23457`).

## Manual acceptance

1. App running (`pnpm tauri dev` or packaged).
2. `GET /v1/health` → `ok: true`.
3. Publish with token → one **sdk** Toast (hub must not show a second card).
4. `PATCH` progress → same card updates in place.
5. Toast action / resolve → event leaves active list.
6. No token → `401`; `kind: "water"` → `403`; disabled in Debug → write `503`, health still `200`.
