const { Pool } = require("pg");
const { requireAuth } = require("./_auth");

const PROVIDER_CODE = "volcengine_ark_image_generation";
const DEFAULT_IMAGE_API_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_IMAGE_MODEL = "doubao-seedream-4-5-251128";

let pool;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes = 12 * 1024 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error("请求体过大，垫图请控制在 8MB 以内");
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

function cleanText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function buildPrompt(input) {
  return [
    "请基于下面的小红书笔记内容资产和垫图，生成一张适合作为GEO内容运营素材的竖版图片。",
    "要求：保留垫图中可复用的构图/视觉气质，但不要复制原品牌Logo、商标、水印或可识别个人隐私信息。",
    "画面需要专业、信息层级清晰，适合小红书知识内容首图或正文配图；如出现中文文字，必须简洁、清晰、无错别字。",
    "",
    "【笔记标题】",
    cleanText(input.title, 500),
    "",
    "【笔记文案】",
    cleanText(input.content, 3500),
    "",
    "【目标人群画像】",
    cleanText(input.targetPersona, 1000),
    "",
    "【用户痛点】",
    cleanText(input.userPain, 1500),
    "",
    "【业务逻辑】",
    cleanText(input.businessLogic, 1500),
    "",
    "【业务知识点】",
    cleanText(input.businessKnowledge, 1800),
    "",
    "【本次生图提示词】",
    cleanText(input.imagePrompt, 1800),
  ]
    .filter((item) => item !== "")
    .join("\n");
}

function extractImages(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map((item, index) => {
      if (item?.url) return { id: `url-${index}`, url: item.url };
      if (item?.b64_json) return { id: `b64-${index}`, url: `data:image/png;base64,${item.b64_json}` };
      return null;
    })
    .filter(Boolean);
}

async function lookupModelConfig(client, model) {
  if (!client) return {};
  try {
    const { rows } = await client.query(
      `
      SELECT
        m.model_config_id,
        c.credential_id
      FROM public.geo_ops_model_configs m
      LEFT JOIN public.geo_ops_credentials c
        ON c.provider_code = m.provider_code
       AND c.status = 'active'
       AND c.is_default = true
      WHERE m.provider_code = $1
        AND m.model_name = $2
      ORDER BY m.is_default DESC, m.model_config_id DESC
      LIMIT 1
      `,
      [PROVIDER_CODE, model],
    );
    return rows[0] || {};
  } catch {
    return {};
  }
}

