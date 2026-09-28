#!/usr/bin/env bash
# Full verification gate: typecheck, frontend tests, frontend build, Rust tests, clippy.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> tsc"
npx tsc --noEmit
echo "==> vitest"
npx vitest run
echo "==> vite build"
npx vite build
echo "==> cargo test"
(cd src-tauri && cargo test --quiet)
echo "==> cargo clippy"
# Existing code does not yet pass `-D warnings`; tighten once the baseline is clean.
(cd src-tauri && cargo clippy --all-targets --quiet)
echo "==> all checks passed"
