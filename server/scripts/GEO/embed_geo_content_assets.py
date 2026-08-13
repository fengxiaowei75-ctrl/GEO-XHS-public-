#!/usr/bin/env python3
import argparse
import json
import os
import select
import sys
import time
from pathlib import Path

import psycopg2
from psycopg2 import sql
import geo_ops_gateway as ops


DEFAULT_ENV_FILE = os.environ.get("XHS_SYNC_ENV_FILE") or (
    "/opt/xhs-sync/sync.env"
    if os.path.exists("/opt/xhs-sync")
    else "/tmp/geo-xhs/sync.env"
)
DEFAULT_ASSET_TABLE = "public.geo_note_content_assets"
DEFAULT_VECTOR_TABLE = "public.geo_note_content_asset_vectors"
DEFAULT_EMBEDDING_MODEL = "doubao-embedding-vision-251215"
DEFAULT_LISTEN_CHANNEL = "geo_note_content_asset_changed"
DEFAULT_DB_HOST = os.environ.get("PGHOST") or "localhost"
DEFAULT_DB_PORT = os.environ.get("PGPORT") or "5432"
DEFAULT_DB_NAME = os.environ.get("PGDATABASE") or "xhs_geo"
DEFAULT_DB_USER = os.environ.get("PGUSER") or "app_user"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Embed GEO note content assets into pgvector, with optional LISTEN/NOTIFY watch mode."
    )
    parser.add_argument("--asset-table", default=DEFAULT_ASSET_TABLE)
    parser.add_argument("--vector-table", default=DEFAULT_VECTOR_TABLE)
    parser.add_argument("--asset-id", action="append", type=int, default=[], help="Only embed selected asset_id.")
    parser.add_argument("--note-id", action="append", default=[], help="Only embed selected note_id.")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--force", action="store_true", help="Re-embed even if vector exists.")
    parser.add_argument("--only-missing", action="store_true", help="Only embed assets without a current vector. Default unless --force.")
    parser.add_argument("--watch", action="store_true", help="Continuously listen for asset changes and embed.")
    parser.add_argument("--poll-interval", type=int, default=60, help="Seconds between fallback polling in watch mode.")
    parser.add_argument("--listen-channel", default=DEFAULT_LISTEN_CHANNEL)
    parser.add_argument("--embedding-model", default="")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--retry-sleep", type=float, default=2.0)
    parser.add_argument("--max-text-chars", type=int, default=4000)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db-host", default=DEFAULT_DB_HOST)
    parser.add_argument("--db-port", default=DEFAULT_DB_PORT)
    parser.add_argument("--db-name", default=DEFAULT_DB_NAME)
    parser.add_argument("--db-user", default=DEFAULT_DB_USER)
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
        values[key] = value.strip().strip("'").strip('"')
    return values


def enrich_args(args):
    values = load_env_file()
    args.db_password = args.db_password or os.environ.get("PGPASSWORD") or values.get("PGPASSWORD") or ""
    args.embedding_model = (
        args.embedding_model
        or os.environ.get("ARK_EMBEDDING_MODEL")
        or values.get("ARK_EMBEDDING_MODEL")
        or DEFAULT_EMBEDDING_MODEL
    )
    if not args.db_password:
        raise RuntimeError("Missing database password. Set PGPASSWORD or --db-password.")
    if not args.dry_run:
        ops.gateway_proxy_url("volcengine_ark_embedding")
    if not args.force:
        args.only_missing = True
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


