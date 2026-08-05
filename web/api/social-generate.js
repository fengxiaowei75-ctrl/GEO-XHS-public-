const { Pool } = require("pg");
const { requireAuth } = require("./_auth");

const PROVIDER_CODE = "volcengine_ark_chat";
const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MODEL = "doubao-seed-2-0-mini-260428";

const platformConfigs = {
  xhs: {
    label: "小红书",
    instruction:
      "生成小红书图文笔记草稿。要求：标题有搜索关键词和点击欲；开头3秒抓住痛点；正文分段短、可扫读；给出封面文案建议、正文、话题标签和评论区引导。语气真实、具体、有生活感，不要夸张营销腔。",
  },
  douyin: {
    label: "抖音",
    instruction:
      "生成抖音短视频内容草稿。要求：给出视频标题、3秒钩子、30-60秒口播稿、镜头分镜、屏幕字幕、结尾互动和发布文案。节奏快，口语化，避免长句。",
  },
  wechat: {
    label: "公众号",
    instruction:
      "生成公众号文章草稿。要求：给出文章标题、摘要、导语、三级结构大纲、完整正文、配图建议和结尾转化。逻辑严谨，适合深度阅读，保留业务知识点。",
  },
  zhihu: {
    label: "知乎",
    instruction:
      "生成知乎文章/回答草稿。要求：给出问题式标题、核心观点、论证结构、完整正文、可引用的经验判断、反常识点和结尾总结。语气专业克制，避免小红书式表情和营销话术。",
  },
};

let pool;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
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

function cleanText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function modelHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function extractResponseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        return item?.text || item?.content || "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function tokenUsage(payload) {
  const usage = payload?.usage && typeof payload.usage === "object" ? payload.usage : {};
  return {
    input_tokens: Number(usage.prompt_tokens || usage.input_tokens || 0) || 0,
    output_tokens: Number(usage.completion_tokens || usage.output_tokens || 0) || 0,
    total_tokens: Number(usage.total_tokens || 0) || 0,
    raw: usage,
  };
}

