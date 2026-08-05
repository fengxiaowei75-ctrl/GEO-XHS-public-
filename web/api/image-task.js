const { requireAuth } = require("./_auth");

const DEFAULT_TASK_API_URL = "https://duomiapi.com/v1/tasks";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function cleanText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
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

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
    return;
  }

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const url = new URL(req.url, "http://localhost");
    const taskId = cleanText(url.searchParams.get("taskId") || url.searchParams.get("id"), 160);
    const apiKey = process.env.IMAGE_GENERATION_API_KEY;
    if (!taskId) {
      sendJson(res, 400, { ok: false, error: "缺少 taskId" });
      return;
    }
    if (!apiKey) {
      sendJson(res, 500, { ok: false, error: "服务端缺少 IMAGE_GENERATION_API_KEY" });
      return;
    }

    const endpoint = taskUrlFor(taskId);
    const providerRes = await fetch(endpoint, {
      method: "GET",
      headers: imageProviderHeaders(apiKey),
    });
    const responseText = await providerRes.text();
    let payload = {};
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { raw_text: responseText };
    }

    if (!providerRes.ok) {
      sendJson(res, providerRes.status, {
        ok: false,
        error: payload?.error?.message || payload?.message || "图像生成任务查询失败",
        detail: payload,
      });
      return;
    }

    const images = extractImages(payload);
    const status = normalizeStatus(payload, images);
    sendJson(res, 200, {
      ok: true,
      taskId,
      status,
      images,
      error: status === "failed" ? extractErrorMessage(payload) || "图像生成任务失败" : "",
      detail: payload,
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "图像生成任务查询失败" });
  }
};
