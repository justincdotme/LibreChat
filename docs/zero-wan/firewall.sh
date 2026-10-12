#!/usr/bin/env bash
# Egress policy for the LibreChat compose network. Run as root. Containers may
# reach the model server and the private ranges in LAN_CIDRS; anything else is
# logged and dropped. Settings come from zero-wan.env next to this script.
# Rules are not persisted across reboots.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$HERE/zero-wan.env"

SUBNET=$COMPOSE_SUBNET
TAG=zero-wan
LLAMA_HOST=$(printf '%s' "$LLAMA_BASE_URL" | sed -E 's|^[a-z]+://([^/:]+).*|\1|')
LLAMA_PORT=$(printf '%s' "$LLAMA_BASE_URL" | sed -nE 's|^[a-z]+://[^/:]+:([0-9]+).*|\1|p')
case "$LLAMA_BASE_URL" in
  https://*) LLAMA_PORT=${LLAMA_PORT:-443} ;;
  *) LLAMA_PORT=${LLAMA_PORT:-80} ;;
esac

check() {
  if ! iptables -S DOCKER-USER > /dev/null 2>&1; then
    echo "no DOCKER-USER chain: Docker is not using the iptables firewall backend on this host" >&2
    exit 1
  fi
  case "$LAN_CIDRS" in
    *,*) echo "LAN_CIDRS must be space separated" >&2; exit 1 ;;
  esac
  # Resolve the model host now so a DNS failure cannot interrupt the rule swap.
  if ! LLAMA_IP=$(getent ahostsv4 "$LLAMA_HOST" | awk 'NR == 1 { print $1 }') || [ -z "$LLAMA_IP" ]; then
    echo "cannot resolve model host $LLAMA_HOST to an IPv4 address" >&2
    exit 1
  fi
}

remove() {
  iptables -S DOCKER-USER \
    | { grep -- "--comment ${TAG}" || true; } \
    | sed 's/^-A /-D /' \
    | while read -r rule; do
        # -S quotes the LOG prefix; eval re-parses those quotes so --log-prefix
        # "LC-EGRESS-DROP " survives as one argument instead of word-splitting.
        eval "iptables $rule"
      done
}

apply() {
  check
  remove
  add() { iptables -I DOCKER-USER 1 -s "$SUBNET" "$@" -m comment --comment "$TAG"; }
  # Every rule goes in at position 1, so the DROP lands first and the policy
  # fails closed if a later insertion errors; the final order is model server,
  # LAN ranges, LOG, DROP.
  add -j DROP
  add -j LOG --log-prefix "LC-EGRESS-DROP " --log-level 4
  for cidr in $(printf '%s\n' $LAN_CIDRS | tac); do
    add -d "$cidr" -j RETURN
  done
  add -d "$LLAMA_IP" -p tcp --dport "$LLAMA_PORT" -j RETURN
  local count
  count=$(iptables -S DOCKER-USER | grep -c -- "--comment ${TAG}")
  echo "applied $count rules for $SUBNET (model server $LLAMA_IP:$LLAMA_PORT)"
}

case "${1:-}" in
  "") apply ;;
  --remove) remove ;;
  --status) iptables -L DOCKER-USER -v -n -x --line-numbers ;;
  *) echo "usage: $0 [--remove|--status]" >&2; exit 2 ;;
esac
