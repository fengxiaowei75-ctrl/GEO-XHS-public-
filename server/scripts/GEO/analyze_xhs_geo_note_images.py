#!/usr/bin/env python3
import argparse
import base64
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, execute_values
import requests

import geo_ops_gateway as ops


ARK_API_KEY = ""
ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/responses"
ARK_MODEL = "doubao-seed-2-0-mini-260428"
DEFAULT_ENV_FILE = os.environ.get("XHS_SYNC_ENV_FILE") or (
    "/opt/xhs-sync/sync.env"
    if os.path.exists("/opt/xhs-sync")
    else "/tmp/geo-xhs/sync.env"
)
DEFAULT_SOURCE_TABLE = "public.note_details"
DEFAULT_TARGET_TABLE = "public.image_analysis"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Analyze all images from XHS GEO note details with Ark multimodal Responses API."
    )
    parser.add_argument("--source-table", default=DEFAULT_SOURCE_TABLE)
    parser.add_argument("--target-table", default=DEFAULT_TARGET_TABLE)
    parser.add_argument("--max-images", type=int, default=0, help="Limit image count for testing.")
    parser.add_argument("--note-id", action="append", default=[], help="Only process selected note_id. Can repeat.")
    parser.add_argument("--force", action="store_true", help="Re-analyze images that already succeeded.")
    parser.add_argument("--dry-run", action="store_true", help="Read DB and list workload only; do not call Ark or write.")
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--write-batch-size", type=int, default=50)
    parser.add_argument("--remote-image-url", action="store_true", help="Send image URLs directly instead of local data URLs.")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--retry-sleep", type=float, default=2.0)
    parser.add_argument("--ark-api-key", default="")
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
    args.ark_api_key = (
        getattr(args, "ark_api_key", "")
        or os.environ.get("ARK_API_KEY")
        or os.environ.get("VOLC_API_KEY")
        or values.get("ARK_API_KEY")
        or values.get("VOLC_API_KEY")
        or ARK_API_KEY
    )
    if not args.dry_run and not args.db_password:
        raise RuntimeError("Missing database password. Set PGPASSWORD or --db-password.")
    if not args.dry_run and not args.ark_api_key:
        raise RuntimeError("Missing Ark API key. Set ARK_API_KEY/VOLC_API_KEY or --ark-api-key.")
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


