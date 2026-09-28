#!/usr/bin/env bash
# Full verification gate: typecheck, frontend tests, frontend build, Rust tests, clippy.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> typecheck"
npm run -s typecheck
echo "==> vitest"
npx vitest run
echo "==> vite build"
npx vite build
echo "==> cargo test"
(cd src-tauri && cargo test --quiet)
echo "==> cargo clippy"
(cd src-tauri && cargo clippy --all-targets --quiet -- -D warnings)
echo "==> all checks passed"
