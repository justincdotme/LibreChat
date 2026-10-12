#!/usr/bin/env bash
# Drives the egress probe from the pinned Playwright image. The browser reaches
# the app through the TLS proxy like any LAN client; the repo mount supplies the
# @playwright/test package that matches the image's browser build. Defaults come
# from zero-wan.env; variables set by the caller win over the file.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
CALLER_MODEL_ID=${MODEL_ID:-}
CALLER_LABEL=${ENDPOINT_LABEL:-}
CALLER_BASE_URL=${BASE_URL:-}
# shellcheck disable=SC1091
. "$HERE/../zero-wan.env"
MODEL_ID=${CALLER_MODEL_ID:-${MODEL_ID:-}}
ENDPOINT_LABEL=${CALLER_LABEL:-$MODEL_LABEL}
BASE_URL=${CALLER_BASE_URL:-https://$CHAT_HOST}
if [ -z "$MODEL_ID" ]; then
  echo "MODEL_ID is empty: run setup.sh (it saves the detected id) or pass MODEL_ID=..." >&2
  exit 1
fi
OUT=${OUT:-$HOME/zero-wan-verify}
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT/downloads"
RESULT="$OUT/egress-$STAMP.json"

status=0
docker run --rm --network host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$REPO":/repo:ro \
  -v "$OUT/downloads":/downloads \
  -w /repo \
  -e BASE_URL="$BASE_URL" \
  -e MODEL_ID="$MODEL_ID" \
  -e ENDPOINT_LABEL="$ENDPOINT_LABEL" \
  -e TEST_EMAIL="${TEST_EMAIL:-egress-$STAMP@example.invalid}" \
  -e TEST_PASSWORD="${TEST_PASSWORD:-Egress-probe-$STAMP}" \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  node docs/zero-wan/verify/egress.mjs | tee "$RESULT" || status=$?
# A failed run prints its diagnostics to stderr and leaves no JSON behind.
[ -s "$RESULT" ] || rm -f "$RESULT"
exit "$status"
