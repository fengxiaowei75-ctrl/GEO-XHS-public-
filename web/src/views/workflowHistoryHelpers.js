import {
  dedupeImageVersions,
  generatedImagesForSave,
  imageResultGroupId,
  imageWorkflowHistoryKey,
  imageWorkflowHistoryUpdatedEvent,
  fixedContentHistoryKey,
  fixedContentHistoryUpdatedEvent,
  maxFixedContentHistory,
  maxImageWorkflowHistory,
  maxWorkflowImages,
  normalizeWorkflowImagePrompts,
  promptPayloadForSave,
  socialPlatformLabels,
} from "./workflowImageHelpers";

function markdownSection(title, value) {
  return [`## ${title}`, "", String(value || "").trim() || "暂无", ""].join("\n");
}

function imageOutputMarkdown(item) {
  const form = item?.form || {};
  const sourceImages = Array.isArray(item?.sourceImages) ? item.sourceImages.filter((image) => image?.url).slice(0, maxWorkflowImages) : [];
  const images = generatedImagesForSave(item?.result);
  const sourceImageRows = sourceImages.length
    ? sourceImages
        .map((image) => `- ${image.label || `原笔记图 ${image.slot || ""}`}: ${image.url}${image.source ? `\n  - 来源：${image.source}` : ""}`)
        .join("\n")
    : "暂无";
  const imageRows = images.length
    ? images.map((image) => `- ${image.label || `第${image.slot}张 v${image.version || 1}`}: ${image.url}${image.editInstruction ? `\n  - 改图要求：${image.editInstruction}` : ""}`).join("\n")
    : "暂无";
  return [
    `# ${form.title || form.noteId || "GEO 图生图产出"}`,
    "",
    `笔记 ID：${form.noteId || "-"}`,
    `产出时间：${item?.createdAt || "-"}`,
    item?.updatedAt ? `更新时间：${item.updatedAt}` : "",
    "",
    markdownSection("笔记标题", form.title),
    markdownSection("笔记文案", form.content),
    markdownSection("目标人群画像", form.targetPersona),
    markdownSection("用户痛点", form.userPain),
    markdownSection("业务逻辑", form.businessLogic),
    markdownSection("业务知识点", form.businessKnowledge),
    markdownSection("整组风格/全局补充", form.imagePrompt),
    "## 原笔记图片",
    "",
    sourceImageRows,
    "",
    "## 逐图提示词",
    "",
    normalizeWorkflowImagePrompts(form.imagePrompts)
      .map((prompt) => `### 第${prompt.slot}张\n\n${prompt.prompt}`)
      .join("\n\n") || "暂无",
    "",
    "## 图片版本",
    "",
    imageRows,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function socialOutputMarkdown(item) {
  const form = item?.form || {};
  const draft = item?.socialDraft || {};
  const platformLabel = socialPlatformLabels[item?.socialPlatform] || draft.platformLabel || "社媒";
  return [
    `# ${form.title || form.noteId || "社媒内容草稿"}`,
    "",
    `平台：${platformLabel}`,
    `笔记 ID：${form.noteId || "-"}`,
    `产出时间：${item?.updatedAt || item?.createdAt || "-"}`,
    "",
    sanitizeXhsDraftContent(draft.content) || "暂无",
    "",
  ].join("\n");
}

function historyDocumentsForItem(item) {
  const docs = [{ key: "image-output", label: "图生图产出.md", filename: "图生图产出.md", content: imageOutputMarkdown(item) }];
  if (item?.socialDraft?.content) {
    docs.push({ key: "social-output", label: "社媒内容.md", filename: "社媒内容.md", content: socialOutputMarkdown(item) });
  }
  return docs;
}

function downloadBlob(blob, fallbackFilename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTextFile(filename, content) {
  downloadBlob(new Blob([content], { type: "text/markdown;charset=utf-8" }), filename);
}

function filenameFromDisposition(value, fallback) {
  const matched = String(value || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (!matched) return fallback;
  try {
    return decodeURIComponent(matched[1]);
  } catch {
    return fallback;
  }
}

function readImageWorkflowHistory() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(imageWorkflowHistoryKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => generatedImagesForSave(item?.result).length).slice(0, maxImageWorkflowHistory) : [];
  } catch {
    return [];
  }
}

function writeImageWorkflowHistory(items) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(imageWorkflowHistoryKey, JSON.stringify(items.slice(0, maxImageWorkflowHistory)));
    window.dispatchEvent(new CustomEvent(imageWorkflowHistoryUpdatedEvent));
  } catch {
    // Browser storage can fail when image URLs or drafts are too large; the UI still keeps current state.
  }
}

