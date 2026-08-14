#!/usr/bin/env python3
import json
import os
import signal
import socket
import subprocess
import sys
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import Json
import requests
import geo_observability as observability


DEFAULT_ENV_FILE = os.environ.get("XHS_SYNC_ENV_FILE") or (
    "/opt/xhs-sync/sync.env"
    if os.path.exists("/opt/xhs-sync")
    else "/tmp/geo-xhs/sync.env"
)

SENSITIVE_MARKERS = (
    "authorization",
    "api_key",
    "apikey",
    "access_key",
    "secret",
    "token",
    "password",
    "passwd",
    "pwd",
)
STRICT_PAID_PROVIDER_CODES = {
    "duomi_image_generation",
    "endata_xhs_note_detail",
    "volcengine_ark_chat",
    "volcengine_ark_embedding",
    "volcengine_ark_vision",
    "kimi_chat",
}

CENTRAL_PROVIDER_ROUTES = {
    "duomi_image_generation": ("duomi", "images_generations"),
    "endata_xhs_note_detail": ("endata", "xhs_note_detail"),
    "volcengine_ark_chat": ("volcengine_ark", "chat_completions"),
    "volcengine_ark_embedding": ("volcengine_ark", "embeddings"),
    "volcengine_ark_vision": ("volcengine_ark", "responses"),
    "kimi_chat": ("kimi", "chat_completions"),
}

_DB_CONFIG = {}
_CURRENT_SCRIPT_KEY = None
_CURRENT_SCRIPT_RUN_ID = None
_SIGNAL_HANDLERS_INSTALLED = False


class RateLimitError(RuntimeError):
    pass


def load_env_file(path=None):
    values = {}
    env_path = Path(path or DEFAULT_ENV_FILE)
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


def gateway_config():
    values = load_env_file()
    base_url = (os.environ.get("GATEWAY_BASE_URL") or values.get("GATEWAY_BASE_URL") or "").rstrip("/")
    token = os.environ.get("GATEWAY_SERVICE_TOKEN") or values.get("GATEWAY_SERVICE_TOKEN") or ""
    return base_url, token


def central_provider_route(provider_code):
    return CENTRAL_PROVIDER_ROUTES.get(str(provider_code or "").strip())


def gateway_proxy_url(provider_code):
    route = central_provider_route(provider_code)
    if not route:
        return None
    base_url, token = gateway_config()
    if not base_url or not token:
        raise RuntimeError("Missing GATEWAY_BASE_URL or GATEWAY_SERVICE_TOKEN")
    provider, endpoint = route
    return f"{base_url}/v1/proxy/{provider}/{endpoint}"


def gateway_response(result, request_url, status_code=None):
    response = requests.Response()
    response.status_code = int(
        result.get("upstream_status")
        or result.get("status_code")
        or status_code
        or 200
    )
    response.url = request_url
    response.headers["content-type"] = "application/json"
    if result.get("request_id"):
        response.headers["x-gateway-request-id"] = str(result["request_id"])
    body = result.get("data") if isinstance(result, dict) and "data" in result else result
    response._content = json.dumps(body if body is not None else {}, ensure_ascii=False).encode("utf-8")
    response.encoding = "utf-8"
    return response


def call_central_proxy(
    method,
    provider_code,
    operation,
    model_name=None,
    metadata=None,
    json_payload=None,
    params=None,
    timeout=120,
):
    route = central_provider_route(provider_code)
    if not route:
        return None
    base_url, token = gateway_config()
    request_url = gateway_proxy_url(provider_code)
    provider, endpoint = route
    payload = dict(json_payload or {})
    if method.upper() == "GET":
        payload.update({key: value for key, value in (params or {}).items() if key.lower() != "token"})
    response = requests.post(
        request_url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Gateway-Feature": operation,
            "X-Gateway-Request-Id": f"geo-xhs:{operation}:{int(time.time() * 1000)}:{uuid.uuid4()}",
        },
        json={
            "feature": operation,
            "model": model_name,
            "payload": payload,
        },
        timeout=timeout,
    )
    try:
        result = response.json()
    except Exception:
        result = {"error": response.text[:1000], "upstream_status": response.status_code}
    if isinstance(result, dict):
        result.setdefault("upstream_status", response.status_code)
    return gateway_response(result, request_url, response.status_code)


