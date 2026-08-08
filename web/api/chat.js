const DEFAULT_COZE_API_BASE = "https://api.coze.cn";
const { requireAuth } = require("./_auth");
const { checkGateway, makeGatewayContext, reportGateway } = require("./_gateway");

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "仅支持 POST 请求" });
    return;
  }

  const startedMono = Date.now();
  let gatewayContext = null;
  let gatewayDecision = null;
  let gatewayReported = false;

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const { message, conversationId, userId } = await readJsonBody(req);
    const token = process.env.COZE_API_TOKEN;
    const botId = process.env.COZE_BOT_ID || "your_coze_bot_id";
    const apiBase = process.env.COZE_API_BASE || DEFAULT_COZE_API_BASE;

    if (!message || typeof message !== "string") {
      sendJson(res, 400, { error: "缺少 message 参数" });
      return;
    }

    if (!token || !botId) {
      sendJson(res, 500, { error: "服务端缺少 COZE_API_TOKEN 或 COZE_BOT_ID" });
      return;
    }

    gatewayContext = makeGatewayContext({
      user,
      featureKey: "coze_chat",
      endpointKey: "POST /api/chat",
      providerCode: "coze_chat",
      modelName: botId,
      costClass: "llm_chat",
      highCost: true,
      description: "Coze Agent 流式聊天",
      metadata: {
        conversation_id: conversationId || null,
        message_chars: message.length,
      },
    });
    try {
      gatewayDecision = await checkGateway(gatewayContext);
    } catch (error) {
      if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
      sendJson(res, error.statusCode || 503, {
        error: "网关限制：Coze 调用暂不可用",
        detail: error.gateway || error.message,
      });
      return;
    }

    const url = new URL(`${apiBase.replace(/\/$/, "")}/v3/chat`);
    if (conversationId) {
      url.searchParams.set("conversation_id", conversationId);
    }

    const cozeRes = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bot_id: botId,
        user_id: userId || "web-user",
        stream: true,
        auto_save_history: true,
        additional_messages: [
          {
            role: "user",
            content: message,
            content_type: "text",
          },
        ],
      }),
    });

    if (!cozeRes.ok) {
      const detail = await cozeRes.text();
      await reportGateway(
        { ...gatewayContext, ...(gatewayDecision || {}) },
        {
          status: "failed",
          latencyMs: Date.now() - startedMono,
          errorCode: String(cozeRes.status),
          errorMessage: detail.slice(0, 500),
          metadata: { upstream_status: cozeRes.status },
        },
      );
      gatewayReported = true;
      sendJson(res, cozeRes.status, {
        error: `Coze API 错误: ${cozeRes.status}`,
        detail,
      });
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const reader = cozeRes.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }

    res.end();
    await reportGateway(
      { ...gatewayContext, ...(gatewayDecision || {}) },
      {
        status: "success",
        latencyMs: Date.now() - startedMono,
        metadata: { stream: true },
      },
    );
    gatewayReported = true;
  } catch (err) {
    if (gatewayContext && !gatewayReported) {
      await reportGateway(
        { ...gatewayContext, ...(gatewayDecision || {}) },
        {
          status: "failed",
          latencyMs: Date.now() - startedMono,
          errorCode: "request_exception",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      );
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, err.statusCode || 500, {
      error: "服务器内部错误",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
};
