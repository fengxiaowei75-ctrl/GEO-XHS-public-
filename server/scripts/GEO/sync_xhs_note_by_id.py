#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import analyze_xhs_geo_note_images as image_pipeline
import build_geo_content_assets as asset_pipeline
import embed_geo_content_assets as vector_pipeline
import import_xhs_note_details_from_excel as detail_pipeline
import geo_ops_gateway as ops


DEFAULT_DETAIL_TABLE = "public.note_details"
DEFAULT_IMAGE_TABLE = "public.image_analysis"
DEFAULT_ASSET_TABLE = "public.geo_note_content_assets"
DEFAULT_RUN_TABLE = "public.geo_note_content_asset_runs"
DEFAULT_VECTOR_TABLE = "public.geo_note_content_asset_vectors"


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Fetch XHS note detail by note ID, upsert it into GEO, analyze images, "
            "and optionally build note-level content assets / pgvector embeddings."
        )
    )
    parser.add_argument("--note-id", action="append", default=[], help="XHS note ID or note URL. Can repeat.")
    parser.add_argument("--note-ids", default="", help="Comma/space/newline separated XHS note IDs or URLs.")
    parser.add_argument("--note-id-file", default="", help="Text file with one note ID or URL per line.")
    parser.add_argument("--detail-table", default=DEFAULT_DETAIL_TABLE)
    parser.add_argument("--image-table", default=DEFAULT_IMAGE_TABLE)
    parser.add_argument("--asset-table", default=DEFAULT_ASSET_TABLE)
    parser.add_argument("--run-table", default=DEFAULT_RUN_TABLE)
    parser.add_argument("--vector-table", default=DEFAULT_VECTOR_TABLE)
    parser.add_argument("--source-keyword", default="manual_note_id")
    parser.add_argument("--skip-images", action="store_true", help="Only fetch/upsert note details.")
    parser.add_argument("--force-detail", action="store_true", help="Re-fetch note detail even if note_details already has success.")
    parser.add_argument("--force-images", action="store_true", help="Re-analyze images even if already completed.")
    parser.add_argument("--max-images", type=int, default=0, help="Limit image analysis count.")
    parser.add_argument("--build-asset", action="store_true", help="Build note-level GEO content asset after image analysis.")
    parser.add_argument("--embed-asset", action="store_true", help="Embed built/existing content asset into pgvector.")
    parser.add_argument("--force-asset", action="store_true", help="Rebuild content asset for prompt_version.")
    parser.add_argument("--force-embedding", action="store_true", help="Rebuild asset vector even if it exists.")
    parser.add_argument("--freshness-half-life-days", type=int, default=45)
    parser.add_argument("--prompt-version", default=asset_pipeline.DEFAULT_PROMPT_VERSION)
    parser.add_argument("--content-api-key", "--kimi-api-key", dest="kimi_api_key", default="")
    parser.add_argument("--content-base-url", "--kimi-base-url", dest="kimi_base_url", default="")
    parser.add_argument("--content-model", "--kimi-model", dest="kimi_model", default="")
    parser.add_argument("--content-temperature", "--kimi-temperature", dest="kimi_temperature", type=float, default=None)
    parser.add_argument("--content-thinking", "--kimi-thinking", dest="kimi_thinking", choices=["disabled", "auto"], default="")
    parser.add_argument("--embedding-model", default="")
    parser.add_argument("--ark-api-key", default="")
    parser.add_argument("--detail-concurrency", type=int, default=8)
    parser.add_argument("--image-concurrency", type=int, default=8)
    parser.add_argument("--write-batch-size", type=int, default=10)
    parser.add_argument("--remote-image-url", action="store_true", help="Send remote image URLs directly. Default uses in-memory data URLs.")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--retry-sleep", type=float, default=2.0)
    parser.add_argument("--endata-token", default="")
    parser.add_argument("--db-host", default="localhost")
    parser.add_argument("--db-port", default="5432")
    parser.add_argument("--db-name", default="xhs_geo")
    parser.add_argument("--db-user", default="app_user")
    parser.add_argument("--db-password", default="")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def extract_note_id(value):
    value = (value or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    path = parsed.path if parsed.scheme else value
    match = re.search(r"/(?:explore|discovery/item)/([^/?#\s]+)", path)
    if match:
        return match.group(1)
    match = re.search(r"(?:explore|discovery/item)/([^/?#\s]+)", value)
    if match:
        return match.group(1)
    value = value.split("?", 1)[0].split("#", 1)[0].strip()
    return value


def collect_note_ids(args):
    raw_values = []
    raw_values.extend(args.note_id)
    if args.note_ids:
        raw_values.extend(re.split(r"[\s,，]+", args.note_ids))
    if args.note_id_file:
        for line in Path(args.note_id_file).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                raw_values.append(line)

    note_ids = []
    seen = set()
    for value in raw_values:
        note_id = extract_note_id(value)
        if note_id and note_id not in seen:
            seen.add(note_id)
            note_ids.append(note_id)
    return note_ids


def make_source_rows(note_ids, source_keyword):
    rows = []
    for index, note_id in enumerate(note_ids, start=1):
        rows.append({
            "note_id": note_id,
            "source_file": "manual_note_id",
            "source_row": index,
            "source_keyword": source_keyword,
            "source_image": "",
            "source_title": "",
            "source_author": "",
            "source_author_profile_url": "",
            "source_note_type": "",
            "source_like_count": 0,
            "source_collected_count": 0,
            "source_comments_count": 0,
            "source_share_count": 0,
            "source_content": "",
            "source_publish_time_text": "",
            "source_author_region": "",
            "source_note_url": f"https://www.xiaohongshu.com/explore/{note_id}",
            "source_raw_json": {"source": "manual_note_id", "note_id": note_id},
        })
    return rows


def existing_success_note_ids(conn, table_name, note_ids):
    if not note_ids:
        return set()
    schema_name, plain_table_name = detail_pipeline.split_table_name(table_name)
    query = detail_pipeline.sql.SQL(
        """
SELECT note_id
FROM {table}
WHERE detail_status = 'success'
  AND note_id = ANY(%s)
"""
    ).format(table=detail_pipeline.sql.Identifier(schema_name, plain_table_name))
    with conn.cursor() as cur:
        cur.execute(query, (note_ids,))
        return {row[0] for row in cur.fetchall()}


def db_password_from_env(args):
    values = detail_pipeline.load_env_file()
    return args.db_password or os.environ.get("PGPASSWORD") or values.get("PGPASSWORD") or ""


def build_detail_args(args):
    values = detail_pipeline.load_env_file()
    endata_token = (
        args.endata_token
        or os.environ.get("ENDATA_TOKEN")
        or values.get("ENDATA_TOKEN")
        or ""
    )
    db_password = db_password_from_env(args)
    if not endata_token:
        raise RuntimeError("Missing Endata token. Set ENDATA_TOKEN or --endata-token.")
    if not args.dry_run and not db_password:
        raise RuntimeError("Missing database password. Set PGPASSWORD or --db-password.")
    return SimpleNamespace(
        endata_token=endata_token,
        db_password=db_password,
        db_host=args.db_host,
        db_port=args.db_port,
        db_name=args.db_name,
        db_user=args.db_user,
        concurrency=args.detail_concurrency,
        timeout=args.timeout,
        retries=args.retries,
        retry_sleep=args.retry_sleep,
        skip_fetch=False,
        dry_run=args.dry_run,
    )


def build_image_args(args, note_ids, db_password):
    return image_pipeline.enrich_args(SimpleNamespace(
        source_table=args.detail_table,
        target_table=args.image_table,
        note_id=note_ids,
        force=args.force_images,
        max_images=args.max_images,
        dry_run=args.dry_run,
        concurrency=args.image_concurrency,
        write_batch_size=args.write_batch_size,
        remote_image_url=args.remote_image_url,
        timeout=args.timeout,
        retries=args.retries,
        retry_sleep=args.retry_sleep,
        ark_api_key=args.ark_api_key,
        db_host=args.db_host,
        db_port=args.db_port,
        db_name=args.db_name,
        db_user=args.db_user,
        db_password=db_password,
    ))


def build_asset_args(args, note_ids, db_password):
    return asset_pipeline.enrich_args(SimpleNamespace(
        detail_table=args.detail_table,
        image_table=args.image_table,
        asset_table=args.asset_table,
        run_table=args.run_table,
        note_id=note_ids,
        limit=0,
        force=args.force_asset,
        only_missing=not args.force_asset,
        min_score=0,
        min_fresh_score=0,
        freshness_half_life_days=args.freshness_half_life_days,
        rank_mode="fresh",
        prompt_version=args.prompt_version,
        max_images_per_note=20,
        dry_run=args.dry_run,
        skip_llm=False,
        kimi_api_key=args.kimi_api_key,
        kimi_base_url=args.kimi_base_url,
        kimi_model=args.kimi_model,
        kimi_temperature=args.kimi_temperature,
        kimi_thinking=args.kimi_thinking,
        timeout=args.timeout,
        retries=args.retries,
        retry_sleep=args.retry_sleep,
        db_host=args.db_host,
        db_port=args.db_port,
        db_name=args.db_name,
        db_user=args.db_user,
        db_password=db_password,
    ))


def build_vector_args(args, note_ids, db_password, force=False):
    return vector_pipeline.enrich_args(SimpleNamespace(
        asset_table=args.asset_table,
        vector_table=args.vector_table,
        asset_id=[],
        note_id=note_ids,
        limit=0,
        force=force,
        only_missing=not force,
        watch=False,
        poll_interval=60,
        listen_channel=vector_pipeline.DEFAULT_LISTEN_CHANNEL,
        embedding_model=args.embedding_model,
        ark_api_key=args.ark_api_key,
        timeout=args.timeout,
        retries=args.retries,
        retry_sleep=args.retry_sleep,
        max_text_chars=4000,
        dry_run=args.dry_run,
        db_host=args.db_host,
        db_port=args.db_port,
        db_name=args.db_name,
        db_user=args.db_user,
        db_password=db_password,
    ))


def build_assets(conn, args, note_ids, db_password):
    asset_args = build_asset_args(args, note_ids, db_password)
    asset_pipeline.ensure_tables(conn, asset_args.asset_table, asset_args.run_table)
    notes = asset_pipeline.fetch_candidate_notes(conn, asset_args)
    asset_ids = []
    failed = 0
    print(f"asset_candidates={len(notes)}")
    for index, note in enumerate(notes, start=1):
        try:
            asset_id = asset_pipeline.process_note(conn, asset_args, note)
            asset_ids.append(asset_id)
            print(f"asset [{index}/{len(notes)}] note_id={note['note_id']} asset_id={asset_id}")
        except Exception as exc:
            failed += 1
            print(f"asset [{index}/{len(notes)}] note_id={note['note_id']} failed={exc}")
            if len(notes) == 1:
                raise
    return asset_ids, failed


def embed_assets(conn, args, note_ids, db_password, force=False):
    vector_args = build_vector_args(args, note_ids, db_password, force=force)
    vector_pipeline.ensure_vector_table(conn, vector_args.asset_table, vector_args.vector_table)
    ok, fail = vector_pipeline.embed_assets(conn, vector_args)
    return ok, fail


def main():
    args = parse_args()
    ops.configure_from_args(args)
    script_run_id = ops.start_script_run(
        "sync_xhs_note_by_id",
        trigger_type=os.environ.get("GEO_OPS_TRIGGER_TYPE") or "manual",
        trigger_source=os.environ.get("GEO_OPS_TRIGGER_SOURCE"),
        job_ref_type=os.environ.get("GEO_OPS_JOB_REF_TYPE"),
        job_ref_id=os.environ.get("GEO_OPS_JOB_REF_ID"),
        command=sys.argv,
        args=args,
    )
    note_ids = collect_note_ids(args)
    if not note_ids:
        error = "Pass at least one --note-id, --note-ids, or --note-id-file."
        ops.finish_script_run(script_run_id, status="failed", exit_code=1, error_message=error)
        raise RuntimeError(error)

    source_rows = make_source_rows(note_ids, args.source_keyword)
    detail_args = build_detail_args(args)
    ops.configure_from_args(detail_args)

    print(f"note_ids={len(note_ids)}")
    details = {}
    detail_success = detail_failed = 0
    detail_skipped_existing = 0
    image_results = []
    image_written = 0
    image_count = 0
    asset_ids = []
    asset_failed = 0
    vector_ok = 0
    vector_failed = 0
    conn = None
    try:
        fetch_source_rows = source_rows
        if not args.dry_run:
            conn = detail_pipeline.db_connect(detail_args)
            detail_pipeline.ensure_table(conn, args.detail_table)
            if not args.force_detail:
                existing_success = existing_success_note_ids(conn, args.detail_table, note_ids)
                fetch_source_rows = [row for row in source_rows if row["note_id"] not in existing_success]
                detail_skipped_existing = len(existing_success)
                for note_id in existing_success:
                    details[note_id] = {
                        "note_id": note_id,
                        "detail_status": "success",
                        "detail_error": None,
                        "payload": None,
                        "data": {},
                        "skipped_existing": True,
                    }
        if fetch_source_rows:
            details.update(detail_pipeline.fetch_details(detail_args, fetch_source_rows))
        else:
            print("details_fetch_skipped=all_existing_success")
        detail_success = sum(1 for item in details.values() if item["detail_status"] == "success")
        detail_failed = sum(1 for item in details.values() if item["detail_status"] != "success")
        print(
            f"details_existing_success_skipped={detail_skipped_existing} "
            f"details_fetch_needed={len(fetch_source_rows)}"
        )

        if args.dry_run:
            print(json.dumps({
                "detail_table": args.detail_table,
                "image_table": args.image_table,
                "asset_table": args.asset_table,
                "vector_table": args.vector_table,
                "note_ids": note_ids,
                "detail_success": detail_success,
                "detail_failed": detail_failed,
                "detail_skipped_existing": detail_skipped_existing,
                "skip_images": args.skip_images,
                "build_asset": args.build_asset,
                "embed_asset": args.embed_asset,
            }, ensure_ascii=False, indent=2))
            ops.finish_script_run(
                script_run_id,
                status="success",
                processed_count=len(note_ids),
                success_count=detail_success,
                failed_count=detail_failed,
                skipped_count=detail_skipped_existing,
                summary={"dry_run": True},
            )
            return

        detail_written = 0
        if fetch_source_rows:
            detail_written = detail_pipeline.upsert_rows(conn, args.detail_table, fetch_source_rows, details)
        print(f"details_written={detail_written} success={detail_success} failed={detail_failed}")

        if not args.skip_images:
            image_args = build_image_args(args, note_ids, detail_args.db_password)
            image_pipeline.ensure_target_table(conn, args.image_table)
            image_rows = image_pipeline.fetch_image_workload(conn, image_args)
            image_count = len(image_rows)
            print(f"images_to_process={image_count}")
            if image_rows:
                image_results, image_written = image_pipeline.analyze_images_and_upsert(conn, image_args, image_rows)

        if args.build_asset:
            asset_ids, asset_failed = build_assets(conn, args, note_ids, detail_args.db_password)

        if args.embed_asset:
            vector_ok, vector_failed = embed_assets(conn, args, note_ids, detail_args.db_password, force=args.force_embedding)
    except Exception as exc:
        ops.finish_script_run(
            script_run_id,
            status="failed",
            exit_code=1,
            processed_count=len(note_ids),
            success_count=detail_success + sum(1 for item in image_results if item.get("status") == "success") + len([item for item in asset_ids if item is not None]) + vector_ok,
            failed_count=detail_failed + sum(1 for item in image_results if item.get("status") == "failed") + asset_failed + vector_failed,
            skipped_count=detail_skipped_existing,
            error_message=str(exc),
            summary=ops.exception_summary(exc),
        )
        raise
    finally:
        if conn is not None:
            conn.close()

    print(json.dumps({
        "detail_table": args.detail_table,
        "image_table": args.image_table,
        "asset_table": args.asset_table,
        "vector_table": args.vector_table,
        "note_count": len(note_ids),
        "detail_success": detail_success,
        "detail_failed": detail_failed,
        "detail_skipped_existing": detail_skipped_existing,
        "images_to_process": image_count,
        "image_success": sum(1 for item in image_results if item["status"] == "success"),
        "image_failed": sum(1 for item in image_results if item["status"] == "failed"),
        "image_written": image_written,
        "asset_written": len([item for item in asset_ids if item is not None]),
        "asset_failed": asset_failed,
        "vector_success": vector_ok,
        "vector_failed": vector_failed,
    }, ensure_ascii=False, indent=2))
    ops.finish_script_run(
        script_run_id,
        status="success",
        processed_count=len(note_ids),
        success_count=detail_success + sum(1 for item in image_results if item["status"] == "success") + len([item for item in asset_ids if item is not None]) + vector_ok,
        failed_count=detail_failed + sum(1 for item in image_results if item["status"] == "failed") + asset_failed + vector_failed,
        skipped_count=detail_skipped_existing,
        summary={
            "detail_success": detail_success,
            "detail_failed": detail_failed,
            "detail_skipped_existing": detail_skipped_existing,
            "images_to_process": image_count,
            "image_written": image_written,
            "asset_written": len([item for item in asset_ids if item is not None]),
            "asset_failed": asset_failed,
            "vector_success": vector_ok,
            "vector_failed": vector_failed,
        },
    )


if __name__ == "__main__":
    main()
