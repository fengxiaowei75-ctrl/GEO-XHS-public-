const { requireAuth } = require("./_auth");
const { makeGatewayContext, proxyProvider } = require("./_gateway");

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

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const { message, conversationId, userId } = await readJsonBody(req);
    const botId = process.env.COZE_BOT_ID || "your_coze_bot_id";

    if (!message || typeof message !== "string") {
      sendJson(res, 400, { error: "缺少 message 参数" });
      return;
    }

    const gatewayContext = makeGatewayContext({
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
    const result = await proxyProvider(gatewayContext, "coze", "chat", {
      bot_id: botId,
      user_id: userId || "web-user",
      conversation_id: conversationId || undefined,
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          content: message,
          content_type: "text",
        },
      ],
    });
    sendJson(res, 200, {
      ok: true,
      data: result.data || result,
      usage: result.usage,
      cost: result.cost,
      request_id: result.request_id,
    });
  } catch (err) {
    sendJson(res, err.statusCode || 500, {
      error: "网关限制：Coze 调用暂不可用",
      detail: err.payload || (err instanceof Error ? err.message : String(err)),
    });
  }
};
