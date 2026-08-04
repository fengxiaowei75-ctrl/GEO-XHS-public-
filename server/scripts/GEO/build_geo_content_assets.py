#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json
import requests

import geo_ops_gateway as ops


DEFAULT_ENV_FILE = os.environ.get("XHS_SYNC_ENV_FILE") or (
    "/opt/xhs-sync/sync.env"
    if os.path.exists("/opt/xhs-sync")
    else "/tmp/geo-xhs/sync.env"
)
DEFAULT_DETAIL_TABLE = "public.note_details"
DEFAULT_IMAGE_TABLE = "public.image_analysis"
DEFAULT_ASSET_TABLE = "public.geo_note_content_assets"
DEFAULT_RUN_TABLE = "public.geo_note_content_asset_runs"

DEFAULT_CONTENT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_CONTENT_MODEL = "doubao-seed-2-0-mini-260428"
DEFAULT_CONTENT_TEMPERATURE = 0.6
DEFAULT_CONTENT_THINKING = "disabled"
DEFAULT_PROMPT_VERSION = "geo_note_asset_v1"

PERSONA_CHOICES = {
    "认知小白",
    "泛好奇者",
    "垂直探路者",
    "行业观望者",
    "行业焦虑决策者",
    "代理/渠道商",
    "无法判断",
}
FUNNEL_CHOICES = {"曝光", "信任", "转化", "无法判断"}
PAIN_AUTHENTICITY_CHOICES = {"真实痛点", "弱痛点", "伪痛点", "无法判断"}
INFORMATION_DENSITY_CHOICES = {"低密度", "中密度", "高密度", "超高密度"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build note-level GEO content assets from note_details and image_analysis with the configured content model."
    )
    parser.add_argument("--detail-table", default=DEFAULT_DETAIL_TABLE)
    parser.add_argument("--image-table", default=DEFAULT_IMAGE_TABLE)
    parser.add_argument("--asset-table", default=DEFAULT_ASSET_TABLE)
    parser.add_argument("--run-table", default=DEFAULT_RUN_TABLE)
    parser.add_argument("--note-id", action="append", default=[], help="Only process selected note_id. Can repeat.")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true", help="Rebuild existing assets for the same prompt_version.")
    parser.add_argument("--only-missing", action="store_true", help="Only build assets missing for prompt_version.")
    parser.add_argument("--min-score", type=float, default=0)
    parser.add_argument("--min-fresh-score", type=float, default=0)
    parser.add_argument("--freshness-half-life-days", type=int, default=45)
    parser.add_argument("--rank-mode", choices=["fresh", "interaction"], default="fresh")
    parser.add_argument("--prompt-version", default=DEFAULT_PROMPT_VERSION)
    parser.add_argument("--max-images-per-note", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-llm", action="store_true", help="Build payload and skip content model call/write asset.")
    parser.add_argument("--content-api-key", "--kimi-api-key", dest="kimi_api_key", default="")
    parser.add_argument("--content-base-url", "--kimi-base-url", dest="kimi_base_url", default="")
    parser.add_argument("--content-model", "--kimi-model", dest="kimi_model", default="")
    parser.add_argument("--content-temperature", "--kimi-temperature", dest="kimi_temperature", type=float, default=None)
    parser.add_argument("--content-thinking", "--kimi-thinking", dest="kimi_thinking", choices=["disabled", "auto"], default="")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--retry-sleep", type=float, default=2.0)
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
        values[key] = value.strip().strip("'").strip('"')
    return values


def enrich_args(args):
    values = load_env_file()
    args.db_password = args.db_password or os.environ.get("PGPASSWORD") or values.get("PGPASSWORD") or ""
    args.kimi_api_key = (
        args.kimi_api_key
        or os.environ.get("GEO_CONTENT_API_KEY")
        or os.environ.get("ARK_CHAT_API_KEY")
        or os.environ.get("KIMI_API_KEY")
        or os.environ.get("MOONSHOT_API_KEY")
        or values.get("GEO_CONTENT_API_KEY")
        or values.get("ARK_CHAT_API_KEY")
        or values.get("KIMI_API_KEY")
        or values.get("MOONSHOT_API_KEY")
        or ""
    )
    args.kimi_model = (
        args.kimi_model
        or os.environ.get("GEO_CONTENT_MODEL")
        or os.environ.get("ARK_CHAT_MODEL")
        or os.environ.get("KIMI_MODEL")
        or values.get("GEO_CONTENT_MODEL")
        or values.get("ARK_CHAT_MODEL")
        or values.get("KIMI_MODEL")
        or DEFAULT_CONTENT_MODEL
    )
    args.kimi_thinking = (
        args.kimi_thinking
        or os.environ.get("GEO_CONTENT_THINKING")
        or os.environ.get("ARK_CHAT_THINKING")
        or os.environ.get("KIMI_THINKING")
        or values.get("GEO_CONTENT_THINKING")
        or values.get("ARK_CHAT_THINKING")
        or values.get("KIMI_THINKING")
        or DEFAULT_CONTENT_THINKING
    )
    if getattr(args, "kimi_temperature", None) is None:
        temperature = (
            os.environ.get("GEO_CONTENT_TEMPERATURE")
            or os.environ.get("ARK_CHAT_TEMPERATURE")
            or os.environ.get("KIMI_TEMPERATURE")
            or values.get("GEO_CONTENT_TEMPERATURE")
            or values.get("ARK_CHAT_TEMPERATURE")
            or values.get("KIMI_TEMPERATURE")
        )
        args.kimi_temperature = float(temperature) if temperature else DEFAULT_CONTENT_TEMPERATURE
    args.kimi_base_url = (
        args.kimi_base_url
        or os.environ.get("GEO_CONTENT_BASE_URL")
        or os.environ.get("ARK_CHAT_BASE_URL")
        or os.environ.get("KIMI_BASE_URL")
        or os.environ.get("MOONSHOT_BASE_URL")
        or values.get("GEO_CONTENT_BASE_URL")
        or values.get("ARK_CHAT_BASE_URL")
        or values.get("KIMI_BASE_URL")
        or values.get("MOONSHOT_BASE_URL")
        or DEFAULT_CONTENT_BASE_URL
    ).rstrip("/")
    if not args.dry_run and not args.db_password:
        raise RuntimeError("Missing database password. Set PGPASSWORD or --db-password.")
    if not args.dry_run and not args.skip_llm and not args.kimi_api_key:
        raise RuntimeError("Missing content model API key. Set GEO_CONTENT_API_KEY/ARK_CHAT_API_KEY/KIMI_API_KEY or --kimi-api-key.")
    if args.freshness_half_life_days <= 0:
        raise RuntimeError("--freshness-half-life-days must be positive.")
    return args


def content_provider_code(args):
    base_url = (getattr(args, "kimi_base_url", "") or "").lower()
    model_name = (getattr(args, "kimi_model", "") or "").lower()
    if "volces.com" in base_url or "doubao" in model_name:
        return "volcengine_ark_chat"
    return "kimi_chat"


def content_model_provider(args):
    return "volcengine_ark" if content_provider_code(args) == "volcengine_ark_chat" else "kimi"


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


def ensure_tables(conn, asset_table, run_table):
    asset_schema, asset_name = split_table_name(asset_table)
    run_schema, run_name = split_table_name(run_table)
    ddl = sql.SQL(
        """
CREATE SCHEMA IF NOT EXISTS {asset_schema};
CREATE SCHEMA IF NOT EXISTS {run_schema};

CREATE TABLE IF NOT EXISTS {asset_table} (
  asset_id bigserial PRIMARY KEY,
  note_id text NOT NULL REFERENCES public.note_details(note_id) ON DELETE CASCADE,

  prompt_version text NOT NULL,
  model_provider text NOT NULL DEFAULT 'kimi',
  model_name text,
  base_url text,
  analysis_status text NOT NULL DEFAULT 'pending',
  analysis_error text,

  title text,
  content text,
  note_type text,
  author_nickname text,
  publish_time timestamp,
  note_url text,

  like_count integer NOT NULL DEFAULT 0,
  collected_count integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  share_count integer NOT NULL DEFAULT 0,
  interaction_score integer NOT NULL DEFAULT 0,
  interaction_formula text NOT NULL DEFAULT 'like_count*1 + collected_count*1 + comments_count*2',
  age_days integer,
  recency_half_life_days integer NOT NULL DEFAULT 45,
  recency_factor numeric(8,6),
  fresh_hot_score numeric(14,4) NOT NULL DEFAULT 0,
  freshness_bucket text,
  interaction_rank integer,
  fresh_hot_rank integer,
  interaction_percentile numeric(6,4),
  fresh_hot_percentile numeric(6,4),
  explosion_level text,

  core_topic_category text,

  true_pain_label text,
  pain_description text,
  pain_evidence text,
  pain_authenticity text,
  pain_confidence numeric(5,4),

  primary_target_persona text,
  target_persona_tags text[] NOT NULL DEFAULT '{{}}',
  target_persona_reason text,

  primary_industry text,
  industry_tags text[] NOT NULL DEFAULT '{{}}',

  funnel_role text,
  funnel_role_reason text,

  business_relevance_score numeric(5,4),
  llm_confidence numeric(5,4),

  knowledge_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  reusable_angles jsonb NOT NULL DEFAULT '[]'::jsonb,
  title_templates jsonb NOT NULL DEFAULT '[]'::jsonb,

  content_logic text,
  business_logic text,
  hook_types text[] NOT NULL DEFAULT '{{}}',
  cta_strategy text,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,

  visual_group_style_prompt text,
  visual_main_colors text,
  visual_emotion text,
  information_density_level text,
  information_density_reason text,
  layout_structure text,
  cover_text_logic text,

  source_image_count integer NOT NULL DEFAULT 0,
  analyzed_image_count integer NOT NULL DEFAULT 0,
  image_analysis_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,

  llm_output jsonb,
  asset_text text,

  generated_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (note_id, prompt_version),

  CHECK (pain_authenticity IS NULL OR pain_authenticity IN ('真实痛点', '弱痛点', '伪痛点', '无法判断')),
  CHECK (funnel_role IS NULL OR funnel_role IN ('曝光', '信任', '转化', '无法判断')),
  CHECK (information_density_level IS NULL OR information_density_level IN ('低密度', '中密度', '高密度', '超高密度'))
);

ALTER TABLE {asset_table}
  ADD COLUMN IF NOT EXISTS base_url text;

CREATE TABLE IF NOT EXISTS {run_table} (
  run_id bigserial PRIMARY KEY,
  note_id text NOT NULL,
  prompt_version text NOT NULL,
  model_provider text NOT NULL DEFAULT 'kimi',
  model_name text,
  input_payload jsonb NOT NULL,
  output_text text,
  parsed_output jsonb,
  status text NOT NULL,
  error text,
  token_usage jsonb,
  latency_ms integer,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS {idx_asset_note}
  ON {asset_table} (note_id);
CREATE INDEX IF NOT EXISTS {idx_asset_interaction}
  ON {asset_table} (interaction_score DESC);
CREATE INDEX IF NOT EXISTS {idx_asset_fresh}
  ON {asset_table} (fresh_hot_score DESC);
CREATE INDEX IF NOT EXISTS {idx_asset_publish}
  ON {asset_table} (publish_time DESC);
CREATE INDEX IF NOT EXISTS {idx_asset_funnel}
  ON {asset_table} (funnel_role);
CREATE INDEX IF NOT EXISTS {idx_asset_topic}
  ON {asset_table} (core_topic_category);
CREATE INDEX IF NOT EXISTS {idx_asset_persona}
  ON {asset_table} (primary_target_persona);
CREATE INDEX IF NOT EXISTS {idx_asset_persona_tags}
  ON {asset_table} USING GIN (target_persona_tags);
CREATE INDEX IF NOT EXISTS {idx_asset_industry_tags}
  ON {asset_table} USING GIN (industry_tags);

CREATE INDEX IF NOT EXISTS {idx_run_note}
  ON {run_table} (note_id);
CREATE INDEX IF NOT EXISTS {idx_run_status}
  ON {run_table} (status);

CREATE OR REPLACE FUNCTION public.notify_geo_note_asset_vector_queue()
RETURNS trigger AS $$
BEGIN
  IF NEW.analysis_status = 'success' AND COALESCE(NEW.asset_text, '') <> '' THEN
    PERFORM pg_notify('geo_note_content_asset_changed', NEW.asset_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_geo_note_content_assets_vector_notify ON {asset_table};
CREATE TRIGGER trg_geo_note_content_assets_vector_notify
AFTER INSERT OR UPDATE OF asset_text, analysis_status, prompt_version ON {asset_table}
FOR EACH ROW
EXECUTE FUNCTION public.notify_geo_note_asset_vector_queue();
"""
    ).format(
        asset_schema=sql.Identifier(asset_schema),
        run_schema=sql.Identifier(run_schema),
        asset_table=sql.Identifier(asset_schema, asset_name),
        run_table=sql.Identifier(run_schema, run_name),
        idx_asset_note=sql.Identifier(f"idx_{asset_name}_note_id"),
        idx_asset_interaction=sql.Identifier(f"idx_{asset_name}_interaction_score"),
        idx_asset_fresh=sql.Identifier(f"idx_{asset_name}_fresh_hot_score"),
        idx_asset_publish=sql.Identifier(f"idx_{asset_name}_publish_time"),
        idx_asset_funnel=sql.Identifier(f"idx_{asset_name}_funnel_role"),
        idx_asset_topic=sql.Identifier(f"idx_{asset_name}_topic"),
        idx_asset_persona=sql.Identifier(f"idx_{asset_name}_primary_persona"),
        idx_asset_persona_tags=sql.Identifier(f"idx_{asset_name}_persona_tags"),
        idx_asset_industry_tags=sql.Identifier(f"idx_{asset_name}_industry_tags"),
        idx_run_note=sql.Identifier(f"idx_{run_name}_note_id"),
        idx_run_status=sql.Identifier(f"idx_{run_name}_status"),
    )
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def clamp_score(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return max(0, min(1, number))


def as_text(value):
    if value is None:
        return ""
    return str(value).strip()


def as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def as_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def text_array(value, allowed=None, fallback=None):
    items = []
    for item in as_list(value):
        text = as_text(item)
        if not text:
            continue
        if allowed and text not in allowed:
            continue
        items.append(text)
    if not items and fallback:
        items = [fallback]
    return items


def enum_value(value, allowed, fallback="无法判断"):
    text = as_text(value)
    return text if text in allowed else fallback


def truncate_text(value, max_chars):
    text = as_text(value)
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


def freshness_bucket(age_days):
    if age_days is None:
        return "过期参考"
    if age_days <= 7:
        return "7天内"
    if age_days <= 30:
        return "30天内"
    if age_days <= 90:
        return "90天内"
    if age_days <= 180:
        return "180天内"
    return "过期参考"


def explosion_level(percentile):
    if percentile is None:
        return None
    if percentile >= 0.95:
        return "S"
    if percentile >= 0.80:
        return "A"
    if percentile >= 0.50:
        return "B"
    return "C"


def fetch_candidate_notes(conn, args):
    detail_schema, detail_name = split_table_name(args.detail_table)
    asset_schema, asset_name = split_table_name(args.asset_table)
    order_column = sql.Identifier("fresh_hot_score" if args.rank_mode == "fresh" else "interaction_score")

    where_parts = [sql.SQL("r.detail_status = 'success'")]
    params = {
        "half_life": args.freshness_half_life_days,
        "prompt_version": args.prompt_version,
    }
    if args.note_id:
        where_parts.append(sql.SQL("r.note_id = ANY(%(note_ids)s)"))
        params["note_ids"] = args.note_id
    if args.min_score:
        where_parts.append(sql.SQL("r.interaction_score >= %(min_score)s"))
        params["min_score"] = args.min_score
    if args.min_fresh_score:
        where_parts.append(sql.SQL("r.fresh_hot_score >= %(min_fresh_score)s"))
        params["min_fresh_score"] = args.min_fresh_score
    if args.only_missing and not args.force:
        where_parts.append(sql.SQL("a.asset_id IS NULL"))

    limit_sql = sql.SQL("")
    if args.limit:
        limit_sql = sql.SQL("LIMIT %(limit)s")
        params["limit"] = args.limit

    query = sql.SQL(
        """
WITH scored AS (
  SELECT
    n.*,
    (COALESCE(n.like_count,0) + COALESCE(n.collected_count,0) + COALESCE(n.comments_count,0) * 2) AS interaction_score,
    GREATEST(0, CURRENT_DATE - n.publish_time::date) AS age_days,
    POWER(0.5, GREATEST(0, CURRENT_DATE - n.publish_time::date)::numeric / %(half_life)s::numeric) AS recency_factor,
    ((COALESCE(n.like_count,0) + COALESCE(n.collected_count,0) + COALESCE(n.comments_count,0) * 2)
      * POWER(0.5, GREATEST(0, CURRENT_DATE - n.publish_time::date)::numeric / %(half_life)s::numeric)) AS fresh_hot_score
  FROM {detail_table} n
  WHERE n.detail_status = 'success'
),
ranked AS (
  SELECT
    s.*,
    RANK() OVER (ORDER BY s.interaction_score DESC NULLS LAST) AS interaction_rank,
    RANK() OVER (ORDER BY s.fresh_hot_score DESC NULLS LAST) AS fresh_hot_rank,
    CASE WHEN COUNT(*) OVER () <= 1 THEN 1
      ELSE 1 - ((RANK() OVER (ORDER BY s.interaction_score DESC NULLS LAST) - 1)::numeric / NULLIF(COUNT(*) OVER () - 1, 0))
    END AS interaction_percentile,
    CASE WHEN COUNT(*) OVER () <= 1 THEN 1
      ELSE 1 - ((RANK() OVER (ORDER BY s.fresh_hot_score DESC NULLS LAST) - 1)::numeric / NULLIF(COUNT(*) OVER () - 1, 0))
    END AS fresh_hot_percentile
  FROM scored s
)
SELECT
  r.note_id, r.source_note_url, r.title, r.content, r.note_type, r.nickname, r.publish_time,
  r.like_count, r.collected_count, r.comments_count, r.share_count,
  r.interaction_score, r.age_days, r.recency_factor, r.fresh_hot_score,
  r.interaction_rank, r.fresh_hot_rank, r.interaction_percentile, r.fresh_hot_percentile,
  r.topic_list, r.images_list, r.top_image, r.source_image,
  a.asset_id AS existing_asset_id
FROM ranked r
LEFT JOIN {asset_table} a
  ON a.note_id = r.note_id
 AND a.prompt_version = %(prompt_version)s
WHERE {where_clause}
ORDER BY r.{order_column} DESC NULLS LAST, r.publish_time DESC NULLS LAST
{limit_sql}
"""
    ).format(
        detail_table=sql.Identifier(detail_schema, detail_name),
        asset_table=sql.Identifier(asset_schema, asset_name),
        where_clause=sql.SQL(" AND ").join(where_parts),
        order_column=order_column,
        limit_sql=limit_sql,
    )
    with conn.cursor() as cur:
        cur.execute(query, params)
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def fetch_image_items(conn, image_table, note_id, max_images):
    image_schema, image_name = split_table_name(image_table)
    query = sql.SQL(
        """
SELECT
  id, image_index, image_source, image_url, analysis_image_url, status, error,
  image_tags, image_description, visible_text, business_logic, emotional_hook,
  topic_category, target_persona, decision_stage, core_question, user_pain,
  knowledge_points, content_logic, takeaway, account_growth_role, content_funnel_stage,
  cta_strategy, series_potential, next_content_suggestions, hook_type, cover_text_logic,
  title_templates, reuse_method, visual_format, layout_structure, typography_style,
  color_palette, information_density, image2_style_prompt, risk_flags, confidence
FROM {image_table}
WHERE note_id = %s
ORDER BY image_index, id
LIMIT %s
"""
    ).format(image_table=sql.Identifier(image_schema, image_name))
    with conn.cursor() as cur:
        cur.execute(query, (note_id, max_images))
        columns = [desc[0] for desc in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]

    items = []
    for row in rows:
        item = dict(row)
        item["visible_text"] = truncate_text(item.get("visible_text"), 1600)
        item["image_description"] = truncate_text(item.get("image_description"), 1000)
        item["content_logic"] = truncate_text(item.get("content_logic"), 800)
        item["business_logic"] = truncate_text(item.get("business_logic"), 800)
        item["image2_style_prompt"] = truncate_text(item.get("image2_style_prompt"), 800)
        items.append(item)
    return items


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ")
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def make_jsonable(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=json_default))


def build_system_prompt():
    return (
        "你是小红书爆文拆解专家、GEO乙方业务增长顾问、内容策略师和视觉提示词工程师。"
        "你的任务是基于输入的一条小红书笔记、互动数据、时效数据和整组图片解析结果，"
        "输出一条笔记级内容资产JSON。必须先判断真实痛点，再判断目标人群。"
        "只基于输入内容判断，不要编造不存在的事实、案例、品牌、数据、行业或截图来源。"
        "只输出合法JSON，不要Markdown，不要代码块，不要解释过程。"
    )


def build_user_prompt(note, image_items, args):
    note_payload = {
        "note_id": note["note_id"],
        "title": note.get("title"),
        "nickname": note.get("nickname"),
        "note_type": note.get("note_type"),
        "publish_time": note.get("publish_time"),
        "like_count": note.get("like_count"),
        "collected_count": note.get("collected_count"),
        "comments_count": note.get("comments_count"),
        "share_count": note.get("share_count"),
        "interaction_score": note.get("interaction_score"),
        "age_days": note.get("age_days"),
        "recency_half_life_days": args.freshness_half_life_days,
        "recency_factor": float(note.get("recency_factor") or 0),
        "fresh_hot_score": float(note.get("fresh_hot_score") or 0),
        "interaction_rank": note.get("interaction_rank"),
        "fresh_hot_rank": note.get("fresh_hot_rank"),
        "interaction_percentile": float(note.get("interaction_percentile") or 0),
        "fresh_hot_percentile": float(note.get("fresh_hot_percentile") or 0),
        "freshness_bucket": freshness_bucket(note.get("age_days")),
        "content": truncate_text(note.get("content"), 3500),
        "topic_list": note.get("topic_list"),
        "note_url": note.get("source_note_url"),
    }
    return f"""
请把下面这条小红书笔记拆解成可复用的 GEO 内容资产。

【账号业务背景】
我是做 GEO 的乙方公司，技术团队和产品力很强，但运营能力需要通过小红书爆文拆解提升。当前目标不是直接生成笔记成稿，而是用爆文数据沉淀选题判断、脚本方向、案例分析和智能体召回能力，最终服务 GEO 获客。

【目标人群候选】
只能从以下候选中选择目标人群标签，可多选，但必须给出 primary_target_persona：
1. 认知小白
2. 泛好奇者
3. 垂直探路者
4. 行业观望者
5. 行业焦虑决策者
6. 代理/渠道商

【漏斗作用候选】
只能从以下候选中选择 funnel_role：
1. 曝光
2. 信任
3. 转化
4. 无法判断

【真实痛点判定标准】
真实痛点必须至少满足其中一类：业务损失、决策困难、风险规避、效率问题、机会错失。
如果只是猎奇、热点围观或泛概念科普，没有明确业务损失或决策压力，请标为“弱痛点”，不要硬判为转化痛点。

【互动权重与时效权重】
interaction_score = like_count + collected_count + comments_count * 2
recency_factor = 0.5 ^ (age_days / recency_half_life_days)
fresh_hot_score = interaction_score * recency_factor

请同时参考 interaction_score 和 fresh_hot_score：
- interaction_score 高：说明历史互动强，适合拆结构。
- fresh_hot_score 高：说明近期仍有复用价值，适合优先进入分析池。
- 老内容 interaction_score 高但 fresh_hot_score 低时，只能作为历史爆文结构参考。

【笔记详情 JSON】
{json.dumps(note_payload, ensure_ascii=False, default=json_default, indent=2)}

【整组图片解析 JSON 数组】
{json.dumps(image_items, ensure_ascii=False, default=json_default, indent=2)}

请输出严格 JSON，字段如下：
{{
  "prompt_version": "{args.prompt_version}",
  "note_id": "{note['note_id']}",
  "analysis_status": "success",
  "core_topic_category": "业务可用的选题分类",
  "true_pain_label": "真实痛点短标签",
  "pain_description": "真实痛点描述",
  "pain_evidence": "输入中的证据",
  "pain_authenticity": "真实痛点/弱痛点/伪痛点/无法判断",
  "pain_confidence": 0.0,
  "primary_target_persona": "认知小白/泛好奇者/垂直探路者/行业观望者/行业焦虑决策者/代理/渠道商/无法判断",
  "target_persona_tags": ["候选标签"],
  "target_persona_reason": "先痛点后人群的判断原因",
  "primary_industry": "行业或null",
  "industry_tags": ["行业标签"],
  "funnel_role": "曝光/信任/转化/无法判断",
  "funnel_role_reason": "判断原因",
  "business_relevance_score": 0.0,
  "llm_confidence": 0.0,
  "knowledge_points": [
    {{"point": "知识点", "explanation": "解释", "reuse_angle": "作为选题方向/脚本方向/案例分析依据的方式"}}
  ],
  "reusable_angles": [
    {{"angle": "可复用分析角度", "suitable_persona": "适合人群", "suggested_funnel_role": "曝光/信任/转化", "why_it_works": "为什么有效"}}
  ],
  "title_templates": ["带 {{{{变量}}}} 的标题模板，只做模板沉淀，不生成最终发布标题"],
  "content_logic": "内容叙事结构",
  "business_logic": "商业逻辑和账号增长价值",
  "hook_types": ["热点/权威背书/焦虑/恐惧/避坑/反常识/清单/案例/利益承诺/身份认同/争议/黑幕揭秘/专业干货/模板"],
  "cta_strategy": "适合承接的行动方向，只做策略判断",
  "risk_flags": ["复用风险"],
  "visual_group_style_prompt": "整组图片视觉风格提示词，不包含原品牌Logo",
  "visual_main_colors": "主色调",
  "visual_emotion": "视觉情绪",
  "information_density_level": "低密度/中密度/高密度/超高密度",
  "information_density_reason": "原因",
  "layout_structure": "布局结构",
  "cover_text_logic": "封面或首屏文字逻辑",
  "asset_text": "给向量库使用的综合文本，1500到3000中文字"
}}
""".strip()


def extract_response_text(payload):
    if not isinstance(payload, dict):
        return ""
    if isinstance(payload.get("choices"), list) and payload["choices"]:
        message = payload["choices"][0].get("message") or {}
        if isinstance(message.get("content"), str):
            return message["content"]
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    return ""


def parse_model_json(text):
    text = (text or "").strip()
    if not text:
        return {}
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            return json.loads(match.group(0))
        raise


def call_kimi(args, system_prompt, user_prompt):
    body = {
        "model": args.kimi_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": args.kimi_temperature,
    }
    if args.kimi_thinking == "disabled":
        body["thinking"] = {"type": "disabled"}
    headers = {
        "Authorization": f"Bearer {args.kimi_api_key}",
        "Content-Type": "application/json",
    }
    last_error = None
    started = time.monotonic()
    for attempt in range(args.retries + 1):
        try:
            response = ops.call_api(
                "POST",
                f"{args.kimi_base_url}/chat/completions",
                provider_code=content_provider_code(args),
                operation="content_asset_summary",
                model_name=args.kimi_model,
                note_id=getattr(args, "_current_note_id", None),
                attempt_no=attempt + 1,
                max_attempts=args.retries + 1,
                metadata={
                    "prompt_version": getattr(args, "_current_prompt_version", None),
                    "thinking": args.kimi_thinking,
                    "temperature": args.kimi_temperature,
                },
                headers=headers,
                json=body,
                timeout=args.timeout,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"HTTP {response.status_code}: {response.text[:1000]}")
            payload = response.json()
            text = extract_response_text(payload)
            parsed = parse_model_json(text)
            latency_ms = int((time.monotonic() - started) * 1000)
            return payload, text, parsed, latency_ms
        except Exception as exc:
            last_error = exc
            if attempt >= args.retries:
                break
            time.sleep(args.retry_sleep * (attempt + 1))
    latency_ms = int((time.monotonic() - started) * 1000)
    raise RuntimeError(f"Content model call failed after retries: {last_error}") from last_error


def fallback_asset_text(note, parsed):
    parts = [
        f"标题：{note.get('title') or ''}",
        f"原始互动权重：{note.get('interaction_score') or 0}",
        f"时效热度分：{round(float(note.get('fresh_hot_score') or 0), 1)}",
        f"核心选题：{parsed.get('core_topic_category') or ''}",
        f"真实痛点：{parsed.get('true_pain_label') or ''}。{parsed.get('pain_description') or ''}",
        f"目标人群：{'、'.join(text_array(parsed.get('target_persona_tags')))}",
        f"行业标签：{'、'.join(text_array(parsed.get('industry_tags')))}",
        f"漏斗作用：{parsed.get('funnel_role') or ''}",
        f"内容逻辑：{parsed.get('content_logic') or ''}",
        f"商业逻辑：{parsed.get('business_logic') or ''}",
        f"标题模板：{'；'.join(text_array(parsed.get('title_templates')))}",
        f"视觉风格：{parsed.get('visual_group_style_prompt') or ''}",
    ]
    return "\n".join(part for part in parts if part.strip())


def token_usage(payload):
    if isinstance(payload, dict) and isinstance(payload.get("usage"), dict):
        return payload["usage"]
    return {}


def insert_run(conn, args, note_id, input_payload, output_text, parsed_output, status, error, latency_ms, raw_payload=None):
    run_schema, run_name = split_table_name(args.run_table)
    query = sql.SQL(
        """
INSERT INTO {run_table}
  (note_id, prompt_version, model_provider, model_name, input_payload, output_text,
   parsed_output, status, error, token_usage, latency_ms)
VALUES
  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""
    ).format(run_table=sql.Identifier(run_schema, run_name))
    with conn.cursor() as cur:
        cur.execute(
            query,
            (
                note_id,
                args.prompt_version,
                content_model_provider(args),
                args.kimi_model,
                Json(make_jsonable(input_payload)),
                output_text,
                Json(make_jsonable(parsed_output or {})),
                status,
                error,
                Json(make_jsonable(token_usage(raw_payload))),
                latency_ms,
            ),
        )
    conn.commit()


def upsert_asset(conn, args, note, image_items, parsed, raw_payload):
    asset_schema, asset_name = split_table_name(args.asset_table)
    age_days = as_int(note.get("age_days"))
    fresh_percentile = as_float(note.get("fresh_hot_percentile"), 0)
    asset_text = as_text(parsed.get("asset_text")) or fallback_asset_text(note, parsed)
    row = {
        "note_id": note["note_id"],
        "prompt_version": args.prompt_version,
        "model_name": args.kimi_model,
        "model_provider": content_model_provider(args),
        "base_url": args.kimi_base_url,
        "analysis_status": "success",
        "analysis_error": None,
        "title": note.get("title"),
        "content": note.get("content"),
        "note_type": note.get("note_type"),
        "author_nickname": note.get("nickname"),
        "publish_time": note.get("publish_time"),
        "note_url": note.get("source_note_url"),
        "like_count": as_int(note.get("like_count")),
        "collected_count": as_int(note.get("collected_count")),
        "comments_count": as_int(note.get("comments_count")),
        "share_count": as_int(note.get("share_count")),
        "interaction_score": as_int(note.get("interaction_score")),
        "age_days": age_days,
        "recency_half_life_days": args.freshness_half_life_days,
        "recency_factor": as_float(note.get("recency_factor")),
        "fresh_hot_score": as_float(note.get("fresh_hot_score")),
        "freshness_bucket": freshness_bucket(age_days),
        "interaction_rank": as_int(note.get("interaction_rank")) or None,
        "fresh_hot_rank": as_int(note.get("fresh_hot_rank")) or None,
        "interaction_percentile": as_float(note.get("interaction_percentile")),
        "fresh_hot_percentile": fresh_percentile,
        "explosion_level": explosion_level(fresh_percentile),
        "core_topic_category": as_text(parsed.get("core_topic_category")) or None,
        "true_pain_label": as_text(parsed.get("true_pain_label")) or None,
        "pain_description": as_text(parsed.get("pain_description")) or None,
        "pain_evidence": as_text(parsed.get("pain_evidence")) or None,
        "pain_authenticity": enum_value(parsed.get("pain_authenticity"), PAIN_AUTHENTICITY_CHOICES),
        "pain_confidence": clamp_score(parsed.get("pain_confidence")),
        "primary_target_persona": enum_value(parsed.get("primary_target_persona"), PERSONA_CHOICES),
        "target_persona_tags": text_array(parsed.get("target_persona_tags"), PERSONA_CHOICES),
        "target_persona_reason": as_text(parsed.get("target_persona_reason")) or None,
        "primary_industry": as_text(parsed.get("primary_industry")) or None,
        "industry_tags": text_array(parsed.get("industry_tags")),
        "funnel_role": enum_value(parsed.get("funnel_role"), FUNNEL_CHOICES),
        "funnel_role_reason": as_text(parsed.get("funnel_role_reason")) or None,
        "business_relevance_score": clamp_score(parsed.get("business_relevance_score")),
        "llm_confidence": clamp_score(parsed.get("llm_confidence")),
        "knowledge_points": as_list(parsed.get("knowledge_points")),
        "reusable_angles": as_list(parsed.get("reusable_angles")),
        "title_templates": as_list(parsed.get("title_templates")),
        "content_logic": as_text(parsed.get("content_logic")) or None,
        "business_logic": as_text(parsed.get("business_logic")) or None,
        "hook_types": text_array(parsed.get("hook_types")),
        "cta_strategy": as_text(parsed.get("cta_strategy")) or None,
        "risk_flags": as_list(parsed.get("risk_flags")),
        "visual_group_style_prompt": as_text(parsed.get("visual_group_style_prompt")) or None,
        "visual_main_colors": as_text(parsed.get("visual_main_colors")) or None,
        "visual_emotion": as_text(parsed.get("visual_emotion")) or None,
        "information_density_level": enum_value(
            parsed.get("information_density_level"), INFORMATION_DENSITY_CHOICES, fallback=None
        ),
        "information_density_reason": as_text(parsed.get("information_density_reason")) or None,
        "layout_structure": as_text(parsed.get("layout_structure")) or None,
        "cover_text_logic": as_text(parsed.get("cover_text_logic")) or None,
        "source_image_count": len(image_items),
        "analyzed_image_count": sum(1 for item in image_items if item.get("status") == "success"),
        "image_analysis_snapshot": image_items,
        "llm_output": parsed,
        "asset_text": asset_text,
    }
    columns = list(row.keys())
    updates = [column for column in columns if column not in {"note_id", "prompt_version"}]
    query = sql.SQL(
        """
INSERT INTO {asset_table} ({columns}, generated_at)
VALUES ({values}, CURRENT_TIMESTAMP)
ON CONFLICT (note_id, prompt_version) DO UPDATE SET
  {updates},
  generated_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP
RETURNING asset_id
"""
    ).format(
        asset_table=sql.Identifier(asset_schema, asset_name),
        columns=sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        values=sql.SQL(", ").join(sql.Placeholder() for _ in columns),
        updates=sql.SQL(",\n  ").join(
            sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(column)) for column in updates
        ),
    )
    values = []
    json_columns = {"knowledge_points", "reusable_angles", "title_templates", "risk_flags", "image_analysis_snapshot", "llm_output"}
    for column in columns:
        value = row[column]
        values.append(Json(make_jsonable(value)) if column in json_columns else value)
    with conn.cursor() as cur:
        cur.execute(query, values)
        asset_id = cur.fetchone()[0]
    conn.commit()
    return asset_id


def build_input_payload(note, image_items, args, system_prompt, user_prompt):
    return {
        "note_id": note["note_id"],
        "prompt_version": args.prompt_version,
        "model_name": args.kimi_model,
        "model_provider": content_model_provider(args),
        "base_url": args.kimi_base_url,
        "rank_mode": args.rank_mode,
        "freshness_half_life_days": args.freshness_half_life_days,
        "note": {
            key: json_default(value) if isinstance(value, (datetime, date)) else value
            for key, value in note.items()
            if key != "existing_asset_id"
        },
        "image_count": len(image_items),
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
    }


def process_note(conn, args, note):
    args._current_note_id = note["note_id"]
    args._current_prompt_version = args.prompt_version
    image_items = fetch_image_items(conn, args.image_table, note["note_id"], args.max_images_per_note)
    system_prompt = build_system_prompt()
    user_prompt = build_user_prompt(note, image_items, args)
    input_payload = build_input_payload(note, image_items, args, system_prompt, user_prompt)

    if args.dry_run or args.skip_llm:
        print(json.dumps(input_payload, ensure_ascii=False, default=json_default, indent=2))
        return None

    raw_payload = None
    output_text = ""
    parsed = {}
    latency_ms = None
    try:
        raw_payload, output_text, parsed, latency_ms = call_kimi(args, system_prompt, user_prompt)
        asset_id = upsert_asset(conn, args, note, image_items, parsed, raw_payload)
        insert_run(conn, args, note["note_id"], input_payload, output_text, parsed, "success", None, latency_ms, raw_payload)
        return asset_id
    except Exception as exc:
        conn.rollback()
        insert_run(
            conn,
            args,
            note["note_id"],
            input_payload,
            output_text,
            parsed,
            "failed",
            str(exc),
            latency_ms,
            raw_payload,
        )
        raise


def print_summary(args, notes, asset_ids, failed):
    print(json.dumps({
        "asset_table": args.asset_table,
        "run_table": args.run_table,
        "prompt_version": args.prompt_version,
        "candidates": len(notes),
        "written_assets": len([item for item in asset_ids if item is not None]),
        "failed": failed,
        "rank_mode": args.rank_mode,
        "freshness_half_life_days": args.freshness_half_life_days,
    }, ensure_ascii=False, indent=2))


def main():
    args = enrich_args(parse_args())
    ops.configure_from_args(args)
    script_run_id = ops.start_script_run(
        "build_geo_content_assets",
        trigger_type=os.environ.get("GEO_OPS_TRIGGER_TYPE") or "manual",
        command=sys.argv,
        args=args,
    )
    conn = db_connect(args)
    asset_ids = []
    failed = 0
    notes = []
    try:
        ensure_tables(conn, args.asset_table, args.run_table)
        notes = fetch_candidate_notes(conn, args)
        print(f"candidates={len(notes)} rank_mode={args.rank_mode} prompt_version={args.prompt_version}")
        for index, note in enumerate(notes, start=1):
            try:
                asset_id = process_note(conn, args, note)
                asset_ids.append(asset_id)
                print(f"[{index}/{len(notes)}] note_id={note['note_id']} asset_id={asset_id}")
            except Exception as exc:
                failed += 1
                print(f"[{index}/{len(notes)}] note_id={note['note_id']} failed={exc}")
                if args.note_id and len(notes) == 1:
                    raise
    except Exception as exc:
        ops.finish_script_run(
            script_run_id,
            status="failed",
            exit_code=1,
            processed_count=len(notes) if notes else None,
            success_count=len([item for item in asset_ids if item is not None]),
            failed_count=failed,
            error_message=str(exc),
            summary=ops.exception_summary(exc),
        )
        raise
    finally:
        conn.close()
    print_summary(args, notes, asset_ids, failed)
    ops.finish_script_run(
        script_run_id,
        status="success",
        processed_count=len(notes),
        success_count=len([item for item in asset_ids if item is not None]),
        failed_count=failed,
        summary={
            "asset_table": args.asset_table,
            "run_table": args.run_table,
            "prompt_version": args.prompt_version,
            "rank_mode": args.rank_mode,
        },
    )


if __name__ == "__main__":
    main()
