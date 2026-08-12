const { Pool } = require("pg");
const { requireAuth } = require("./_auth");
const { makeGatewayContext, proxyProvider } = require("./_gateway");

const PROVIDER_CODE = "volcengine_ark_chat";
const DEFAULT_MODEL = "doubao-seed-2-0-mini-260428";
const MAX_WORKFLOW_IMAGES = 10;
const MAX_IMAGE_PROMPT_CHARS = 60000;

const platformConfigs = {
  xhs: {
    label: "小红书",
    instruction:
      "生成小红书图文笔记草稿。要求：标题有搜索关键词和点击欲；开头3秒抓住痛点；正文分段短、可扫读；给出封面文案建议、正文和评论区引导。语气真实、具体、有生活感，不要夸张营销腔，不要单独输出话题标签。",
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

function currentDateText() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function sanitizePlainText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      let text = String(line || "").trim();
      if (/^(话题标签|标签|hashtags?)[:：]/i.test(text)) return "";
      text = text.replace(/^(标题|正文|封面文案建议|评论区引导|小红书文案|新标题)[:：]\s*/g, "");
      text = text.replace(/^#{1,6}\s*/g, "");
      text = text.replace(/^[-*•]\s+/g, "");
      text = text.replace(/^\d+[.)]\s+/g, "");
      text = text.replace(/\*\*(.*?)\*\*/g, "$1");
      text = text.replace(/__(.*?)__/g, "$1");
      text = text.replace(/[`*_]/g, "");
      text = text.replace(/#/g, "");
      return text.trimEnd();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const editInstruction = cleanText(input.editInstruction, 4000);
  const currentSocialContent = cleanText(input.currentSocialContent, 20000);
  const isEdit = String(input.workflowAction || "").toLowerCase() === "social_edit" || Boolean(editInstruction || currentSocialContent);
  const imageLines = Array.isArray(input.images)
    ? input.images
        .slice(0, MAX_WORKFLOW_IMAGES)
        .map((image, index) => `第${index + 1}张图：${cleanText(image?.label || image?.url || "", 400)}`)
        .join("\n")
    : "";
  return [
    `平台：${config.label}`,
    config.instruction,
    "",
    isEdit
      ? "请基于下面的内容草稿和修改要求进行重写。不要保留不需要的旧表达，改文案时同时保留事实、结构、平台语气和可发布性。"
      : "请基于下面的 GEO 内容资产生成可直接二次编辑的社媒草稿。不要编造无法从材料推导出的事实；如信息不足，用可替换占位表达。",
    "",
    "【强制改写与安全规则】",
    `当前日期：${currentDateText()}。`,
    "1. 原笔记只作为素材来源，不能直接复刻。必须结合目标人群画像、用户痛点、需求、业务逻辑和业务知识点重新组织内容，让新稿比原稿更清晰、更有价值、更利于发布。",
    "2. 标题必须重新生成：不能和原笔记标题一模一样，也不能只做标点、语序或近义词替换。标题要围绕用户痛点/反常识/收益点/搜索关键词重新设计。",
    "3. 正文不能原样照搬原笔记文案；要重写开头钩子、内容结构、案例表达、行动建议和结尾引导。保留事实和知识点，但表达方式、层次和卖点必须升级。",
    "4. 不要出现第三方公司名、品牌Logo、博主账号、账号ID、头像、水印、店铺名、二维码、网址、联系方式或可识别个人隐私信息；如素材里出现这些信息，统一抽象成“某品牌”“某账号”“行业案例”。",
    "5. 不要复刻原图/原文里的旧日期、截图时间、发布年份或活动时间。非实时新闻/明确历史案例不要写具体年月日；如必须出现日期，只能使用输入材料中真实且必要的日期，禁止编造日期，禁止把 2024/2025 年误当成当前时间。",
    "6. 输出要体现“为什么用户需要看这篇”：先解决痛点和需求，再展开方法论/知识点，最后给可执行建议或转化路径。",
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
    cleanText(input.imagePrompt, MAX_IMAGE_PROMPT_CHARS),
    "",
    isEdit && currentSocialContent ? "【当前社媒草稿】\n" + currentSocialContent : "",
    isEdit && editInstruction ? `【本次修改要求】\n${editInstruction}` : "",
    "",
    "【已生成图片】",
    imageLines || "暂无",
    "",
    "输出格式要求：纯文本，可直接复制到小红书发布框；第一行直接写新标题，空行后写正文；不要写“标题：”“正文：”“封面文案建议：”“话题标签：”等栏目名；不要使用 Markdown，不要写 #、```、*、- 这类格式符号，不要输出标题层级标记；用自然段和空行区分内容即可。",
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
  let gatewayContext = null;

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const input = await readJsonBody(req);
    const platform = platformConfigs[input.platform] ? input.platform : "xhs";
    const model = cleanText(process.env.GEO_CONTENT_MODEL || process.env.ARK_CHAT_MODEL || DEFAULT_MODEL, 160);
    const temperature = Number(process.env.GEO_CONTENT_TEMPERATURE || process.env.ARK_CHAT_TEMPERATURE || 0.6);
    const thinking = cleanText(process.env.GEO_CONTENT_THINKING || process.env.ARK_CHAT_THINKING || "disabled", 64);

    const prompt = buildUserPrompt(input, platform);
    gatewayContext = makeGatewayContext({
      user,
      featureKey: "social_generation",
      endpointKey: "POST /api/social-generate",
      providerCode: PROVIDER_CODE,
      modelName: model,
      costClass: "llm_chat",
      highCost: true,
      description: "Ark Chat 生成社媒内容草稿",
      metadata: {
        platform,
        prompt_chars: prompt.length,
        note_id: cleanText(input.noteId, 120) || null,
      },
    });

    const dbPool = getPool();
    if (dbPool) client = await dbPool.connect();
    const modelConfig = await lookupModelConfig(client, model);

    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content: "你是资深中文内容策略和社媒编辑，擅长把原始笔记素材重构为更强的多平台可发布草稿。你必须重写标题和正文结构，不能复刻原文、账号、品牌露出或错误日期。输出必须是纯文本，不要输出 Markdown、标题层级、列表符号或 # 号。",
        },
        { role: "user", content: prompt },
      ],
      temperature: Number.isFinite(temperature) ? temperature : 0.6,
    };
    if (thinking === "disabled") requestBody.thinking = { type: "disabled" };

    let gatewayResult = null;
    let modelOk = true;
    let modelStatus = 200;
    let payload = {};
    let responseText = "";
    try {
      gatewayResult = await proxyProvider(
        gatewayContext,
        "volcengine_ark",
        "chat_completions",
        requestBody,
        { timeoutMs: 120000 },
      );
      payload = gatewayResult.data || {};
      responseText = JSON.stringify(payload);
    } catch (error) {
      modelOk = false;
      modelStatus = error.statusCode || 502;
      payload = error.payload?.data || error.payload || { error: error.message };
      responseText = JSON.stringify(payload);
    }
    const finishedAt = new Date();
    const latencyMs = Date.now() - startedMono;
    const content = sanitizePlainText(extractResponseText(payload));
    const usage = tokenUsage(payload);
    const logWarning = await writeApiLog(client, {
      traceId: `web:social-draft:${Date.now()}`,
      modelConfigId: modelConfig.model_config_id,
      credentialId: modelConfig.credential_id,
      status: modelOk && content ? "success" : "failed",
      requestHost: "central-api-gateway",
      requestPath: "/v1/proxy/volcengine_ark/chat_completions",
      httpStatus: modelStatus,
      noteId: cleanText(input.noteId, 120),
      startedAt,
      finishedAt,
      latencyMs,
      requestBytes: Buffer.byteLength(JSON.stringify(requestBody)),
      responseBytes: Buffer.byteLength(responseText || ""),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
      errorCode: modelOk ? "" : String(payload?.error?.code || payload?.code || modelStatus),
      errorMessage: modelOk ? "" : String(payload?.error?.message || payload?.message || responseText).slice(0, 500),
      rawUsage: usage.raw,
      metadata: {
        source: "web_social_generation_workflow",
        platform,
        platform_label: platformConfigs[platform].label,
        model,
        prompt_chars: prompt.length,
        user_id: user.user_id,
        gateway_request_id: gatewayResult?.request_id || gatewayContext.requestId,
      },
    });

    if (!modelOk || !content) {
      sendJson(res, modelOk ? 502 : modelStatus, {
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
        requestHost: "central-api-gateway",
        requestPath: "/v1/proxy/volcengine_ark/chat_completions",
        startedAt,
        finishedAt,
        latencyMs,
        requestBytes: 0,
        responseBytes: 0,
        errorCode: "request_exception",
        errorMessage: error.message,
        rawUsage: {},
        metadata: {
          source: "web_social_generation_workflow",
          gateway_request_id: gatewayContext?.requestId || null,
        },
      });
    }
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "社媒内容生成失败" });
  } finally {
    if (client) client.release();
  }
};
