# Development

```bash
npm install
npm run tauri dev
```

`npm test` runs the frontend tests. `npm run check` runs the full gate: typecheck, frontend tests, production build, Rust tests and clippy.

Debug builds keep their data in a `dev` folder inside the app data directory and store secrets there in owner-only files instead of the keychain, so they never touch an installed Posta's accounts.

## Releasing

Pushing a tag that starts with a digit runs `.github/workflows/release.yml` and drafts a GitHub release. macOS builds are signed with the Developer ID identity in `src-tauri/tauri.conf.json` and the iCloud entitlement in `src-tauri/Entitlements.plist`, and embed `src-tauri/Posta.provisionprofile` (a Developer ID profile for `com.sryo.posta` with iCloud enabled), which must be present in the checkout the release builds from. The workflow reads the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` repository secrets to sign and notarize. After the build, `scripts/verify-macos-bundle.sh` checks the built `Posta.app`: it fails the macOS job when the signature or the embedded profile doesn't carry every entitlement in `Entitlements.plist`. The draft release is already uploaded by then, so delete it by hand if that step fails.

Until those secrets exist, the macOS download is built and notarized locally with the `posta-notary` keychain profile (`xcrun notarytool store-credentials`): `npm run tauri build -- --bundles app`, zip the app with `ditto -c -k --keepParent`, `xcrun notarytool submit … --keychain-profile posta-notary --wait`, `xcrun stapler staple` the app, then build a DMG with `hdiutil create` (the app plus an `/Applications` link), `codesign` it with the Developer ID identity, notarize and staple the DMG the same way, and upload it to the draft with `gh release upload --clobber`.
