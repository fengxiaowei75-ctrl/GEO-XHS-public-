const { Pool } = require("pg");
const { requireAuth } = require("./_auth");

let pool;
const MAX_IMAGE_PROMPTS = 10;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error("请求体过大");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getPoolConfig() {
  const ssl = process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false;
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl, max: 2, idleTimeoutMillis: 30000 };

  const requiredEnv = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  if (!requiredEnv.every((key) => Boolean(process.env[key]))) return null;
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl,
    max: 2,
    idleTimeoutMillis: 30000,
  };
}

function getPool() {
  const config = getPoolConfig();
  if (!config) return null;
  if (!pool) pool = new Pool(config);
  return pool;
}

function cleanNoteId(value) {
  return String(value || "")
    .trim()
    .split(/[·\s]+/)[0]
    .trim();
}

function cleanText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeKnowledgePoints(value) {
  if (!value) return "";
  const rows = Array.isArray(value) ? value : [value];
  return rows
    .map((item) => {
      if (!item || typeof item !== "object") return String(item || "").trim();
      return [item.point, item.explanation, item.reuse_angle].filter(Boolean).join("：");
    })
    .filter(Boolean)
    .join("\n");
}

function buildImagePrompt(row) {
  return [
    ["原图复写提示词", row.image2_prompt],
    ["原图风格提示词", row.image2_style_prompt],
    ["可见文字/OCR", row.visible_text],
    ["封面/首屏文字逻辑", row.cover_text_logic],
    ["版式结构", row.layout_structure],
    ["视觉类型", row.visual_format],
    ["字体/强调方式", row.typography_style],
    ["配色结构", row.color_palette],
    ["信息密度", row.information_density],
  ]
    .map(([label, value]) => {
      const text = cleanText(value, 1200);
      return text ? `【${label}】\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeImagePrompts(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item, index) => {
      const prompt = cleanText(item.prompt || buildImagePrompt(item), 5000);
      if (!prompt) return null;
      return {
        slot: Number(item.slot || index + 1),
        imageIndex: Number.isFinite(Number(item.image_index)) ? Number(item.image_index) : Number(item.slot || index + 1) - 1,
        imageUrl: cleanText(item.image_url, 2000),
        prompt,
        image2Prompt: cleanText(item.image2_prompt, 2500),
        image2StylePrompt: cleanText(item.image2_style_prompt, 1600),
        colorPalette: cleanText(item.color_palette, 800),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_IMAGE_PROMPTS);
}

function notePayload(row) {
  const imagePrompts = normalizeImagePrompts(row.image_prompts);
  const sourceImageCount = Number(row.source_image_count || 0);
  const suggestedImageCount = Math.max(1, Math.min(MAX_IMAGE_PROMPTS, imagePrompts.length || sourceImageCount || 1));
  const visualPromptParts = imagePrompts.length
    ? [row.visual_group_style_prompt]
    : [row.visual_group_style_prompt, row.cover_text_logic, row.layout_structure];
  return {
    note_id: row.note_id,
    title: row.title || "",
    content: row.content || "",
    target_persona: row.primary_target_persona || "",
    user_pain: [row.true_pain_label, row.pain_description, row.pain_evidence].filter(Boolean).join("\n"),
    business_logic: row.business_logic || row.content_logic || "",
    business_knowledge: normalizeKnowledgePoints(row.knowledge_points),
    visual_prompt: visualPromptParts.filter(Boolean).join("\n"),
    image_prompts: imagePrompts,
    image_prompt_count: imagePrompts.length,
    source_image_count: sourceImageCount,
    analyzed_image_count: Number(row.analyzed_image_count || imagePrompts.length || 0),
    suggested_image_count: suggestedImageCount,
    image_prompt_warning: row.image_prompt_warning || "",
    source: row.asset_id ? "geo_note_content_assets" : "note_details",
  };
}

async function loadImagePrompts(client, noteId) {
  try {
    const { rows } = await client.query(
      `
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'slot', image_index + 1,
            'image_index', image_index,
            'image_url', image_url,
            'image2_prompt', image2_prompt,
            'image2_style_prompt', image2_style_prompt,
            'visible_text', visible_text,
            'cover_text_logic', cover_text_logic,
            'layout_structure', layout_structure,
            'visual_format', visual_format,
            'typography_style', typography_style,
            'color_palette', color_palette,
            'information_density', information_density
          )
          ORDER BY image_index
        ) AS image_prompts
      FROM (
        SELECT DISTINCT ON (image_index)
          image_index,
          image_url,
          image2_prompt,
          image2_style_prompt,
          visible_text,
          cover_text_logic,
          layout_structure,
          visual_format,
          typography_style,
          color_palette,
          information_density,
          analyzed_at,
          updated_at,
          id
        FROM public.image_analysis
        WHERE note_id = $1
          AND status = 'success'
          AND COALESCE(
            NULLIF(trim(image2_prompt), ''),
            NULLIF(trim(image2_style_prompt), ''),
            NULLIF(trim(layout_structure), ''),
            NULLIF(trim(cover_text_logic), '')
          ) IS NOT NULL
        ORDER BY image_index, analyzed_at DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC
        LIMIT 10
      ) p
      `,
      [noteId],
    );
    return { image_prompts: rows[0]?.image_prompts || [], image_prompt_warning: "" };
  } catch (error) {
    return { image_prompts: [], image_prompt_warning: error.message || "逐图提示词读取失败" };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
    return;
  }

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const { noteId } = await readJsonBody(req);
    const note_id = cleanNoteId(noteId);
    if (!note_id) {
      sendJson(res, 400, { ok: false, error: "缺少 noteId" });
      return;
    }
    if (!/^[A-Za-z0-9_-]{6,96}$/.test(note_id)) {
      sendJson(res, 400, { ok: false, error: "noteId 格式不合法" });
      return;
    }

    const dbPool = getPool();
    if (!dbPool) {
      sendJson(res, 500, { ok: false, error: "服务端缺少数据库环境变量" });
      return;
    }

    const client = await dbPool.connect();
    try {
      const { rows } = await client.query(
        `
        WITH latest_asset AS (
          SELECT *
          FROM public.geo_note_content_assets
          WHERE note_id = $1
          ORDER BY generated_at DESC NULLS LAST, updated_at DESC NULLS LAST, asset_id DESC
          LIMIT 1
        )
        SELECT
          COALESCE(a.note_id, n.note_id) AS note_id,
          a.asset_id,
          COALESCE(NULLIF(a.title, ''), NULLIF(n.title, ''), NULLIF(n.source_title, ''), COALESCE(a.note_id, n.note_id)) AS title,
          left(trim(regexp_replace(COALESCE(a.content, n.content, n.source_content, ''), '[[:space:]]+', ' ', 'g')), 4000) AS content,
          COALESCE(NULLIF(trim(a.primary_target_persona), ''), array_to_string(a.target_persona_tags, ' / '), '') AS primary_target_persona,
          a.true_pain_label,
          a.pain_description,
          a.pain_evidence,
          a.business_logic,
          a.content_logic,
          a.knowledge_points,
          a.visual_group_style_prompt,
          a.cover_text_logic,
          a.layout_structure,
          a.source_image_count,
          a.analyzed_image_count
        FROM public.note_details n
        FULL JOIN latest_asset a ON a.note_id = n.note_id
        WHERE COALESCE(a.note_id, n.note_id) = $1
        LIMIT 1
        `,
        [note_id],
      );

      if (!rows.length) {
        sendJson(res, 404, { ok: false, error: "没有找到这个 note_id" });
        return;
      }

      const imagePromptResult = await loadImagePrompts(client, note_id);
      sendJson(res, 200, { ok: true, note: notePayload({ ...rows[0], ...imagePromptResult }) });
    } finally {
      client.release();
    }
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "读取笔记失败" });
  }
};
