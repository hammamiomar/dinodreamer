#!/usr/bin/env bash
set -euo pipefail
cd engine
version=$(node -p 'require("./qualified-engine.json").wasmPackVersion')
if [[ $(wasm-pack --version 2>/dev/null || true) != "wasm-pack $version" ]]; then
  tools=$(mktemp -d)
  trap 'rm -rf "$tools"' EXIT
  cargo install wasm-pack --version "$version" --locked --root "$tools"
  export PATH="$tools/bin:$PATH"
fi
wasm-pack build --target web --release -- --locked