def configure_db(host=None, port=None, dbname=None, user=None, password=None):
    values = load_env_file()
    _DB_CONFIG.update(
        {
            "host": host or os.environ.get("PGHOST") or values.get("PGHOST") or "localhost",
            "port": port or os.environ.get("PGPORT") or values.get("PGPORT") or "5432",
            "dbname": dbname or os.environ.get("PGDATABASE") or values.get("PGDATABASE") or "xhs_geo",
            "user": user or os.environ.get("PGUSER") or values.get("PGUSER") or "app_user",
            "password": password or os.environ.get("PGPASSWORD") or values.get("PGPASSWORD") or "",
        }
    )


def configure_from_args(args):
    configure_db(
        host=getattr(args, "db_host", None),
        port=getattr(args, "db_port", None),
        dbname=getattr(args, "db_name", None),
        user=getattr(args, "db_user", None),
        password=getattr(args, "db_password", None),
    )


def db_connect():
    if not _DB_CONFIG:
        configure_db()
    if not _DB_CONFIG.get("password"):
        return None
    return psycopg2.connect(**_DB_CONFIG)


def warn(message):
    print(f"[geo_ops_gateway] {message}", file=sys.stderr, flush=True)


def safe_json(value):
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    except Exception:
        return {"unserializable": str(value)}


def is_sensitive_key(key):
    text = str(key or "").lower()
    return any(marker in text for marker in SENSITIVE_MARKERS)


def mask_value(value):
    if value is None:
        return None
    text = str(value)
    if len(text) <= 8:
        return "***"
    return f"{text[:3]}***{text[-4:]}"


def sanitize(value):
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            sanitized[key] = mask_value(item) if is_sensitive_key(key) else sanitize(item)
        return sanitized
    if isinstance(value, (list, tuple)):
        return [sanitize(item) for item in value]
    return value


def current_git_sha():
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(Path(__file__).resolve().parents[3]),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


def script_args_payload(args):
    if args is None:
        return {}
    if isinstance(args, dict):
        return sanitize(args)
    if hasattr(args, "__dict__"):
        return sanitize(vars(args))
    return sanitize({"args": str(args)})


def ensure_script_registered(conn, script_key, script_path=None):
    script_path = script_path or sys.argv[0] or script_key
    query = """
INSERT INTO public.geo_ops_scripts (
  script_key, display_name_cn, description_cn, script_path, script_type, runtime_target
) VALUES (
  %(script_key)s, %(display_name_cn)s, %(description_cn)s, %(script_path)s, 'python', 'server'
)
ON CONFLICT (script_key) DO NOTHING
"""
    with conn.cursor() as cur:
        cur.execute(
            query,
            {
                "script_key": script_key,
                "display_name_cn": script_key,
                "description_cn": "自动注册的 GEO 后台脚本，请在 geo_ops_scripts 中补充中文说明。",
                "script_path": script_path,
            },
        )


def set_current_script_run(script_key=None, script_run_id=None):
    global _CURRENT_SCRIPT_KEY, _CURRENT_SCRIPT_RUN_ID
    _CURRENT_SCRIPT_KEY = script_key
    _CURRENT_SCRIPT_RUN_ID = script_run_id


