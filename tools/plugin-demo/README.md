# Plugin demo — demo-timer

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
- **Use `render` + `h` from `globalThis.__CATRACE_VUE__`** — no SFC template string, no `import 'vue'`
- Host loads UI via **Blob URL** (not file/asset import)

See architecture: `.agent/architecture/desktop-event-os/m10-external-plugins.md`

## Trust

Local plugins run in the app WebView. Only install packages you trust. No marketplace.