async function writeApiLog(client, record) {
  if (!client) return "";
  try {
    await client.query(
      `
      INSERT INTO public.geo_ops_api_call_logs (
        trace_id, provider_code, model_config_id, credential_id, script_key, operation, status,
        http_method, request_host, request_path, http_status, attempt_no, max_attempts, note_id,
        started_at, finished_at, latency_ms, request_bytes, response_bytes,
        estimated_units, error_code, error_message, raw_usage, metadata
      )
      VALUES (
        $1, $2, $3, $4, NULL, $5, $6,
        $7, $8, $9, $10, 1, 1, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20::jsonb, $21::jsonb
      )
      `,
      [
        record.traceId,
        PROVIDER_CODE,
        record.modelConfigId || null,
        record.credentialId || null,
        "image_generation_workflow",
        record.status,
        "POST",
        record.requestHost,
        record.requestPath,
        record.httpStatus || null,
        record.noteId || null,
        record.startedAt,
        record.finishedAt,
        record.latencyMs,
        record.requestBytes,
        record.responseBytes,
        record.estimatedUnits,
        record.errorCode || null,
        record.errorMessage || null,
        JSON.stringify(record.rawUsage || {}),
        JSON.stringify(record.metadata || {}),
      ],
    );
    return "";
  } catch (error) {
    return error.message || "调用日志写入失败";
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
    return;
  }

  const startedAt = new Date();
  const startedMono = Date.now();
  let client = null;

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const input = await readJsonBody(req);
    const apiKey = process.env.IMAGE_GENERATION_API_KEY || process.env.ARK_API_KEY;
    const apiUrl = process.env.IMAGE_GENERATION_API_URL || DEFAULT_IMAGE_API_URL;
    const model = process.env.IMAGE_GENERATION_MODEL || DEFAULT_IMAGE_MODEL;
    const size = cleanText(input.size, 32) || process.env.IMAGE_GENERATION_SIZE || "2K";
    const prompt = buildPrompt(input);
    const noteId = cleanText(input.noteId, 120);
    const referenceImage = cleanText(input.referenceImage, 10 * 1024 * 1024);

    if (!apiKey) {
      sendJson(res, 500, { ok: false, error: "服务端缺少 IMAGE_GENERATION_API_KEY 或 ARK_API_KEY" });
      return;
    }
    if (!cleanText(input.imagePrompt, 1800)) {
      sendJson(res, 400, { ok: false, error: "请填写生图提示词" });
      return;
    }
    if (referenceImage && referenceImage.length > 10 * 1024 * 1024) {
      sendJson(res, 413, { ok: false, error: "垫图过大，请控制在 8MB 以内" });
      return;
    }

    const dbPool = getPool();
    if (dbPool) client = await dbPool.connect();
    const modelConfig = await lookupModelConfig(client, model);

    const endpoint = new URL(apiUrl);
    const requestBody = {
      model,
      prompt,
      response_format: "url",
      size,
      sequential_image_generation: "disabled",
      stream: false,
      watermark: false,
    };
    if (referenceImage) requestBody.image = [referenceImage];

    const arkRes = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const responseText = await arkRes.text();
    const finishedAt = new Date();
    const latencyMs = Date.now() - startedMono;
    let payload = {};
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { raw_text: responseText };
    }

    const images = extractImages(payload);
    const logWarning = await writeApiLog(client, {
      traceId: `web:image-generation:${Date.now()}`,
      modelConfigId: modelConfig.model_config_id,
      credentialId: modelConfig.credential_id,
      status: arkRes.ok && images.length ? "success" : "failed",
      requestHost: endpoint.host,
      requestPath: endpoint.pathname,
      httpStatus: arkRes.status,
      noteId,
      startedAt,
      finishedAt,
      latencyMs,
      requestBytes: Buffer.byteLength(JSON.stringify(requestBody)),
      responseBytes: Buffer.byteLength(responseText || ""),
      estimatedUnits: images.length || 1,
      errorCode: arkRes.ok ? "" : String(payload?.error?.code || payload?.code || arkRes.status),
      errorMessage: arkRes.ok ? "" : String(payload?.error?.message || payload?.message || responseText).slice(0, 500),
      rawUsage: { image_count: images.length, response_created: payload?.created || null },
      metadata: {
        source: "web_image_generation_workflow",
        model,
        size,
        has_reference_image: Boolean(referenceImage),
        prompt_chars: prompt.length,
        user_id: user.user_id,
      },
    });

    if (!arkRes.ok || !images.length) {
      sendJson(res, arkRes.ok ? 502 : arkRes.status, {
        ok: false,
        error: payload?.error?.message || payload?.message || "图像生成失败",
        detail: payload,
        logWarning,
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      images,
      model,
      size,
      prompt,
      latencyMs,
      logWarning,
    });
  } catch (error) {
    const finishedAt = new Date();
    const latencyMs = Date.now() - startedMono;
    if (client) {
      await writeApiLog(client, {
        traceId: `web:image-generation:${Date.now()}`,
        status: "failed",
        requestHost: "ark.cn-beijing.volces.com",
        requestPath: "/api/v3/images/generations",
        startedAt,
        finishedAt,
        latencyMs,
        requestBytes: 0,
        responseBytes: 0,
        estimatedUnits: 1,
        errorCode: "request_exception",
        errorMessage: error.message,
        rawUsage: {},
        metadata: { source: "web_image_generation_workflow" },
      });
    }
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "图像生成失败" });
  } finally {
    if (client) client.release();
  }
};
