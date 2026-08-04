#!/usr/bin/env python3
import argparse
import json
import os
import re
import select
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json

import build_geo_content_assets as asset_pipeline
import geo_ops_gateway as ops


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = os.environ.get("XHS_SYNC_ENV_FILE") or (
    "/opt/xhs-sync/sync.env"
    if os.path.exists("/opt/xhs-sync")
    else "/tmp/geo-xhs/sync.env"
)
DEFAULT_QUEUE_TABLE = "public.geo_note_ingest_queue"
DEFAULT_DETAIL_TABLE = "public.note_details"
DEFAULT_ASSET_TABLE = "public.geo_note_content_assets"
DEFAULT_VECTOR_TABLE = "public.geo_note_content_asset_vectors"
DEFAULT_PROMPT_VERSION = asset_pipeline.DEFAULT_PROMPT_VERSION
DEFAULT_LISTEN_CHANNEL = "geo_note_ingest_queue_changed"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Continuously process GEO note_id queue: detail fetch, image analysis, content asset, pgvector refresh."
    )
    parser.add_argument("--queue-table", default=DEFAULT_QUEUE_TABLE)
    parser.add_argument("--detail-table", default=DEFAULT_DETAIL_TABLE)
    parser.add_argument("--asset-table", default=DEFAULT_ASSET_TABLE)
    parser.add_argument("--vector-table", default=DEFAULT_VECTOR_TABLE)
    parser.add_argument("--prompt-version", default=DEFAULT_PROMPT_VERSION)
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--once", action="store_true", help="Process available jobs once and exit.")
    parser.add_argument("--enqueue-existing", action="store_true", help="Enqueue historical note_details missing assets.")
    parser.add_argument("--historical-priority", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--poll-interval", type=int, default=30)
    parser.add_argument("--listen-channel", default=DEFAULT_LISTEN_CHANNEL)
    parser.add_argument("--worker-id", default="")
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--job-timeout", type=int, default=1200)
    parser.add_argument("--child-timeout", type=int, default=180)
    parser.add_argument("--child-retries", type=int, default=1)
    parser.add_argument("--child-retry-sleep", type=float, default=2.0)
    parser.add_argument("--detail-concurrency", type=int, default=4)
    parser.add_argument("--image-concurrency", type=int, default=4)
    parser.add_argument("--write-batch-size", type=int, default=10)
    parser.add_argument("--source-keyword-prefix", default="queue")
    parser.add_argument("--force-images", action="store_true")
    parser.add_argument("--force-asset", action="store_true")
    parser.add_argument("--force-embedding", action="store_true")
    parser.add_argument(
        "--embed-in-child",
        action="store_true",
        help="Run embedding inside each queue child process. Default relies on the asset-vector watcher.",
    )
    parser.add_argument("--db-host", default="localhost")
    parser.add_argument("--db-port", default="5432")
    parser.add_argument("--db-name", default="xhs_geo")
    parser.add_argument("--db-user", default="app_user")
    parser.add_argument("--db-password", default="")
    return parser.parse_args()


def load_env_file():
    values = {}
    env_path = Path(DEFAULT_ENV_FILE)
    if not env_path.exists():
        return values
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


def enrich_args(args):
    values = load_env_file()
    args.db_password = args.db_password or os.environ.get("PGPASSWORD") or values.get("PGPASSWORD") or ""
    if not args.db_password:
        raise RuntimeError("Missing database password. Set PGPASSWORD or --db-password.")
    if not args.worker_id:
        args.worker_id = f"{socket.gethostname()}:{os.getpid()}"
    if args.batch_size <= 0:
        raise RuntimeError("--batch-size must be positive.")
    if args.max_attempts <= 0:
        raise RuntimeError("--max-attempts must be positive.")
    if not args.watch and not args.once:
        args.once = True
    return args


def split_table_name(table_name):
    parts = [part.strip('"') for part in table_name.split(".")]
    if len(parts) == 1:
        return "public", parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise ValueError("Table name must be table or schema.table")


def db_connect(args):
    return psycopg2.connect(
        host=args.db_host,
        port=args.db_port,
        dbname=args.db_name,
        user=args.db_user,
        password=args.db_password,
    )


def ensure_queue_table(conn, args):
    queue_schema, queue_name = split_table_name(args.queue_table)
    ddl = sql.SQL(
        """
CREATE SCHEMA IF NOT EXISTS {queue_schema};

CREATE TABLE IF NOT EXISTS {queue_table} (
  queue_id bigserial PRIMARY KEY,
  input_value text,
  note_id text NOT NULL,
  source_keyword text NOT NULL DEFAULT 'manual_queue',
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_command text[] NOT NULL DEFAULT '{{}}',
  result jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  last_error text,
  locked_by text,
  locked_at timestamp,
  started_at timestamp,
  finished_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (note_id),
  CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped'))
);

ALTER TABLE {queue_table}
  ADD COLUMN IF NOT EXISTS input_value text,
  ADD COLUMN IF NOT EXISTS source_keyword text NOT NULL DEFAULT 'manual_queue',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS run_command text[] NOT NULL DEFAULT '{{}}',
  ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_at timestamp,
  ADD COLUMN IF NOT EXISTS started_at timestamp,
  ADD COLUMN IF NOT EXISTS finished_at timestamp;

CREATE INDEX IF NOT EXISTS {idx_queue_status_priority}
  ON {queue_table} (status, priority, created_at);

CREATE INDEX IF NOT EXISTS {idx_queue_updated_at}
  ON {queue_table} (updated_at DESC);

CREATE OR REPLACE FUNCTION public.enqueue_geo_note_id(
  raw_value text,
  source_keyword text DEFAULT 'manual_queue',
  priority integer DEFAULT 100
) RETURNS bigint AS $$
DECLARE
  cleaned text;
  extracted text;
  matches text[];
  new_queue_id bigint;
BEGIN
  cleaned := btrim(COALESCE(raw_value, ''));
  IF cleaned = '' THEN
    RAISE EXCEPTION 'raw_value is empty';
  END IF;

  matches := regexp_match(cleaned, '(explore|discovery/item)/([^/?#[:space:]]+)');
  IF matches IS NOT NULL THEN
    extracted := matches[2];
  ELSE
    extracted := split_part(split_part(cleaned, '?', 1), '#', 1);
  END IF;
  extracted := btrim(extracted);

  INSERT INTO {queue_table} (
    input_value, note_id, source_keyword, priority, status,
    attempts, max_attempts, last_error, locked_by, locked_at,
    started_at, finished_at, updated_at
  )
  VALUES (
    cleaned, extracted, source_keyword, priority, 'pending',
    0, 3, NULL, NULL, NULL,
    NULL, NULL, CURRENT_TIMESTAMP
  )
  ON CONFLICT (note_id) DO UPDATE SET
    input_value = EXCLUDED.input_value,
    source_keyword = EXCLUDED.source_keyword,
    priority = EXCLUDED.priority,
    status = CASE
      WHEN {queue_ref}.status = 'running' THEN {queue_ref}.status
      ELSE 'pending'
    END,
    attempts = CASE
      WHEN {queue_ref}.status = 'running' THEN {queue_ref}.attempts
      ELSE 0
    END,
    last_error = NULL,
    locked_by = CASE WHEN {queue_ref}.status = 'running' THEN {queue_ref}.locked_by ELSE NULL END,
    locked_at = CASE WHEN {queue_ref}.status = 'running' THEN {queue_ref}.locked_at ELSE NULL END,
    started_at = CASE WHEN {queue_ref}.status = 'running' THEN {queue_ref}.started_at ELSE NULL END,
    finished_at = NULL,
    updated_at = CURRENT_TIMESTAMP
  RETURNING queue_id INTO new_queue_id;

  PERFORM pg_notify('{listen_channel}', new_queue_id::text);
  RETURN new_queue_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.notify_geo_note_ingest_queue()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM pg_notify('{listen_channel}', NEW.queue_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_geo_note_ingest_queue_notify ON {queue_table};
CREATE TRIGGER trg_geo_note_ingest_queue_notify
AFTER INSERT OR UPDATE OF status ON {queue_table}
FOR EACH ROW
EXECUTE FUNCTION public.notify_geo_note_ingest_queue();
"""
    ).format(
        queue_schema=sql.Identifier(queue_schema),
        queue_table=sql.Identifier(queue_schema, queue_name),
        queue_ref=sql.Identifier(queue_name),
        idx_queue_status_priority=sql.Identifier(f"idx_{queue_name}_status_priority"),
        idx_queue_updated_at=sql.Identifier(f"idx_{queue_name}_updated_at"),
        listen_channel=sql.SQL(args.listen_channel.replace("'", "''")),
    )
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def enqueue_existing_notes(conn, args):
    queue_schema, queue_name = split_table_name(args.queue_table)
    detail_schema, detail_name = split_table_name(args.detail_table)
    asset_schema, asset_name = split_table_name(args.asset_table)
    query = sql.SQL(
        """
INSERT INTO {queue_table} (
  input_value, note_id, source_keyword, priority, status, max_attempts, updated_at
)
SELECT
  n.note_id,
  n.note_id,
  'historical_backfill',
  %(priority)s,
  'pending',
  %(max_attempts)s,
  CURRENT_TIMESTAMP
FROM {detail_table} n
LEFT JOIN {asset_table} a
  ON a.note_id = n.note_id
 AND a.prompt_version = %(prompt_version)s
WHERE n.detail_status = 'success'
  AND a.asset_id IS NULL
ON CONFLICT (note_id) DO UPDATE SET
  source_keyword = CASE
    WHEN {queue_ref}.status = 'success' THEN {queue_ref}.source_keyword
    ELSE EXCLUDED.source_keyword
  END,
  priority = CASE
    WHEN {queue_ref}.status = 'success' THEN {queue_ref}.priority
    ELSE LEAST({queue_ref}.priority, EXCLUDED.priority)
  END,
  status = CASE
    WHEN {queue_ref}.status IN ('running', 'success') THEN {queue_ref}.status
    ELSE 'pending'
  END,
  max_attempts = GREATEST({queue_ref}.max_attempts, EXCLUDED.max_attempts),
  updated_at = CURRENT_TIMESTAMP
RETURNING queue_id
"""
    ).format(
        queue_table=sql.Identifier(queue_schema, queue_name),
        queue_ref=sql.Identifier(queue_name),
        detail_table=sql.Identifier(detail_schema, detail_name),
        asset_table=sql.Identifier(asset_schema, asset_name),
    )
    with conn.cursor() as cur:
        cur.execute(
            query,
            {
                "priority": args.historical_priority,
                "max_attempts": args.max_attempts,
                "prompt_version": args.prompt_version,
            },
        )
        rows = cur.fetchall()
    conn.commit()
    return len(rows)


def claim_job(conn, args):
    queue_schema, queue_name = split_table_name(args.queue_table)
    query = sql.SQL(
        """
WITH next_job AS (
  SELECT queue_id
  FROM {queue_table}
  WHERE status = 'pending'
     OR (
       status = 'failed'
       AND attempts < max_attempts
       AND updated_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
     )
  ORDER BY priority ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE {queue_table} q
SET
  status = 'running',
  attempts = attempts + 1,
  locked_by = %(worker_id)s,
  locked_at = CURRENT_TIMESTAMP,
  started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
  finished_at = NULL,
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP
FROM next_job
WHERE q.queue_id = next_job.queue_id
RETURNING
  q.queue_id, q.note_id, q.source_keyword, q.priority,
  q.attempts, q.max_attempts, q.created_at
"""
    ).format(queue_table=sql.Identifier(queue_schema, queue_name))
    with conn.cursor() as cur:
        cur.execute(query, {"worker_id": args.worker_id})
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    return {
        "queue_id": row[0],
        "note_id": row[1],
        "source_keyword": row[2],
        "priority": row[3],
        "attempts": row[4],
        "max_attempts": row[5],
        "created_at": row[6],
    }


def normalize_source_keyword(value, prefix):
    text = value or "manual_queue"
    text = re.sub(r"[^0-9A-Za-z_\-]+", "_", text).strip("_")
    if not text:
        text = "manual_queue"
    if not text.startswith(prefix):
        text = f"{prefix}_{text}"
    return text[:80]


def build_child_command(args, job):
    command = [
        sys.executable,
        str(SCRIPT_DIR / "sync_xhs_note_by_id.py"),
        "--note-id",
        job["note_id"],
        "--source-keyword",
        normalize_source_keyword(job.get("source_keyword"), args.source_keyword_prefix),
        "--build-asset",
        "--timeout",
        str(args.child_timeout),
        "--retries",
        str(args.child_retries),
        "--retry-sleep",
        str(args.child_retry_sleep),
        "--detail-concurrency",
        str(args.detail_concurrency),
        "--image-concurrency",
        str(args.image_concurrency),
        "--write-batch-size",
        str(args.write_batch_size),
        "--prompt-version",
        args.prompt_version,
    ]
    if args.force_images:
        command.append("--force-images")
    if args.force_asset:
        command.append("--force-asset")
    if args.embed_in_child:
        command.append("--embed-asset")
    if args.embed_in_child and args.force_embedding:
        command.append("--force-embedding")
    return command


def tail_text(text, max_chars=8000):
    text = text or ""
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def finish_job(conn, args, job, status, result, error=None):
    queue_schema, queue_name = split_table_name(args.queue_table)
    query = sql.SQL(
        """
UPDATE {queue_table}
SET
  status = %(status)s,
  result = %(result)s,
  last_error = %(error)s,
  locked_by = NULL,
  locked_at = NULL,
  finished_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
WHERE queue_id = %(queue_id)s
"""
    ).format(queue_table=sql.Identifier(queue_schema, queue_name))
    with conn.cursor() as cur:
        cur.execute(
            query,
            {
                "queue_id": job["queue_id"],
                "status": status,
                "result": Json(result),
                "error": error,
            },
        )
    conn.commit()


def run_job(conn, args, job):
    command = build_child_command(args, job)
    queue_schema, queue_name = split_table_name(args.queue_table)
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("UPDATE {queue_table} SET run_command = %(command)s WHERE queue_id = %(queue_id)s").format(
                queue_table=sql.Identifier(queue_schema, queue_name)
            ),
            {"queue_id": job["queue_id"], "command": command},
        )
    conn.commit()

    started = time.monotonic()
    print(
        f"{datetime.now().isoformat(timespec='seconds')} queue_id={job['queue_id']} "
        f"note_id={job['note_id']} attempt={job['attempts']}/{job['max_attempts']} start",
        flush=True,
    )
    ops.insert_event(
        message="队列任务开始处理",
        event_type="queue_job_start",
        payload={
            "queue_id": job["queue_id"],
            "note_id": job["note_id"],
            "attempt": job["attempts"],
            "max_attempts": job["max_attempts"],
        },
    )
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["GEO_OPS_TRIGGER_TYPE"] = "queue"
    env["GEO_OPS_TRIGGER_SOURCE"] = args.queue_table
    env["GEO_OPS_JOB_REF_TYPE"] = "geo_note_ingest_queue"
    env["GEO_OPS_JOB_REF_ID"] = str(job["queue_id"])
    try:
        completed = subprocess.run(
            command,
            cwd=str(SCRIPT_DIR),
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=args.job_timeout,
        )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        result = {
            "returncode": completed.returncode,
            "elapsed_ms": elapsed_ms,
            "stdout_tail": tail_text(completed.stdout),
            "stderr_tail": tail_text(completed.stderr),
        }
        if completed.returncode == 0:
            finish_job(conn, args, job, "success", result)
            ops.insert_event(
                message="队列任务处理成功",
                event_type="queue_job_success",
                payload={
                    "queue_id": job["queue_id"],
                    "note_id": job["note_id"],
                    "elapsed_ms": elapsed_ms,
                    "returncode": completed.returncode,
                },
            )
            print(
                f"{datetime.now().isoformat(timespec='seconds')} queue_id={job['queue_id']} "
                f"note_id={job['note_id']} success elapsed_ms={elapsed_ms}",
                flush=True,
            )
        else:
            error = tail_text(completed.stderr or completed.stdout, 3000)
            finish_job(conn, args, job, "failed", result, error=error)
            ops.insert_event(
                message="队列任务处理失败",
                level="error",
                event_type="queue_job_failed",
                payload={
                    "queue_id": job["queue_id"],
                    "note_id": job["note_id"],
                    "elapsed_ms": elapsed_ms,
                    "returncode": completed.returncode,
                    "error_tail": error,
                },
            )
            print(
                f"{datetime.now().isoformat(timespec='seconds')} queue_id={job['queue_id']} "
                f"note_id={job['note_id']} failed returncode={completed.returncode}",
                flush=True,
            )
    except subprocess.TimeoutExpired as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        result = {
            "returncode": None,
            "elapsed_ms": elapsed_ms,
            "timeout": args.job_timeout,
            "stdout_tail": tail_text(exc.stdout if isinstance(exc.stdout, str) else ""),
            "stderr_tail": tail_text(exc.stderr if isinstance(exc.stderr, str) else ""),
        }
        finish_job(conn, args, job, "failed", result, error=f"job timeout after {args.job_timeout}s")
        ops.insert_event(
            message="队列任务处理超时",
            level="error",
            event_type="queue_job_timeout",
            payload={
                "queue_id": job["queue_id"],
                "note_id": job["note_id"],
                "elapsed_ms": elapsed_ms,
                "timeout": args.job_timeout,
            },
        )
        print(
            f"{datetime.now().isoformat(timespec='seconds')} queue_id={job['queue_id']} "
            f"note_id={job['note_id']} timeout elapsed_ms={elapsed_ms}",
            flush=True,
        )


