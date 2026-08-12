#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse
from zipfile import ZipFile
from xml.etree import ElementTree as ET

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, execute_values

import geo_ops_gateway as ops


DEFAULT_ENV_FILE = os.environ.get("XHS_SYNC_ENV_FILE") or (
    "/opt/xhs-sync/sync.env"
    if os.path.exists("/opt/xhs-sync")
    else "/tmp/geo-xhs/sync.env"
)
DEFAULT_EXCEL_FILE = os.environ.get("XHS_GEO_DEFAULT_EXCEL_FILE") or (
    "/tmp/geo-xhs/sample-notes.xlsx"
)
DEFAULT_TABLE = "public.note_details"
DEFAULT_DB_HOST = os.environ.get("PGHOST") or "localhost"
DEFAULT_DB_PORT = os.environ.get("PGPORT") or "5432"
DEFAULT_DB_NAME = os.environ.get("PGDATABASE") or "xhs_geo"
DEFAULT_DB_USER = os.environ.get("PGUSER") or "app_user"

XLSX_NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import XHS note list Excel, fetch realtime note details, and write to PostgreSQL."
    )
    parser.add_argument("--input", default=DEFAULT_EXCEL_FILE)
    parser.add_argument("--sheet", default="", help="Sheet name. Empty uses the first sheet.")
    parser.add_argument("--table", default=DEFAULT_TABLE, help="Target table, schema.table")
    parser.add_argument("--keyword", default="", help="Optional search keyword label stored with rows.")
    parser.add_argument("--max-notes", type=int, default=0, help="Limit notes for testing.")
    parser.add_argument("--dry-run", action="store_true", help="Parse/fetch only; do not write DB.")
    parser.add_argument("--skip-fetch", action="store_true", help="Only parse Excel and write source rows.")
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-sleep", type=float, default=2.0)
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
    if not args.dry_run and not args.db_password:
        raise RuntimeError("Missing database password. Set PGPASSWORD or --db-password.")
    return args


def col_to_index(cell_ref):
    match = re.match(r"([A-Z]+)", cell_ref)
    if not match:
        return 0
    value = 0
    for char in match.group(1):
        value = value * 26 + ord(char) - 64
    return value - 1


def read_shared_strings(zip_file):
    if "xl/sharedStrings.xml" not in zip_file.namelist():
        return []
    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    shared = []
    for item in root.findall("a:si", XLSX_NS):
        parts = [text.text or "" for text in item.findall(".//a:t", XLSX_NS)]
        shared.append("".join(parts))
    return shared


def workbook_sheets(zip_file):
    workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
    rels = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    sheets = []
    for sheet in workbook.find("a:sheets", XLSX_NS):
        rel_id = sheet.attrib["{%s}id" % XLSX_NS["r"]]
        target = rel_map[rel_id]
        sheet_path = "xl/" + target.lstrip("/") if not target.startswith("xl/") else target
        sheets.append((sheet.attrib["name"], sheet_path))
    return sheets


def cell_value(cell, shared):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in cell.findall(".//a:t", XLSX_NS))
    value_node = cell.find("a:v", XLSX_NS)
    if value_node is None:
        return ""
    raw_value = value_node.text or ""
    if cell_type == "s":
        return shared[int(raw_value)] if raw_value else ""
    if cell_type == "b":
        return "TRUE" if raw_value == "1" else "FALSE"
    return raw_value


def read_xlsx_records(path, sheet_name=""):
    path = Path(path)
    with ZipFile(path) as zip_file:
        shared = read_shared_strings(zip_file)
        sheets = workbook_sheets(zip_file)
        if not sheets:
            raise RuntimeError("Workbook has no sheets.")
        selected = None
        for name, sheet_path in sheets:
            if not sheet_name or name == sheet_name:
                selected = (name, sheet_path)
                break
        if selected is None:
            available = ", ".join(name for name, _ in sheets)
            raise RuntimeError(f"Sheet {sheet_name!r} not found. Available: {available}")

        root = ET.fromstring(zip_file.read(selected[1]))
        rows = []
        for row in root.findall(".//a:sheetData/a:row", XLSX_NS):
            values_by_index = {}
            max_index = -1
            for cell in row.findall("a:c", XLSX_NS):
                index = col_to_index(cell.attrib.get("r", "A"))
                max_index = max(max_index, index)
                values_by_index[index] = cell_value(cell, shared)
            values = [""] * (max_index + 1)
            for index, value in values_by_index.items():
                values[index] = value
            rows.append(values)

    if not rows:
        return selected[0], []
    headers = [str(header).strip() for header in rows[0]]
    records = []
    for source_row, row in enumerate(rows[1:], start=2):
        if not any(str(value).strip() for value in row):
            continue
        record = {headers[index]: row[index] if index < len(row) else "" for index in range(len(headers))}
        record["_source_row"] = source_row
        records.append(record)
    return selected[0], records