function upsertImageWorkflowHistoryItem(item, currentItems = []) {
  const storedItems = readImageWorkflowHistory();
  const source = storedItems.length ? storedItems : currentItems;
  const existing = source.find((historyItem) => historyItem.id === item.id);
  const mergedItem = existing ? { ...item, createdAt: existing.createdAt || item.createdAt, updatedAt: item.createdAt } : item;
  const next = [mergedItem, ...source.filter((historyItem) => historyItem.id !== item.id)].slice(0, maxImageWorkflowHistory);
  writeImageWorkflowHistory(next);
  return next;
}

function readFixedContentHistory() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(fixedContentHistoryKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => generatedImagesForSave(item?.result).length).slice(0, maxFixedContentHistory) : [];
  } catch {
    return [];
  }
}

function writeFixedContentHistory(items) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(fixedContentHistoryKey, JSON.stringify(items.slice(0, maxFixedContentHistory)));
    window.dispatchEvent(new CustomEvent(fixedContentHistoryUpdatedEvent));
  } catch {
    // Browser storage can fail when image URLs or drafts are too large; the UI still keeps current state.
  }
}

function upsertFixedContentHistoryItem(item, currentItems = []) {
  const storedItems = readFixedContentHistory();
  const source = storedItems.length ? storedItems : currentItems;
  const existing = source.find((historyItem) => historyItem.id === item.id);
  const mergedItem = existing ? { ...item, createdAt: existing.createdAt || item.createdAt, updatedAt: item.createdAt } : item;
  const next = [mergedItem, ...source.filter((historyItem) => historyItem.id !== item.id)].slice(0, maxFixedContentHistory);
  writeFixedContentHistory(next);
  return next;
}

function reviewDraftSourceLabel(source) {
  return source === "fixed" ? "固定内容流" : "爆文洗稿流";
}

function normalizeReviewDraft(item, source) {
  const socialDraft = item?.socialDraft
    ? {
        ...item.socialDraft,
        content: sanitizeXhsDraftContent(item.socialDraft.content),
      }
    : null;
  return {
    ...item,
    reviewId: `${source}:${item.id}`,
    source,
    sourceLabel: reviewDraftSourceLabel(source),
    status: item.status || "待审核",
    socialDraft,
  };
}

