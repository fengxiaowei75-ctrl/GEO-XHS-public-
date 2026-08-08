const crypto = require("crypto");

const DEFAULT_TIMEOUT_MS = 10000;
const PROJECT_CODE = "geo-xhs";

function cleanText(value) {
  return String(value || "").trim();
}

function gatewayConfig() {
  const baseUrl = cleanText(process.env.GATEWAY_BASE_URL);
  const token = cleanText(process.env.GATEWAY_SERVICE_TOKEN);
  if (!baseUrl || !token) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    token,
  };
}

function isProductionLike() {
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");
}

function makeGatewayContext({
  requestId,
  featureKey,
  endpointKey,
  providerCode,
  modelName,
  costClass = "unknown",
  highCost = true,
  user,
  description = "",
  metadata = {},
}) {
  return {
    requestId: requestId || `geo-xhs:${featureKey || "api"}:${Date.now()}:${crypto.randomUUID()}`,
    projectCode: PROJECT_CODE,
    featureKey,
    endpointKey,
    providerCode: providerCode || null,
    modelName: modelName || null,
    costClass,
    highCost: Boolean(highCost),
    userRef: user?.user_id ? String(user.user_id) : user?.username || null,
    role: user?.role || null,
    description,
    metadata,
  };
}

async function requestGateway(path, payload) {
  const config = gatewayConfig();
  if (!config) {
    if (isProductionLike()) {
      const error = new Error("缺少 GATEWAY_BASE_URL 或 GATEWAY_SERVICE_TOKEN");
      error.statusCode = 503;
      throw error;
    }
    return { skipped: true, allowed: true, requestId: payload.requestId || `geo-xhs:${Date.now()}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw_text: text };
    }
    if (!response.ok) {
      const error = new Error(data.error || data.message || `gateway_${path.replace(/^\//, "").replace(/\//g, "_")}_failed`);
      error.statusCode = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") {
      const timeoutError = new Error("gateway_timeout");
      timeoutError.statusCode = 503;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function checkGateway(context) {
  const result = await requestGateway("/api/gateway/check", context);
  if (result && result.allowed === false) {
    const error = new Error(result.error || result.reason || "gateway_blocked");
    error.statusCode = result.status === "quota_exceeded" || result.status === "rate_limited" ? 429 : 403;
    error.gateway = result;
    error.retryAfterSeconds = result.retryAfterSeconds;
    throw error;
  }
  return result;
}

async function reportGateway(context, result) {
  try {
    const windowSeconds = result.windowSeconds || context.windowSeconds || context.policy?.windowSeconds;
    return await requestGateway("/api/gateway/report", {
      ...context,
      windowSeconds,
      ...result,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      statusCode: error.statusCode || 500,
      payload: error.payload || null,
    };
  }
}

module.exports = {
  checkGateway,
  makeGatewayContext,
  reportGateway,
};
