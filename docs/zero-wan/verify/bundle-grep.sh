#!/usr/bin/env bash
# Lists every third-party host string left in the built client and shows its
# surrounding bytes so each hit can be matched to the reachability notes in
# the README.
set -euo pipefail
IMAGE=${IMAGE:-librechat-zero-wan}
PATTERN='cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|codesandbox\.io|cdnjs\.cloudflare\.com|unpkg\.com|googletagmanager|fonts\.googleapis'

docker run --rm --entrypoint sh "$IMAGE" -c '
  cd /app/client/dist
  files=$(grep -rl -E "'"$PATTERN"'" . || true)
  [ -n "$files" ] || { echo "no hits"; exit 0; }
  for f in $files; do
    echo "== $f"
    grep -o -E ".{0,80}('"$PATTERN"').{0,80}" "$f" | head -5
  done'
