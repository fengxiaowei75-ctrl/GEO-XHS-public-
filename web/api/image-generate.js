const { Pool } = require("pg");
const { requireAuth } = require("./_auth");
const { checkGateway, makeGatewayContext, reportGateway } = require("./_gateway");

const PROVIDER_CODE = "duomi_image_generation";
const DEFAULT_IMAGE_API_URL = "https://duomiapi.com/v1/images/generations";
const DEFAULT_TASK_API_URL = "https://duomiapi.com/v1/tasks";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const MAX_IMAGE_COUNT = 10;
const MAX_GLOBAL_PROMPT_CHARS = 5000;

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

function currentDateText() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y"].includes(String(value).trim().toLowerCase());
}

function normalizeImageCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(MAX_IMAGE_COUNT, Math.floor(count)));
}

function parseImagePrompts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => ({
      slot: Number(item?.slot || index + 1),
      prompt: cleanText(typeof item === "string" ? item : item?.prompt, 5000),
    }))
    .filter((item) => item.prompt)
    .slice(0, MAX_IMAGE_COUNT);
}

function promptForSlot(imagePrompts, slot) {
  return imagePrompts.find((item) => item.slot === slot)?.prompt || imagePrompts[slot - 1]?.prompt || "";
}

function buildPromptIndex(imagePrompts, total) {
  const rows = Array.from({ length: total }, (_, index) => {
    const slot = index + 1;
    const prompt = cleanText(promptForSlot(imagePrompts, slot), 700);
    return prompt ? `第${slot}张：${prompt}` : "";
  }).filter(Boolean);
  if (!rows.length) return "";
  return [
    "【整组逐图内容索引（用于避免重复）】",
    "下面是本组每张图的原图提示词摘要。当前任务只能执行自己的图片序号；其他序号只用于理解差异，不能复制其标题、主文案、构图或内容模块。",
    rows.join("\n"),
  ].join("\n");
}

function hasImagePrompt(input) {
  return Boolean(cleanText(input.imagePrompt, MAX_GLOBAL_PROMPT_CHARS) || parseImagePrompts(input.imagePrompts).length);
}

function buildCommonPrompt(input) {
  return [
    "请基于下面的小红书笔记内容资产和垫图要求，生成适合作为GEO内容运营素材的图片。",
    "画面需要专业、信息层级清晰，适合小红书知识内容首图或正文配图；如出现中文文字，必须简洁、清晰、无错别字。",
    "",
    "【强制安全与时效规则】",
    `当前日期：${currentDateText()}。`,
    "1. 所有组图都不能出现任何别人的公司名、品牌Logo、商标、博主账号、账号ID、头像、水印、店铺名、二维码、网址、联系方式或可识别个人隐私信息。",
    "2. 如果原图提示词、OCR、垫图或笔记内容里带有第三方公司/账号/博主名，只能抽象成“某品牌”“某账号”“行业案例”等通用表达，不能复刻具体名称。",
    "3. 不要复刻原图里的旧日期、截图时间、发布年份或活动时间。非实时新闻/明确历史案例不要在图片上写具体年月日。",
    "4. 如果必须出现日期，只能使用输入材料中明确真实且仍有必要保留的日期；涉及实时新闻时可使用真实日期。禁止编造日期，禁止把旧素材里的 2024/2025 年误当成当前时间。",
    "5. 所有图中文字必须围绕当前笔记重新生成，不要原样照搬原图标题、原图日期、原图账号和原图品牌露出。",
    "",
    "【全局内容资产使用规则】",
    "下面的笔记标题、文案、人群、痛点、业务逻辑、知识点和整组视觉参考，只用于帮助大模型理解主题语境、目标读者、转化目的、知识边界和视觉一致性。",
    "这些全局内容不能覆盖“本张原图对应提示词”，也不能被每一张图照搬成同一标题、同一主卖点、同一内容模块或同一版式。",
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
    "【整组视觉理解参考/全局补充】",
    "这一段只用于理解整组视觉系统、主配色、信息密度、平台感和风格边界。若其中包含封面、首屏、布局或钩子描述，除非本张原图对应提示词明确要求，否则不得机械套用到当前图片。",
    cleanText(input.imagePrompt, MAX_GLOBAL_PROMPT_CHARS),
  ]
    .filter((item) => item !== "")
    .join("\n");
}