def as_text(value):
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def as_int(value):
    text = as_text(value).replace(",", "")
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def extract_note_id(record):
    for key in ("XhsId", "note_id", "笔记ID", "作品ID"):
        value = as_text(record.get(key))
        if value:
            return value

    link = as_text(record.get("笔记链接") or record.get("note_url") or record.get("作品链接"))
    if not link:
        return ""
    parsed = urlparse(link)
    match = re.search(r"/(?:explore|discovery/item)/([^/?#]+)", parsed.path)
    if match:
        return match.group(1)
    match = re.search(r"(?:explore|discovery/item)/([^/?#]+)", link)
    return match.group(1) if match else ""


def normalize_records(records, source_file, keyword, max_notes=0):
    normalized = []
    seen = set()
    for record in records:
        note_id = extract_note_id(record)
        if not note_id or note_id in seen:
            continue
        seen.add(note_id)
        normalized.append({
            "note_id": note_id,
            "source_file": str(source_file),
            "source_row": int(record["_source_row"]),
            "source_keyword": keyword,
            "source_image": as_text(record.get("图片")),
            "source_title": as_text(record.get("标题")),
            "source_author": as_text(record.get("博主")),
            "source_author_profile_url": as_text(record.get("博主主页链接")),
            "source_note_type": as_text(record.get("笔记类型")),
            "source_like_count": as_int(record.get("点赞数")),
            "source_collected_count": as_int(record.get("收藏数")),
            "source_comments_count": as_int(record.get("评论数")),
            "source_share_count": as_int(record.get("分享数")),
            "source_content": as_text(record.get("内容")),
            "source_publish_time_text": as_text(record.get("发布时间")),
            "source_author_region": as_text(record.get("博主-地区")),
            "source_note_url": as_text(record.get("笔记链接")),
            "source_raw_json": record,
        })
        if max_notes and len(normalized) >= max_notes:
            break
    return normalized


def request_note_detail(args, note_id):
    url = ops.gateway_proxy_url("endata_xhs_note_detail")
    params = {"XhsId": note_id}
    last_error = None
    for attempt in range(args.retries + 1):
        response = None
        try:
            response = ops.call_api(
                "GET",
                url,
                provider_code="endata_xhs_note_detail",
                operation="note_detail_fetch",
                note_id=note_id,
                attempt_no=attempt + 1,
                max_attempts=args.retries + 1,
                metadata={"source": "note_details", "business_status": "pending"},
                params=params,
                timeout=args.timeout,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"HTTP {response.status_code}: {response.text[:500]}")
            payload = response.json()
            code = payload.get("Code")
            if code not in (0, 200, "0", "200", None):
                message = str(payload.get("Msg") or "")
                error_message = f"Code={code} Msg={message}"
                last_error = RuntimeError(error_message)
                if ("请求失败" in message or "重试" in message) and attempt < args.retries:
                    time.sleep(args.retry_sleep * (attempt + 1))
                    continue
                return {
                    "note_id": note_id,
                    "detail_status": "failed",
                    "detail_error": error_message,
                    "payload": payload,
                    "data": {},
                }
            data = payload.get("Data") or {}
            return {
                "note_id": note_id,
                "detail_status": "success",
                "detail_error": None,
                "payload": payload,
                "data": data,
            }
        except Exception as exc:
            last_error = exc
            if attempt >= args.retries:
                break
            time.sleep(args.retry_sleep * (attempt + 1))
    return {
        "note_id": note_id,
        "detail_status": "failed",
        "detail_error": str(last_error),
        "payload": None,
        "data": {},
    }


def fetch_details(args, source_rows):
    if args.skip_fetch:
        return {
            row["note_id"]: {
                "note_id": row["note_id"],
                "detail_status": "skipped",
                "detail_error": None,
                "payload": None,
                "data": {},
            }
            for row in source_rows
        }

    details = {}
    note_ids = [row["note_id"] for row in source_rows]
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {executor.submit(request_note_detail, args, note_id): note_id for note_id in note_ids}
        for index, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            details[result["note_id"]] = result
            if index == 1 or index % 20 == 0 or index == len(note_ids):
                ok = sum(1 for item in details.values() if item["detail_status"] == "success")
                print(f"details {index}/{len(note_ids)} success={ok}")
    return details


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


