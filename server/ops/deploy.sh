#!/bin/bash
set -euo pipefail

PROJECT_NAME="${1:-}"

if [ "$PROJECT_NAME" != "project-a" ]; then
  echo "[deploy] this script only handles project-a" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
GEO_SOURCE_DIR="$ROOT_DIR/server/scripts/GEO"
GEO_RUNTIME_DIR="/opt/xhs-sync/scripts/GEO"
GEO_LOG_DIR="/opt/xhs-sync/logs"
SYSTEMD_DIR="/etc/systemd/system"
LOGROTATE_DIR="/etc/logrotate.d"
NOTE_SERVICE="xhs-geo-note-ingest-queue.service"
VECTOR_SERVICE="xhs-geo-asset-vector.service"

log() {
  printf '[deploy] %s\n' "$*"
}

sync_gateway_env() {
  local env_file="${XHS_SYNC_ENV_FILE:-/opt/xhs-sync/sync.env}"
  local temp_file
  [ -n "${GATEWAY_BASE_URL:-}" ] || return 0
  [ -n "${GATEWAY_SERVICE_TOKEN:-}" ] || return 0
  mkdir -p "$(dirname "$env_file")"
  touch "$env_file"

  temp_file="$(mktemp)"
  awk \
    -v base_url="$GATEWAY_BASE_URL" \
    -v service_token="$GATEWAY_SERVICE_TOKEN" '
    BEGIN { base_done = 0; token_done = 0 }
    /^GATEWAY_BASE_URL=/ {
      if (!base_done) { print "GATEWAY_BASE_URL=" base_url; base_done = 1 }
      next
    }
    /^GATEWAY_SERVICE_TOKEN=/ {
      if (!token_done) { print "GATEWAY_SERVICE_TOKEN=" service_token; token_done = 1 }
      next
    }
    /^(ENDATA_TOKEN|DOMI_API_KEY|DUOMI_API_KEY|ARK_API_KEY|ARK_CHAT_API_KEY|GEO_CONTENT_API_KEY|KIMI_API_KEY|COZE_API_TOKEN)=/ { next }
    { print }
    END {
      if (!base_done) print "GATEWAY_BASE_URL=" base_url
      if (!token_done) print "GATEWAY_SERVICE_TOKEN=" service_token
    }
  ' "$env_file" >"$temp_file"
  install -m 0600 "$temp_file" "$env_file"
  rm -f "$temp_file"
  log "central gateway runtime configuration synchronized"
}

sync_flags_from_path() {
  local path=$1
  case "$path" in
    geo_ops_gateway.py|geo_observability.py)
      RESTART_NOTE=1
      RESTART_VECTOR=1
      ;;
    watch_geo_note_ingest_queue.py|sync_xhs_note_by_id.py|build_geo_content_assets.py|analyze_xhs_geo_note_images.py|import_xhs_note_details_from_excel.py)
      RESTART_NOTE=1
      ;;
    embed_geo_content_assets.py)
      RESTART_VECTOR=1
      ;;
  esac
}

RESTART_NOTE=0
RESTART_VECTOR=0
RELOAD_SYSTEMD=0

sync_gateway_env

if [ -d "$WEB_DIR" ] && [ -f "$WEB_DIR/package.json" ]; then
  log "clean up leftover preview probes"
  pkill -f "$WEB_DIR/node_modules/.bin/vite preview --host 0.0.0.0" 2>/dev/null || true
  pkill -f "$WEB_DIR/node_modules/.bin/vite preview" 2>/dev/null || true

  log "install web dependencies"
  if [ -f "$WEB_DIR/package-lock.json" ]; then
    (cd "$WEB_DIR" && npm ci)
  else
    (cd "$WEB_DIR" && npm install)
  fi

  log "build web"
  (cd "$WEB_DIR" && npm run build)
fi

if [ -f "$ROOT_DIR/server/logrotate/geo-xhs" ]; then
  log "install GEO log rotation"
  install -m 0644 "$ROOT_DIR/server/logrotate/geo-xhs" "$LOGROTATE_DIR/geo-xhs"
  logrotate -d "$LOGROTATE_DIR/geo-xhs" >/dev/null
fi

if [ -d "$GEO_SOURCE_DIR" ]; then
  log "sync GEO runtime to $GEO_RUNTIME_DIR"
  mkdir -p "$GEO_RUNTIME_DIR" "$GEO_LOG_DIR"

  changed_file_list="$(mktemp)"
  trap 'rm -f "$changed_file_list"' EXIT
  rsync -a --delete --exclude '__pycache__/' --exclude '*.pyc' --itemize-changes --dry-run \
    "$GEO_SOURCE_DIR"/ "$GEO_RUNTIME_DIR"/ >"$changed_file_list"

  if [ -s "$changed_file_list" ]; then
    while IFS= read -r line; do
      path="${line##* }"
      case "$path" in
        ""|"./"|".") continue ;;
        */) continue ;;
      esac
      sync_flags_from_path "$path"
    done <"$changed_file_list"

    rsync -a --delete --exclude '__pycache__/' --exclude '*.pyc' \
      "$GEO_SOURCE_DIR"/ "$GEO_RUNTIME_DIR"/
  fi
fi

if [ -d "$ROOT_DIR/server/systemd" ]; then
  for unit in "$ROOT_DIR"/server/systemd/*.service; do
    [ -e "$unit" ] || continue
    dest="$SYSTEMD_DIR/$(basename "$unit")"
    if [ ! -e "$dest" ] || ! cmp -s "$unit" "$dest"; then
      log "update systemd unit $(basename "$unit")"
      install -m 0644 "$unit" "$dest"
      RELOAD_SYSTEMD=1
      case "$(basename "$unit")" in
        "$NOTE_SERVICE")
          RESTART_NOTE=1
          ;;
        "$VECTOR_SERVICE")
          RESTART_VECTOR=1
          ;;
      esac
    fi
  done
fi

if [ "$RELOAD_SYSTEMD" -eq 1 ]; then
  log "daemon-reload"
  systemctl daemon-reload
fi

if [ "$RESTART_VECTOR" -eq 1 ]; then
  log "restart $VECTOR_SERVICE"
  systemctl restart "$VECTOR_SERVICE"
fi

if [ "$RESTART_NOTE" -eq 1 ]; then
  log "restart $NOTE_SERVICE"
  systemctl restart "$NOTE_SERVICE"
fi

if [ "$RESTART_VECTOR" -eq 1 ] || [ "$RESTART_NOTE" -eq 1 ]; then
  systemctl status "$VECTOR_SERVICE" --no-pager -l || true
  systemctl status "$NOTE_SERVICE" --no-pager -l || true
else
  log "no GEO service restart required"
fi

log "done"