function buildSlotPrompt(input, slot, total, imagePrompts) {
  const commonPrompt = buildCommonPrompt(input);
  const slotPrompt = promptForSlot(imagePrompts, slot);
  const unifiedVisualStyle = input.unifiedVisualStyle !== false;
  return [
    commonPrompt,
    buildPromptIndex(imagePrompts, total),
    unifiedVisualStyle && total > 1
      ? [
          "",
          "【全组统一风格/配色约束（最高优先级）】",
          "本组图片必须共用同一套视觉系统、主配色、字体气质、留白规则和信息密度。若单张原图提示词之间存在冲突，优先保持整组风格与配色统一，再保留每张图自己的内容结构。",
        ].join("\n")
      : "",
    "",
    "【本张原图对应提示词】",
    slotPrompt || cleanText(input.imagePrompt, MAX_GLOBAL_PROMPT_CHARS),
    "",
    "【本张差异化执行规则】",
    `当前只生成第${slot}张图。第${slot}张必须优先执行“本张原图对应提示词”，不得重复第1张或其他图片的主标题、主卖点、核心内容模块、布局结构和可见文字。`,
    "如果本张提示词与整组共用内容相似，也要重新拆分成不同角度：保留同一主题和同一视觉系统，但换一个内容侧重点、信息结构和主视觉，不要生成同一张图的变体。",
    "",
    "【本次图片序号】",
    total > 1 ? `请只生成第${slot}张图。这张图必须优先理解并执行“本张原图对应提示词”，不要套用固定四图模板。` : "请生成当前这张图。",
    total > 1 ? "多张图之间保持同一笔记主题和阅读连贯性，但每张图只承担自己原图提示词对应的内容，不要重复同一构图。" : "",
  ]
    .filter((item) => item !== "")
    .join("\n");
}

function buildPromptPreview(input, total, imagePrompts) {
  return Array.from({ length: total }, (_, index) => `--- 第${index + 1}张发送提示词 ---\n${buildSlotPrompt(input, index + 1, total, imagePrompts)}`).join("\n\n");
}