def ensure_target_table(conn, target_table):
    schema_name, plain_table_name = split_table_name(target_table)
    ddl = sql.SQL(
        """
CREATE SCHEMA IF NOT EXISTS {schema};

CREATE TABLE IF NOT EXISTS {table} (
  id bigserial PRIMARY KEY,
  note_id text NOT NULL,
  image_index integer NOT NULL,
  image_source text NOT NULL,
  image_url text NOT NULL,
  analysis_image_url text,
  analysis_transport text,

  note_title text,
  note_author text,
  note_publish_time timestamp,
  note_type text,

  status text NOT NULL DEFAULT 'pending',
  error text,

  image_tags jsonb,
  image_description text,
  image2_prompt text,
  visible_text text,
  business_logic text,
  emotional_hook text,

  topic_category text,
  target_persona text,
  decision_stage text,
  core_question text,
  user_pain text,
  knowledge_points jsonb,
  content_logic text,
  takeaway text,
  account_growth_role text,
  content_funnel_stage text,
  cta_strategy text,
  series_potential text,
  next_content_suggestions jsonb,
  hook_type text,
  cover_text_logic text,
  title_templates jsonb,
  reuse_method text,

  content_category text,
  subjects jsonb,
  scene text,
  visual_style text,
  style_reconstruction text,
  visual_format text,
  layout_structure text,
  typography_style text,
  color_palette text,
  information_density text,
  image2_style_prompt text,
  brand_mentions jsonb,
  risk_flags jsonb,
  confidence numeric(5,4),

  model_name text NOT NULL DEFAULT 'doubao-seed-2-0-mini-260428',
  raw_response jsonb,
  analyzed_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (note_id, image_url)
);

COMMENT ON TABLE {table} IS '小红书 GEO 笔记图片多模态分析结果';
COMMENT ON COLUMN {table}.image_tags IS '图片标签数组，用于检索、聚类和内容分析';
COMMENT ON COLUMN {table}.image_description IS '客观图片描述，保留主体、构图、文案、场景、色彩等可复原信息';
COMMENT ON COLUMN {table}.image2_prompt IS '面向 image2 复原原图/近似视觉的提示词';
COMMENT ON COLUMN {table}.visible_text IS '图片中可见文案/OCR文字及排版结构';
COMMENT ON COLUMN {table}.business_logic IS '兼容旧字段：图片里的知识组织逻辑/内容论证逻辑';
COMMENT ON COLUMN {table}.emotional_hook IS '用户为什么喜欢这类内容：解决的焦虑、情绪、欲望或身份认同';

ALTER TABLE {table}
  ADD COLUMN IF NOT EXISTS analysis_image_url text,
  ADD COLUMN IF NOT EXISTS analysis_transport text,
  ADD COLUMN IF NOT EXISTS style_reconstruction text,
  ADD COLUMN IF NOT EXISTS topic_category text,
  ADD COLUMN IF NOT EXISTS target_persona text,
  ADD COLUMN IF NOT EXISTS decision_stage text,
  ADD COLUMN IF NOT EXISTS core_question text,
  ADD COLUMN IF NOT EXISTS user_pain text,
  ADD COLUMN IF NOT EXISTS knowledge_points jsonb,
  ADD COLUMN IF NOT EXISTS content_logic text,
  ADD COLUMN IF NOT EXISTS takeaway text,
  ADD COLUMN IF NOT EXISTS account_growth_role text,
  ADD COLUMN IF NOT EXISTS content_funnel_stage text,
  ADD COLUMN IF NOT EXISTS cta_strategy text,
  ADD COLUMN IF NOT EXISTS series_potential text,
  ADD COLUMN IF NOT EXISTS next_content_suggestions jsonb,
  ADD COLUMN IF NOT EXISTS hook_type text,
  ADD COLUMN IF NOT EXISTS cover_text_logic text,
  ADD COLUMN IF NOT EXISTS title_templates jsonb,
  ADD COLUMN IF NOT EXISTS reuse_method text,
  ADD COLUMN IF NOT EXISTS visual_format text,
  ADD COLUMN IF NOT EXISTS layout_structure text,
  ADD COLUMN IF NOT EXISTS typography_style text,
  ADD COLUMN IF NOT EXISTS color_palette text,
  ADD COLUMN IF NOT EXISTS information_density text,
  ADD COLUMN IF NOT EXISTS image2_style_prompt text;

COMMENT ON COLUMN {table}.analysis_image_url IS '实际送入大模型分析的图片URL；当详情图被模型服务403时会使用Excel预览图兜底';
COMMENT ON COLUMN {table}.analysis_transport IS '图片传给模型的方式：data_url 表示本机下载后base64传入，remote_url 表示直接传URL';
COMMENT ON COLUMN {table}.style_reconstruction IS '用于复原图片风格的独立描述，包括媒介、质感、排版、色彩、光影、镜头和平台风格';
COMMENT ON COLUMN {table}.topic_category IS '起号选题大类，如GEO入门、避坑、工具测评、服务商选择、行业案例、转化方案等';
COMMENT ON COLUMN {table}.target_persona IS '内容面向的人设/受众，如认知小白、焦虑决策者、实操困惑者、ROI怀疑者等';
COMMENT ON COLUMN {table}.decision_stage IS '用户决策阶段：认知期、考虑期、决策期、行动期等';
COMMENT ON COLUMN {table}.core_question IS '这张图回答的核心问题';
COMMENT ON COLUMN {table}.user_pain IS '用户痛点、焦虑或未被解决的信息缺口';
COMMENT ON COLUMN {table}.knowledge_points IS '图片讲述的知识点数组，含知识点、解释、可复用动作';
COMMENT ON COLUMN {table}.content_logic IS '图片如何组织知识、论证观点、推动收藏/转化';
COMMENT ON COLUMN {table}.takeaway IS '用户看完能带走的东西，如框架、清单、模板、判断标准';
COMMENT ON COLUMN {table}.account_growth_role IS '这张图在起号里的作用：流量入口、信任背书、转化承接等';
COMMENT ON COLUMN {table}.content_funnel_stage IS '内容漏斗位置：曝光、教育、种草、转化、咨询承接等';
COMMENT ON COLUMN {table}.cta_strategy IS '评论区/私信/主页/收藏/转发等行动引导策略';
COMMENT ON COLUMN {table}.series_potential IS '是否适合做系列，以及系列化方向';
COMMENT ON COLUMN {table}.next_content_suggestions IS '基于这张图可延展的后续选题数组';
COMMENT ON COLUMN {table}.hook_type IS '钩子类型：反常识、避坑、焦虑、清单、对比、案例、测评、模板等';
COMMENT ON COLUMN {table}.cover_text_logic IS '封面或首屏文字为什么这样写，以及如何制造点击';
COMMENT ON COLUMN {table}.title_templates IS '可复用标题模板数组';
COMMENT ON COLUMN {table}.reuse_method IS '这张图的内容结构如何复用到新账号选题';
COMMENT ON COLUMN {table}.visual_format IS '视觉类型：表格清单、手绘思维导图、短视频封面、PPT式框架等';
COMMENT ON COLUMN {table}.layout_structure IS '版式结构：标题区、表格、卡片、矩阵、发散模块等';
COMMENT ON COLUMN {table}.typography_style IS '字体/字号/强调方式';
COMMENT ON COLUMN {table}.color_palette IS '配色结构';
COMMENT ON COLUMN {table}.information_density IS '信息密度：高密度表格、中密度卡片、低密度强钩子等';
COMMENT ON COLUMN {table}.image2_style_prompt IS '专门给 image2 使用的图片风格复原提示词';

UPDATE {table}
SET analysis_image_url = image_url
WHERE analysis_image_url IS NULL
  AND status = 'success';

CREATE INDEX IF NOT EXISTS {idx_note}
  ON {table} (note_id);
CREATE INDEX IF NOT EXISTS {idx_status}
  ON {table} (status);
CREATE INDEX IF NOT EXISTS {idx_author}
  ON {table} (note_author);
CREATE INDEX IF NOT EXISTS {idx_tags}
  ON {table} USING GIN (image_tags);
CREATE INDEX IF NOT EXISTS {idx_brand}
  ON {table} USING GIN (brand_mentions);
CREATE INDEX IF NOT EXISTS {idx_topic}
  ON {table} (topic_category);
CREATE INDEX IF NOT EXISTS {idx_persona}
  ON {table} (target_persona);
CREATE INDEX IF NOT EXISTS {idx_visual_format}
  ON {table} (visual_format);
CREATE INDEX IF NOT EXISTS {idx_knowledge_points}
  ON {table} USING GIN (knowledge_points);
"""
    ).format(
        schema=sql.Identifier(schema_name),
        table=sql.Identifier(schema_name, plain_table_name),
        idx_note=sql.Identifier(f"idx_{plain_table_name}_note_id"),
        idx_status=sql.Identifier(f"idx_{plain_table_name}_status"),
        idx_author=sql.Identifier(f"idx_{plain_table_name}_author"),
        idx_tags=sql.Identifier(f"idx_{plain_table_name}_tags"),
        idx_brand=sql.Identifier(f"idx_{plain_table_name}_brand_mentions"),
        idx_topic=sql.Identifier(f"idx_{plain_table_name}_topic_category"),
        idx_persona=sql.Identifier(f"idx_{plain_table_name}_target_persona"),
        idx_visual_format=sql.Identifier(f"idx_{plain_table_name}_visual_format"),
        idx_knowledge_points=sql.Identifier(f"idx_{plain_table_name}_knowledge_points"),
    )
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def normalize_images(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            decoded = json.loads(text)
            if isinstance(decoded, list):
                return [str(item).strip() for item in decoded if str(item).strip()]
        except json.JSONDecodeError:
            pass
        return [item.strip() for item in re.split(r"[,，\s]+", text) if item.strip()]
    return []


def add_image(images, seen, image_url, source):
    image_url = (image_url or "").strip()
    if not image_url or image_url in seen:
        return
    seen.add(image_url)
    images.append((len(images), source, image_url))


def collect_images_for_note(row):
    (
        note_id,
        title,
        nickname,
        publish_time,
        note_type,
        images_list,
        top_image,
        video_top_image,
        source_image,
    ) = row
    seen = set()
    images = []
    for image_url in normalize_images(images_list):
        add_image(images, seen, image_url, "images_list")
    add_image(images, seen, top_image, "top_image")
    add_image(images, seen, video_top_image, "video_top_image")
    if not images:
        add_image(images, seen, source_image, "source_image")
    return [
        {
            "note_id": note_id,
            "image_index": image_index,
            "image_source": image_source,
            "image_url": image_url,
            "fallback_image_url": source_image if image_index == 0 and source_image != image_url else "",
            "note_title": title,
            "note_author": nickname,
            "note_publish_time": publish_time,
            "note_type": note_type,
        }
        for image_index, image_source, image_url in images
    ]


def fetch_image_workload(conn, args):
    source_schema, source_name = split_table_name(args.source_table)
    where_parts = [
        sql.SQL("detail_status = 'success'"),
        sql.SQL("COALESCE(is_show, true) = true"),
        sql.SQL("COALESCE(NULLIF(trim(title), ''), NULLIF(trim(content), '')) IS NOT NULL"),
    ]
    params = []
    if args.note_id:
        where_parts.append(sql.SQL("note_id = ANY(%s)"))
        params.append(args.note_id)
    select_sql = sql.SQL(
        """
SELECT note_id, title, nickname, publish_time, note_type, images_list,
       top_image, video_top_image, source_image
FROM {source_table}
WHERE {where_clause}
ORDER BY publish_time DESC NULLS LAST, note_id
"""
    ).format(
        source_table=sql.Identifier(source_schema, source_name),
        where_clause=sql.SQL(" AND ").join(where_parts),
    )
    image_rows = []
    with conn.cursor() as cur:
        cur.execute(select_sql, params)
        for row in cur.fetchall():
            image_rows.extend(collect_images_for_note(row))

    if not args.force and image_rows:
        target_schema, target_name = split_table_name(args.target_table)
        existing_sql = sql.SQL(
            """
SELECT note_id, image_url
FROM {target_table}
WHERE status = 'success'
  AND knowledge_points IS NOT NULL
  AND jsonb_typeof(knowledge_points) = 'array'
  AND jsonb_array_length(knowledge_points) > 0
  AND COALESCE(image2_style_prompt, '') <> ''
"""
        ).format(target_table=sql.Identifier(target_schema, target_name))
        with conn.cursor() as cur:
            try:
                cur.execute(existing_sql)
                existing = {(row[0], row[1]) for row in cur.fetchall()}
            except psycopg2.errors.UndefinedTable:
                conn.rollback()
                existing = set()
        image_rows = [row for row in image_rows if (row["note_id"], row["image_url"]) not in existing]

    if args.max_images:
        image_rows = image_rows[: args.max_images]
    return image_rows


def build_prompt(image_task):
    title = image_task.get("note_title") or ""
    author = image_task.get("note_author") or ""
    note_type = image_task.get("note_type") or ""
    return f"""
你是小红书 GEO 账号操盘手、爆文拆解师、内容产品经理和 image2 提示词工程师。请关闭推理展示，只输出最终 JSON，不要 Markdown，不要代码块，不要解释。

任务：这不是普通看图描述。你的目标是把输入图片拆解成“未来起号可复用的内容运营资产”：
1. 读出图片里真正讲了什么知识点、方法论、清单、框架或案例。
2. 判断它服务于账号增长漏斗的哪个环节：曝光、教育、信任、转化、评论区引流、私信咨询等。
3. 提炼它的选题、人群、钩子、内容结构、可复用标题和后续系列选题。
4. 详细拆解图片风格，输出可给 image2 复原类似风格的提示词。

不要臆造图片里不存在的具体数据、品牌、机构、人物身份或截图来源；无法确定时写“无法确定”。如果图片文字较多，尽量读取并结构化整理。

已知笔记上下文：
- 标题：{title}
- 作者：{author}
- 笔记类型：{note_type}

请输出严格 JSON，字段如下：
{{
  "image_tags": ["8到15个中文标签，覆盖选题、受众、人群阶段、钩子、格式、账号增长用途"],
  "visible_text": "图片中可见文案/OCR文字，尽量逐行保留；没有文字则为空字符串",

  "topic_category": "选题大类，如GEO入门/避坑/工具测评/服务商选择/行业案例/转化方案/老板决策/法律合规/SEO转GEO/其他",
  "target_persona": "目标人设或受众，如认知小白/焦虑决策者/实操困惑者/垂直探路者/ROI怀疑者/老板/运营/服务商/无法确定",
  "decision_stage": "认知期/考虑期/决策期/行动期/转化期/无法确定",
  "core_question": "这张图正在回答的一个核心问题，用用户口吻写",
  "user_pain": "这张图击中的用户痛点、焦虑、犹豫、好奇或决策障碍",

  "knowledge_points": [
    {{
      "point": "图片中讲述的知识点或方法论",
      "explanation": "这个知识点是什么意思，尽量结合图片原文",
      "operation": "用户或账号运营者可以如何照着做",
      "reuse_angle": "这个知识点未来可以拆成什么短内容/长内容/系列内容"
    }}
  ],
  "content_logic": "这张图如何组织知识：例如先抛误区→给结论→拆步骤→给证据→引导收藏/咨询。重点讲知识结构，不要泛泛写吸引点击",
  "business_logic": "兼容旧字段：同 content_logic，用于说明图片里的知识组织逻辑和内容运营逻辑",
  "takeaway": "用户看完能带走什么：清单/表格/框架/模板/判断标准/案例认知/行动路径",

  "account_growth_role": "这张图在起号里的作用：流量入口/信任背书/教育种草/转化承接/评论区引流/私信咨询入口/系列内容母题",
  "content_funnel_stage": "曝光/教育/信任/转化/复盘/咨询承接/无法确定",
  "cta_strategy": "它适合怎么设计行动引导：评论区钩子/引导看主页长文/私信关键词/收藏自查/转发给老板/预约咨询等",
  "series_potential": "是否适合做成系列，以及系列化方向",
  "next_content_suggestions": ["基于这张图可延展的3到8个后续选题，标题化表达"],

  "hook_type": "钩子类型：反常识/避坑/焦虑/清单/对比/案例/测评/模板/热点/权威背书/利益承诺/其他",
  "cover_text_logic": "封面或首屏文字为什么这样写：它如何制造点击、降低理解成本或建立可信度",
  "title_templates": ["3到8个可复用标题模板，保持小红书口吻"],
  "reuse_method": "这张图的内容结构如何复用到新GEO账号内容产出，例如长线内容如何拆短线、如何做流量入口和信任背书",

  "image_description": "200到500字中文客观视觉描述，说明画面主体、信息区域、文字层级、排版关系和视觉元素",
  "content_category": "兼容旧字段：同 topic_category 或更粗分类",
  "subjects": ["图片中的主要对象、概念或信息模块"],
  "scene": "画面场景或信息呈现场景，如表格清单/手绘笔记/人物口播封面/新闻截图/聊天截图等",
  "visual_style": "短风格标签",
  "visual_format": "视觉类型：表格清单/手绘思维导图/短视频封面/PPT式框架/聊天截图/新闻截图/长图清单/流程图/矩阵表/其他",
  "layout_structure": "详细描述版式结构：标题区、表格列数、卡片布局、左右结构、中心发散、分区、边框、留白、阅读顺序",
  "typography_style": "字体/字号/强调方式：如宋体大标题、红黑强调、粗体无衬线、手写体、圆角标签、项目符号等",
  "color_palette": "配色：背景色、主色、强调色、分区色，以及整体视觉情绪",
  "information_density": "低密度强钩子/中密度卡片/高密度表格/超高密度长图，并说明原因",
  "style_reconstruction": "给设计师看的风格复原描述：媒介、画幅、平台感、排版密度、字体气质、配色、边框、卡片、表格、图标、留白、质感、清晰度",
  "image2_style_prompt": "可直接给 image2 的中文风格提示词，只描述风格和版式，不要求生成原图具体文字；包括画幅比例、背景、布局、字体风格、颜色、表格/卡片/手写元素、信息密度、质感、留白和避免项",

  "emotional_hook": "用户为什么喜欢这类内容：它解决何种焦虑、好奇、身份认同、效率诉求、决策压力或转化顾虑",
  "risk_flags": ["可能的误导、夸大、侵权、医疗法律金融等风险，没有则空数组"],
  "confidence": 0.0
}}
""".strip()


def extract_response_text(payload):
    if not isinstance(payload, dict):
        return ""
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    parts = []
    for output in payload.get("output") or []:
        if not isinstance(output, dict):
            continue
        for content in output.get("content") or []:
            if not isinstance(content, dict):
                continue
            if isinstance(content.get("text"), str):
                parts.append(content["text"])
            elif isinstance(content.get("output_text"), str):
                parts.append(content["output_text"])
    return "\n".join(parts).strip()


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


def should_try_fallback(error):
    text = str(error)
    return (
        "status code: 403" in text
        or "Error while downloading" in text
        or '"param":"image_url"' in text
        or "param\":\"image_url" in text
    )


def download_image_as_data_url(args, image_url, image_task=None):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36",
        "Referer": "https://www.xiaohongshu.com/",
    }
    response = ops.call_api(
        "GET",
        image_url,
        provider_code="xhs_image_download",
        operation="image_download_for_vision",
        note_id=(image_task or {}).get("note_id"),
        image_url=image_url,
        attempt_no=1,
        max_attempts=1,
        metadata={"image_index": (image_task or {}).get("image_index")},
        headers=headers,
        timeout=60,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"image download HTTP {response.status_code}: {response.text[:300]}")
    if not response.content:
        raise RuntimeError("image download returned empty body")

    content_type = response.headers.get("content-type") or "image/jpeg"
    content_type = content_type.split(";", 1)[0].strip()
    if not content_type.startswith("image/"):
        content_type = "image/jpeg"
    encoded = base64.b64encode(response.content).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def image_input_for_model(args, image_url, image_task=None):
    if args.remote_image_url:
        return image_url, "remote_url"
    return download_image_as_data_url(args, image_url, image_task=image_task), "data_url"