def ensure_table(conn, table_name):
    schema_name, plain_table_name = split_table_name(table_name)
    create_sql = sql.SQL(
        """
CREATE SCHEMA IF NOT EXISTS {schema};

CREATE TABLE IF NOT EXISTS {table} (
  note_id text PRIMARY KEY,

  source_file text,
  source_row integer,
  source_keyword text,
  source_image text,
  source_title text,
  source_author text,
  source_author_profile_url text,
  source_note_type text,
  source_like_count integer DEFAULT 0,
  source_collected_count integer DEFAULT 0,
  source_comments_count integer DEFAULT 0,
  source_share_count integer DEFAULT 0,
  source_content text,
  source_publish_time_text text,
  source_author_region text,
  source_note_url text,
  source_raw_json jsonb,

  detail_status text NOT NULL DEFAULT 'pending',
  detail_error text,
  is_show boolean,
  xhs_id text,
  title text,
  content text,
  publish_time timestamp,
  images_list jsonb,
  top_image text,
  like_count integer DEFAULT 0,
  collected_count integer DEFAULT 0,
  comments_count integer DEFAULT 0,
  share_count integer DEFAULT 0,
  author_id text,
  nickname text,
  topic_list jsonb,
  video_address text,
  video_top_image text,
  avatar text,
  ip_location text,
  duration integer DEFAULT 0,
  note_type text,
  red_id text,
  raw_json jsonb,

  fetched_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE {table} IS '小红书笔记列表导入后通过实时详情接口补全的作品详情表';
COMMENT ON COLUMN {table}.source_raw_json IS 'Excel 笔记列表原始行';
COMMENT ON COLUMN {table}.raw_json IS 'Endata GetStandardNoteInfo 接口原始返回';

CREATE INDEX IF NOT EXISTS {idx_author}
  ON {table} (nickname);
CREATE INDEX IF NOT EXISTS {idx_publish}
  ON {table} (publish_time);
CREATE INDEX IF NOT EXISTS {idx_status}
  ON {table} (detail_status);
CREATE INDEX IF NOT EXISTS {idx_like}
  ON {table} (like_count);
"""
    ).format(
        schema=sql.Identifier(schema_name),
        table=sql.Identifier(schema_name, plain_table_name),
        idx_author=sql.Identifier(f"idx_{plain_table_name}_nickname"),
        idx_publish=sql.Identifier(f"idx_{plain_table_name}_publish_time"),
        idx_status=sql.Identifier(f"idx_{plain_table_name}_detail_status"),
        idx_like=sql.Identifier(f"idx_{plain_table_name}_like_count"),
    )
    with conn.cursor() as cur:
        cur.execute(create_sql)
    conn.commit()


def build_row(source_row, detail_result):
    data = detail_result.get("data") or {}
    return (
        source_row["note_id"],
        source_row["source_file"],
        source_row["source_row"],
        source_row["source_keyword"],
        source_row["source_image"],
        source_row["source_title"],
        source_row["source_author"],
        source_row["source_author_profile_url"],
        source_row["source_note_type"],
        source_row["source_like_count"],
        source_row["source_collected_count"],
        source_row["source_comments_count"],
        source_row["source_share_count"],
        source_row["source_content"],
        source_row["source_publish_time_text"],
        source_row["source_author_region"],
        source_row["source_note_url"],
        Json(source_row["source_raw_json"]),
        detail_result["detail_status"],
        detail_result["detail_error"],
        data.get("IsShow"),
        data.get("XhsId") or source_row["note_id"],
        data.get("Title"),
        data.get("Content"),
        data.get("PublishTime") or None,
        Json(data.get("ImagesList")),
        data.get("TopImage"),
        as_int(data.get("LikeCount")),
        as_int(data.get("CollectedCount")),
        as_int(data.get("CommentsCount")),
        as_int(data.get("ShareCount")),
        data.get("UserId"),
        data.get("NickName"),
        Json(data.get("TopicList")),
        data.get("VideoAddress"),
        data.get("VideoTopImage"),
        data.get("Avator"),
        data.get("IpLocation"),
        as_int(data.get("Duration")),
        data.get("NoteType"),
        data.get("RedId"),
        Json(detail_result.get("payload")),
    )


