#!/usr/bin/env python3
import argparse
import json
import os
import sys

import psycopg2
from psycopg2.extras import Json

import geo_ops_gateway as ops


def parse_args():
    parser = argparse.ArgumentParser(
        description="Backfill GEO observability tables from existing business result tables."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db-host", default="localhost")
    parser.add_argument("--db-port", default="5432")
    parser.add_argument("--db-name", default="xhs_geo")
    parser.add_argument("--db-user", default="app_user")
    parser.add_argument("--db-password", default="")
    return parser.parse_args()


def enrich_args(args):
    values = ops.load_env_file()
    args.db_password = args.db_password or os.environ.get("PGPASSWORD") or values.get("PGPASSWORD") or ""
    if not args.db_password:
        raise RuntimeError("Missing database password. Set PGPASSWORD or --db-password.")
    return args


def db_connect(args):
    return psycopg2.connect(
        host=args.db_host,
        port=args.db_port,
        dbname=args.db_name,
        user=args.db_user,
        password=args.db_password,
    )


def table_exists(conn, table_name):
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", (table_name,))
        return cur.fetchone()[0] is not None


def register_backfill_script(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO public.geo_ops_scripts (
  script_key, display_name_cn, description_cn, script_path, script_type, runtime_target, service_name
) VALUES (
  'backfill_geo_ops_history',
  '历史观测日志回填',
  '把历史业务结果表转换为 geo_ops API 调用日志和脚本运行日志。',
  'server/scripts/GEO/backfill_geo_ops_history.py',
  'python',
  'server',
  NULL
)
ON CONFLICT (script_key) DO UPDATE SET
  display_name_cn = EXCLUDED.display_name_cn,
  description_cn = EXCLUDED.description_cn,
  script_path = EXCLUDED.script_path,
  updated_at = now()
"""
        )
    conn.commit()


def execute_insert(conn, name, query):
    with conn.cursor() as cur:
        cur.execute(query)
        count = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
    return name, count


BACKFILL_NOTE_DETAILS = """
INSERT INTO public.geo_ops_api_call_logs (
  trace_id, provider_code, credential_id, script_key, operation, status,
  http_method, request_host, request_path, attempt_no, max_attempts, note_id,
  started_at, finished_at, http_status, error_code, error_message, raw_usage, metadata
)
SELECT
  'history:note_details:' || n.note_id,
  'endata_xhs_note_detail',
  (
    SELECT credential_id
    FROM public.geo_ops_credentials
    WHERE provider_code = 'endata_xhs_note_detail' AND status = 'active'
    ORDER BY is_default DESC, credential_id
    LIMIT 1
  ),
  'import_xhs_note_details_from_excel',
  'historical_note_detail_fetch',
  CASE
    WHEN n.detail_status = 'success' THEN 'success'
    WHEN n.detail_status = 'skipped' THEN 'skipped'
    ELSE 'failed'
  END,
  'GET',
  'dataapi.endata.com.cn',
  '/V2/Xhs/GetStandardNoteInfo',
  1,
  1,
  n.note_id,
  COALESCE(n.fetched_at, n.updated_at, n.created_at, now()),
  COALESCE(n.fetched_at, n.updated_at, n.created_at, now()),
  CASE WHEN n.detail_status = 'success' THEN 200 ELSE NULL END,
  CASE WHEN n.detail_status = 'success' THEN NULL ELSE 'historical_business_status' END,
  LEFT(n.detail_error, 2000),
  '{}'::jsonb,
  jsonb_build_object(
    'history_source', 'note_details',
    'source_status', n.detail_status,
    'source_table', 'public.note_details'
  )
FROM public.note_details n
WHERE NOT EXISTS (
  SELECT 1
  FROM public.geo_ops_api_call_logs l
  WHERE l.trace_id = 'history:note_details:' || n.note_id
)
"""


BACKFILL_IMAGE_ANALYSIS = """
INSERT INTO public.geo_ops_api_call_logs (
  trace_id, provider_code, model_config_id, credential_id, script_key, operation, status,
  http_method, request_host, request_path, attempt_no, max_attempts, note_id, image_analysis_id, image_url,
  started_at, finished_at, http_status, input_tokens, output_tokens, total_tokens,
  error_code, error_message, raw_usage, metadata
)
SELECT
  'history:image_analysis:' || i.id::text,
  'volcengine_ark_vision',
  (
    SELECT model_config_id
    FROM public.geo_ops_model_configs
    WHERE provider_code = 'volcengine_ark_vision'
      AND model_name = COALESCE(i.model_name, 'doubao-seed-2-0-mini-260428')
    ORDER BY is_default DESC, model_config_id
    LIMIT 1
  ),
  (
    SELECT credential_id
    FROM public.geo_ops_credentials
    WHERE provider_code = 'volcengine_ark_vision' AND status = 'active'
    ORDER BY is_default DESC, credential_id
    LIMIT 1
  ),
  'analyze_xhs_geo_note_images',
  'historical_image_analysis',
  CASE WHEN i.status = 'success' THEN 'success' ELSE 'failed' END,
  'POST',
  'ark.cn-beijing.volces.com',
  '/api/v3/responses',
  1,
  1,
  i.note_id,
  i.id,
  i.image_url,
  COALESCE(i.analyzed_at, i.updated_at, i.created_at, now()),
  COALESCE(i.analyzed_at, i.updated_at, i.created_at, now()),
  CASE WHEN i.status = 'success' THEN 200 ELSE NULL END,
  CASE WHEN (i.raw_response->'usage'->>'input_tokens') ~ '^[0-9]+$'
    THEN (i.raw_response->'usage'->>'input_tokens')::integer
    WHEN (i.raw_response->'usage'->>'prompt_tokens') ~ '^[0-9]+$'
    THEN (i.raw_response->'usage'->>'prompt_tokens')::integer
    ELSE NULL
  END,
  CASE WHEN (i.raw_response->'usage'->>'output_tokens') ~ '^[0-9]+$'
    THEN (i.raw_response->'usage'->>'output_tokens')::integer
    WHEN (i.raw_response->'usage'->>'completion_tokens') ~ '^[0-9]+$'
    THEN (i.raw_response->'usage'->>'completion_tokens')::integer
    ELSE NULL
  END,
  CASE WHEN (i.raw_response->'usage'->>'total_tokens') ~ '^[0-9]+$'
    THEN (i.raw_response->'usage'->>'total_tokens')::integer
    ELSE NULL
  END,
  CASE WHEN i.status = 'success' THEN NULL ELSE 'historical_business_status' END,
  LEFT(i.error, 2000),
  COALESCE(i.raw_response->'usage', '{}'::jsonb),
  jsonb_build_object(
    'history_source', 'image_analysis',
    'source_status', i.status,
    'source_table', 'public.image_analysis',
    'image_index', i.image_index,
    'analysis_transport', i.analysis_transport
  )
FROM public.image_analysis i
WHERE NOT EXISTS (
  SELECT 1
  FROM public.geo_ops_api_call_logs l
  WHERE l.trace_id = 'history:image_analysis:' || i.id::text
)
"""


BACKFILL_KIMI_RUNS = """
INSERT INTO public.geo_ops_api_call_logs (
  trace_id, provider_code, model_config_id, credential_id, script_key, operation, status,
  http_method, request_host, request_path, attempt_no, max_attempts, note_id,
  started_at, finished_at, latency_ms, http_status, input_tokens, output_tokens, total_tokens,
  error_code, error_message, raw_usage, metadata
)
SELECT
  'history:geo_note_content_asset_runs:' || r.run_id::text,
  'kimi_chat',
  (
    SELECT model_config_id
    FROM public.geo_ops_model_configs
    WHERE provider_code = 'kimi_chat'
      AND model_name = COALESCE(r.model_name, 'kimi-k2.6')
    ORDER BY is_default DESC, model_config_id
    LIMIT 1
  ),
  (
    SELECT credential_id
    FROM public.geo_ops_credentials
    WHERE provider_code = 'kimi_chat' AND status = 'active'
    ORDER BY is_default DESC, credential_id
    LIMIT 1
  ),
  'build_geo_content_assets',
  'historical_content_asset_summary',
  CASE WHEN r.status = 'success' THEN 'success' ELSE 'failed' END,
  'POST',
  'api.kimi.com',
  '/coding/v1/chat/completions',
  1,
  1,
  r.note_id,
  r.created_at,
  r.created_at + ((COALESCE(r.latency_ms, 0)::text || ' milliseconds')::interval),
  r.latency_ms,
  CASE WHEN r.status = 'success' THEN 200 ELSE NULL END,
  CASE WHEN (r.token_usage->>'input_tokens') ~ '^[0-9]+$'
    THEN (r.token_usage->>'input_tokens')::integer
    WHEN (r.token_usage->>'prompt_tokens') ~ '^[0-9]+$'
    THEN (r.token_usage->>'prompt_tokens')::integer
    ELSE NULL
  END,
  CASE WHEN (r.token_usage->>'output_tokens') ~ '^[0-9]+$'
    THEN (r.token_usage->>'output_tokens')::integer
    WHEN (r.token_usage->>'completion_tokens') ~ '^[0-9]+$'
    THEN (r.token_usage->>'completion_tokens')::integer
    ELSE NULL
  END,
  CASE WHEN (r.token_usage->>'total_tokens') ~ '^[0-9]+$'
    THEN (r.token_usage->>'total_tokens')::integer
    ELSE NULL
  END,
  CASE WHEN r.status = 'success' THEN NULL ELSE 'historical_business_status' END,
  LEFT(r.error, 2000),
  COALESCE(r.token_usage, '{}'::jsonb),
  jsonb_build_object(
    'history_source', 'geo_note_content_asset_runs',
    'source_status', r.status,
    'source_table', 'public.geo_note_content_asset_runs',
    'prompt_version', r.prompt_version
  )
FROM public.geo_note_content_asset_runs r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.geo_ops_api_call_logs l
  WHERE l.trace_id = 'history:geo_note_content_asset_runs:' || r.run_id::text
)
"""


BACKFILL_VECTORS = """
INSERT INTO public.geo_ops_api_call_logs (
  trace_id, provider_code, model_config_id, credential_id, script_key, operation, status,
  http_method, request_host, request_path, attempt_no, max_attempts, note_id, asset_id,
  started_at, finished_at, http_status, raw_usage, metadata
)
SELECT
  'history:geo_note_content_asset_vectors:' || v.asset_id::text,
  'volcengine_ark_embedding',
  (
    SELECT model_config_id
    FROM public.geo_ops_model_configs
    WHERE provider_code = 'volcengine_ark_embedding'
      AND model_name = COALESCE(v.embedding_model, 'doubao-embedding-vision-251215')
    ORDER BY is_default DESC, model_config_id
    LIMIT 1
  ),
  (
    SELECT credential_id
    FROM public.geo_ops_credentials
    WHERE provider_code = 'volcengine_ark_embedding' AND status = 'active'
    ORDER BY is_default DESC, credential_id
    LIMIT 1
  ),
  'embed_geo_content_assets',
  'historical_asset_embedding',
  'success',
  'POST',
  'ark.cn-beijing.volces.com',
  '/api/v3/embeddings/multimodal',
  1,
  1,
  v.note_id,
  v.asset_id,
  COALESCE(v.updated_at, v.created_at, now()),
  COALESCE(v.updated_at, v.created_at, now()),
  200,
  '{}'::jsonb,
  jsonb_build_object(
    'history_source', 'geo_note_content_asset_vectors',
    'source_status', 'success',
    'source_table', 'public.geo_note_content_asset_vectors',
    'embedding_model', v.embedding_model
  )
FROM public.geo_note_content_asset_vectors v
WHERE NOT EXISTS (
  SELECT 1
  FROM public.geo_ops_api_call_logs l
  WHERE l.trace_id = 'history:geo_note_content_asset_vectors:' || v.asset_id::text
)
"""


BACKFILL_QUEUE_SCRIPT_RUNS = """
INSERT INTO public.geo_ops_script_runs (
  script_key, status, trigger_type, trigger_source, job_ref_type, job_ref_id,
  note_id, worker_id, command, args, started_at, finished_at, duration_ms,
  processed_count, success_count, failed_count, summary, stdout_tail, stderr_tail,
  error_message
)
SELECT
  'sync_xhs_note_by_id',
  CASE
    WHEN q.status IN ('pending', 'running', 'success', 'failed', 'skipped') THEN q.status
    ELSE 'failed'
  END,
  'queue',
  q.source_keyword,
  'geo_note_ingest_queue',
  q.queue_id::text,
  q.note_id,
  q.locked_by,
  to_jsonb(q.run_command),
  jsonb_build_object(
    'source_keyword', q.source_keyword,
    'priority', q.priority,
    'attempts', q.attempts,
    'max_attempts', q.max_attempts
  ),
  COALESCE(q.started_at, q.created_at, now()),
  CASE WHEN q.finished_at IS NULL AND q.status = 'running' THEN NULL ELSE COALESCE(q.finished_at, q.updated_at, now()) END,
  CASE WHEN (q.result->>'elapsed_ms') ~ '^[0-9]+$' THEN (q.result->>'elapsed_ms')::integer ELSE NULL END,
  1,
  CASE WHEN q.status = 'success' THEN 1 ELSE 0 END,
  CASE WHEN q.status = 'failed' THEN 1 ELSE 0 END,
  jsonb_build_object(
    'history_source', 'geo_note_ingest_queue',
    'history_trace_id', 'history:geo_note_ingest_queue:' || q.queue_id::text,
    'source_status', q.status,
    'queue_result', q.result
  ),
  q.result->>'stdout_tail',
  q.result->>'stderr_tail',
  LEFT(q.last_error, 2000)
FROM public.geo_note_ingest_queue q
WHERE NOT EXISTS (
  SELECT 1
  FROM public.geo_ops_script_runs r
  WHERE r.summary->>'history_trace_id' = 'history:geo_note_ingest_queue:' || q.queue_id::text
)
"""


BACKFILL_QUEUE_EVENTS = """
INSERT INTO public.geo_ops_script_events (
  script_run_id, script_key, event_time, level, event_type, message, payload
)
SELECT
  r.script_run_id,
  r.script_key,
  COALESCE(r.finished_at, r.started_at, now()),
  CASE WHEN r.status = 'failed' THEN 'error' ELSE 'info' END,
  'historical_queue_result',
  CASE
    WHEN r.status = 'success' THEN '历史队列任务成功'
    WHEN r.status = 'failed' THEN '历史队列任务失败'
    WHEN r.status = 'running' THEN '历史队列任务仍在运行'
    ELSE '历史队列任务状态记录'
  END,
  jsonb_build_object(
    'history_source', 'geo_note_ingest_queue',
    'history_trace_id', r.summary->>'history_trace_id',
    'job_ref_id', r.job_ref_id,
    'note_id', r.note_id,
    'status', r.status
  )
FROM public.geo_ops_script_runs r
WHERE r.summary->>'history_source' = 'geo_note_ingest_queue'
  AND NOT EXISTS (
    SELECT 1
    FROM public.geo_ops_script_events e
    WHERE e.script_run_id = r.script_run_id
      AND e.event_type = 'historical_queue_result'
  )
"""


def run_backfill(conn):
    tasks = []
    if table_exists(conn, "public.note_details"):
        tasks.append(("note_details_api_calls", BACKFILL_NOTE_DETAILS))
    if table_exists(conn, "public.image_analysis"):
        tasks.append(("image_analysis_api_calls", BACKFILL_IMAGE_ANALYSIS))
    if table_exists(conn, "public.geo_note_content_asset_runs"):
        tasks.append(("kimi_asset_run_api_calls", BACKFILL_KIMI_RUNS))
    if table_exists(conn, "public.geo_note_content_asset_vectors"):
        tasks.append(("asset_vector_api_calls", BACKFILL_VECTORS))
    if table_exists(conn, "public.geo_note_ingest_queue"):
        tasks.append(("queue_script_runs", BACKFILL_QUEUE_SCRIPT_RUNS))
        tasks.append(("queue_script_events", BACKFILL_QUEUE_EVENTS))

    results = {}
    for name, query in tasks:
        task_name, count = execute_insert(conn, name, query)
        results[task_name] = count
    return results


def main():
    args = enrich_args(parse_args())
    ops.configure_from_args(args)
    conn = db_connect(args)
    script_run_id = None
    results = {}
    try:
        register_backfill_script(conn)
        script_run_id = ops.start_script_run(
            "backfill_geo_ops_history",
            trigger_type="manual",
            command=sys.argv,
            args=args,
        )
        results = run_backfill(conn)
        if args.dry_run:
            conn.rollback()
        else:
            conn.commit()
        print(json.dumps({"dry_run": args.dry_run, "inserted": results}, ensure_ascii=False, indent=2))
        ops.finish_script_run(
            script_run_id,
            status="success",
            processed_count=sum(results.values()),
            success_count=sum(results.values()),
            summary={"dry_run": args.dry_run, "inserted": results},
        )
    except Exception as exc:
        conn.rollback()
        ops.finish_script_run(
            script_run_id,
            status="failed",
            exit_code=1,
            processed_count=sum(results.values()) if results else None,
            error_message=str(exc),
            summary=ops.exception_summary(exc),
        )
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