def analyze_image(args, image_task):
    candidates = [image_task["image_url"]]
    fallback_url = (image_task.get("fallback_image_url") or "").strip()
    if fallback_url and fallback_url not in candidates:
        candidates.append(fallback_url)

    body = {
        "model": ARK_MODEL,
        "thinking": {"type": "disabled"},
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_image", "image_url": image_task["image_url"]},
                    {"type": "input_text", "text": build_prompt(image_task)},
                ],
            }
        ],
    }
    headers = {
        "Authorization": f"Bearer {args.ark_api_key}",
        "Content-Type": "application/json",
    }
    last_error = None
    last_analysis_url = image_task["image_url"]
    last_transport = "remote_url" if args.remote_image_url else "data_url"
    for image_url in candidates:
        last_analysis_url = image_url
        try:
            model_image_url, transport = image_input_for_model(args, image_url, image_task=image_task)
            last_transport = transport
        except Exception as exc:
            last_error = exc
            if image_url != candidates[-1]:
                continue
            model_image_url = image_url
            last_transport = "remote_url"
        body["input"][0]["content"][0]["image_url"] = model_image_url
        for attempt in range(args.retries + 1):
            try:
                response = ops.call_api(
                    "POST",
                    ARK_URL,
                    provider_code="volcengine_ark_vision",
                    operation="image_analysis",
                    model_name=ARK_MODEL,
                    note_id=image_task["note_id"],
                    image_url=image_url,
                    attempt_no=attempt + 1,
                    max_attempts=args.retries + 1,
                    metadata={
                        "image_index": image_task.get("image_index"),
                        "image_source": image_task.get("image_source"),
                        "transport": last_transport,
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
                return {
                    **image_task,
                    "analysis_image_url": image_url,
                    "analysis_transport": last_transport,
                    "status": "success",
                    "error": None,
                    "analysis": parsed,
                    "raw_response": payload,
                }
            except Exception as exc:
                last_error = exc
                if should_try_fallback(exc) and image_url != candidates[-1]:
                    break
                if attempt >= args.retries:
                    break
                time.sleep(args.retry_sleep * (attempt + 1))
    return {
        **image_task,
        "analysis_image_url": last_analysis_url,
        "analysis_transport": last_transport,
        "status": "failed",
        "error": str(last_error),
        "analysis": {},
        "raw_response": None,
    }


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def as_confidence(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return 0
    if number > 1:
        return 1
    return number


def upsert_results(conn, target_table, results):
    if not results:
        return 0
    schema_name, plain_table_name = split_table_name(target_table)
    columns = [
        "note_id",
        "image_index",
        "image_source",
        "image_url",
        "analysis_image_url",
        "analysis_transport",
        "note_title",
        "note_author",
        "note_publish_time",
        "note_type",
        "status",
        "error",
        "image_tags",
        "image_description",
        "image2_prompt",
        "visible_text",
        "business_logic",
        "emotional_hook",
        "topic_category",
        "target_persona",
        "decision_stage",
        "core_question",
        "user_pain",
        "knowledge_points",
        "content_logic",
        "takeaway",
        "account_growth_role",
        "content_funnel_stage",
        "cta_strategy",
        "series_potential",
        "next_content_suggestions",
        "hook_type",
        "cover_text_logic",
        "title_templates",
        "reuse_method",
        "content_category",
        "subjects",
        "scene",
        "visual_style",
        "style_reconstruction",
        "visual_format",
        "layout_structure",
        "typography_style",
        "color_palette",
        "information_density",
        "image2_style_prompt",
        "brand_mentions",
        "risk_flags",
        "confidence",
        "model_name",
        "raw_response",
        "analyzed_at",
    ]
    rows = []
    for result in results:
        analysis = result.get("analysis") or {}
        rows.append((
            result["note_id"],
            result["image_index"],
            result["image_source"],
            result["image_url"],
            result.get("analysis_image_url") or result["image_url"],
            result.get("analysis_transport"),
            result.get("note_title"),
            result.get("note_author"),
            result.get("note_publish_time"),
            result.get("note_type"),
            result["status"],
            result.get("error"),
            Json(as_list(analysis.get("image_tags"))),
            analysis.get("image_description"),
            analysis.get("image2_prompt"),
            analysis.get("visible_text"),
            analysis.get("business_logic") or analysis.get("content_logic"),
            analysis.get("emotional_hook"),
            analysis.get("topic_category"),
            analysis.get("target_persona"),
            analysis.get("decision_stage"),
            analysis.get("core_question"),
            analysis.get("user_pain"),
            Json(as_list(analysis.get("knowledge_points"))),
            analysis.get("content_logic"),
            analysis.get("takeaway"),
            analysis.get("account_growth_role"),
            analysis.get("content_funnel_stage"),
            analysis.get("cta_strategy"),
            analysis.get("series_potential"),
            Json(as_list(analysis.get("next_content_suggestions"))),
            analysis.get("hook_type"),
            analysis.get("cover_text_logic"),
            Json(as_list(analysis.get("title_templates"))),
            analysis.get("reuse_method"),
            analysis.get("content_category") or analysis.get("topic_category"),
            Json(as_list(analysis.get("subjects"))),
            analysis.get("scene"),
            analysis.get("visual_style"),
            analysis.get("style_reconstruction"),
            analysis.get("visual_format"),
            analysis.get("layout_structure"),
            analysis.get("typography_style"),
            analysis.get("color_palette"),
            analysis.get("information_density"),
            analysis.get("image2_style_prompt"),
            Json([]),
            Json(as_list(analysis.get("risk_flags"))),
            as_confidence(analysis.get("confidence")),
            ARK_MODEL,
            Json(result.get("raw_response")),
            sql.SQL("CURRENT_TIMESTAMP"),
        ))

    # execute_values cannot adapt SQL snippets inside row values. Use now() in SQL instead.
    rows = [row[:-1] for row in rows]
    insert_sql = sql.SQL(
        """
INSERT INTO {table} (
  note_id, image_index, image_source, image_url, analysis_image_url, analysis_transport,
  note_title, note_author,
  note_publish_time, note_type, status, error, image_tags, image_description,
  image2_prompt, visible_text, business_logic, emotional_hook, topic_category,
  target_persona, decision_stage, core_question, user_pain, knowledge_points,
  content_logic, takeaway, account_growth_role, content_funnel_stage, cta_strategy,
  series_potential, next_content_suggestions, hook_type, cover_text_logic,
  title_templates, reuse_method, content_category, subjects, scene, visual_style,
  style_reconstruction, visual_format, layout_structure, typography_style,
  color_palette, information_density, image2_style_prompt, brand_mentions,
  risk_flags, confidence,
  model_name, raw_response, analyzed_at
) VALUES %s
ON CONFLICT (note_id, image_url) DO UPDATE SET
  image_index = EXCLUDED.image_index,
  image_source = EXCLUDED.image_source,
  analysis_image_url = EXCLUDED.analysis_image_url,
  analysis_transport = EXCLUDED.analysis_transport,
  note_title = EXCLUDED.note_title,
  note_author = EXCLUDED.note_author,
  note_publish_time = EXCLUDED.note_publish_time,
  note_type = EXCLUDED.note_type,
  status = EXCLUDED.status,
  error = EXCLUDED.error,
  image_tags = EXCLUDED.image_tags,
  image_description = EXCLUDED.image_description,
  image2_prompt = EXCLUDED.image2_prompt,
  visible_text = EXCLUDED.visible_text,
  business_logic = EXCLUDED.business_logic,
  emotional_hook = EXCLUDED.emotional_hook,
  topic_category = EXCLUDED.topic_category,
  target_persona = EXCLUDED.target_persona,
  decision_stage = EXCLUDED.decision_stage,
  core_question = EXCLUDED.core_question,
  user_pain = EXCLUDED.user_pain,
  knowledge_points = EXCLUDED.knowledge_points,
  content_logic = EXCLUDED.content_logic,
  takeaway = EXCLUDED.takeaway,
  account_growth_role = EXCLUDED.account_growth_role,
  content_funnel_stage = EXCLUDED.content_funnel_stage,
  cta_strategy = EXCLUDED.cta_strategy,
  series_potential = EXCLUDED.series_potential,
  next_content_suggestions = EXCLUDED.next_content_suggestions,
  hook_type = EXCLUDED.hook_type,
  cover_text_logic = EXCLUDED.cover_text_logic,
  title_templates = EXCLUDED.title_templates,
  reuse_method = EXCLUDED.reuse_method,
  content_category = EXCLUDED.content_category,
  subjects = EXCLUDED.subjects,
  scene = EXCLUDED.scene,
  visual_style = EXCLUDED.visual_style,
  style_reconstruction = EXCLUDED.style_reconstruction,
  visual_format = EXCLUDED.visual_format,
  layout_structure = EXCLUDED.layout_structure,
  typography_style = EXCLUDED.typography_style,
  color_palette = EXCLUDED.color_palette,
  information_density = EXCLUDED.information_density,
  image2_style_prompt = EXCLUDED.image2_style_prompt,
  brand_mentions = EXCLUDED.brand_mentions,
  risk_flags = EXCLUDED.risk_flags,
  confidence = EXCLUDED.confidence,
  model_name = EXCLUDED.model_name,
  raw_response = EXCLUDED.raw_response,
  analyzed_at = EXCLUDED.analyzed_at,
  updated_at = CURRENT_TIMESTAMP
"""
    ).format(table=sql.Identifier(schema_name, plain_table_name))
    template = "(" + ",".join(["%s"] * 51) + ",CURRENT_TIMESTAMP)"
    with conn.cursor() as cur:
        execute_values(cur, insert_sql, rows, template=template, page_size=200)
    conn.commit()
    return len(rows)


def analyze_images(args, image_rows):
    results = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {executor.submit(analyze_image, args, row): row for row in image_rows}
        for index, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            if index == 1 or index % 10 == 0 or index == len(image_rows):
                success = sum(1 for item in results if item["status"] == "success")
                failed = sum(1 for item in results if item["status"] == "failed")
                print(f"images {index}/{len(image_rows)} success={success} failed={failed}")
    return results


def analyze_images_and_upsert(conn, args, image_rows):
    results = []
    pending = []
    written = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {executor.submit(analyze_image, args, row): row for row in image_rows}
        for index, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            pending.append(result)

            if len(pending) >= args.write_batch_size:
                written += upsert_results(conn, args.target_table, pending)
                pending = []

            if index == 1 or index % 10 == 0 or index == len(image_rows):
                success = sum(1 for item in results if item["status"] == "success")
                failed = sum(1 for item in results if item["status"] == "failed")
                print(f"images {index}/{len(image_rows)} success={success} failed={failed} written={written}", flush=True)

        if pending:
            written += upsert_results(conn, args.target_table, pending)
    return results, written


def print_summary(target_table, image_rows, results, written=0):
    print(json.dumps({
        "target_table": target_table,
        "images_to_process": len(image_rows),
        "success": sum(1 for result in results if result["status"] == "success"),
        "failed": sum(1 for result in results if result["status"] == "failed"),
        "written": written,
    }, ensure_ascii=False, indent=2))


def main():
    args = enrich_args(parse_args())
    ops.configure_from_args(args)
    script_run_id = ops.start_script_run(
        "analyze_xhs_geo_note_images",
        trigger_type=os.environ.get("GEO_OPS_TRIGGER_TYPE") or "manual",
        command=sys.argv,
        args=args,
    )
    image_rows = []
    results = []
    written = 0
    conn = db_connect(args)
    try:
        ensure_target_table(conn, args.target_table)
        image_rows = fetch_image_workload(conn, args)
        print(f"images_to_process={len(image_rows)} source={args.source_table} target={args.target_table}")
        if args.dry_run:
            sample = image_rows[:5]
            print(json.dumps(sample, ensure_ascii=False, default=str, indent=2))
            ops.finish_script_run(
                script_run_id,
                status="success",
                processed_count=len(image_rows),
                skipped_count=len(image_rows),
                summary={"dry_run": True, "target_table": args.target_table},
            )
            return
        if not image_rows:
            print_summary(args.target_table, image_rows, [], 0)
            ops.finish_script_run(
                script_run_id,
                status="success",
                processed_count=0,
                success_count=0,
                failed_count=0,
                skipped_count=0,
                summary={"target_table": args.target_table, "images_to_process": 0},
            )
            return
        results, written = analyze_images_and_upsert(conn, args, image_rows)
    except Exception as exc:
        ops.finish_script_run(
            script_run_id,
            status="failed",
            exit_code=1,
            processed_count=len(image_rows) if image_rows else None,
            success_count=sum(1 for result in results if result.get("status") == "success"),
            failed_count=sum(1 for result in results if result.get("status") == "failed"),
            error_message=str(exc),
            summary=ops.exception_summary(exc),
        )
        raise
    finally:
        conn.close()
    print_summary(args.target_table, image_rows, results, written)
    ops.finish_script_run(
        script_run_id,
        status="success",
        processed_count=len(image_rows),
        success_count=sum(1 for result in results if result["status"] == "success"),
        failed_count=sum(1 for result in results if result["status"] == "failed"),
        summary={"target_table": args.target_table, "written": written},
    )


if __name__ == "__main__":
    main()