def ensure_vector_table(conn, asset_table, vector_table):
    asset_schema, asset_name = split_table_name(asset_table)
    vector_schema, vector_name = split_table_name(vector_table)
    ddl = sql.SQL(
        """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS {vector_schema};

CREATE TABLE IF NOT EXISTS {vector_table} (
  asset_id bigint PRIMARY KEY REFERENCES {asset_table}(asset_id) ON DELETE CASCADE,
  note_id text NOT NULL,
  embedding_model text NOT NULL,
  combined_text text NOT NULL,
  content_vector halfvec(2048),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS {idx_note}
  ON {vector_table} (note_id);

CREATE INDEX IF NOT EXISTS {idx_hnsw}
  ON {vector_table}
  USING hnsw (content_vector halfvec_cosine_ops);
"""
    ).format(
        vector_schema=sql.Identifier(vector_schema),
        vector_table=sql.Identifier(vector_schema, vector_name),
        asset_table=sql.Identifier(asset_schema, asset_name),
        idx_note=sql.Identifier(f"idx_{vector_name}_note_id"),
        idx_hnsw=sql.Identifier(f"idx_{vector_name}_hnsw"),
    )
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def fetch_assets(conn, args, specific_asset_ids=None):
    asset_schema, asset_name = split_table_name(args.asset_table)
    vector_schema, vector_name = split_table_name(args.vector_table)
    where_parts = [
        sql.SQL("a.analysis_status = 'success'"),
        sql.SQL("COALESCE(a.asset_text, '') <> ''"),
    ]
    params = {}
    if specific_asset_ids:
        where_parts.append(sql.SQL("a.asset_id = ANY(%(specific_asset_ids)s)"))
        params["specific_asset_ids"] = list(specific_asset_ids)
    elif args.asset_id:
        where_parts.append(sql.SQL("a.asset_id = ANY(%(asset_ids)s)"))
        params["asset_ids"] = args.asset_id
    if args.note_id:
        where_parts.append(sql.SQL("a.note_id = ANY(%(note_ids)s)"))
        params["note_ids"] = args.note_id
    if args.only_missing:
        where_parts.append(
            sql.SQL(
                """(
                  v.asset_id IS NULL
                  OR v.embedding_model IS DISTINCT FROM %(embedding_model)s
                  OR v.updated_at < a.updated_at
                  OR v.combined_text IS DISTINCT FROM left(a.asset_text, %(max_text_chars)s)
                )"""
            )
        )
        params["embedding_model"] = args.embedding_model
        params["max_text_chars"] = args.max_text_chars
    limit_sql = sql.SQL("")
    if args.limit and not specific_asset_ids:
        limit_sql = sql.SQL("LIMIT %(limit)s")
        params["limit"] = args.limit

    query = sql.SQL(
        """
SELECT a.asset_id, a.note_id, a.asset_text, a.updated_at
FROM {asset_table} a
LEFT JOIN {vector_table} v ON v.asset_id = a.asset_id
WHERE {where_clause}
ORDER BY a.fresh_hot_score DESC NULLS LAST, a.updated_at DESC
{limit_sql}
"""
    ).format(
        asset_table=sql.Identifier(asset_schema, asset_name),
        vector_table=sql.Identifier(vector_schema, vector_name),
        where_clause=sql.SQL(" AND ").join(where_parts),
        limit_sql=limit_sql,
    )
    with conn.cursor() as cur:
        cur.execute(query, params)
        return [
            {"asset_id": row[0], "note_id": row[1], "asset_text": row[2], "updated_at": row[3]}
            for row in cur.fetchall()
        ]


def get_embedding(args, text, asset=None):
    text = (text or "").strip()
    if not text:
        return None
    text = text[: args.max_text_chars]
    body = {
        "model": args.embedding_model,
        "input": [{"type": "text", "text": text}],
    }
    headers = {"Content-Type": "application/json"}
    last_error = None
    for attempt in range(args.retries + 1):
        try:
            response = ops.call_api(
                "POST",
                ops.gateway_proxy_url("volcengine_ark_embedding"),
                provider_code="volcengine_ark_embedding",
                operation="asset_embedding",
                model_name=args.embedding_model,
                note_id=(asset or {}).get("note_id"),
                asset_id=(asset or {}).get("asset_id"),
                attempt_no=attempt + 1,
                max_attempts=args.retries + 1,
                metadata={"max_text_chars": args.max_text_chars},
                headers=headers,
                json=body,
                timeout=args.timeout,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"HTTP {response.status_code}: {response.text[:1000]}")
            payload = response.json()
            data = payload.get("data")
            if isinstance(data, list) and data:
                embedding = data[0].get("embedding")
            elif isinstance(data, dict):
                embedding = data.get("embedding")
            else:
                embedding = None
            if not embedding:
                raise RuntimeError(f"embedding missing in response: {payload}")
            return embedding
        except Exception as exc:
            last_error = exc
            if attempt >= args.retries:
                break
            time.sleep(args.retry_sleep * (attempt + 1))
    raise RuntimeError(f"embedding request failed after retries: {last_error}") from last_error


def vector_literal(vector):
    return "[" + ",".join(str(float(item)) for item in vector) + "]"


def upsert_vector(conn, args, asset, embedding):
    vector_schema, vector_name = split_table_name(args.vector_table)
    combined_text = (asset.get("asset_text") or "").strip()[: args.max_text_chars]
    query = sql.SQL(
        """
INSERT INTO {vector_table} (asset_id, note_id, embedding_model, combined_text, content_vector)
VALUES (%s, %s, %s, %s, %s)
ON CONFLICT (asset_id) DO UPDATE SET
  note_id = EXCLUDED.note_id,
  embedding_model = EXCLUDED.embedding_model,
  combined_text = EXCLUDED.combined_text,
  content_vector = EXCLUDED.content_vector,
  updated_at = CURRENT_TIMESTAMP
"""
    ).format(vector_table=sql.Identifier(vector_schema, vector_name))
    with conn.cursor() as cur:
        cur.execute(query, (asset["asset_id"], asset["note_id"], args.embedding_model, combined_text, vector_literal(embedding)))
    conn.commit()


