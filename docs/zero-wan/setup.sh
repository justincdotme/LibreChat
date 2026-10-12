#!/usr/bin/env bash
# Renders the site-specific files for the zero-WAN deployment from zero-wan.env:
# the project .env (secrets generated when empty, never rewritten), config.yaml,
# Caddyfile.snippet, and the bind-mounted data directories. Safe to rerun.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
SETTINGS="$HERE/zero-wan.env"

if [ ! -f "$SETTINGS" ]; then
  cp "$HERE/zero-wan.env.example" "$SETTINGS"
  echo "Created $SETTINGS from the example. Edit it, then rerun $0." >&2
  exit 1
fi

for tool in curl jq openssl; do
  command -v "$tool" > /dev/null || { echo "$tool is required" >&2; exit 1; }
done

# shellcheck disable=SC1090
. "$SETTINGS"

for name in CHAT_HOST LLAMA_BASE_URL MODEL_LABEL COMPOSE_SUBNET COMPOSE_BRIDGE LAN_CIDRS; do
  if [ -z "${!name:-}" ]; then
    echo "$name is empty in $SETTINGS" >&2
    exit 1
  fi
done
if ! grep -q '^CADDY_TLS=' "$SETTINGS"; then
  echo "CADDY_TLS is missing from $SETTINGS (set it, or set it empty for Caddy automatic HTTPS)" >&2
  exit 1
fi
CADDY_TLS=${CADDY_TLS-}
if [ -z "$CADDY_TLS" ]; then
  echo "warning: CADDY_TLS is empty, so Caddy will try automatic HTTPS, which needs internet access for ACME" >&2
fi
case "$LLAMA_BASE_URL" in
  *://localhost*|*://127.*|*://0.0.0.0*)
    echo "LLAMA_BASE_URL points at loopback, which inside a container is the container itself. Use the host's LAN address and bind the model server to it." >&2
    exit 1 ;;
esac
case "$LAN_CIDRS" in
  *,*) echo "LAN_CIDRS must be space separated, not comma separated" >&2; exit 1 ;;
esac

if [ -z "${MODEL_ID:-}" ]; then
  if ! models=$(curl -sf --max-time 10 "$LLAMA_BASE_URL/models"); then
    echo "MODEL_ID is empty and $LLAMA_BASE_URL/models did not answer; start the model server or set MODEL_ID in $SETTINGS" >&2
    exit 1
  fi
  MODEL_ID=$(printf '%s' "$models" | jq -r '.data[0].id // empty')
  if [ -z "$MODEL_ID" ]; then
    echo "MODEL_ID is empty and the /v1/models answer had no data[0].id; set MODEL_ID in $SETTINGS" >&2
    exit 1
  fi
  sed -i "s|^MODEL_ID=.*|MODEL_ID=$(printf '%s' "$MODEL_ID" | sed 's/[|&]/\\&/g')|" "$SETTINGS"
  echo "MODEL_ID from the server, saved to $SETTINGS: $MODEL_ID"
fi

# sed replacement text: escape the delimiter and ampersands.
esc() { printf '%s' "$1" | sed 's/[|&]/\\&/g'; }

render() {
  sed \
    -e "s|@CHAT_HOST@|$(esc "$CHAT_HOST")|g" \
    -e "s|@CADDY_TLS@|$(esc "$CADDY_TLS")|g" \
    -e "s|@LLAMA_BASE_URL@|$(esc "$LLAMA_BASE_URL")|g" \
    -e "s|@MODEL_ID@|$(esc "$MODEL_ID")|g" \
    -e "s|@MODEL_LABEL@|$(esc "$MODEL_LABEL")|g" \
    "$1" > "$2"
  echo "rendered $2"
}

render "$HERE/config.yaml.example" "$HERE/config.yaml"
render "$HERE/Caddyfile.snippet.example" "$HERE/Caddyfile.snippet"

ENV="$ROOT/.env"
if [ ! -f "$ENV" ]; then
  cp "$ROOT/.env.example" "$ENV"
  echo "created $ENV from .env.example"
fi

# Set a key, replacing it in place or appending it; uncommented example lines count as present.
setenv() {
  if grep -q -E "^#? ?$1=" "$ENV"; then
    sed -i -E "s|^#? ?$1=.*|$1=$(esc "$2")|" "$ENV"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV"
  fi
}
# Generate a secret only while the key is empty, so reruns keep existing sessions valid.
secret() {
  local current
  current=$(sed -n -E "s|^$1=(.*)|\1|p" "$ENV" | head -1)
  if [ -z "$current" ]; then
    setenv "$1" "$(openssl rand -hex "$2")"
    echo "generated $1"
  fi
}

setenv DOMAIN_CLIENT "https://$CHAT_HOST"
setenv DOMAIN_SERVER "https://$CHAT_HOST"
setenv UID "$(id -u)"
setenv GID "$(id -g)"
setenv ENDPOINTS "custom,agents"
setenv COMPOSE_FILE "docker-compose.yml:docs/zero-wan/override.yml"
setenv ZERO_WAN_SUBNET "$COMPOSE_SUBNET"
setenv ZERO_WAN_BRIDGE "$COMPOSE_BRIDGE"
secret JWT_SECRET 32
secret JWT_REFRESH_SECRET 32
secret CREDS_KEY 32
secret CREDS_IV 16
secret MEILI_MASTER_KEY 32
echo "updated $ENV"

# Bind-mounted directories must exist before the first start or Docker creates
# them as root. The MeiliSearch data directory name follows the base compose file.
meili_dir=$(sed -n -E 's|^\s*- \./(meili_data[^:]*):/meili_data.*|\1|p' "$ROOT/docker-compose.yml" | head -1)
(cd "$ROOT" && mkdir -p images uploads logs skill data-node "${meili_dir:-meili_data}")

cat <<EOF

Next (from $ROOT):
  docker compose config --services            # api mongodb meilisearch
  docker compose build api && docker compose pull mongodb meilisearch
  sudo tee -a /etc/caddy/Caddyfile < docs/zero-wan/Caddyfile.snippet && sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
  sudo docs/zero-wan/firewall.sh
  docker compose up -d
See docs/zero-wan/README.md for the verification steps.
EOF
