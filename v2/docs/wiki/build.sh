#!/usr/bin/env bash
# Build wiki pages from registry. Pure text generation, no JS framework.
# Reads v2/resources/registry/{resources,edges,modules,policies}.json
# and writes a static table into architecture.html and resources.html.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REG="$HERE/../../resources/registry"
OUT="$HERE"
node "$HERE/build.mjs" "$REG" "$OUT"