def upsert_rows(conn, table_name, source_rows, details):
    if not source_rows:
        return 0

    schema_name, plain_table_name = split_table_name(table_name)
    target = sql.Identifier(schema_name, plain_table_name)
    columns = [
        "note_id",
        "source_file",
        "source_row",
        "source_keyword",
        "source_image",
        "source_title",
        "source_author",
        "source_author_profile_url",
        "source_note_type",
        "source_like_count",
        "source_collected_count",
        "source_comments_count",
        "source_share_count",
        "source_content",
        "source_publish_time_text",
        "source_author_region",
        "source_note_url",
        "source_raw_json",
        "detail_status",
        "detail_error",
        "is_show",
        "xhs_id",
        "title",
        "content",
        "publish_time",
        "images_list",
        "top_image",
        "like_count",
        "collected_count",
        "comments_count",
        "share_count",
        "author_id",
        "nickname",
        "topic_list",
        "video_address",
        "video_top_image",
        "avatar",
        "ip_location",
        "duration",
        "note_type",
        "red_id",
        "raw_json",
    ]
    update_columns = [column for column in columns if column != "note_id"]
    rows = [build_row(source_row, details[source_row["note_id"]]) for source_row in source_rows]
    insert_sql = sql.SQL(
        """
INSERT INTO {table} ({columns})
VALUES %s
ON CONFLICT (note_id) DO UPDATE SET
  {updates},
  fetched_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
"""
    ).format(
        table=target,
        columns=sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        updates=sql.SQL(",\n  ").join(
            sql.SQL("{column} = EXCLUDED.{column}").format(column=sql.Identifier(column))
            for column in update_columns
        ),
    )
    with conn.cursor() as cur:
        execute_values(cur, insert_sql, rows, page_size=200)
    conn.commit()
    return len(rows)


def print_summary(table, source_rows, details, written=0):
    success = sum(1 for item in details.values() if item["detail_status"] == "success")
    failed = sum(1 for item in details.values() if item["detail_status"] == "failed")
    skipped = sum(1 for item in details.values() if item["detail_status"] == "skipped")
    print(
        json.dumps(
            {
                "table": table,
                "unique_notes": len(source_rows),
                "detail_success": success,
                "detail_failed": failed,
                "detail_skipped": skipped,
                "written": written,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def main():
    args = enrich_args(parse_args())
    ops.configure_from_args(args)
    script_run_id = ops.start_script_run(
        "import_xhs_note_details_from_excel",
        trigger_type=os.environ.get("GEO_OPS_TRIGGER_TYPE") or "manual",
        command=sys.argv,
        args=args,
    )
    source_rows = []
    details = {}
    written = 0
    try:
        sheet_name, raw_records = read_xlsx_records(args.input, args.sheet)
        source_rows = normalize_records(raw_records, args.input, args.keyword, args.max_notes)
        print(f"sheet={sheet_name} rows={len(raw_records)} unique_note_ids={len(source_rows)}")
        if not source_rows:
            raise RuntimeError("No note IDs found in Excel.")

        details = fetch_details(args, source_rows)
        if args.dry_run:
            print_summary(args.table, source_rows, details)
            ops.finish_script_run(
                script_run_id,
                status="success",
                processed_count=len(source_rows),
                success_count=sum(1 for item in details.values() if item["detail_status"] == "success"),
                failed_count=sum(1 for item in details.values() if item["detail_status"] == "failed"),
                skipped_count=sum(1 for item in details.values() if item["detail_status"] == "skipped"),
                summary={"dry_run": True, "table": args.table},
            )
            return

        conn = db_connect(args)
        try:
            ensure_table(conn, args.table)
            written = upsert_rows(conn, args.table, source_rows, details)
        finally:
            conn.close()
        print_summary(args.table, source_rows, details, written)
        ops.finish_script_run(
            script_run_id,
            status="success",
            processed_count=len(source_rows),
            success_count=sum(1 for item in details.values() if item["detail_status"] == "success"),
            failed_count=sum(1 for item in details.values() if item["detail_status"] == "failed"),
            skipped_count=sum(1 for item in details.values() if item["detail_status"] == "skipped"),
            summary={"table": args.table, "written": written},
        )
    except Exception as exc:
        ops.finish_script_run(
            script_run_id,
            status="failed",
            exit_code=1,
            processed_count=len(source_rows) if source_rows else None,
            success_count=sum(1 for item in details.values() if item.get("detail_status") == "success"),
            failed_count=sum(1 for item in details.values() if item.get("detail_status") == "failed"),
            error_message=str(exc),
            summary=ops.exception_summary(exc),
        )
        raise


if __name__ == "__main__":
    main()