function readReviewDrafts() {
  return [
    ...readFixedContentHistory().map((item) => normalizeReviewDraft(item, "fixed")),
    ...readImageWorkflowHistory().map((item) => normalizeReviewDraft(item, "image")),
  ].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

function writeReviewDraftItem(draft) {
  const item = {
    ...draft,
    updatedAt: new Date().toISOString(),
    status: draft.status || "待审核",
  };
  delete item.reviewId;
  delete item.source;
  delete item.sourceLabel;
  if (draft.source === "fixed") {
    const next = upsertFixedContentHistoryItem(item);
    return normalizeReviewDraft(next.find((historyItem) => historyItem.id === item.id) || item, "fixed");
  }
  const next = upsertImageWorkflowHistoryItem(item);
  return normalizeReviewDraft(next.find((historyItem) => historyItem.id === item.id) || item, "image");
}

function draftPackagePayloadFromItem(item, options = {}) {
  const form = item?.form || {};
  const noteDetail = options.noteDetail || item?.noteDetail || null;
  const socialContent = options.socialContent ?? (item?.socialDraft?.content || "");
  const sourceImages = options.sourceImages || item?.sourceImages || [];
  return {
    platform: item?.socialPlatform || item?.socialDraft?.platform || "xhs",
    producedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
    noteId: form.noteId || item?.noteId || "",
    title: form.title || item?.noteTitle || noteDetail?.title || "",
    content: form.content || noteDetail?.content || "",
    targetPersona: form.targetPersona || noteDetail?.primary_target_persona || "",
    userPain: form.userPain || noteDetail?.true_pain_label || "",
    businessLogic: form.businessLogic || noteDetail?.business_logic || "",
    businessKnowledge: form.businessKnowledge || noteDetail?.business_knowledge || "",
    imagePrompt: promptPayloadForSave(form),
    socialContent: sanitizeXhsDraftContent(socialContent),
    images: generatedImagesForSave(item?.result),
    sourceImages: Array.isArray(sourceImages) ? sourceImages.filter((image) => image?.url).slice(0, maxWorkflowImages) : [],
  };
}

function draftItemNoteId(item) {
  return item?.form?.noteId || item?.noteId || "";
}

function draftItemTitle(item) {
  return item?.form?.title || item?.noteTitle || item?.note?.title || item?.title || draftItemNoteId(item) || "未命名草稿";
}

function draftItemSourceLabel(item) {
  return item?.sourceLabel || "待审核";
}

function draftItemSocialContent(item) {
  return sanitizeXhsDraftContent(item?.socialDraft?.content || "");
}

function draftItemImages(item) {
  return generatedImagesForSave(item?.result);
}

function draftItemSourceImages(item) {
  return Array.isArray(item?.sourceImages) ? item.sourceImages.filter((image) => image?.url).slice(0, maxWorkflowImages) : [];
}

function historyFormSnapshot(form) {
  return {
    noteId: form.noteId || "",
    title: form.title || "",
    content: form.content || "",
    targetPersona: form.targetPersona || "",
    userPain: form.userPain || "",
    businessLogic: form.businessLogic || "",
    businessKnowledge: form.businessKnowledge || "",
    imagePrompt: form.imagePrompt || "",
    imagePrompts: normalizeWorkflowImagePrompts(form.imagePrompts),
    unifiedVisualStyle: form.unifiedVisualStyle !== false,
    referenceImageName: form.referenceImageName || "",
    size: form.size || "1024x1024",
    imageCount: form.imageCount || "1",
  };
}

function compactImageResult(result) {
  const tasks = (result?.tasks || []).slice(0, maxWorkflowImages).map((task) => ({
    slot: Number(task.slot || 0),
    taskId: task.taskId || "",
    status: task.status || "",
    images: dedupeImageVersions(task.images || [])
      .filter((image) => image?.url)
      .map((image, index) => ({
        id: image.id,
        url: image.url,
        slot: Number(image.slot || task.slot || 0),
        version: Number(image.version || index + 1),
        taskId: image.taskId || task.taskId || "",
        editedAt: image.editedAt || "",
        editInstruction: image.editInstruction || "",
      })),
  }));
  const sourceImages = (result?.images || []).filter((image) => image?.url).length ? result.images : tasks.flatMap((task) => task.images || []);
  const images = dedupeImageVersions(sourceImages || []).map((image, index) => ({
    id: image.id || `history-image-${index}`,
    url: image.url,
    slot: Number(image.slot || index + 1),
    version: Number(image.version || index + 1),
    taskId: image.taskId || "",
    editedAt: image.editedAt || "",
    editInstruction: image.editInstruction || "",
  }));
  return {
    ok: true,
    groupId: imageResultGroupId(result),
    taskId: result?.taskId || "",
    taskIds: result?.taskIds || [],
    tasks,
    status: result?.status || "succeeded",
    images,
    imageCount: result?.imageCount || images.length || 1,
    model: result?.model || "",
    size: result?.size || "",
    prompt: String(result?.prompt || "").slice(0, 60000),
    latencyMs: result?.latencyMs || 0,
    logWarning: result?.logWarning || "",
  };
}

function sanitizeXhsDraftContent(value) {
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

function compactSocialDraft(draft) {
  if (!draft?.content) return null;
  return {
    platform: draft.platform,
    platformLabel: draft.platformLabel,
    content: sanitizeXhsDraftContent(draft.content),
    model: draft.model || "",
    latencyMs: draft.latencyMs || 0,
  };
}

export {
  markdownSection,
  imageOutputMarkdown,
  socialOutputMarkdown,
  historyDocumentsForItem,
  downloadBlob,
  downloadTextFile,
  filenameFromDisposition,
  readImageWorkflowHistory,
  writeImageWorkflowHistory,
  upsertImageWorkflowHistoryItem,
  readFixedContentHistory,
  writeFixedContentHistory,
  upsertFixedContentHistoryItem,
  reviewDraftSourceLabel,
  normalizeReviewDraft,
  readReviewDrafts,
  writeReviewDraftItem,
  draftPackagePayloadFromItem,
  draftItemNoteId,
  draftItemTitle,
  draftItemSourceLabel,
  draftItemSocialContent,
  draftItemImages,
  draftItemSourceImages,
  historyFormSnapshot,
  compactImageResult,
  sanitizeXhsDraftContent,
  compactSocialDraft,
};
