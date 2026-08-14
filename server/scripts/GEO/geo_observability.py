import json
import os
import socket
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request


PROJECT_CODE = "geo-xhs"
DEFAULT_LOG_DIR = Path("/opt/xhs-sync/logs") if Path("/opt/xhs-sync").exists() else Path("/tmp/geo-xhs-logs")
_last_heartbeat = {}
_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _safe(value, limit=2000):
    return str(value or "")[:limit]


def _append_local(event):
    log_dir = Path(os.environ.get("OBSERVABILITY_LOG_DIR") or DEFAULT_LOG_DIR)
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / "geo-observability.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
    except OSError as exc:
        print(f"[observability] local log unavailable: {exc}", flush=True)


def _post(event):
    base_url = _safe(os.environ.get("GATEWAY_BASE_URL"), 500).rstrip("/")
    token = _safe(os.environ.get("GATEWAY_SERVICE_TOKEN"), 1000)
    if not base_url or not token:
        return False
    payload = json.dumps(event, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        f"{base_url}/v1/observability/events",
        data=payload,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with request.urlopen(req, timeout=2) as response:
            return 200 <= response.status < 300
    except (error.URLError, TimeoutError, OSError) as exc:
        print(f"[observability] upload deferred: {exc}", flush=True)
        return False


def emit(service, event_type, status="success", severity="info", **fields):
    event = {
        "event_id": fields.pop("event_id", str(uuid.uuid4())),
        "project_code": PROJECT_CODE,
        "environment": os.environ.get("APP_ENV") or "production",
        "service_name": service,
        "host": socket.gethostname(),
        "event_type": event_type,
        "status": status,
        "severity": severity,
        "occurred_at": fields.pop("occurred_at", _now()),
        **{key: value for key, value in fields.items() if value is not None},
    }
    _append_local(event)
    _post(event)
    return event["event_id"]


def heartbeat(service, run_id=None, interval_seconds=300, **metadata):
    now = time.monotonic()
    with _lock:
        if now - _last_heartbeat.get(service, 0) < interval_seconds:
            return False
        _last_heartbeat[service] = now
    emit(service, "service_heartbeat", status="running", run_id=str(run_id) if run_id else None, metadata=metadata)
    return True


def exception_fields(exc, layer="worker"):
    return {
        "error_layer": layer,
        "error_category": "internal_error",
        "error_code": exc.__class__.__name__,
        "message": _safe(exc),
        "retryable": False,
    }
