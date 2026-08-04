const DEFAULT_COZE_API_BASE = "https://api.coze.cn";
const { requireAuth } = require("./_auth");

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
  } catch (err) {
    sendJson(res, 500, {
      error: "服务器内部错误",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
};
