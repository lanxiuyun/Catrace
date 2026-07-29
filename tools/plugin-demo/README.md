# Plugin demo

Local external plugin samples for Catrace M10.

| Package | Role |
|---------|------|
| `demo-timer/` | Minimal toast card + background tick |
| `timer/` | First-party **定时提醒** (settings + scheduling) |

Debug builds junction packages under `tools/plugin-demo/` into `app_data/plugins/`.

---

# demo-timer

Sample **local external plugin** for Catrace M10.

## Install

1. Open Catrace → **Plugins** → **Open plugins folder**  
   (or copy into `%APPDATA%/com.lanxiuyun.catrace/plugins/` / macOS Application Support `…/plugins/`).
2. Copy this folder so the path is:

   ```
   <app_data>/plugins/demo-timer/manifest.json
   <app_data>/plugins/demo-timer/ui.mjs
   ```

   Directory name **must** equal `manifest.id` (`demo-timer`).
3. In Plugins page → **Refresh** → enable **Demo Timer**.
4. Click **Send test notification** on the detail panel (easiest path).

## Publish via HTTP

Need Event SDK enabled + token (System Settings → Event SDK).

```bash
node tools/plugin-demo/publish.mjs --token <token>
```

Payload includes `plugin_id: "demo-timer"` so the host sets `source=plugin` and `kind=demo-timer`.

## Card contract (required)

- props: `event` (BusEvent), `isHovered?`
- emits: `close`, `action(actionId)`
- **Use `render` + `h` from `globalThis.__CATRACE_VUE__`** — no SFC template string, no `import 'vue'` / `import 'naive-ui'`
- Optional host UI kits (see `src/plugins/pluginRuntime.ts`):
  - `globalThis.__CATRACE_NAIVE__` — curated naive-ui (`NButton`, `NSwitch`, `NInput`, `NSlider`, `NModal`, `NSelect`, `NTooltip`, `useMessage`, …)
  - `globalThis.__CATRACE_UI__` — host settings blocks (`SettingRow`, `SliderControl`)
- **Prefer inline card editors over `NModal`** for complex settings — modal teleports to `body`, so CSS under the plugin root will not apply. Details: `.agent/architecture/desktop-event-os/m10-external-plugins.md`
- Host loads UI via **Blob URL** (not file/asset import)

See architecture: `.agent/architecture/desktop-event-os/m10-external-plugins.md`

## Trust

Local plugins run in the app WebView. Only install packages you trust. No marketplace.

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