def start_script_run(
    script_key,
    trigger_type=None,
    trigger_source=None,
    job_ref_type=None,
    job_ref_id=None,
    note_id=None,
    asset_id=None,
    image_analysis_id=None,
    worker_id=None,
    command=None,
    args=None,
    env_profile=None,
):
    trigger_type = trigger_type or os.environ.get("GEO_OPS_TRIGGER_TYPE") or "manual"
    trigger_source = trigger_source or os.environ.get("GEO_OPS_TRIGGER_SOURCE")
    job_ref_type = job_ref_type or os.environ.get("GEO_OPS_JOB_REF_TYPE")
    job_ref_id = job_ref_id or os.environ.get("GEO_OPS_JOB_REF_ID")
    command = command if command is not None else sys.argv
    payload = {
        "script_key": script_key,
        "trigger_type": trigger_type,
        "trigger_source": trigger_source,
        "job_ref_type": job_ref_type,
        "job_ref_id": str(job_ref_id) if job_ref_id is not None else None,
        "note_id": note_id,
        "asset_id": asset_id,
        "image_analysis_id": image_analysis_id,
        "worker_id": worker_id,
        "host_name": socket.gethostname(),
        "pid": os.getpid(),
        "git_commit_sha": current_git_sha(),
        "command": Json(safe_json(sanitize(command))),
        "args": Json(safe_json(script_args_payload(args))),
        "env_profile": env_profile,
    }
    query = """
INSERT INTO public.geo_ops_script_runs (
  script_key, trigger_type, trigger_source, job_ref_type, job_ref_id,
  note_id, asset_id, image_analysis_id, worker_id, host_name, pid,
  git_commit_sha, command, args, env_profile
) VALUES (
  %(script_key)s, %(trigger_type)s, %(trigger_source)s, %(job_ref_type)s, %(job_ref_id)s,
  %(note_id)s, %(asset_id)s, %(image_analysis_id)s, %(worker_id)s, %(host_name)s, %(pid)s,
  %(git_commit_sha)s, %(command)s, %(args)s, %(env_profile)s
)
RETURNING script_run_id
"""
    script_run_id = None
    try:
        conn = db_connect()
        if conn is None:
            return None
        try:
            ensure_script_registered(conn, script_key)
            with conn.cursor() as cur:
                cur.execute(query, payload)
                script_run_id = cur.fetchone()[0]
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        warn(f"start_script_run skipped: {exc}")
        return None
    set_current_script_run(script_key, script_run_id)
    return script_run_id


def cancel_stale_running_runs(script_key, reason="Superseded by a new service process."):
    query = """
UPDATE public.geo_ops_script_runs
SET
  status = 'canceled',
  finished_at = now(),
  duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::integer),
  error_message = %(reason)s,
  updated_at = now()
WHERE script_key = %(script_key)s
  AND status = 'running'
"""
    try:
        conn = db_connect()
        if conn is None:
            return 0
        try:
            with conn.cursor() as cur:
                cur.execute(query, {"script_key": script_key, "reason": reason})
                count = cur.rowcount or 0
            conn.commit()
            return count
        finally:
            conn.close()
    except Exception as exc:
        warn(f"cancel_stale_running_runs skipped: {exc}")
        return 0


def install_signal_handlers(script_run_id=None):
    global _SIGNAL_HANDLERS_INSTALLED
    if _SIGNAL_HANDLERS_INSTALLED:
        return
    script_run_id = script_run_id if script_run_id is not None else _CURRENT_SCRIPT_RUN_ID
    if not script_run_id:
        return

    def handle(signum, _frame):
        finish_script_run(
            script_run_id,
            status="canceled",
            exit_code=128 + int(signum),
            error_message=f"terminated by signal {signum}",
        )
        raise SystemExit(128 + int(signum))

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)
    _SIGNAL_HANDLERS_INSTALLED = True