def process_available(conn, args):
    processed = 0
    for _ in range(args.batch_size):
        job = claim_job(conn, args)
        if not job:
            break
        run_job(conn, args, job)
        processed += 1
    return processed


def watch_loop(conn, args):
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql.SQL("LISTEN {};").format(sql.Identifier(args.listen_channel)))
    print(
        f"{datetime.now().isoformat(timespec='seconds')} worker_id={args.worker_id} "
        f"watching queue={args.queue_table} channel={args.listen_channel}",
        flush=True,
    )
    while True:
        processed = process_available(conn, args)
        if processed:
            continue
        ready = select.select([conn], [], [], args.poll_interval)
        if ready[0]:
            conn.poll()
            conn.notifies.clear()


def main():
    args = enrich_args(parse_args())
    ops.configure_from_args(args)
    if args.watch:
        ops.cancel_stale_running_runs("watch_geo_note_ingest_queue")
    script_run_id = ops.start_script_run(
        "watch_geo_note_ingest_queue",
        trigger_type="watch" if args.watch else (os.environ.get("GEO_OPS_TRIGGER_TYPE") or "manual"),
        command=sys.argv,
        args=args,
        worker_id=args.worker_id,
    )
    conn = db_connect(args)
    total = 0
    try:
        ensure_queue_table(conn, args)
        if args.enqueue_existing:
            count = enqueue_existing_notes(conn, args)
            print(f"historical_enqueued_or_touched={count}", flush=True)
            ops.insert_event(
                message="历史笔记入队完成",
                event_type="enqueue_existing",
                payload={"count": count, "prompt_version": args.prompt_version},
            )
        if args.watch:
            ops.install_signal_handlers(script_run_id)
            try:
                watch_loop(conn, args)
            except KeyboardInterrupt:
                ops.finish_script_run(script_run_id, status="canceled", exit_code=130, processed_count=total)
                return
        else:
            while True:
                processed = process_available(conn, args)
                total += processed
                if not processed or args.once:
                    break
            print(json.dumps({"processed": total}, ensure_ascii=False), flush=True)
            ops.finish_script_run(
                script_run_id,
                status="success",
                processed_count=total,
                summary={"processed": total, "queue_table": args.queue_table},
            )
    except Exception as exc:
        ops.finish_script_run(
            script_run_id,
            status="failed",
            exit_code=1,
            processed_count=total,
            error_message=str(exc),
            summary=ops.exception_summary(exc),
        )
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
