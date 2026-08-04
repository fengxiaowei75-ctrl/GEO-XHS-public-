const crypto = require("crypto");
const { requireAuth } = require("./_auth");

const DEFAULT_CONTENT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_CONTENT_MODEL = "doubao-seed-2-0-mini-260428";
const memoryCache = new Map();

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
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function truncateText(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeNotes(notes) {
  return (Array.isArray(notes) ? notes : [])
    .slice(0, 80)
    .map((item) => ({
      note_id: truncateText(item.note_id, 48),
      title: truncateText(item.title, 80),
      content: truncateText(item.content_excerpt || item.content || item.asset_text_excerpt, 260),
      topic: truncateText(item.core_topic_category, 40),
      persona: truncateText(item.primary_target_persona, 40),
      pain: truncateText(item.true_pain_label || item.pain_description, 100),
      hooks: Array.isArray(item.hook_types) ? item.hook_types.slice(0, 6) : [],
      business_logic: truncateText(item.business_logic || item.content_logic, 180),
      reusable_angle: truncateText(item.reusable_angle || item.reusable_angles_preview, 160),
      interaction_score: Number(item.interaction_score || 0),
      like_count: Number(item.like_count || 0),
      collected_count: Number(item.collected_count || 0),
      comments_count: Number(item.comments_count || 0),
    }))
    .filter((item) => item.note_id || item.title || item.content);
}

function cacheKeyFor(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("模型返回为空");
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型返回不是 JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeClusterOutput(parsed, notes, scopeLabel) {
  const clusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
  return {
    title: truncateText(parsed.title || "内容自然聚类导图", 40),
    summary: truncateText(parsed.summary || `${scopeLabel} 共分析 ${notes.length} 条笔记。`, 220),
    clusters: clusters.slice(0, 8).map((cluster, index) => ({
      id: truncateText(cluster.id || `cluster_${index + 1}`, 40),
      name: truncateText(cluster.name || `聚类 ${index + 1}`, 42),
      insight: truncateText(cluster.insight, 180),
      anxiety: truncateText(cluster.anxiety, 120),
      what_marketers_say: truncateText(cluster.what_marketers_say, 140),
      recommended_action: truncateText(cluster.recommended_action, 140),
      weight: Number(cluster.weight || 0),
      note_ids: Array.isArray(cluster.note_ids) ? cluster.note_ids.slice(0, 8).map((item) => String(item)) : [],
      children: (Array.isArray(cluster.children) ? cluster.children : []).slice(0, 6).map((child, childIndex) => ({
        id: truncateText(child.id || `${index + 1}_${childIndex + 1}`, 40),
        name: truncateText(child.name || `分支 ${childIndex + 1}`, 36),
        insight: truncateText(child.insight, 120),
        weight: Number(child.weight || 0),
      })),
    })),
  };
}

function buildPrompts({ notes, persona, rangeLabel }) {
  const scopeLabel = `${rangeLabel || "当前周期"} / ${persona || "全部人群"}`;
  const systemPrompt = [
    "你是GEO小红书内容运营策略师和信息架构师。",
    "请对给定笔记做自然聚类，不要按固定字段硬分组，而是根据用户焦虑、营销号在讲的内容、业务逻辑和可复用角度归纳主题簇。",
    "只输出合法JSON，不要Markdown，不要代码块，不要解释过程。",
  ].join("");
  const userPrompt = JSON.stringify({
    task: "对当前周期小红书笔记做自然聚类，并输出可渲染为思维导图的数据结构。",
    scope: scopeLabel,
    output_schema: {
      title: "导图标题",
      summary: "一句话概括当前周期内容格局",
      clusters: [
        {
          id: "cluster_key",
          name: "聚类名称，短句",
          insight: "这个聚类的核心洞察",
          anxiety: "用户主要焦虑",
          what_marketers_say: "营销号主要在讲什么",
          recommended_action: "运营下一步可怎么用",
          weight: "0到100，代表重要性",
          note_ids: ["支撑该聚类的note_id"],
          children: [
            { id: "child_key", name: "自然分支名称", insight: "分支洞察", weight: "0到100" },
          ],
        },
      ],
    },
    rules: [
      "clusters控制在4到7个，每个cluster的children控制在2到5个。",
      "不要输出视觉风格、标题模板。",
      "优先让运营一眼看懂：用户为什么焦虑、营销号在讲什么、我们如何复用。",
      "note_ids只能使用输入中的note_id。",
      "weight按互动量、出现频次、业务相关性综合判断。",
    ],
    notes,
  });
  return { systemPrompt, userPrompt, scopeLabel };
}

async function callContentModel({ systemPrompt, userPrompt }) {
  const apiKey = process.env.GEO_CONTENT_API_KEY || process.env.ARK_CHAT_API_KEY || process.env.KIMI_API_KEY;
  const baseUrl = (process.env.GEO_CONTENT_BASE_URL || process.env.ARK_CHAT_BASE_URL || process.env.KIMI_BASE_URL || DEFAULT_CONTENT_BASE_URL).replace(/\/$/, "");
  const model = process.env.GEO_CONTENT_MODEL || process.env.ARK_CHAT_MODEL || process.env.KIMI_MODEL || DEFAULT_CONTENT_MODEL;
  const temperature = Number(process.env.GEO_CONTENT_TEMPERATURE || process.env.ARK_CHAT_TEMPERATURE || process.env.KIMI_TEMPERATURE || 0.35);
  const thinking = process.env.GEO_CONTENT_THINKING || process.env.ARK_CHAT_THINKING || process.env.KIMI_THINKING || "disabled";

  if (!apiKey) {
    const error = new Error("服务端缺少 GEO_CONTENT_API_KEY / ARK_CHAT_API_KEY / KIMI_API_KEY");
    error.statusCode = 500;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature,
  };
  if (thinking === "disabled") body.thinking = { type: "disabled" };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`内容聚类模型调用失败: HTTP ${response.status}`);
      error.detail = text.slice(0, 500);
      error.statusCode = response.status;
      throw error;
    }
    const payload = JSON.parse(text);
    return {
      text: payload.choices?.[0]?.message?.content || payload.output_text || "",
      model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
    return;
  }

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const payload = await readJsonBody(req);
    const notes = normalizeNotes(payload.notes);
    if (!notes.length) {
      sendJson(res, 400, { ok: false, error: "缺少可分析笔记" });
      return;
    }

    const { systemPrompt, userPrompt, scopeLabel } = buildPrompts({
      notes,
      persona: payload.persona,
      rangeLabel: payload.rangeLabel,
    });
    const cacheKey = cacheKeyFor({ notes, persona: payload.persona || "", rangeLabel: payload.rangeLabel || "" });
    if (!payload.forceRefresh && memoryCache.has(cacheKey)) {
      sendJson(res, 200, { ok: true, cached: true, ...memoryCache.get(cacheKey) });
      return;
    }

    const startedAt = Date.now();
    const modelResult = await callContentModel({ systemPrompt, userPrompt });
    const parsed = extractJson(modelResult.text);
    const mindMap = normalizeClusterOutput(parsed, notes, scopeLabel);
    const result = {
      mindMap,
      model: modelResult.model,
      noteCount: notes.length,
      cacheKey,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
    memoryCache.set(cacheKey, result);
    sendJson(res, 200, { ok: true, cached: false, ...result });
  } catch (err) {
    sendJson(res, err.statusCode || 500, {
      ok: false,
      error: err.message || "内容聚类失败",
      detail: err.detail,
    });
  }
};
