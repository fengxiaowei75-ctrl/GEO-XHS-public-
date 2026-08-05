const { Pool } = require("pg");
const { requireAuth } = require("./_auth");

let pool;

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
  return String(value || "").trim();
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

function notePayload(row) {
  return {
    note_id: row.note_id,
    title: row.title || "",
    content: row.content || "",
    target_persona: row.primary_target_persona || "",
    user_pain: [row.true_pain_label, row.pain_description, row.pain_evidence].filter(Boolean).join("\n"),
    business_logic: row.business_logic || row.content_logic || "",
    business_knowledge: normalizeKnowledgePoints(row.knowledge_points),
    visual_prompt: [row.visual_group_style_prompt, row.cover_text_logic, row.layout_structure].filter(Boolean).join("\n"),
    source: row.asset_id ? "geo_note_content_assets" : "note_details",
  };
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
          a.layout_structure
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

      sendJson(res, 200, { ok: true, note: notePayload(rows[0]) });
    } finally {
      client.release();
    }
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "读取笔记失败" });
  }
};
