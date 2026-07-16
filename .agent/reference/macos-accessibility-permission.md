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

## Local Reset When Testing

When testing different unsigned/signed builds, remove stale TCC entries before
rechecking the permission flow:

```sh
tccutil reset Accessibility com.lanxiuyun.catrace
```