function buildUserPrompt(input, platform) {
  const config = platformConfigs[platform] || platformConfigs.xhs;
  const imageLines = Array.isArray(input.images)
    ? input.images
        .slice(0, 4)
        .map((image, index) => `第${index + 1}张图：${cleanText(image?.url || "", 400)}`)
        .join("\n")
    : "";
  return [
    `平台：${config.label}`,
    config.instruction,
    "",
    "请基于下面的 GEO 内容资产生成可直接二次编辑的社媒草稿。不要编造无法从材料推导出的事实；如信息不足，用可替换占位表达。",
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
    "【生图提示词】",
    cleanText(input.imagePrompt, 1800),
    "",
    "【已生成图片】",
    imageLines || "暂无",
    "",
    "输出格式要求：用 Markdown；标题、正文、发布建议分清楚；内容尽量完整，少写解释过程。",
  ].join("\n");
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
        input_tokens, output_tokens, total_tokens,
        estimated_units, error_code, error_message, raw_usage, metadata
      )
      VALUES (
        $1, $2, $3, $4, NULL, $5, $6,
        $7, $8, $9, $10, 1, 1, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19,
        1, $20, $21, $22::jsonb, $23::jsonb
      )
      `,
      [
        record.traceId,
        PROVIDER_CODE,
        record.modelConfigId || null,
        record.credentialId || null,
        "social_draft_generation",
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
        record.inputTokens || 0,
        record.outputTokens || 0,
        record.totalTokens || 0,
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
    const platform = platformConfigs[input.platform] ? input.platform : "xhs";
    const apiKey = process.env.GEO_CONTENT_API_KEY || process.env.ARK_CHAT_API_KEY;
    const baseUrl = cleanText(process.env.GEO_CONTENT_BASE_URL || process.env.ARK_CHAT_BASE_URL || DEFAULT_BASE_URL, 500).replace(/\/$/, "");
    const model = cleanText(process.env.GEO_CONTENT_MODEL || process.env.ARK_CHAT_MODEL || DEFAULT_MODEL, 160);
    const temperature = Number(process.env.GEO_CONTENT_TEMPERATURE || process.env.ARK_CHAT_TEMPERATURE || 0.6);
    const thinking = cleanText(process.env.GEO_CONTENT_THINKING || process.env.ARK_CHAT_THINKING || "disabled", 64);

    if (!apiKey) {
      sendJson(res, 500, { ok: false, error: "服务端缺少 GEO_CONTENT_API_KEY 或 ARK_CHAT_API_KEY" });
      return;
    }

    const prompt = buildUserPrompt(input, platform);
    const dbPool = getPool();
    if (dbPool) client = await dbPool.connect();
    const modelConfig = await lookupModelConfig(client, model);

    const endpoint = new URL(`${baseUrl}/chat/completions`);
    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content: "你是资深中文内容策略和社媒编辑，擅长把业务知识资产改写为不同平台的可发布草稿。",
        },
        { role: "user", content: prompt },
      ],
      temperature: Number.isFinite(temperature) ? temperature : 0.6,
    };
    if (thinking === "disabled") requestBody.thinking = { type: "disabled" };

    const modelRes = await fetch(endpoint.toString(), {
      method: "POST",
      headers: modelHeaders(apiKey),
      body: JSON.stringify(requestBody),
    });
    const responseText = await modelRes.text();
    const finishedAt = new Date();
    const latencyMs = Date.now() - startedMono;
    let payload = {};
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { raw_text: responseText };
    }
    const content = extractResponseText(payload);
    const usage = tokenUsage(payload);
    const logWarning = await writeApiLog(client, {
      traceId: `web:social-draft:${Date.now()}`,
      modelConfigId: modelConfig.model_config_id,
      credentialId: modelConfig.credential_id,
      status: modelRes.ok && content ? "success" : "failed",
      requestHost: endpoint.host,
      requestPath: endpoint.pathname,
      httpStatus: modelRes.status,
      noteId: cleanText(input.noteId, 120),
      startedAt,
      finishedAt,
      latencyMs,
      requestBytes: Buffer.byteLength(JSON.stringify(requestBody)),
      responseBytes: Buffer.byteLength(responseText || ""),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
      errorCode: modelRes.ok ? "" : String(payload?.error?.code || payload?.code || modelRes.status),
      errorMessage: modelRes.ok ? "" : String(payload?.error?.message || payload?.message || responseText).slice(0, 500),
      rawUsage: usage.raw,
      metadata: {
        source: "web_image_generation_workflow",
        platform,
        platform_label: platformConfigs[platform].label,
        model,
        prompt_chars: prompt.length,
        user_id: user.user_id,
      },
    });

    if (!modelRes.ok || !content) {
      sendJson(res, modelRes.ok ? 502 : modelRes.status, {
        ok: false,
        error: payload?.error?.message || payload?.message || "社媒内容生成失败",
        detail: payload,
        logWarning,
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      platform,
      platformLabel: platformConfigs[platform].label,
      content,
      model,
      usage: usage.raw,
      latencyMs,
      logWarning,
    });
  } catch (error) {
    const finishedAt = new Date();
    const latencyMs = Date.now() - startedMono;
    if (client) {
      await writeApiLog(client, {
        traceId: `web:social-draft:${Date.now()}`,
        status: "failed",
        requestHost: "ark.cn-beijing.volces.com",
        requestPath: "/api/v3/chat/completions",
        startedAt,
        finishedAt,
        latencyMs,
        requestBytes: 0,
        responseBytes: 0,
        errorCode: "request_exception",
        errorMessage: error.message,
        rawUsage: {},
        metadata: { source: "web_image_generation_workflow" },
      });
    }
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "社媒内容生成失败" });
  } finally {
    if (client) client.release();
  }
};
