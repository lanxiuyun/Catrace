# Plugin demo

Local external plugin samples for Catrace M10.

| Package | Role |
|---------|------|
| `timer/` | First-party **定时提醒** (settings + scheduling) |
| `sidecar-echo/` | Complete native sidecar demo: lifecycle, JSONL publish/log, custom Toast UI, and action round-trip |
| `bt-music/` | Bluetooth headset connect Toast → open player (OS device-change events on enable) |

Debug builds junction packages under `tools/plugin-demo/` into `app_data/plugins/`.

---

# bt-music（蓝牙听歌）

Target M15 scenario: device connect → Toast → open player. **No host Bluetooth API.**

```
tools/plugin-demo/bt-music/
  manifest.json         # id=bt-music, sidecar node runtime/main.mjs
  runtime/main.mjs      # Win32_DeviceChangeEvent watcher + IsConnected snapshot + open-player
  ui.mjs                # custom toast card
  settings.mjs          # product UI: trigger / player / toast stay
```

- Enable plugin → sidecar starts a long-lived PowerShell `ManagementEventWatcher` on `Win32_DeviceChangeEvent` (arrival/removal). On event (and once at start), re-scan BTHENUM/BTHHFENUM with `DEVPKEY_Device_IsConnected=True`. First snapshot seeds only; later deltas publish.
- Settings UI is product-facing only (no sidecar/PnP jargon, no poll interval, no status dump). Three sections: trigger filter, player path, toast stay seconds.
- Toast action `open-player` → host `resolved` → sidecar `spawn` configured `playerPath` (must be set).
- Toast duration defaults: connected 5s / disconnected 3s (0 = sticky; ≥3 → `payload.auto_hide_ms`). Settings auto-save + `setConfig`.
- Non-Windows: sidecar runs but watcher is a no-op (watchSupported=false).

## Hand test

1. `pnpm tauri dev` → Plugins → enable **蓝牙听歌** → pick a music app under 听歌程序.
2. Connect a Bluetooth headset → CONNECTED Toast; **打开听歌** opens the chosen app.
3. Optionally change 弹窗偏好 seconds → reconnect and confirm auto-hide.
4. Disconnect → DISCONNECTED Toast if「断开时也提醒」on.
5. Disable plugin → sidecar exits.

---

# timer（定时提醒）

First-party external plugin ported from the former built-in timer.

```
tools/plugin-demo/timer/
  manifest.json      # id=timer, main/background/settings
  background.mjs     # minute-aligned schedule + ack/snooze/skip
  ui.mjs             # toast card
  settings.mjs       # Plugins page rule CRUD
```

- Config key stays `plugin_config:timer` (rules migrate in place).
- Runtime state in SQLite `plugin_storage(timer, runtime)`.
- Toast actions resolve on the host; side-effects run in `background.mjs` via `catrace:plugin-event-resolved`.
- Header switch = external plugin enabled; per-rule switches live in settings.
- Rule modes: `interval` / `daily`. Interval only fires while user active; daily fires at HH:MM regardless of activity.
- Interval option `reset_on_rest` (UI: 休息重置): if last real rest end falls after `last_fired_at`, restart from rest end. Host `plugin_get_last_real_rest` uses rest plugin `break_minutes`. Legacy `mode=active` → interval + reset.
- Card stay: `sticky` (no auto-hide) or `card_duration_sec` (default 8, eye preset 25). Host reads `payload.auto_hide_ms`.

## settings.mjs layout (all external plugins)

Host `Plugins.vue` `.plugin-detail` owns **max-width / padding / gap** (including the narrow-viewport media query). Your settings root must **not** add outer padding or `max-width: 64rem` — including responsive rules that only fire on small windows (double inset vs built-in panels).

Reference: `timer/settings.mjs` root `.timer-settings` is business-only. Full contract: `.agent/architecture/desktop-event-os/m10-external-plugins.md` →「settings.mjs 布局合同」。