function extractImages(payload) {
  const found = [];

  function addUrl(value, loose = false) {
    if (!value || typeof value !== "string") return;
    const text = value.trim();
    if (!text) return;
    if (text.startsWith("data:image/")) {
      found.push(text);
      return;
    }
    if (!/^https?:\/\//i.test(text)) return;
    if (loose || /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(text) || /image|img|cdn|oss|cos|r2|s3/i.test(text)) found.push(text);
  }

  function walk(value, depth = 0) {
    if (!value || depth > 6) return;
    if (typeof value === "string") {
      addUrl(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;

    if (value.b64_json) addUrl(`data:image/png;base64,${value.b64_json}`);
    [
      "url",
      "image",
      "image_url",
      "imageUrl",
      "output_url",
      "outputUrl",
      "result_url",
      "resultUrl",
    ].forEach((key) => addUrl(value[key], true));
    [
      "data",
      "images",
      "image_urls",
      "imageUrls",
      "output",
      "outputs",
      "result",
      "results",
      "artifacts",
      "items",
    ].forEach((key) => walk(value[key], depth + 1));
  }

  walk(payload);
  return Array.from(new Set(found)).map((url, index) => ({ id: `image-${index}`, url }));
}

function extractTaskId(payload) {
  const candidates = [
    payload?.id,
    payload?.task_id,
    payload?.taskId,
    payload?.data?.id,
    payload?.data?.task_id,
    payload?.data?.taskId,
    payload?.result?.id,
    payload?.result?.task_id,
    payload?.result?.taskId,
  ];
  return cleanText(candidates.find(Boolean), 160);
}

function taskUrlFor(taskId) {
  const base = process.env.IMAGE_GENERATION_TASK_API_URL || DEFAULT_TASK_API_URL;
  if (base.includes("{id}")) return base.replace("{id}", encodeURIComponent(taskId));
  return `${base.replace(/\/$/, "")}/${encodeURIComponent(taskId)}`;
}

function imageProviderHeaders(apiKey) {
  const prefix = cleanText(process.env.IMAGE_GENERATION_AUTH_PREFIX, 32);
  return {
    Authorization: prefix ? `${prefix} ${apiKey}` : apiKey,
    "Content-Type": "application/json",
  };
}

function appendReferenceImage(requestBody, referenceImage) {
  if (!referenceImage) return false;
  const field = cleanText(process.env.IMAGE_GENERATION_REFERENCE_FIELD, 64) || "image";
  if (field.toLowerCase() === "none") return false;
  const normalizedField = field.endsWith("[]") ? field.slice(0, -2) : field;
  requestBody[normalizedField] = field.endsWith("[]") ? [referenceImage] : referenceImage;
  return true;
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
        record.operation || "image_generation_create_task",
        record.status,
        record.httpMethod || "POST",
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
  let activeGatewayContext = null;
  let activeGatewayDecision = null;
  let activeGatewayReported = false;

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const input = await readJsonBody(req);
    const apiKey = process.env.IMAGE_GENERATION_API_KEY;
    const apiUrl = process.env.IMAGE_GENERATION_API_URL || DEFAULT_IMAGE_API_URL;
    const model = process.env.IMAGE_GENERATION_MODEL || DEFAULT_IMAGE_MODEL;
    const size = cleanText(input.size, 32) || process.env.IMAGE_GENERATION_SIZE || "1024x1024";
    const imageCount = normalizeImageCount(input.imageCount);
    const oversea = parseBoolean(input.oversea, parseBoolean(process.env.IMAGE_GENERATION_OVERSEA, false));
    const imagePrompts = parseImagePrompts(input.imagePrompts);
    const prompt = buildPromptPreview(input, imageCount, imagePrompts);
    const noteId = cleanText(input.noteId, 120);
    const referenceImage = cleanText(input.referenceImage, 10 * 1024 * 1024);
    const workflowAction = cleanText(input.workflowAction, 64) || "image_generation";
    const operation = workflowAction === "image_edit" ? "image_generation_edit_task" : "image_generation_create_task";
    const editSlot = Number(input.editSlot || 0) || null;

    if (!apiKey) {
      sendJson(res, 500, { ok: false, error: "服务端缺少 IMAGE_GENERATION_API_KEY" });
      return;
    }
    if (!hasImagePrompt(input)) {
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
    const tasks = [];
    const allImages = [];
    const logWarnings = [];

    for (let slot = 1; slot <= imageCount; slot += 1) {
      const slotStartedAt = new Date();
      const slotStartedMono = Date.now();
      const slotPrompt = buildSlotPrompt(input, slot, imageCount, imagePrompts);
      const requestBody = { model, prompt: slotPrompt, size, oversea };
      const referenceImageSent = appendReferenceImage(requestBody, referenceImage);

      activeGatewayContext = makeGatewayContext({
        user,
        featureKey: "image_generation",
        endpointKey: "POST /api/image-generate",
        providerCode: "domi_image_generation",
        modelName: model,
        costClass: "image_generation",
        highCost: true,
        description: "Domi 图片生成/改图任务提交",
        metadata: {
          slot,
          image_count_requested: imageCount,
          workflow_action: workflowAction,
          size,
          oversea,
          has_reference_image: Boolean(referenceImage),
          prompt_chars: slotPrompt.length,
          note_id: noteId || null,
        },
      });
      activeGatewayDecision = null;
      activeGatewayReported = false;
      try {
        activeGatewayDecision = await checkGateway(activeGatewayContext);
      } catch (error) {
        if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
        sendJson(res, error.statusCode || 503, {
          ok: false,
          error: "网关限制：图片生成暂不可用",
          detail: error.gateway || error.message,
        });
        return;
      }

      const providerRes = await fetch(endpoint.toString(), {
        method: "POST",
        headers: imageProviderHeaders(apiKey),
        body: JSON.stringify(requestBody),
      });
      const responseText = await providerRes.text();
      const finishedAt = new Date();
      const latencyMs = Date.now() - slotStartedMono;
      let payload = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { raw_text: responseText };
      }

      const images = extractImages(payload).map((image) => ({ ...image, slot }));
      const taskId = extractTaskId(payload);
      const logWarning = await writeApiLog(client, {
        traceId: `web:image-generation:${Date.now()}:${slot}`,
        modelConfigId: modelConfig.model_config_id,
        credentialId: modelConfig.credential_id,
        operation,
        status: providerRes.ok ? "success" : "failed",
        requestHost: endpoint.host,
        requestPath: endpoint.pathname,
        httpStatus: providerRes.status,
        noteId,
        startedAt: slotStartedAt,
        finishedAt,
        latencyMs,
        requestBytes: Buffer.byteLength(JSON.stringify(requestBody)),
        responseBytes: Buffer.byteLength(responseText || ""),
        estimatedUnits: providerRes.ok ? 1 : 0,
        errorCode: providerRes.ok ? "" : String(payload?.error?.code || payload?.code || providerRes.status),
        errorMessage: providerRes.ok ? "" : String(payload?.error?.message || payload?.message || responseText).slice(0, 500),
        rawUsage: { image_count: images.length, task_id: taskId || null, slot, image_count_requested: imageCount, per_image_prompt_count: imagePrompts.length, workflow_action: workflowAction },
        metadata: {
          source: "web_image_generation_workflow",
          provider: "duomiapi",
          workflow_action: workflowAction,
          model,
          size,
          oversea,
          task_url: taskId ? taskUrlFor(taskId) : null,
          has_reference_image: Boolean(referenceImage),
          reference_image_sent: referenceImageSent,
          prompt_chars: slotPrompt.length,
          image_count_requested: imageCount,
          per_image_prompt_count: imagePrompts.length,
          unified_visual_style: input.unifiedVisualStyle !== false,
          slot,
          edit_slot: editSlot,
          user_id: user.user_id,
          gateway_request_id: activeGatewayDecision?.requestId || activeGatewayContext.requestId,
          gateway_policy_id: activeGatewayDecision?.policyId || null,
        },
      });
      if (logWarning) logWarnings.push(`第${slot}张：${logWarning}`);

      if (!providerRes.ok) {
        await reportGateway(
          { ...activeGatewayContext, ...(activeGatewayDecision || {}) },
          {
            status: "failed",
            latencyMs,
            imageCount: 0,
            errorCode: String(payload?.error?.code || payload?.code || providerRes.status),
            errorMessage: String(payload?.error?.message || payload?.message || responseText).slice(0, 500),
            metadata: {
              slot,
              upstream_status: providerRes.status,
              workflow_action: workflowAction,
              task_id: taskId || null,
            },
          },
        );
        activeGatewayReported = true;
        sendJson(res, providerRes.status, {
          ok: false,
          error: payload?.error?.message || payload?.message || `第${slot}张图生成任务创建失败`,
          detail: payload,
          logWarning: logWarnings.join("；"),
        });
        return;
      }

      if (!taskId && !images.length) {
        await reportGateway(
          { ...activeGatewayContext, ...(activeGatewayDecision || {}) },
          {
            status: "failed",
            latencyMs,
            imageCount: 0,
            errorCode: "missing_task_or_image",
            errorMessage: "任务创建成功但响应中没有任务 ID 或图片 URL",
            metadata: {
              slot,
              workflow_action: workflowAction,
              upstream_status: providerRes.status,
            },
          },
        );
        activeGatewayReported = true;
        sendJson(res, 502, {
          ok: false,
          error: `第${slot}张图任务创建成功，但响应中没有找到任务 ID 或图片 URL`,
          detail: payload,
          logWarning: logWarnings.join("；"),
        });
        return;
      }

      await reportGateway(
        { ...activeGatewayContext, ...(activeGatewayDecision || {}) },
        {
          status: "success",
          latencyMs,
          imageCount: 1,
          metadata: {
            slot,
            workflow_action: workflowAction,
            task_id: taskId || null,
            image_count: images.length,
            image_count_requested: imageCount,
            upstream_status: providerRes.status,
          },
        },
      );
      activeGatewayReported = true;

      tasks.push({ slot, taskId, images });
      allImages.push(...images);
    }

    sendJson(res, 200, {
      ok: true,
      taskId: tasks[0]?.taskId || "",
      taskIds: tasks.map((item) => item.taskId).filter(Boolean),
      tasks,
      status: allImages.length >= imageCount ? "succeeded" : "processing",
      images: allImages,
      imageCount,
      model,
      size,
      prompt,
      latencyMs: Date.now() - startedMono,
      logWarning: logWarnings.join("；"),
    });
  } catch (error) {
    const finishedAt = new Date();
    const latencyMs = Date.now() - startedMono;
    if (activeGatewayContext && !activeGatewayReported) {
      await reportGateway(
        { ...activeGatewayContext, ...(activeGatewayDecision || {}) },
        {
          status: "failed",
          latencyMs,
          imageCount: 0,
          errorCode: "request_exception",
          errorMessage: error.message,
        },
      );
    }
    if (client) {
      await writeApiLog(client, {
        traceId: `web:image-generation:${Date.now()}`,
        status: "failed",
        requestHost: "duomiapi.com",
        requestPath: "/v1/images/generations",
        startedAt,
        finishedAt,
        latencyMs,
        requestBytes: 0,
        responseBytes: 0,
        estimatedUnits: 0,
        errorCode: "request_exception",
        errorMessage: error.message,
        rawUsage: {},
        metadata: {
          source: "web_image_generation_workflow",
          provider: "duomiapi",
          gateway_request_id: activeGatewayDecision?.requestId || activeGatewayContext?.requestId || null,
          gateway_policy_id: activeGatewayDecision?.policyId || null,
        },
      });
    }
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "图像生成任务创建失败" });
  } finally {
    if (client) client.release();
  }
};
