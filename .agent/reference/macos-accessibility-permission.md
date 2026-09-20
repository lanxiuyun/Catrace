# macOS Accessibility Permission

Catrace reads keyboard and mouse activity locally, so macOS must trust the app in
System Settings > Privacy & Security > Accessibility.

## Why Installed Builds Can Prompt Repeatedly

macOS TCC stores Accessibility grants against the app's code identity. Development
builds launched from the same terminal can appear stable, while installed builds
can prompt again when the `.app` is unsigned, ad-hoc signed with changing code
requirements, moved from the DMG instead of copied to Applications, or rebuilt
with a different signing identity.

## Local Build Requirement

`src-tauri/tauri.macos.conf.json` sets `bundle.macOS.signingIdentity` to `"-"`.
This forces Tauri to ad-hoc sign the entire `.app` bundle instead of leaving only
the Mach-O binary linker-signed.

After building, verify the generated or installed app:

```sh
codesign -dv --verbose=4 /Applications/catrace.app
codesign --verify --deep --strict --verbose=2 /Applications/catrace.app
```

The output must show `Identifier=com.lanxiuyun.catrace` and must not show
`Info.plist=not bound`.

## Release Build Requirements

Use a stable Developer ID identity for release DMGs:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Team Name (TEAMID)"
pnpm tauri build --bundles dmg
```

For public distribution, replace the local ad-hoc identity with the Developer ID
identity in the macOS build configuration or CI config, then notarize the
resulting DMG as part of the release pipeline. After installing, verify the app
copied to `/Applications`:

```sh
codesign -dv --verbose=4 /Applications/catrace.app
spctl -a -vv /Applications/catrace.app
```

The `Identifier` should remain `com.lanxiuyun.catrace`, and the authority chain
should show the same Developer ID identity across releases.

## Installed Updates Without Developer ID

Until release builds use a stable Developer ID, each updater replacement is a
new TCC identity. Keyboard/mouse via `device_query` then reads zeros and rest
detection would stay idle.

The host still keeps rest detection working: a permission-free fallback samples
`CGEventSourceSecondsSinceLastEventType` and cursor position into the same
`ActivityState.count` gates. `AccessibilityBanner` on the main window asks the
user to re-grant Accessibility; after grant, full `device_query` sampling
resumes. Key-count stats stay 0 until then.

Details: [macos-无辅助功能权限时用系统空闲秒数兜底忙闲.md](../features/input-monitoring/macos-无辅助功能权限时用系统空闲秒数兜底忙闲.md).

## Local Reset When Testing

When testing different unsigned/signed builds, remove stale TCC entries before
rechecking the permission flow:

```sh
tccutil reset Accessibility com.lanxiuyun.catrace
```
