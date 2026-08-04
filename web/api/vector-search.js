const { Pool } = require("pg");
const { requireAuth } = require("./_auth");

let pool;

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getPoolConfig() {
  const ssl = process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: 2,
      idleTimeoutMillis: 30000,
    };
  }

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

function normalizeLimit(value) {
  const parsed = Number(value || 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(20, Math.max(1, Math.floor(parsed)));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { success: false, error: "仅支持 POST 请求" });
    return;
  }

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const { query, limit } = await readJsonBody(req);
    const embeddingUrl = process.env.EMBEDDING_API_URL || "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal";
    const embeddingKey = process.env.EMBEDDING_API_KEY;
    const embeddingModel = process.env.EMBEDDING_MODEL || "doubao-embedding-vision-251215";

    if (!query || typeof query !== "string") {
      sendJson(res, 400, { success: false, error: "缺少查询内容" });
      return;
    }

    if (!embeddingKey) {
      sendJson(res, 500, { success: false, error: "服务端缺少 EMBEDDING_API_KEY" });
      return;
    }

    const dbPool = getPool();
    if (!dbPool) {
      sendJson(res, 500, { success: false, error: "服务端缺少数据库环境变量" });
      return;
    }

    const embeddingRes = await fetch(embeddingUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${embeddingKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: [{ type: "text", text: query }],
      }),
    });

    if (!embeddingRes.ok) {
      const detail = await embeddingRes.text();
      sendJson(res, 500, {
        success: false,
        error: `Embedding API 错误: ${embeddingRes.status}`,
        detail,
      });
      return;
    }

    const embeddingData = await embeddingRes.json();
    const embeddingPayload = embeddingData?.data;
    const queryVector = Array.isArray(embeddingPayload)
      ? embeddingPayload[0]?.embedding
      : embeddingPayload?.embedding;

    if (!Array.isArray(queryVector) || !queryVector.length) {
      sendJson(res, 500, { success: false, error: "Embedding API 未返回有效向量" });
      return;
    }

    const vectorStr = `[${queryVector.join(",")}]`;
    const sql = `
      SELECT
        v.asset_id,
        v.note_id,
        v.combined_text,
        COALESCE(
          NULLIF(a.title, ''),
          NULLIF(n.title, ''),
          NULLIF(n.source_title, ''),
          NULLIF(left(trim(regexp_replace(COALESCE(a.content, n.content, n.source_content, ''), '[[:space:]]+', ' ', 'g')), 80), ''),
          v.note_id
        ) AS title,
        a.author_nickname,
        a.explosion_level,
        a.fresh_hot_score,
        a.interaction_score,
        a.core_topic_category,
        a.primary_target_persona,
        a.primary_industry,
        v.content_vector <=> $1::halfvec AS distance
      FROM public.geo_note_content_asset_vectors v
      LEFT JOIN public.geo_note_content_assets a ON v.asset_id = a.asset_id
      LEFT JOIN public.note_details n ON n.note_id = v.note_id
      ORDER BY v.content_vector <=> $1::halfvec
      LIMIT $2
    `;

    const result = await dbPool.query(sql, [vectorStr, normalizeLimit(limit)]);

    sendJson(res, 200, {
      success: true,
      query,
      results: result.rows,
      rowCount: result.rowCount,
    });
  } catch (err) {
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