def finish_script_run(
    script_run_id=None,
    status="success",
    exit_code=0,
    processed_count=None,
    success_count=None,
    failed_count=None,
    skipped_count=None,
    summary=None,
    stdout_tail=None,
    stderr_tail=None,
    error_message=None,
):
    script_run_id = script_run_id if script_run_id is not None else _CURRENT_SCRIPT_RUN_ID
    if not script_run_id:
        return
    query = """
UPDATE public.geo_ops_script_runs
SET
  status = %(status)s,
  finished_at = now(),
  duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::integer),
  exit_code = %(exit_code)s,
  processed_count = %(processed_count)s,
  success_count = %(success_count)s,
  failed_count = %(failed_count)s,
  skipped_count = %(skipped_count)s,
  summary = %(summary)s,
  stdout_tail = %(stdout_tail)s,
  stderr_tail = %(stderr_tail)s,
  error_message = %(error_message)s,
  updated_at = now()
WHERE script_run_id = %(script_run_id)s
"""
    try:
        conn = db_connect()
        if conn is None:
            return
        try:
            with conn.cursor() as cur:
                cur.execute(
                    query,
                    {
                        "script_run_id": script_run_id,
                        "status": status,
                        "exit_code": exit_code,
                        "processed_count": processed_count,
                        "success_count": success_count,
                        "failed_count": failed_count,
                        "skipped_count": skipped_count,
                        "summary": Json(safe_json(sanitize(summary or {}))),
                        "stdout_tail": stdout_tail,
                        "stderr_tail": stderr_tail,
                        "error_message": error_message,
                    },
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        warn(f"finish_script_run skipped: {exc}")


def insert_event(script_key=None, message="", level="info", event_type="log", payload=None, script_run_id=None):
    script_key = script_key or _CURRENT_SCRIPT_KEY
    script_run_id = script_run_id if script_run_id is not None else _CURRENT_SCRIPT_RUN_ID
    unified_status = "failed" if level in ("error", "critical") else ("running" if level == "warning" else "success")
    unified_severity = level if level in ("debug", "info", "warning", "error", "critical") else "info"
    try:
        observability.emit(
            script_key or "geo-worker",
            event_type,
            status=unified_status,
            severity=unified_severity,
            run_id=str(script_run_id) if script_run_id is not None else None,
            operation=event_type,
            message=message,
            metadata=payload or {},
        )
    except Exception as exc:
        warn(f"unified observability skipped: {exc}")
    query = """
INSERT INTO public.geo_ops_script_events (
  script_run_id, script_key, level, event_type, message, payload
) VALUES (
  %(script_run_id)s, %(script_key)s, %(level)s, %(event_type)s, %(message)s, %(payload)s
)
"""
    try:
        conn = db_connect()
        if conn is None:
            return
        try:
            with conn.cursor() as cur:
                cur.execute(
                    query,
                    {
                        "script_run_id": script_run_id,
                        "script_key": script_key,
                        "level": level,
                        "event_type": event_type,
                        "message": str(message)[:2000],
                        "payload": Json(safe_json(sanitize(payload or {}))),
                    },
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        warn(f"insert_event skipped: {exc}")


def response_usage(payload):
    if not isinstance(payload, dict):
        return {}
    usage = payload.get("usage")
    return usage if isinstance(usage, dict) else {}


def classify_provider_payload(provider_code, payload):
    if provider_code != "endata_xhs_note_detail" or not isinstance(payload, dict):
        return None
    code = payload.get("Code")
    if code in (0, 200, "0", "200", None):
        return None
    message = str(payload.get("Msg") or "")
    return {
        "status": "failed",
        "error_code": "endata_business_code",
        "error_message": f"Code={code} Msg={message}",
        "metadata": {
            "business_code": code,
            "business_message": message,
            "business_status": "failed",
        },
    }


def int_from_usage(usage, *keys):
    for key in keys:
        value = usage.get(key) if isinstance(usage, dict) else None
        try:
            if value is not None:
                return int(value)
        except (TypeError, ValueError):
            continue
    return None


def classify_http_status(status_code):
    if status_code is None:
        return "failed", None
    if status_code == 429:
        return "rate_limited", "http_429"
    if 200 <= status_code < 400:
        return "success", None
    if status_code == 401:
        return "failed", "http_401"
    if status_code == 403:
        return "failed", "http_403"
    if 500 <= status_code:
        return "failed", "provider_error"
    return "failed", f"http_{status_code}"


def classify_exception(exc):
    if isinstance(exc, requests.Timeout):
        return "timeout", "timeout"
    if isinstance(exc, requests.ConnectionError):
        return "failed", "network"
    return "failed", exc.__class__.__name__


def request_size(kwargs):
    total = 0
    for key in ("params", "json", "data"):
        if key in kwargs and kwargs[key] is not None:
            try:
                total += len(json.dumps(kwargs[key], ensure_ascii=False, default=str).encode("utf-8"))
            except Exception:
                total += len(str(kwargs[key]).encode("utf-8"))
    return total or None


def response_size(response):
    try:
        return len(response.content or b"")
    except Exception:
        return None


def resolve_model_and_credential(conn, provider_code, model_name=None):
    model_config_id = None
    credential_id = None
    with conn.cursor() as cur:
        if model_name:
            cur.execute(
                """
SELECT model_config_id
FROM public.geo_ops_model_configs
WHERE provider_code = %s AND model_name = %s
ORDER BY is_default DESC, model_config_id
LIMIT 1
""",
                (provider_code, model_name),
            )
            row = cur.fetchone()
            model_config_id = row[0] if row else None
        cur.execute(
            """
SELECT credential_id
FROM public.geo_ops_credentials
WHERE provider_code = %s AND status = 'active'
ORDER BY is_default DESC, credential_id
LIMIT 1
""",
            (provider_code,),
        )
        row = cur.fetchone()
        credential_id = row[0] if row else None
    return model_config_id, credential_id


def matching_rate_limit_rules(conn, provider_code, model_config_id=None, credential_id=None):
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT rule_id, rule_name, period_seconds, max_calls, max_tokens, max_estimated_cost, hard_block,
       provider_code, model_config_id, credential_id
FROM public.geo_ops_rate_limit_rules
WHERE is_enabled
  AND (provider_code IS NULL OR provider_code = %(provider_code)s)
  AND (model_config_id IS NULL OR model_config_id = %(model_config_id)s)
  AND (credential_id IS NULL OR credential_id = %(credential_id)s)
ORDER BY hard_block DESC, period_seconds ASC, rule_id ASC
""",
            {
                "provider_code": provider_code,
                "model_config_id": model_config_id,
                "credential_id": credential_id,
            },
        )
        return cur.fetchall()


def usage_for_rule(conn, rule):
    (
        _rule_id,
        _rule_name,
        period_seconds,
        _max_calls,
        _max_tokens,
        _max_estimated_cost,
        _hard_block,
        provider_code,
        model_config_id,
        credential_id,
    ) = rule
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT
  count(*)::integer AS calls_total,
  COALESCE(sum(total_tokens), 0)::bigint AS tokens_total,
  COALESCE(sum(estimated_cost), 0)::numeric AS estimated_cost
FROM public.geo_ops_api_call_logs
WHERE started_at >= now() - ((%(period_seconds)s::text || ' seconds')::interval)
  AND (%(provider_code)s IS NULL OR provider_code = %(provider_code)s)
  AND (%(model_config_id)s IS NULL OR model_config_id = %(model_config_id)s)
  AND (%(credential_id)s IS NULL OR credential_id = %(credential_id)s)
""",
            {
                "period_seconds": period_seconds,
                "provider_code": provider_code,
                "model_config_id": model_config_id,
                "credential_id": credential_id,
            },
        )
        return cur.fetchone()


def check_rate_limits(provider_code, model_name=None):
    try:
        conn = db_connect()
        if conn is None:
            if provider_code in STRICT_PAID_PROVIDER_CODES and os.environ.get("GEO_PAID_PROVIDER_FAIL_OPEN") != "1":
                return {
                    "blocked": True,
                    "error": f"rate limit database unavailable for paid provider {provider_code}",
                    "payload": {
                        "provider_code": provider_code,
                        "error_code": "rate_limit_db_unavailable",
                    },
                }
            return None
        try:
            model_config_id, credential_id = resolve_model_and_credential(conn, provider_code, model_name)
            rules = matching_rate_limit_rules(conn, provider_code, model_config_id, credential_id)
            if not rules and provider_code in STRICT_PAID_PROVIDER_CODES and os.environ.get("GEO_PAID_PROVIDER_FAIL_OPEN") != "1":
                return {
                    "blocked": True,
                    "error": f"no enabled rate limit rule for paid provider {provider_code}",
                    "payload": {
                        "provider_code": provider_code,
                        "error_code": "rate_limit_rule_missing",
                    },
                }
            for rule in rules:
                rule_id, rule_name, period_seconds, max_calls, max_tokens, max_estimated_cost, hard_block, *_ = rule
                calls_total, tokens_total, estimated_cost = usage_for_rule(conn, rule)
                exceeded = []
                if max_calls is not None and calls_total >= max_calls:
                    exceeded.append(f"calls {calls_total}/{max_calls}")
                if max_tokens is not None and tokens_total >= max_tokens:
                    exceeded.append(f"tokens {tokens_total}/{max_tokens}")
                if max_estimated_cost is not None and estimated_cost >= max_estimated_cost:
                    exceeded.append(f"cost {estimated_cost}/{max_estimated_cost}")
                if exceeded:
                    message = f"rate limit rule {rule_name} exceeded: {', '.join(exceeded)}"
                    payload = {
                        "rule_id": rule_id,
                        "rule_name": rule_name,
                        "period_seconds": period_seconds,
                        "hard_block": hard_block,
                        "provider_code": provider_code,
                        "model_name": model_name,
                    }
                    insert_event(level="warning", event_type="rate_limit_exceeded", message=message, payload=payload)
                    if hard_block:
                        return {"blocked": True, "error": message, "payload": payload}
        finally:
            conn.close()
    except Exception as exc:
        if provider_code not in STRICT_PAID_PROVIDER_CODES:
            warn(f"check_rate_limits skipped: {exc}")
            return None
        if os.environ.get("GEO_PAID_PROVIDER_FAIL_OPEN") == "1":
            warn(f"check_rate_limits skipped: {exc}")
            return None
        return {
            "blocked": True,
            "error": f"rate limit check failed for paid provider {provider_code}: {exc}",
            "payload": {
                "provider_code": provider_code,
                "error_code": "rate_limit_check_failed",
            },
        }
    return None


def record_api_call(
    provider_code,
    operation,
    method,
    url,
    status,
    started_at,
    finished_at,
    latency_ms,
    http_status=None,
    attempt_no=1,
    max_attempts=None,
    model_name=None,
    note_id=None,
    asset_id=None,
    image_analysis_id=None,
    image_url=None,
    request_bytes=None,
    response_bytes=None,
    usage=None,
    error_code=None,
    error_message=None,
    metadata=None,
    trace_id=None,
    script_key=None,
    script_run_id=None,
):
    parsed = urlparse(url)
    usage = usage if isinstance(usage, dict) else {}
    query = """
INSERT INTO public.geo_ops_api_call_logs (
  trace_id, provider_code, model_config_id, credential_id, script_run_id, script_key,
  operation, status, http_method, request_host, request_path, http_status,
  attempt_no, max_attempts, note_id, asset_id, image_analysis_id, image_url,
  started_at, finished_at, latency_ms, request_bytes, response_bytes,
  input_tokens, output_tokens, total_tokens, cached_tokens,
  rate_limited, error_code, error_message, raw_usage, metadata
) VALUES (
  %(trace_id)s, %(provider_code)s, %(model_config_id)s, %(credential_id)s, %(script_run_id)s, %(script_key)s,
  %(operation)s, %(status)s, %(http_method)s, %(request_host)s, %(request_path)s, %(http_status)s,
  %(attempt_no)s, %(max_attempts)s, %(note_id)s, %(asset_id)s, %(image_analysis_id)s, %(image_url)s,
  %(started_at)s, %(finished_at)s, %(latency_ms)s, %(request_bytes)s, %(response_bytes)s,
  %(input_tokens)s, %(output_tokens)s, %(total_tokens)s, %(cached_tokens)s,
  %(rate_limited)s, %(error_code)s, %(error_message)s, %(raw_usage)s, %(metadata)s
)
"""
    try:
        conn = db_connect()
        if conn is None:
            return
        try:
            model_config_id, credential_id = resolve_model_and_credential(conn, provider_code, model_name)
            with conn.cursor() as cur:
                cur.execute(
                    query,
                    {
                        "trace_id": trace_id or str(uuid.uuid4()),
                        "provider_code": provider_code,
                        "model_config_id": model_config_id,
                        "credential_id": credential_id,
                        "script_run_id": script_run_id if script_run_id is not None else _CURRENT_SCRIPT_RUN_ID,
                        "script_key": script_key or _CURRENT_SCRIPT_KEY,
                        "operation": operation,
                        "status": status,
                        "http_method": method.upper() if method else None,
                        "request_host": parsed.netloc,
                        "request_path": parsed.path or "/",
                        "http_status": http_status,
                        "attempt_no": attempt_no or 1,
                        "max_attempts": max_attempts,
                        "note_id": note_id,
                        "asset_id": asset_id,
                        "image_analysis_id": image_analysis_id,
                        "image_url": image_url,
                        "started_at": started_at,
                        "finished_at": finished_at,
                        "latency_ms": latency_ms,
                        "request_bytes": request_bytes,
                        "response_bytes": response_bytes,
                        "input_tokens": int_from_usage(usage, "input_tokens", "prompt_tokens"),
                        "output_tokens": int_from_usage(usage, "output_tokens", "completion_tokens"),
                        "total_tokens": int_from_usage(usage, "total_tokens"),
                        "cached_tokens": int_from_usage(usage, "cached_tokens"),
                        "rate_limited": status == "rate_limited",
                        "error_code": error_code,
                        "error_message": str(error_message)[:2000] if error_message else None,
                        "raw_usage": Json(safe_json(usage)),
                        "metadata": Json(safe_json(sanitize(metadata or {}))),
                    },
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        warn(f"record_api_call skipped: {exc}")


def call_api(
    method,
    url,
    provider_code,
    operation,
    model_name=None,
    note_id=None,
    asset_id=None,
    image_analysis_id=None,
    image_url=None,
    attempt_no=1,
    max_attempts=None,
    metadata=None,
    **kwargs,
):
    central_route = central_provider_route(provider_code)
    limit_decision = None if central_route else check_rate_limits(provider_code, model_name=model_name)
    if limit_decision and limit_decision.get("blocked"):
        now = datetime.now(timezone.utc)
        record_api_call(
            provider_code=provider_code,
            operation=operation,
            method=method,
            url=url,
            status="rate_limited",
            started_at=now,
            finished_at=now,
            latency_ms=0,
            attempt_no=attempt_no,
            max_attempts=max_attempts,
            model_name=model_name,
            note_id=note_id,
            asset_id=asset_id,
            image_analysis_id=image_analysis_id,
            image_url=image_url,
            error_code="gateway_rate_limit",
            error_message=limit_decision["error"],
            metadata={**(metadata or {}), "rate_limit": limit_decision.get("payload") or {}},
        )
        raise RateLimitError(limit_decision["error"])

    started_mono = time.monotonic()
    started_at = datetime.now(timezone.utc)
    response = None
    status = "failed"
    error_code = None
    error_message = None
    usage = {}
    try:
        if central_route:
            response = call_central_proxy(
                method,
                provider_code,
                operation,
                model_name=model_name,
                metadata=metadata,
                json_payload=kwargs.get("json"),
                params=kwargs.get("params"),
                timeout=kwargs.get("timeout", 120),
            )
        else:
            response = requests.request(method, url, **kwargs)
        status, error_code = classify_http_status(response.status_code)
        try:
            payload = response.json()
            usage = response_usage(payload)
            provider_classification = classify_provider_payload(provider_code, payload)
            if provider_classification:
                status = provider_classification["status"]
                error_code = provider_classification["error_code"]
                error_message = provider_classification["error_message"]
                metadata = {**(metadata or {}), **provider_classification["metadata"]}
        except Exception:
            usage = {}
        return response
    except Exception as exc:
        status, error_code = classify_exception(exc)
        error_message = str(exc)
        raise
    finally:
        finished_at = datetime.now(timezone.utc)
        latency_ms = int((time.monotonic() - started_mono) * 1000)
        if response is not None and response.status_code >= 400 and not error_message:
            error_message = (response.text or "")[:1000]
        record_api_call(
            provider_code=provider_code,
            operation=operation,
            method=method,
            url=url,
            status=status,
            started_at=started_at,
            finished_at=finished_at,
            latency_ms=latency_ms,
            http_status=response.status_code if response is not None else None,
            attempt_no=attempt_no,
            max_attempts=max_attempts,
            model_name=model_name,
            note_id=note_id,
            asset_id=asset_id,
            image_analysis_id=image_analysis_id,
            image_url=image_url,
            request_bytes=request_size(kwargs),
            response_bytes=response_size(response) if response is not None else None,
            usage=usage,
            error_code=error_code,
            error_message=error_message,
            metadata=metadata,
        )


def exception_summary(exc):
    return {
        "error_type": exc.__class__.__name__,
        "error_message": str(exc),
        "traceback_tail": traceback.format_exc()[-4000:],
    }