def embed_assets(conn, args, specific_asset_ids=None):
    assets = fetch_assets(conn, args, specific_asset_ids=specific_asset_ids)
    if not assets:
        return 0, 0
    print(f"assets_to_embed={len(assets)}")
    ok = fail = 0
    for index, asset in enumerate(assets, start=1):
        try:
            if args.dry_run:
                print(json.dumps({
                    "asset_id": asset["asset_id"],
                    "note_id": asset["note_id"],
                    "text_preview": (asset["asset_text"] or "")[:300],
                }, ensure_ascii=False, indent=2))
                ok += 1
                continue
            embedding = get_embedding(args, asset["asset_text"], asset=asset)
            if len(embedding) != 2048:
                raise RuntimeError(f"embedding dimension mismatch: expected 2048, got {len(embedding)}")
            upsert_vector(conn, args, asset, embedding)
            ok += 1
            print(f"[{index}/{len(assets)}] asset_id={asset['asset_id']} ok")
        except Exception as exc:
            fail += 1
            print(f"[{index}/{len(assets)}] asset_id={asset['asset_id']} failed={exc}", flush=True)
    return ok, fail


def watch_loop(args):
    conn = db_connect(args)
    conn.autocommit = True
    try:
        ensure_vector_table(conn, args.asset_table, args.vector_table)
        with conn.cursor() as cur:
            cur.execute(sql.SQL("LISTEN {};").format(sql.Identifier(args.listen_channel)))
        print(f"listening channel={args.listen_channel} poll_interval={args.poll_interval}s")
        # Initial catch-up.
        ok, fail = embed_assets(conn, args)
        print(f"initial_catchup ok={ok} failed={fail}", flush=True)
        while True:
            ready = select.select([conn], [], [], args.poll_interval)
            specific_ids = set()
            if ready[0]:
                conn.poll()
                while conn.notifies:
                    notify = conn.notifies.pop(0)
                    try:
                        specific_ids.add(int(notify.payload))
                    except ValueError:
                        pass
            if specific_ids:
                ok, fail = embed_assets(conn, args, specific_asset_ids=specific_ids)
                print(f"notify_embed ok={ok} failed={fail}", flush=True)
            else:
                ok, fail = embed_assets(conn, args)
                if ok or fail:
                    print(f"poll_embed ok={ok} failed={fail}", flush=True)
    finally:
        conn.close()


def main():
    args = enrich_args(parse_args())
    ops.configure_from_args(args)
    if args.watch:
        ops.cancel_stale_running_runs("embed_geo_content_assets")
    script_run_id = ops.start_script_run(
        "embed_geo_content_assets",
        trigger_type="watch" if args.watch else (os.environ.get("GEO_OPS_TRIGGER_TYPE") or "manual"),
        command=sys.argv,
        args=args,
    )
    if args.watch:
        ops.install_signal_handlers(script_run_id)
        try:
            watch_loop(args)
        except KeyboardInterrupt:
            ops.finish_script_run(script_run_id, status="canceled", exit_code=130)
            return
        except Exception as exc:
            ops.finish_script_run(
                script_run_id,
                status="failed",
                exit_code=1,
                error_message=str(exc),
                summary=ops.exception_summary(exc),
            )
            raise
        return

    conn = db_connect(args)
    ok = fail = 0
    try:
        ensure_vector_table(conn, args.asset_table, args.vector_table)
        ok, fail = embed_assets(conn, args)
    except Exception as exc:
        ops.finish_script_run(
            script_run_id,
            status="failed",
            exit_code=1,
            success_count=ok,
            failed_count=fail,
            error_message=str(exc),
            summary=ops.exception_summary(exc),
        )
        raise
    finally:
        conn.close()
    print(json.dumps({
        "vector_table": args.vector_table,
        "embedding_model": args.embedding_model,
        "success": ok,
        "failed": fail,
    }, ensure_ascii=False, indent=2))
    ops.finish_script_run(
        script_run_id,
        status="success",
        processed_count=ok + fail,
        success_count=ok,
        failed_count=fail,
        summary={"vector_table": args.vector_table, "embedding_model": args.embedding_model},
    )


if __name__ == "__main__":
    main()
