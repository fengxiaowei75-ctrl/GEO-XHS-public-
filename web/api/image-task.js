const { Pool } = require("pg");
const { requireAuth } = require("./_auth");
const { makeGatewayContext, proxyProvider } = require("./_gateway");

const PROVIDER_CODE = "duomi_image_generation";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

let pool;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function cleanText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
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

function normalizeStatus(payload, images) {
  const raw = cleanText(
    payload?.status ||
      payload?.task_status ||
      payload?.taskStatus ||
      payload?.state ||
      payload?.data?.status ||
      payload?.data?.task_status ||
      payload?.data?.taskStatus ||
      payload?.data?.state ||
      payload?.result?.status ||
      payload?.result?.state,
    64,
  ).toLowerCase();
  if (images.length) return "succeeded";
  if (["success", "succeeded", "completed", "complete", "done", "finished"].includes(raw)) return "succeeded";
  if (["failed", "failure", "error", "canceled", "cancelled", "rejected"].includes(raw)) return "failed";
  if (["queued", "pending", "created", "waiting"].includes(raw)) return "queued";
  if (["running", "processing", "in_progress", "generating"].includes(raw)) return "processing";
  return raw || "processing";
}

function extractErrorMessage(payload) {
  return cleanText(
    payload?.error?.message ||
      payload?.error_message ||
      payload?.message ||
      payload?.data?.error?.message ||
      payload?.data?.error_message ||
      payload?.data?.message ||
      payload?.result?.error?.message ||
      payload?.result?.error_message ||
      "",
    500,
  );
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
        http_method, request_host, request_path, http_status, attempt_no, max_attempts,
        started_at, finished_at, latency_ms, request_bytes, response_bytes,
        estimated_units, error_code, error_message, raw_usage, metadata
      )
      VALUES (
        $1, $2, $3, $4, NULL, 'image_generation_query_task', $5,
        'GET', $6, $7, $8, 1, 1,
        $9, $10, $11, 0, $12,
        0, $13, $14, $15::jsonb, $16::jsonb
      )
      `,
      [
        record.traceId,
        PROVIDER_CODE,
        record.modelConfigId || null,
        record.credentialId || null,
        record.status,
        record.requestHost,
        record.requestPath,
        record.httpStatus || null,
        record.startedAt,
        record.finishedAt,
        record.latencyMs,
        record.responseBytes,
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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
    return;
  }

  const startedAt = new Date();
  const startedMono = Date.now();
  let client = null;
  let gatewayContext = null;

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const url = new URL(req.url, "http://localhost");
    const taskId = cleanText(url.searchParams.get("taskId") || url.searchParams.get("id"), 160);
    if (!taskId) {
      sendJson(res, 400, { ok: false, error: "缺少 taskId" });
      return;
    }

    const model = process.env.IMAGE_GENERATION_MODEL || DEFAULT_IMAGE_MODEL;
    gatewayContext = makeGatewayContext({
      user,
      featureKey: "image_task_polling",
      endpointKey: "GET /api/image-task",
      providerCode: "duomi_image_generation",
      modelName: model,
      costClass: "external_api",
      highCost: false,
      description: "多米图片任务状态查询",
      metadata: { task_id: taskId },
    });

    const dbPool = getPool();
    if (dbPool) client = await dbPool.connect();
    const modelConfig = await lookupModelConfig(client, model);
    let gatewayResult = null;
    let providerOk = true;
    let providerStatus = 200;
    let payload = {};
    let responseText = "";
    try {
      gatewayResult = await proxyProvider(
        gatewayContext,
        "duomi",
        "tasks_get",
        { task_id: taskId },
        { timeoutMs: 30000 },
      );
      payload = gatewayResult.data || {};
      responseText = JSON.stringify(payload);
    } catch (error) {
      providerOk = false;
      providerStatus = error.statusCode || 502;
      payload = error.payload?.data || error.payload || { error: error.message };
      responseText = JSON.stringify(payload);
    }
    const finishedAt = new Date();
    const latencyMs = Date.now() - startedMono;
    const images = extractImages(payload);
    const status = normalizeStatus(payload, images);
    const logWarning = await writeApiLog(client, {
      traceId: `web:image-task:${Date.now()}`,
      modelConfigId: modelConfig.model_config_id,
      credentialId: modelConfig.credential_id,
      status: providerOk ? "success" : "failed",
      requestHost: "central-api-gateway",
      requestPath: "/v1/proxy/duomi/tasks_get",
      httpStatus: providerStatus,
      startedAt,
      finishedAt,
      latencyMs,
      responseBytes: Buffer.byteLength(responseText || ""),
      errorCode: providerOk ? "" : String(payload?.error?.code || payload?.code || providerStatus),
      errorMessage: providerOk ? "" : String(payload?.error?.message || payload?.message || responseText).slice(0, 500),
      rawUsage: { task_id: taskId, task_status: status, image_count: images.length },
      metadata: {
        source: "web_image_generation_workflow",
        provider: "duomi",
        task_id: taskId,
        task_status: status,
        image_count: images.length,
        user_id: user.user_id,
        gateway_request_id: gatewayResult?.request_id || gatewayContext.requestId,
      },
    });

    if (!providerOk) {
      sendJson(res, providerStatus, {
        ok: false,
        error: payload?.error?.message || payload?.message || "图像生成任务查询失败",
        detail: payload,
        logWarning,
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      taskId,
      status,
      images,
      error: status === "failed" ? extractErrorMessage(payload) || "图像生成任务失败" : "",
      detail: payload,
      logWarning,
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "图像生成任务查询失败" });
  } finally {
    if (client) client.release();
  }
};
