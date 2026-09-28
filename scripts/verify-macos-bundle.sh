#!/usr/bin/env bash
# Checks that a signed Posta.app carries every entitlement in
# src-tauri/Entitlements.plist and embeds a provisioning profile, from the same
# team, that grants them. Without both, iCloud key-value sync fails silently or
# the app is killed at launch. Only reads the bundle.
#
# Usage: scripts/verify-macos-bundle.sh <Posta.app> [Entitlements.plist]
set -euo pipefail

app=${1:?usage: $0 <Posta.app> [Entitlements.plist]}
expected=${2:-"$(dirname "$0")/../src-tauri/Entitlements.plist"}
plistbuddy=/usr/libexec/PlistBuddy

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

failed=0
fail() {
  echo "::error::$*" >&2
  failed=1
}

# PlistBuddy, unlike plutil, takes keys that contain dots.
value() {
  "$plistbuddy" -c "Print :$2" "$1" 2>/dev/null
}

codesign --verify --deep --strict "$app" || fail "codesign --verify --deep --strict rejected $app"

if ! codesign -d --entitlements - --xml "$app" >"$work/signed.plist" 2>/dev/null; then
  fail "could not read the entitlements $app is signed with"
fi

profile="$app/Contents/embedded.provisionprofile"
if [ ! -f "$profile" ]; then
  fail "$app has no Contents/embedded.provisionprofile"
elif ! security cms -D -i "$profile" >"$work/profile.plist" 2>/dev/null; then
  fail "could not decode $profile"
fi

team=$(value "$expected" com.apple.developer.team-identifier) || true
profile_team=$(value "$work/profile.plist" TeamIdentifier:0) || true
if [ -f "$work/profile.plist" ] && [ "$profile_team" != "$team" ]; then
  fail "the embedded profile belongs to team '$profile_team', not '$team'"
fi

keys=$(grep -o '<key>[^<]*</key>' "$expected" | sed 's:</*key>::g')
for key in $keys; do
  want=$(value "$expected" "$key")
  signed=$(value "$work/signed.plist" "$key") || signed=""
  if [ "$signed" != "$want" ]; then
    fail "$app is signed with $key='$signed', expected '$want'"
  fi
  if [ -f "$work/profile.plist" ]; then
    granted=$(value "$work/profile.plist" "Entitlements:$key") || granted=""
    # A profile may grant a wildcard such as TEAMID.* instead of the exact value.
    # shellcheck disable=SC2053
    if [ -z "$granted" ] || [[ "$want" != $granted ]]; then
      fail "the embedded profile grants $key='$granted', which does not cover '$want'"
    fi
  fi
done

exit $failed
