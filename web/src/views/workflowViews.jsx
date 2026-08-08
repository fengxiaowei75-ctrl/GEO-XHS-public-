import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Filter,
  Gauge,
  Heart,
  ImagePlus,
  KeyRound,
  Layers3,
  ListChecks,
  LogOut,
  MessageCircle,
  PencilLine,
  RefreshCcw,
  Save,
  Search,
  Shield,
  Sparkles,
  Target,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import "tippy.js/dist/tippy.css";
import { ChatWidget } from "../components/ChatWidget";
import { ApiStatusComboChart } from "../components/charts/ApiStatusComboChart";
import { LineChart } from "../components/charts/LineChart";
import { TimeWindowSlider } from "../components/charts/TimeWindowSlider";
import { BarRow } from "../components/data/BarRow";
import { Stat } from "../components/data/StatCard";
import { StatusPill } from "../components/data/StatusPill";
import { SectionHeader } from "../components/layout/SectionHeader";
import { ViewErrorBoundary } from "../components/layout/ViewErrorBoundary";
import { SelectControl } from "../components/form/SelectControl";
import { SegmentedControl } from "../components/form/SegmentedControl";
import { ImageEditPanel } from "../components/workflows/ImageEditPanel";
import { ImagePreviewModal } from "../components/workflows/ImagePreviewModal";
import { ImageWorkflowField } from "../components/workflows/ImageWorkflowField";
import { WorkflowSteps } from "../components/workflows/WorkflowSteps";
import { chartColors } from "../constants/chartColors";
import { navItems } from "../constants/navConfig";
import { modelProviderTypes } from "../constants/providerLabels";
import { useAuth } from "../hooks/useAuth";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDraftReview } from "../hooks/useDraftReview";
import { useImageGeneration } from "../hooks/useImageGeneration";
import { requestJson } from "../hooks/useRequestJson";
import {
  activeEndataPeriod,
  arrayText,
  deltaClass,
  endataPeriodOptions,
  endataRangeLabel,
  formatCompact,
  formatDate,
  formatDateTimeSecond,
  formatDuration,
  formatMoney,
  formatMoneyDelta,
  formatNumber,
  formatPercent,
  formatScore,
  formatShortDate,
  formatSignedNumber,
  modelDisplayName,
  providerDisplayName,
  providerTypeLabel,
  statusTone,
  textPreview,
} from "../utils/formatters";
import {
  addDays,
  buildBucketDomain,
  dateKeyFromValue,
  dayStart,
  formatDayLabel,
  getMonthKey,
  latestBucketDate,
  localDateInputValue,
  monthLabel,
  noteDateKey,
  normalizeBucketStart,
  rangeForLastDays,
  todayInputValue,
} from "../utils/dates";
import { firstStructuredText, latestEndataSnapshot, listItems, noteContentText, structuredText } from "../utils/collections";
import { canAccess, firstAllowedView } from "../utils/validators";

const ReactWordcloud = lazy(() =>
  import("@cp949/react-wordcloud").then((module) => ({
    default: module.default || module.ReactWordcloud,
  })),
);

const emptyImageWorkflowForm = {
  noteId: "",
  title: "",
  content: "",
  targetPersona: "",
  userPain: "",
  businessLogic: "",
  businessKnowledge: "",
  imagePrompt: "",
  imagePrompts: [],
  unifiedVisualStyle: true,
  referenceImage: "",
  referenceImageName: "",
  size: "1024x1024",
  imageCount: "1",
};

const socialPlatformOptions = [
  { value: "xhs", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "wechat", label: "公众号" },
  { value: "zhihu", label: "知乎" },
];

const socialPlatformLabels = Object.fromEntries(socialPlatformOptions.map((item) => [item.value, item.label]));
const imageWorkflowHistoryKey = "geo:image-generation-workflow-history:v1";
const maxImageWorkflowHistory = 12;
const fixedContentHistoryKey = "geo:fixed-content-workflow-history:v1";
const maxFixedContentHistory = 24;
const maxWorkflowImages = 10;
const maxImageTaskPollAttempts = 24;
const imageWorkflowHistoryUpdatedEvent = "geo:image-workflow-history-updated:v1";
const fixedContentHistoryUpdatedEvent = "geo:fixed-content-history-updated:v1";

function normalizeWorkflowImageCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(maxWorkflowImages, Math.floor(count)));
}

function normalizeWorkflowImagePrompts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => ({
      slot: normalizeWorkflowImageCount(item?.slot || index + 1),
      prompt: String(typeof item === "string" ? item : item?.prompt || "")
        .trim()
        .slice(0, 5000),
      imageUrl: String(item?.imageUrl || item?.image_url || "").trim(),
    }))
    .filter((item) => item.prompt)
    .slice(0, maxWorkflowImages);
}

function imagePromptAt(form, slot) {
  const prompts = normalizeWorkflowImagePrompts(form.imagePrompts);
  return prompts.find((item) => Number(item.slot) === slot)?.prompt || prompts[slot - 1]?.prompt || "";
}

function hasWorkflowPrompt(form) {
  return Boolean(String(form.imagePrompt || "").trim() || normalizeWorkflowImagePrompts(form.imagePrompts).length);
}

function promptPayloadForSave(form) {
  const rows = [];
  if (String(form.imagePrompt || "").trim()) rows.push(`【整组风格/全局补充】\n${form.imagePrompt.trim()}`);
  normalizeWorkflowImagePrompts(form.imagePrompts).forEach((item) => {
    rows.push(`【第${item.slot}张原图对应提示词】\n${item.prompt}`);
  });
  return rows.join("\n\n");
}

function imagePromptSummary(form) {
  const promptCount = normalizeWorkflowImagePrompts(form.imagePrompts).length;
  const globalText = String(form.imagePrompt || "").trim();
  if (promptCount) return `${globalText ? "整组已填" : "整组未填"} · 逐图${promptCount}条`;
  return globalText ? textPreview(globalText, 96) : "未填写";
}

function imageWorkflowFormFromNote(note, current) {
  const imagePrompts = normalizeWorkflowImagePrompts(note.image_prompts);
  const imageCount = normalizeWorkflowImageCount(note.suggested_image_count || imagePrompts.length || current.imageCount);
  return {
    ...current,
    noteId: note.note_id || current.noteId,
    title: note.title || "",
    content: note.content || "",
    targetPersona: note.target_persona || "",
    userPain: note.user_pain || "",
    businessLogic: note.business_logic || "",
    businessKnowledge: note.business_knowledge || "",
    imagePrompt: note.visual_prompt || current.imagePrompt || "",
    imagePrompts: imagePrompts.length ? imagePrompts : current.imagePrompts || [],
    imageCount: String(imageCount),
  };
}

function imageTaskStatusLabel(status) {
  const labels = {
    queued: "排队中",
    processing: "生成中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
  };
  return labels[status] || status || "生成中";
}

function imageResultGroupId(result) {
  if (result?.groupId) return result.groupId;
  if (result?.taskIds?.length) return result.taskIds.join("|");
  if (result?.taskId) return result.taskId;
  const imageKey = (result?.images || []).map((image) => image?.url).filter(Boolean).join("|");
  return imageKey || "";
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function imageTaskPollDelay(attempt) {
  if (attempt === 0) return 4500;
  if (attempt < 3) return 6500;
  return 10000;
}

function normalizeResultImage(image, fallbackSlot, fallbackVersion = 1) {
  if (!image?.url) return null;
  const slot = normalizeWorkflowImageCount(image.slot || fallbackSlot || 1);
  return {
    id: image.id || `image-${slot}-${fallbackVersion}`,
    url: image.url,
    slot,
    version: Number(image.version || fallbackVersion),
    taskId: image.taskId || "",
    editedAt: image.editedAt || "",
    editInstruction: image.editInstruction || "",
  };
}

function dedupeImageVersions(images) {
  const seen = new Set();
  return images.filter((image) => {
    if (!image?.url || seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

function imageVersionsForSlot(result, slot) {
  const fallbackSlot = normalizeWorkflowImageCount(slot);
  const collected = [];
  (result?.images || []).forEach((image, index) => {
    const normalized = normalizeResultImage(image, image.slot || index + 1, index + 1);
    if (normalized?.slot === fallbackSlot) collected.push(normalized);
  });
  (result?.tasks || []).forEach((task) => {
    (task.images || []).forEach((image, index) => {
      const normalized = normalizeResultImage({ ...image, taskId: image.taskId || task.taskId }, task.slot || fallbackSlot, index + 1);
      if (normalized?.slot === fallbackSlot) collected.push(normalized);
    });
  });
  return dedupeImageVersions(collected).map((image, index) => ({ ...image, version: index + 1 }));
}

function allImageVersions(result) {
  return Array.from({ length: maxWorkflowImages }, (_, index) => imageVersionsForSlot(result, index + 1)).flat();
}

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

function imageSlotItems(result) {
  const slots = Array.from({ length: maxWorkflowImages }, (_, index) => ({
    slot: index + 1,
    image: null,
    versions: [],
    versionCount: 0,
    status: "empty",
  }));
  (result?.tasks || []).forEach((task) => {
    const slotIndex = Number(task.slot || 0) - 1;
    if (slotIndex >= 0 && slotIndex < maxWorkflowImages) {
      slots[slotIndex].status = task.status || result?.status || "processing";
      slots[slotIndex].taskId = task.taskId;
    }
  });
  slots.forEach((slot) => {
    const versions = imageVersionsForSlot(result, slot.slot);
    if (!versions.length) return;
    slot.versions = versions;
    slot.versionCount = versions.length;
    slot.image = versions[versions.length - 1];
    slot.status = "succeeded";
  });
  return slots;
}

function imageVersionDisplayItems(result, imageCount = maxWorkflowImages, includeEmpty = false) {
  const activeCount = normalizeWorkflowImageCount(imageCount);
  return imageSlotItems(result).flatMap((slot) => {
    const active = slot.slot <= activeCount;
    if (slot.versions.length) {
      return slot.versions.map((image) => ({
        key: `${slot.slot}-${image.version}-${image.url}`,
        slot: slot.slot,
        image,
        active,
        status: "succeeded",
        versionCount: slot.versionCount,
        isLatest: Number(image.version || 1) === slot.versionCount,
      }));
    }
    return includeEmpty
      ? [
          {
            key: `empty-${slot.slot}`,
            slot: slot.slot,
            image: null,
            active,
            status: slot.status,
            versionCount: 0,
            isLatest: false,
          },
        ]
      : [];
  });
}

function imageVersionBadge(image) {
  const slot = Number(image?.slot || 0);
  const version = Number(image?.version || 1);
  if (!slot) return version > 1 ? `v${version}` : "v1";
  return version > 1 ? `${slot}-v${version}` : `${slot}-v1`;
}

function imageVersionLabel(image) {
  const slot = Number(image?.slot || 0);
  const version = Number(image?.version || 1);
  const base = slot ? `第${slot}张` : "图片";
  return version > 1 ? `${base} v${version} 改图` : `${base} v1 原图`;
}

function generatedImagesForSave(result) {
  return allImageVersions(result).map((image) => ({
    slot: image.slot,
    version: image.version,
    url: image.url,
    label: imageVersionLabel(image),
    editedAt: image.editedAt || "",
    editInstruction: image.editInstruction || "",
  }));
}

function buildImageEditPrompt({ slot, originalPrompt, instruction, branchIndex = 1, branchTotal = 1 }) {
  return [
    "【改图任务】",
    `这是对当前组图第${slot}张已有产出进行改图，不是重新生成整组。随请求传入的垫图/参考图就是当前渲染框里的图片结果。`,
    "请以当前图片结果为基础，只执行用户本次修改点；没有提到的主体、构图、信息层级、风格、配色、字体气质和已经正确的文字尽量保留。",
    "不要复制其他图片的内容模块，不要把第1张/封面逻辑套到这张图上。",
    branchTotal > 1
      ? `本次需要从当前图片派生${branchTotal}张图。当前是派生结果第${branchIndex}张：必须和其他派生图主题连续，但版式、信息层级或画面侧重点要有明显差异。`
      : "",
    "",
    "【当前图原始提示词】",
    originalPrompt || "暂无逐图原始提示词，请参考全局内容资产和当前图片结果。",
    "",
    "【用户本次修改点】",
    instruction,
  ].join("\n");
}

function firstEmptyImageSlot(result, reserved = new Set()) {
  const occupied = new Set(imageSlotItems(result).filter((slot) => slot.versions.length).map((slot) => slot.slot));
  for (let slot = 1; slot <= maxWorkflowImages; slot += 1) {
    if (!occupied.has(slot) && !reserved.has(slot)) return slot;
  }
  return null;
}

function appendEditedImages(currentResult, slot, editResult, editImages, editInstruction, latencyMs) {
  const targetSlot = normalizeWorkflowImageCount(slot);
  const groupId = imageResultGroupId(currentResult) || imageResultGroupId(editResult) || `image-group-${Date.now()}`;
  const editImageItems = (editImages || []).filter((image) => image?.url).slice(0, 2);
  const reservedSlots = new Set();
  let tasks = Array.isArray(currentResult?.tasks) ? currentResult.tasks.map((task) => ({ ...task, images: [...(task.images || [])] })) : [];
  let images = [...(currentResult?.images || [])];

  editImageItems.forEach((editImage, index) => {
    const nextSlot = index === 0 ? targetSlot : firstEmptyImageSlot({ ...(currentResult || {}), tasks, images }, reservedSlots);
    if (!nextSlot) return;
    reservedSlots.add(nextSlot);
    const existingVersions = imageVersionsForSlot({ ...(currentResult || {}), tasks, images }, nextSlot);
    const nextVersion = existingVersions.length + 1;
    const taskId = editResult?.tasks?.[index]?.taskId || editResult?.taskIds?.[index] || editResult?.taskId || editImage?.taskId || "";
    const nextImage = {
      ...editImage,
      id: editImage?.id || `slot-${nextSlot}-v${nextVersion}`,
      slot: nextSlot,
      version: nextVersion,
      taskId,
      editedAt: new Date().toISOString(),
      editInstruction: index === 0 ? editInstruction : `由第${targetSlot}张拆分新增：${editInstruction}`,
    };
    const taskFound = tasks.some((task) => Number(task.slot) === nextSlot);
    tasks = tasks.map((task) => {
      if (Number(task.slot) !== nextSlot) return task;
      return {
        ...task,
        taskId: task.taskId || taskId,
        status: "succeeded",
        images: dedupeImageVersions([...(task.images || []), nextImage]),
      };
    });
    if (!taskFound) {
      tasks.push({ slot: nextSlot, taskId, status: "succeeded", images: [nextImage] });
    }
    images = dedupeImageVersions([...images, nextImage]);
  });

  const taskIds = Array.from(new Set([...(currentResult?.taskIds || []), ...(editResult?.taskIds || [])].filter(Boolean)));
  const prompts = [currentResult?.prompt, `--- 第${targetSlot}张改图发送提示词 ---\n${editResult?.prompt || ""}`].filter(Boolean).join("\n\n");
  const imageCount = Math.max(Number(currentResult?.imageCount || 0) || 1, ...images.map((image) => Number(image.slot || 0)).filter(Boolean));
  return {
    ...(currentResult || {}),
    ok: true,
    groupId,
    taskId: currentResult?.taskId || editResult?.taskId || "",
    taskIds,
    tasks,
    images,
    imageCount,
    status: "succeeded",
    model: currentResult?.model || editResult?.model || "",
    size: currentResult?.size || editResult?.size || "",
    prompt: prompts.slice(0, 60000),
    latencyMs,
    logWarning: [currentResult?.logWarning, editResult?.logWarning].filter(Boolean).join("；"),
  };
}

function appendEditedSlotImage(currentResult, slot, editResult, editImage, editInstruction, latencyMs) {
  return appendEditedImages(currentResult, slot, editResult, [editImage], editInstruction, latencyMs);
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

function ImageGenerationWorkflow({ data }) {
  const noteRows = data?.contentInsight?.noteAnalysis || [];
  const initialHistory = useMemo(() => readImageWorkflowHistory(), []);
  const latestHistory = initialHistory[0] || null;
  const [form, setForm] = useState(() =>
    latestHistory?.form ? { ...emptyImageWorkflowForm, ...latestHistory.form, referenceImage: "", referenceImageName: latestHistory.form.referenceImageName || "" } : emptyImageWorkflowForm,
  );
  const [loadingNote, setLoadingNote] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingSocial, setGeneratingSocial] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [message, setMessage] = useState("");
  const [socialMessage, setSocialMessage] = useState("");
  const [result, setResult] = useState(() => latestHistory?.result || null);
  const [socialPlatform, setSocialPlatform] = useState(() => latestHistory?.socialPlatform || latestHistory?.socialDraft?.platform || "xhs");
  const [socialDraft, setSocialDraft] = useState(() => latestHistory?.socialDraft || null);
  const [noteDetail, setNoteDetail] = useState(() => latestHistory?.noteDetail || null);
  const [historyItems, setHistoryItems] = useState(initialHistory);
  const [promptOpen, setPromptOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [editingImage, setEditingImage] = useState(false);
  const {
    editingSlot,
    editingSourceImage,
    editInstruction,
    editImageCount,
    setEditingSlot,
    setEditInstruction,
    setEditImageCount,
    openImageEdit,
    resetImageEdit,
  } = useImageGeneration({ onOpen: () => setMessage("") });
  const noteOptions = useMemo(
    () =>
      noteRows.slice(0, 300).map((item) => ({
        note_id: item.note_id,
        label: `${item.note_id} · ${item.title || "未命名笔记"}`,
      })),
    [noteRows],
  );

  useEffect(() => {
    function handleHistorySync() {
      setHistoryItems(readImageWorkflowHistory());
    }
    window.addEventListener(imageWorkflowHistoryUpdatedEvent, handleHistorySync);
    return () => window.removeEventListener(imageWorkflowHistoryUpdatedEvent, handleHistorySync);
  }, []);

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateImagePrompt(slot, value) {
    setForm((current) => {
      const nextPrompts = Array.from({ length: maxWorkflowImages }, (_, index) => {
        const promptSlot = index + 1;
        return normalizeWorkflowImagePrompts(current.imagePrompts).find((item) => item.slot === promptSlot) || { slot: promptSlot, prompt: "" };
      });
      nextPrompts[slot - 1] = { ...nextPrompts[slot - 1], slot, prompt: value };
      return { ...current, imagePrompts: nextPrompts.filter((item) => item.prompt.trim()) };
    });
  }

  function handleSocialPlatformChange(value) {
    setSocialPlatform(value);
    setSocialDraft(null);
    setSocialMessage("");
  }

  function persistHistoryItem(nextResult, nextSocialDraft = socialDraft) {
    const compactResult = compactImageResult(nextResult);
    if (!generatedImagesForSave(compactResult).length) return;
    const taskKey = imageResultGroupId(compactResult) || compactResult.images.map((image) => image.url).join("|");
    const item = {
      id: taskKey || `history-${Date.now()}`,
      createdAt: new Date().toISOString(),
      form: historyFormSnapshot(form),
      result: compactResult,
      socialPlatform,
      socialDraft: compactSocialDraft(nextSocialDraft),
      sourceImages: sourceImagesForNote(noteDetail),
    };
    const next = upsertImageWorkflowHistoryItem(item, historyItems);
    setHistoryItems(next);
  }

  function restoreHistoryItem(item) {
    setForm({ ...emptyImageWorkflowForm, ...(item.form || {}), referenceImage: "", referenceImageName: item.form?.referenceImageName || "" });
    setResult(item.result || null);
    setSocialPlatform(item.socialPlatform || item.socialDraft?.platform || "xhs");
    setSocialDraft(item.socialDraft || null);
    setNoteDetail(item.noteDetail || null);
    resetImageEdit();
    setMessage("已恢复历史产出");
    setSocialMessage(item.socialDraft?.content ? "已恢复历史社媒草稿" : "");
  }

  function removeHistoryItem(id) {
    setHistoryItems((current) => {
      const next = current.filter((item) => item.id !== id);
      writeImageWorkflowHistory(next);
      return next;
    });
  }

  async function loadNote() {
    const noteId = form.noteId.trim();
    if (!noteId) {
      setMessage("请先输入或选择 note_id");
      return;
    }
    setLoadingNote(true);
    setMessage("");
    try {
      const payload = await requestJson("/api/image-note", {
        method: "POST",
        body: JSON.stringify({ noteId }),
      });
      setNoteDetail(payload.note || null);
      setForm((current) => imageWorkflowFormFromNote(payload.note || {}, current));
      const promptCount = Number(payload.note?.image_prompt_count || 0);
      const promptWarning = payload.note?.image_prompt_warning ? `，逐图提示词暂未读取：${payload.note.image_prompt_warning}` : "";
      setMessage(`已读取 ${payload.note?.source || "数据库"} 字段${promptCount ? `，逐图提示词 ${promptCount} 条` : ""}${promptWarning}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoadingNote(false);
    }
  }

  async function editGeneratedImage(event) {
    event.preventDefault();
    const slot = normalizeWorkflowImageCount(editingSlot);
    const instruction = editInstruction.trim();
    const editCount = Math.min(2, normalizeWorkflowImageCount(editImageCount));
    const sourceSlot = imageSlotItems(result).find((item) => item.slot === slot);
    const sourceImage = editingSourceImage?.url ? editingSourceImage : sourceSlot?.image;
    if (!sourceImage?.url) {
      setMessage("请先生成当前图片后再改图");
      return;
    }
    if (!instruction) {
      setMessage("请填写这次要修改的点");
      return;
    }

    const startedAt = Date.now();
    const originalPrompt = imagePromptAt(form, slot) || form.imagePrompt || "";
    const editPrompts = Array.from({ length: editCount }, (_, index) => ({
      slot: index + 1,
      prompt: buildImageEditPrompt({ slot, originalPrompt, instruction, branchIndex: index + 1, branchTotal: editCount }),
    }));
    setEditingImage(true);
    setMessage(editCount > 1 ? `第${slot}张改图并派生新图任务创建中` : `第${slot}张改图任务创建中`);
    try {
      const payload = await requestJson("/api/image-generate", {
        method: "POST",
        body: JSON.stringify({
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: editPrompts.map((item) => item.prompt).join("\n\n"),
          imagePrompts: editPrompts,
          unifiedVisualStyle: false,
          referenceImage: sourceImage.url,
          workflowAction: "image_edit",
          editSlot: slot,
          size: form.size,
          imageCount: editCount,
        }),
      });
      let editImages = (payload.images || []).map((image) => ({ ...image, sourceEditSlot: slot }));
      let taskState = (payload.tasks?.length ? payload.tasks : [{ slot: 1, taskId: payload.taskId, images: editImages }]).map((task, index) => ({
        slot: Number(task.slot || index + 1),
        taskId: task.taskId,
        status: task.images?.length ? "succeeded" : "processing",
        images: (task.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
      }));

      if (editImages.length < editCount) {
        if (!taskState.some((task) => task.taskId)) throw new Error("改图任务创建成功，但没有返回任务 ID");
        setMessage(editCount > 1 ? `第${slot}张改图与新增图生成中` : `第${slot}张改图生成中`);
        for (let attempt = 0; attempt < maxImageTaskPollAttempts; attempt += 1) {
          await wait(imageTaskPollDelay(attempt));
          for (let index = 0; index < taskState.length; index += 1) {
            const task = taskState[index];
            if (!task?.taskId || task.images?.length) continue;
            const taskPayload = await requestJson(`/api/image-task?taskId=${encodeURIComponent(task.taskId)}`);
            taskState[index] = {
              ...task,
              status: taskPayload.status,
              images: (taskPayload.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
            };
            if (taskPayload.status === "failed") throw new Error(taskPayload.error || `第${slot}张改图失败`);
          }
          editImages = taskState.flatMap((task) => task.images || []);
          if (editImages.length >= editCount) break;
          const pendingLabels = taskState.filter((task) => !task.images?.length).map((task) => `派生${task.slot}${imageTaskStatusLabel(task.status)}`);
          setMessage(pendingLabels.join("，") || `第${slot}张改图生成中`);
        }
      }

      if (editImages.length < editCount) throw new Error("改图任务仍在处理中，请稍后重试");
      const editResult = {
        ...payload,
        tasks: taskState,
        images: editImages,
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
      };
      const nextResult = appendEditedImages(result, slot, editResult, editImages.slice(0, editCount), instruction, Date.now() - startedAt);
      setResult(nextResult);
      persistHistoryItem(nextResult);
      resetImageEdit();
      setMessage(payload.logWarning ? `第${slot}张已改图，监控日志写入提示：${payload.logWarning}` : `第${slot}张已改图并写入监控日志`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setEditingImage(false);
    }
  }

  async function generateImage(event) {
    event.preventDefault();
    if (!hasWorkflowPrompt(form)) {
      setMessage("请填写生图提示词");
      return;
    }
    const startedAt = Date.now();
    const imageCount = normalizeWorkflowImageCount(form.imageCount);
    const imagePrompts = normalizeWorkflowImagePrompts(form.imagePrompts).slice(0, imageCount);
    setGenerating(true);
    setMessage("");
    setResult(null);
    resetImageEdit();
    try {
      const payload = await requestJson("/api/image-generate", {
        method: "POST",
        body: JSON.stringify({
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: form.imagePrompt,
          imagePrompts,
          unifiedVisualStyle: form.unifiedVisualStyle !== false,
          referenceImage: form.referenceImage,
          size: form.size,
          imageCount,
        }),
      });
      const baseResult = { ...payload, latencyMs: Date.now() - startedAt };
      setResult(baseResult);
      if ((payload.images || []).length >= imageCount) {
        persistHistoryItem(baseResult);
        setMessage(payload.logWarning ? `已生成，监控日志写入提示：${payload.logWarning}` : "已生成并写入监控日志");
        return;
      }
      const taskState = (payload.tasks?.length ? payload.tasks : [{ slot: 1, taskId: payload.taskId, images: payload.images || [] }]).map((task, index) => ({
        slot: Number(task.slot || index + 1),
        taskId: task.taskId,
        images: task.images || [],
        status: task.images?.length ? "succeeded" : "processing",
      }));
      if (!taskState.some((task) => task.taskId)) {
        throw new Error("图像生成任务创建成功，但没有返回任务 ID");
      }
      setMessage(payload.logWarning ? `任务已创建，监控日志写入提示：${payload.logWarning}` : "任务已创建，等待生成结果");

      for (let attempt = 0; attempt < maxImageTaskPollAttempts; attempt += 1) {
        await wait(imageTaskPollDelay(attempt));
        for (let index = 0; index < taskState.length; index += 1) {
          const task = taskState[index];
          if (!task.taskId || task.images?.length) continue;
          const taskPayload = await requestJson(`/api/image-task?taskId=${encodeURIComponent(task.taskId)}`);
          taskState[index] = {
            ...task,
            status: taskPayload.status,
            images: (taskPayload.images || []).map((image) => ({ ...image, slot: task.slot })),
          };
          if (taskPayload.status === "failed") {
            throw new Error(taskPayload.error || `第${task.slot}张图生成任务失败`);
          }
        }
        const images = taskState.flatMap((task) => (task.images || []).map((image) => ({ ...image, slot: task.slot })));
        const nextResult = {
          ...baseResult,
          tasks: taskState.map((task) => ({ ...task })),
          images,
          status: images.length >= imageCount ? "succeeded" : "processing",
          model: payload.model,
          size: payload.size,
          prompt: payload.prompt,
          logWarning: payload.logWarning,
          latencyMs: Date.now() - startedAt,
        };
        setResult(nextResult);
        if (images.length >= imageCount) {
          persistHistoryItem(nextResult);
          setMessage(payload.logWarning ? `已生成，监控日志写入提示：${payload.logWarning}` : "已生成并写入监控日志");
          return;
        }
        const pendingLabels = taskState.filter((task) => !task.images?.length).map((task) => `第${task.slot}张${imageTaskStatusLabel(task.status)}`);
        setMessage(pendingLabels.join("，") || "生成中");
      }
      throw new Error("图像生成仍在处理中，请稍后重新点击生成或检查任务状态");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setGenerating(false);
    }
  }

  async function generateSocialDraft() {
    setGeneratingSocial(true);
    setSocialMessage("");
    try {
      const payload = await requestJson("/api/social-generate", {
        method: "POST",
        body: JSON.stringify({
          platform: socialPlatform,
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: promptPayloadForSave(form),
          images: generatedImagesForSave(result),
        }),
      });
      setSocialDraft(payload);
      if (result?.images?.length) persistHistoryItem(result, payload);
      setSocialMessage(payload.logWarning ? `已生成，监控日志写入提示：${payload.logWarning}` : "社媒内容已生成并写入监控日志");
    } catch (error) {
      setSocialMessage(error.message);
    } finally {
      setGeneratingSocial(false);
    }
  }

  async function saveDraftPackage() {
    setSavingDraft(true);
    setSocialMessage("");
    try {
      const response = await fetch("/api/draft-package", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: socialPlatform,
          producedAt: new Date().toISOString(),
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: promptPayloadForSave(form),
          socialContent: sanitizeXhsDraftContent(socialDraft?.content || ""),
          images: generatedImagesForSave(result),
          sourceImages: sourceImagesForNote(noteDetail),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition"), `${socialPlatformLabels[socialPlatform]}_社媒草稿.zip`);
      downloadBlob(blob, filename);
      setSocialMessage("草稿包已生成下载");
    } catch (error) {
      setSocialMessage(error.message);
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <section className="image-workflow-layout">
      <form className="panel image-workflow-form" onSubmit={generateImage}>
        <SectionHeader icon={ImagePlus} title="爆文洗稿流" action={<StatusPill tone="neutral">gpt-image-2</StatusPill>} />

        <div className="image-note-loader">
          <label>
            <span>笔记 ID</span>
            <input
              list="image-note-options"
              value={form.noteId}
              onChange={(event) => updateForm({ noteId: event.target.value })}
              placeholder="输入 note_id 后读取"
            />
          </label>
          <datalist id="image-note-options">
            {noteOptions.map((item) => (
              <option key={item.note_id} value={item.note_id}>
                {item.label}
              </option>
            ))}
          </datalist>
          <button className="copy-button" type="button" onClick={loadNote} disabled={loadingNote}>
            {loadingNote ? "读取中" : "读取"}
          </button>
        </div>

        <ImageWorkflowField label="笔记标题" value={form.title} onChange={(value) => updateForm({ title: value })} multiline={false} />
        <ImageWorkflowField label="笔记文案" value={form.content} onChange={(value) => updateForm({ content: value })} rows={5} />
        <ImageWorkflowField label="目标人群画像" value={form.targetPersona} onChange={(value) => updateForm({ targetPersona: value })} rows={3} />
        <ImageWorkflowField label="用户痛点" value={form.userPain} onChange={(value) => updateForm({ userPain: value })} rows={4} />
        <ImageWorkflowField label="业务逻辑" value={form.businessLogic} onChange={(value) => updateForm({ businessLogic: value })} rows={4} />
        <ImageWorkflowField label="业务知识点" value={form.businessKnowledge} onChange={(value) => updateForm({ businessKnowledge: value })} rows={4} />
        <div className="image-prompt-collapse">
          <button className="image-prompt-toggle" type="button" onClick={() => setPromptOpen((current) => !current)}>
            <span>生图提示词</span>
            <strong>{promptOpen ? "收起" : "展开"}</strong>
          </button>
          {promptOpen ? (
            <div className="image-prompt-editor">
              <ImageWorkflowField
                label="整组风格/全局补充"
                value={form.imagePrompt}
                onChange={(value) => updateForm({ imagePrompt: value })}
                placeholder="整组统一风格、主配色、禁止第三方公司/账号/Logo/水印/旧日期，或其他补充"
                rows={5}
              />
              <div className="image-slot-prompt-list">
                {Array.from({ length: normalizeWorkflowImageCount(form.imageCount) }, (_, index) => {
                  const slot = index + 1;
                  return (
                    <ImageWorkflowField
                      key={slot}
                      label={`第${slot}张原图对应提示词`}
                      value={imagePromptAt(form, slot)}
                      onChange={(value) => updateImagePrompt(slot, value)}
                      placeholder="读取 note_id 后会自动填充对应原图的 image2 提示词，也可手工修改"
                      rows={5}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <button className="image-prompt-summary" type="button" onClick={() => setPromptOpen(true)}>
              {imagePromptSummary(form)}
            </button>
          )}
        </div>

        <div className="image-generation-options">
          <SelectControl
            value={form.size}
            onChange={(value) => updateForm({ size: value })}
            label="尺寸"
            options={[
              { value: "1024x1024", label: "1024x1024" },
              { value: "1024x1536", label: "1024x1536" },
              { value: "1536x1024", label: "1536x1024" },
            ]}
          />
          <SelectControl
            value={form.imageCount}
            onChange={(value) => updateForm({ imageCount: value })}
            label="数量"
            options={[
              ...Array.from({ length: maxWorkflowImages }, (_, index) => {
                const count = String(index + 1);
                return { value: count, label: `${count}张` };
              }),
            ]}
          />
          <label className="image-style-toggle">
            <input
              checked={form.unifiedVisualStyle !== false}
              type="checkbox"
              onChange={(event) => updateForm({ unifiedVisualStyle: event.target.checked })}
            />
            <span>统一风格/配色</span>
          </label>
        </div>

        <div className="image-workflow-actions">
          <button className="primary-button" type="submit" disabled={generating}>
            {generating ? "生成中" : "确认并生图"}
          </button>
          <button className="copy-button" type="button" onClick={() => setForm(emptyImageWorkflowForm)} disabled={generating}>
            清空
          </button>
        </div>
        {message ? <div className={result?.ok ? "admin-message" : "admin-message image-workflow-message"}>{message}</div> : null}

        <div className="social-draft-panel">
          <SectionHeader icon={Sparkles} title="社媒内容" action={socialDraft?.model ? <StatusPill tone="green">{socialDraft.model}</StatusPill> : null} />
          <div className="social-draft-controls">
            <SelectControl value={socialPlatform} onChange={handleSocialPlatformChange} label="类型" options={socialPlatformOptions} />
            <button className="copy-button" type="button" onClick={generateSocialDraft} disabled={generatingSocial}>
              {generatingSocial ? "生成中" : "生成社媒内容"}
            </button>
            <button className="primary-button" type="button" onClick={saveDraftPackage} disabled={savingDraft}>
              <Save size={15} />
              {savingDraft ? "保存中" : "保存草稿包"}
            </button>
          </div>
          <textarea
            className="social-draft-textarea"
            value={socialDraft?.content || ""}
            onChange={(event) => setSocialDraft((current) => ({ ...(current || { platform: socialPlatform }), content: event.target.value }))}
            onBlur={() => {
              if (result?.images?.length && socialDraft?.content) persistHistoryItem(result, socialDraft);
            }}
            placeholder="生成后的社媒内容会出现在这里"
            rows={10}
          />
          {socialMessage ? <div className="admin-message">{socialMessage}</div> : null}
        </div>
      </form>

      <section className="panel image-workflow-output">
        <SectionHeader icon={Sparkles} title="生成结果" action={result?.model ? <StatusPill tone="green">{result.model}</StatusPill> : null} />
        <div className="image-result-stage image-result-grid">
          {imageVersionDisplayItems(result, form.imageCount, true).map((item) => {
            const active = item.active;
            const slot = item.slot;
            const image = item.image;
            return (
              <div className={`image-result-card ${active ? "active" : ""}`} key={item.key}>
                <button
                  className={`image-result-slot ${image?.url ? "has-image" : ""} ${active ? "active" : ""}`}
                  type="button"
                  onClick={() => (image?.url ? setPreviewImage(image) : null)}
                  disabled={!image?.url}
                >
                  {image?.url ? (
                    <>
                      <img src={image.url} alt={`生成结果 ${slot} ${image.version || 1}`} />
                      <span className="image-version-badge">{imageVersionBadge(image)}</span>
                    </>
                  ) : (
                    <span>
                      <ImagePlus size={24} />
                      <strong>图片 {slot}</strong>
                      <em>{generating && active ? imageTaskStatusLabel(item.status === "empty" ? "processing" : item.status) : active ? "等待生成" : "空位"}</em>
                    </span>
                  )}
                </button>
                {image?.url ? (
                  <div className="image-slot-actions">
                    <button className="copy-button" type="button" onClick={() => openImageEdit(slot, image)} disabled={editingImage || generating}>
                      <PencilLine size={14} />
                      改图
                    </button>
                    <span>{item.isLatest ? "最新版本" : "历史版本"}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {editingSlot ? (
          <ImageEditPanel
            title={imageVersionLabel(editingSourceImage || { slot: editingSlot })}
            instruction={editInstruction}
            onInstructionChange={setEditInstruction}
            imageCount={editImageCount}
            onImageCountChange={setEditImageCount}
            onCancel={resetImageEdit}
            onSubmit={editGeneratedImage}
            editing={editingImage}
            placeholder="只写这次要改的点；如果选择派生2张，可以写：把这张拆成问题页和方法页"
          />
        ) : null}
        {result ? (
          <>
            <div className="image-result-meta">
              <span>尺寸 {result.size}</span>
              <span>耗时 {formatDuration(result.latencyMs)}</span>
              {result.taskIds?.length ? <span>任务 {result.taskIds.join(" / ")}</span> : result.taskId ? <span>任务 {result.taskId}</span> : null}
              <span>{result.logWarning ? "监控日志待补" : "监控日志已写入"}</span>
            </div>
            <div className="image-prompt-preview">
              <strong>发送给模型的提示词</strong>
              <pre>{result.prompt}</pre>
            </div>
          </>
        ) : null}
        <div className="image-history-panel">
          <SectionHeader icon={Clock3} title="历史产出" action={<StatusPill tone="neutral">{historyItems.length}组</StatusPill>} />
          {historyItems.length ? (
            <div className="image-history-list">
              {historyItems.map((item) => (
                <article className="image-history-item" key={item.id}>
                  <div className="image-history-head">
                    <div>
                      <strong>{item.form?.title || item.form?.noteId || "未命名草稿"}</strong>
                      <span>{formatDateTimeSecond(item.createdAt)} · {socialPlatformLabels[item.socialPlatform] || item.socialDraft?.platformLabel || "社媒"}</span>
                    </div>
                    <div className="image-history-actions">
                      <button className="copy-button" type="button" onClick={() => restoreHistoryItem(item)}>
                        恢复
                      </button>
                      <button className="copy-button" type="button" onClick={() => removeHistoryItem(item.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="image-history-thumbs">
                    {generatedImagesForSave(item.result).map((image, index) => (
                      <button type="button" key={`${item.id}-${image.slot}-${image.version}-${index}`} onClick={() => setPreviewImage(image)}>
                        <img src={image.url} alt={`历史图片 ${image.slot}-${image.version}`} />
                        <span>{image.label || (image.version > 1 ? `${image.slot}-${image.version}` : image.slot)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="image-history-docs">
                    {historyDocumentsForItem(item).map((doc) => (
                      <button type="button" key={`${item.id}-${doc.key}`} onClick={() => downloadTextFile(doc.filename, doc.content)}>
                        <FileText size={14} />
                        {doc.label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="image-history-empty">暂无历史产出，生成完成后会自动保留最近记录</div>
          )}
        </div>
      </section>
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </section>
  );
}

const fixedContentLineConfigs = [
  {
    id: "trend",
    title: "蹭热点/降维科普/行业趋势解读",
    shortTitle: "热点科普线",
    intent: "把 GEO、AI 搜索、营销趋势拆成公共认知入口。",
    targetPersonas: ["认知小白", "泛好奇者"],
    keywords: ["热点", "趋势", "科普", "入门", "小白", "一文看懂", "为什么", "AI", "GEO", "搜索"],
  },
  {
    id: "scenario",
    title: "垂直场景贴合，制造代入感",
    shortTitle: "垂直场景线",
    intent: "把通用 GEO 能力落到具体行业、具体角色和具体使用场景。",
    targetPersonas: ["垂直探路者"],
    keywords: ["场景", "行业", "案例", "怎么做", "落地", "实操", "路径", "方法"],
  },
  {
    id: "trust",
    title: "建立专业感、信任感，降低评估成本",
    shortTitle: "信任决策线",
    intent: "服务高焦虑决策、管理者和代理渠道，减少评估链路。",
    targetPersonas: ["行业焦虑决策者", "代理/渠道商"],
    keywords: ["信任", "转化", "决策", "成本", "评估", "避坑", "服务商", "管理者", "代理", "渠道"],
  },
];

const fixedRewriteSteps = ["读取笔记资产", "创建生图任务", "轮询图片结果", "生成小红书文案", "洗稿完成"];
const reviewDraftSteps = ["读取草稿", "调用豆包改文案", "调用多米改图", "写回草稿池"];
const fixedImageSizeOptions = [
  { value: "1024x1536", label: "小红书竖图 1024x1536" },
  { value: "1024x1024", label: "小红书方图 1024x1024" },
  { value: "1536x1024", label: "横图 1536x1024" },
];

function uniqueTextItems(items) {
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

function notePersonaItems(item) {
  return uniqueTextItems([item.primary_target_persona, ...listItems(item.target_persona_tags)]);
}

function noteKeywordText(item) {
  return [
    item.title,
    noteContentText(item),
    item.core_topic_category,
    item.true_pain_label,
    item.pain_description,
    item.business_logic,
    item.content_logic,
    arrayText(item.hook_types),
    item.funnel_role,
    item.primary_industry,
    arrayText(item.industry_tags),
  ]
    .filter(Boolean)
    .join(" ");
}

function noteMatchesPersonas(item, personas) {
  const notePersonas = notePersonaItems(item);
  return personas.some((persona) => notePersonas.includes(persona));
}

function fixedLineScore(line, item) {
  let score = 0;
  if (noteMatchesPersonas(item, line.targetPersonas)) score += 12;
  const keywordText = noteKeywordText(item);
  score += line.keywords.filter((keyword) => keywordText.includes(keyword)).length * 2;
  if (line.id === "trend" && item.funnel_role === "曝光") score += 2;
  if (line.id === "trust" && ["信任", "转化"].includes(item.funnel_role)) score += 5;
  return score;
}

function sortHotNotes(rows) {
  return [...rows].sort((a, b) => {
    const interactionDelta = Number(b.interaction_score || 0) - Number(a.interaction_score || 0);
    if (interactionDelta) return interactionDelta;
    const freshDelta = Number(b.fresh_hot_score || 0) - Number(a.fresh_hot_score || 0);
    if (freshDelta) return freshDelta;
    return String(b.note_date || b.publish_time || "").localeCompare(String(a.note_date || a.publish_time || ""));
  });
}

function dedupeNotes(rows) {
  const seen = new Set();
  return rows.filter((item) => {
    const key = item?.note_id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupFixedNotes(line, notes) {
  return [{ id: "all", label: "全行业", notes: sortHotNotes(notes).slice(0, 18) }];
}

function buildFixedContentLines(rows) {
  const source = sortHotNotes(dedupeNotes(rows || []));
  return fixedContentLineConfigs.map((line) => {
    const matched = source
      .map((note) => ({ note, score: fixedLineScore(line, note) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.note.interaction_score || 0) - Number(a.note.interaction_score || 0))
      .map((item) => item.note);
    const fallbackSize = line.id === "trend" ? 24 : 16;
    const notes = matched.length ? matched.slice(0, 80) : source.slice(0, fallbackSize);
    return {
      ...line,
      notes,
      groups: groupFixedNotes(line, notes),
    };
  });
}

function sourceImagesForNote(note) {
  const items = [];
  const seen = new Set();
  function add(url, source = "image_analysis") {
    const imageUrl = String(url || "").trim();
    if (!imageUrl || seen.has(imageUrl)) return;
    seen.add(imageUrl);
    items.push({ url: imageUrl, source, slot: items.length + 1 });
  }
  (note?.source_images || []).forEach((image) => add(image.url || image.imageUrl, image.source || "source_image"));
  normalizeWorkflowImagePrompts(note?.image_prompts).forEach((prompt) => add(prompt.imageUrl, "image_analysis"));
  return items;
}

function FixedContentFlow({ data }) {
  const fixedRows = useMemo(() => {
    const rows = data?.fixedContent?.notes?.length ? data.fixedContent.notes : data?.contentInsight?.noteAnalysis || data?.topFresh || [];
    return rows || [];
  }, [data]);
  const lines = useMemo(() => buildFixedContentLines(fixedRows), [fixedRows]);
  const initialHistory = useMemo(() => readFixedContentHistory(), []);
  const [selectedLineId, setSelectedLineId] = useState("trend");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [noteDetail, setNoteDetail] = useState(null);
  const [loadingNoteDetail, setLoadingNoteDetail] = useState(false);
  const [detailMessage, setDetailMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [fixedSize, setFixedSize] = useState("1024x1536");
  const [savingDraft, setSavingDraft] = useState(false);
  const [progress, setProgress] = useState({ status: "idle", activeStep: 0, message: "选择一条候选笔记后开始洗稿" });
  const [runningImageResult, setRunningImageResult] = useState(null);
  const [fixedResult, setFixedResult] = useState(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [editingImage, setEditingImage] = useState(false);
  const [historyItems, setHistoryItems] = useState(initialHistory);
  const {
    editingSlot,
    editingSourceImage,
    editInstruction,
    editImageCount,
    setEditingSlot,
    setEditInstruction,
    setEditImageCount,
    openImageEdit: openFixedImageEdit,
    resetImageEdit: resetFixedImageEdit,
  } = useImageGeneration({
    onOpen: (slot) => {
      setProgress((current) => ({ ...current, message: `准备修改第${slot}张图` }));
    },
  });

  const selectedLine = lines.find((line) => line.id === selectedLineId) || lines[0] || fixedContentLineConfigs[0];
  const visibleNotes = selectedLine.notes || [];
  const selectedNote = visibleNotes.find((note) => note.note_id === selectedNoteId) || visibleNotes[0] || null;
  const sourceImages = sourceImagesForNote(noteDetail);
  const selectedForm = noteDetail ? imageWorkflowFormFromNote(noteDetail, emptyImageWorkflowForm) : null;
  const selectedImageCount = selectedForm ? normalizeWorkflowImageCount(selectedForm.imageCount) : 1;
  const selectedNoteHistory = useMemo(
    () =>
      historyItems
        .filter((item) => item?.form?.noteId && item.form.noteId === selectedNote?.note_id)
        .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))),
    [historyItems, selectedNote?.note_id],
  );

  useEffect(() => {
    if (!lines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(lines[0]?.id || "trend");
      setSelectedNoteId("");
    }
  }, [lines, selectedLineId]);

  useEffect(() => {
    if (!selectedNote?.note_id) {
      setNoteDetail(null);
      setDetailMessage("");
      return undefined;
    }
    let alive = true;
    setLoadingNoteDetail(true);
    setDetailMessage("");
    requestJson("/api/image-note", {
      method: "POST",
      body: JSON.stringify({ noteId: selectedNote.note_id }),
    })
      .then((payload) => {
        if (!alive) return;
        setNoteDetail(payload.note || null);
      })
      .catch((error) => {
        if (!alive) return;
        setNoteDetail(null);
        setDetailMessage(error.message || "读取笔记详情失败");
      })
      .finally(() => {
        if (alive) setLoadingNoteDetail(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedNote?.note_id]);

  async function ensureNoteDetail(noteId) {
    if (noteDetail?.note_id === noteId) return noteDetail;
    setLoadingNoteDetail(true);
    try {
      const payload = await requestJson("/api/image-note", {
        method: "POST",
        body: JSON.stringify({ noteId }),
      });
      setNoteDetail(payload.note || null);
      return payload.note || null;
    } finally {
      setLoadingNoteDetail(false);
    }
  }

  function updateProgress(activeStep, message, status = "running") {
    setProgress({ status, activeStep, message });
  }

  function persistFixedHistoryItem(finalResult, nextSocialDraft = finalResult?.socialDraft || null) {
    if (!finalResult?.imageResult) return null;
    const compactResult = compactImageResult(finalResult.imageResult);
    if (!generatedImagesForSave(compactResult).length) return null;
    const historyId = finalResult.historyId || imageResultGroupId(compactResult) || `fixed-content-${Date.now()}`;
    const item = {
      id: historyId,
      createdAt: finalResult.producedAt || new Date().toISOString(),
      form: historyFormSnapshot(finalResult.form || emptyImageWorkflowForm),
      result: compactResult,
      sourceImages: Array.isArray(finalResult.sourceImages) ? finalResult.sourceImages.filter((image) => image?.url).slice(0, maxWorkflowImages) : [],
      socialPlatform: "xhs",
      socialDraft: compactSocialDraft(nextSocialDraft),
      noteId: finalResult.form?.noteId || "",
      noteTitle: finalResult.note?.title || finalResult.form?.title || "",
      noteDate: finalResult.note?.note_date || "",
      authorNickname: finalResult.note?.author_nickname || "",
      lineId: finalResult.lineId || selectedLine.id,
      lineTitle: finalResult.lineTitle || selectedLine.title,
      lineShortTitle: finalResult.lineShortTitle || selectedLine.shortTitle,
    };
    const next = upsertFixedContentHistoryItem(item, historyItems);
    setHistoryItems(next);
    return item;
  }

  function restoreFixedHistoryItem(item) {
    if (!item) return;
    setSelectedLineId(item.lineId || selectedLineId);
    setSelectedNoteId(item.noteId || item.form?.noteId || "");
    setFixedSize(item.form?.size || "1024x1536");
    setFixedResult({
      note: item.note || null,
      form: { ...emptyImageWorkflowForm, ...(item.form || {}) },
      imageResult: item.result || null,
      socialDraft: item.socialDraft || null,
      sourceImages: Array.isArray(item.sourceImages) ? item.sourceImages : [],
      producedAt: item.createdAt || new Date().toISOString(),
      historyId: item.id,
      lineId: item.lineId || selectedLine.id,
      lineTitle: item.lineTitle || selectedLine.title,
      lineShortTitle: item.lineShortTitle || selectedLine.shortTitle,
    });
    setResultOpen(true);
    resetFixedImageEdit();
    setProgress({ status: "done", activeStep: 4, message: "已恢复历史草稿" });
  }

  function removeFixedHistoryItem(id) {
    setHistoryItems((current) => {
      const next = current.filter((item) => item.id !== id);
      writeFixedContentHistory(next);
      return next;
    });
  }

  async function runFixedRewrite() {
    if (!selectedNote?.note_id) {
      setProgress({ status: "failed", activeStep: 0, message: "请先选择一条候选笔记" });
      return;
    }
    setRunning(true);
    setFixedResult(null);
    setRunningImageResult(null);
    setResultOpen(false);
    try {
      updateProgress(0, "读取笔记详情、内容资产字段和原图提示词");
      const detail = await ensureNoteDetail(selectedNote.note_id);
      const form = { ...imageWorkflowFormFromNote(detail || {}, emptyImageWorkflowForm), size: fixedSize };
      if (!form.noteId) throw new Error("没有读取到可用笔记资产");
      if (!hasWorkflowPrompt(form)) throw new Error("该笔记缺少可用生图提示词，需要先完成图片解析/内容资产沉淀");

      const startedAt = Date.now();
      const imageCount = normalizeWorkflowImageCount(form.imageCount);
      const imagePrompts = normalizeWorkflowImagePrompts(form.imagePrompts).slice(0, imageCount);
      updateProgress(1, `创建 Duomi 生图任务（${fixedSize}）`);
      const payload = await requestJson("/api/image-generate", {
        method: "POST",
        body: JSON.stringify({
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: form.imagePrompt,
          imagePrompts,
          unifiedVisualStyle: form.unifiedVisualStyle !== false,
          size: form.size,
          imageCount,
        }),
      });

      const baseResult = { ...payload, latencyMs: Date.now() - startedAt };
      setRunningImageResult(baseResult);
      let imageResult = baseResult;
      if ((payload.images || []).length < imageCount) {
        const taskState = (payload.tasks?.length ? payload.tasks : [{ slot: 1, taskId: payload.taskId, images: payload.images || [] }]).map((task, index) => ({
          slot: Number(task.slot || index + 1),
          taskId: task.taskId,
          images: task.images || [],
          status: task.images?.length ? "succeeded" : "processing",
        }));
        if (!taskState.some((task) => task.taskId)) throw new Error("图像生成任务创建成功，但没有返回任务 ID");
        updateProgress(2, "任务已创建，开始轮询图片结果");

        for (let attempt = 0; attempt < maxImageTaskPollAttempts; attempt += 1) {
          await wait(imageTaskPollDelay(attempt));
          for (let index = 0; index < taskState.length; index += 1) {
            const task = taskState[index];
            if (!task.taskId || task.images?.length) continue;
            const taskPayload = await requestJson(`/api/image-task?taskId=${encodeURIComponent(task.taskId)}`);
            taskState[index] = {
              ...task,
              status: taskPayload.status,
              images: (taskPayload.images || []).map((image) => ({ ...image, slot: task.slot })),
            };
            if (taskPayload.status === "failed") throw new Error(taskPayload.error || `第${task.slot}张图生成任务失败`);
          }
          const images = taskState.flatMap((task) => (task.images || []).map((image) => ({ ...image, slot: task.slot })));
          imageResult = {
            ...baseResult,
            tasks: taskState.map((task) => ({ ...task })),
            images,
            status: images.length >= imageCount ? "succeeded" : "processing",
            model: payload.model,
            size: payload.size,
            prompt: payload.prompt,
            logWarning: payload.logWarning,
            latencyMs: Date.now() - startedAt,
          };
          setRunningImageResult(imageResult);
          if (images.length >= imageCount) break;
          const pendingLabels = taskState.filter((task) => !task.images?.length).map((task) => `第${task.slot}张${imageTaskStatusLabel(task.status)}`);
          updateProgress(2, pendingLabels.join("，") || "图片生成中");
        }
        if ((imageResult.images || []).length < imageCount) throw new Error("图像生成仍在处理中，请稍后重新点击洗稿或检查任务状态");
      }

      updateProgress(3, "图片已生成，开始调用豆包生成小红书文案");
      const socialDraft = await requestJson("/api/social-generate", {
        method: "POST",
        body: JSON.stringify({
          platform: "xhs",
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: promptPayloadForSave(form),
          images: generatedImagesForSave(imageResult),
        }),
      });

      const historyId = `fixed-content-${form.noteId}-${Date.now()}`;
      const finalResult = {
        note: selectedNote,
        form,
        imageResult,
        socialDraft,
        sourceImages: sourceImagesForNote(detail),
        producedAt: new Date().toISOString(),
        historyId,
        lineId: selectedLine.id,
        lineTitle: selectedLine.title,
        lineShortTitle: selectedLine.shortTitle,
      };
      setFixedResult(finalResult);
      setProgress({ status: "done", activeStep: 4, message: "洗稿完成，可以查看小红书文案和生成图片" });
      persistFixedHistoryItem(finalResult, socialDraft);
    } catch (error) {
      setProgress({ status: "failed", activeStep: Math.min(progress.activeStep || 0, fixedRewriteSteps.length - 1), message: error.message || "洗稿失败" });
    } finally {
      setRunning(false);
    }
  }

  async function editFixedGeneratedImage(event) {
    event.preventDefault();
    const slot = normalizeWorkflowImageCount(editingSlot);
    const instruction = editInstruction.trim();
    const editCount = Math.min(2, normalizeWorkflowImageCount(editImageCount));
    const currentImageResult = fixedResult?.imageResult;
    const sourceSlot = imageSlotItems(currentImageResult).find((item) => item.slot === slot);
    const sourceImage = editingSourceImage?.url ? editingSourceImage : sourceSlot?.image;
    if (!sourceImage?.url) {
      setProgress((current) => ({ ...current, status: "failed", message: "请先生成当前图片后再改图" }));
      return;
    }
    if (!instruction) {
      setProgress((current) => ({ ...current, status: "failed", message: "请填写这次要修改的点" }));
      return;
    }

    const startedAt = Date.now();
    const originalPrompt = imagePromptAt(fixedResult.form || emptyImageWorkflowForm, slot) || fixedResult.form?.imagePrompt || "";
    const editPrompts = Array.from({ length: editCount }, (_, index) => ({
      slot: index + 1,
      prompt: buildImageEditPrompt({ slot, originalPrompt, instruction, branchIndex: index + 1, branchTotal: editCount }),
    }));
    setEditingImage(true);
    setProgress((current) => ({ ...current, status: "running", activeStep: 1, message: editCount > 1 ? `第${slot}张改图并新增图任务创建中` : `第${slot}张改图任务创建中` }));
    try {
      const payload = await requestJson("/api/image-generate", {
        method: "POST",
        body: JSON.stringify({
          noteId: fixedResult.form.noteId.trim(),
          title: fixedResult.form.title,
          content: fixedResult.form.content,
          targetPersona: fixedResult.form.targetPersona,
          userPain: fixedResult.form.userPain,
          businessLogic: fixedResult.form.businessLogic,
          businessKnowledge: fixedResult.form.businessKnowledge,
          imagePrompt: editPrompts.map((item) => item.prompt).join("\n\n"),
          imagePrompts: editPrompts,
          unifiedVisualStyle: false,
          referenceImage: sourceImage.url,
          workflowAction: "image_edit",
          editSlot: slot,
          size: fixedResult.form.size,
          imageCount: editCount,
        }),
      });
      let editImages = (payload.images || []).map((image) => ({ ...image, sourceEditSlot: slot }));
      let taskState = (payload.tasks?.length ? payload.tasks : [{ slot: 1, taskId: payload.taskId, images: editImages }]).map((task, index) => ({
        slot: Number(task.slot || index + 1),
        taskId: task.taskId,
        status: task.images?.length ? "succeeded" : "processing",
        images: (task.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
      }));

      if (editImages.length < editCount) {
        if (!taskState.some((task) => task.taskId)) throw new Error("改图任务创建成功，但没有返回任务 ID");
        setProgress((current) => ({ ...current, activeStep: 2, message: editCount > 1 ? `第${slot}张改图与新增图生成中` : `第${slot}张改图生成中` }));
        for (let attempt = 0; attempt < maxImageTaskPollAttempts; attempt += 1) {
          await wait(imageTaskPollDelay(attempt));
          for (let index = 0; index < taskState.length; index += 1) {
            const task = taskState[index];
            if (!task?.taskId || task.images?.length) continue;
            const taskPayload = await requestJson(`/api/image-task?taskId=${encodeURIComponent(task.taskId)}`);
            taskState[index] = {
              ...task,
              status: taskPayload.status,
              images: (taskPayload.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
            };
            if (taskPayload.status === "failed") throw new Error(taskPayload.error || `第${slot}张改图失败`);
          }
          editImages = taskState.flatMap((task) => task.images || []);
          if (editImages.length >= editCount) break;
          const pendingLabels = taskState.filter((task) => !task.images?.length).map((task) => `派生${task.slot}${imageTaskStatusLabel(task.status)}`);
          setProgress((current) => ({ ...current, activeStep: 2, message: pendingLabels.join("，") || `第${slot}张${imageTaskStatusLabel("processing")}` }));
        }
      }

      if (editImages.length < editCount) throw new Error("改图任务仍在处理中，请稍后重试");
      const editResult = {
        ...payload,
        tasks: taskState,
        images: editImages,
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
      };
      const nextResult = appendEditedImages(currentImageResult, slot, editResult, editImages.slice(0, editCount), instruction, Date.now() - startedAt);
      const nextFixedResult = {
        ...fixedResult,
        imageResult: nextResult,
        historyId: fixedResult.historyId || `fixed-content-${fixedResult.form.noteId}`,
      };
      setFixedResult(nextFixedResult);
      persistFixedHistoryItem(nextFixedResult, fixedResult.socialDraft);
      resetImageEdit();
      setProgress({ status: "done", activeStep: 4, message: `第${slot}张已改图` });
    } catch (error) {
      setProgress({ status: "failed", activeStep: Math.min(progress.activeStep || 0, fixedRewriteSteps.length - 1), message: error.message || "改图失败" });
    } finally {
      setEditingImage(false);
    }
  }

  async function copyFixedDraft() {
    const content = sanitizeXhsDraftContent(fixedResult?.socialDraft?.content || "");
    if (!content) return;
    try {
      await navigator.clipboard?.writeText(content);
      setProgress((current) => ({ ...current, message: "小红书文案已复制" }));
    } catch {
      setProgress((current) => ({ ...current, message: "复制失败，请手动选中文案" }));
    }
  }

  async function saveFixedDraftPackage() {
    if (!fixedResult) return;
    setSavingDraft(true);
    try {
      const response = await fetch("/api/draft-package", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "xhs",
          producedAt: fixedResult.producedAt,
          noteId: fixedResult.form.noteId,
          title: fixedResult.form.title,
          content: fixedResult.form.content,
          targetPersona: fixedResult.form.targetPersona,
          userPain: fixedResult.form.userPain,
          businessLogic: fixedResult.form.businessLogic,
          businessKnowledge: fixedResult.form.businessKnowledge,
          imagePrompt: promptPayloadForSave(fixedResult.form),
          socialContent: sanitizeXhsDraftContent(fixedResult.socialDraft?.content || ""),
          images: generatedImagesForSave(fixedResult.imageResult),
          sourceImages: Array.isArray(fixedResult.sourceImages) ? fixedResult.sourceImages.filter((image) => image?.url).slice(0, maxWorkflowImages) : [],
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition"), "固定内容流_小红书草稿.zip");
      downloadBlob(blob, filename);
      setProgress((current) => ({ ...current, message: "草稿包已生成下载" }));
    } catch (error) {
      setProgress((current) => ({ ...current, message: error.message || "草稿包保存失败" }));
    } finally {
      setSavingDraft(false);
    }
  }

  if (resultOpen && fixedResult) {
    const images = imageVersionDisplayItems(fixedResult.imageResult, fixedResult.form?.imageCount || 1, false);
    return (
      <section className="fixed-content-flow">
        <section className="panel fixed-result-panel">
          <SectionHeader
            icon={CheckCircle2}
            title="洗稿效果"
            action={<StatusPill tone="green">洗稿完成</StatusPill>}
          />
          <div className="fixed-result-head">
            <div>
              <strong>{fixedResult.form.title || fixedResult.form.noteId}</strong>
              <span>{fixedResult.form.noteId} · {formatDateTimeSecond(fixedResult.producedAt)}</span>
            </div>
            <div className="header-actions">
              <button className="copy-button" type="button" onClick={() => setResultOpen(false)}>
                返回内容线
              </button>
              <button className="copy-button" type="button" onClick={copyFixedDraft}>
                复制文案
              </button>
              <button className="primary-button" type="button" onClick={saveFixedDraftPackage} disabled={savingDraft}>
                <Save size={15} />
                {savingDraft ? "保存中" : "下载草稿包"}
              </button>
            </div>
          </div>
          <div className="fixed-progress-message">{progress.message}</div>
          <div className="fixed-result-grid">
            <section className="fixed-social-output">
              <SectionHeader icon={FileText} title="小红书文案" action={fixedResult.socialDraft?.model ? <StatusPill tone="green">{fixedResult.socialDraft.model}</StatusPill> : null} />
              <div className="fixed-social-compare">
                <label>
                  <span>洗稿前文案</span>
                  <textarea readOnly value={fixedResult.form.content || ""} rows={10} />
                </label>
                <label>
                  <span>洗稿后文案</span>
                  <textarea readOnly value={sanitizeXhsDraftContent(fixedResult.socialDraft?.content || "")} rows={14} />
                </label>
              </div>
            </section>
            <section className="fixed-image-output">
              <SectionHeader icon={ImagePlus} title="生成图片" action={<StatusPill tone="neutral">{formatNumber(images.length)} 张</StatusPill>} />
              <div className="fixed-result-images">
                {images.map((item) => (
                  <div className="fixed-result-image-card" key={item.key}>
                    <button type="button" className="fixed-result-thumb" onClick={() => setPreviewImage(item.image)} disabled={!item.image?.url}>
                      <img src={item.image.url} alt={`固定内容流生成图 ${item.slot} ${item.image.version || 1}`} />
                      <span className="image-version-badge">{imageVersionBadge(item.image)}</span>
                    </button>
                    <div className="image-slot-actions">
                      <button className="copy-button" type="button" onClick={() => openFixedImageEdit(item.slot, item.image)} disabled={editingImage || running}>
                        <PencilLine size={14} />
                        改图
                      </button>
                      <span>{item.isLatest ? "最新版本" : "历史版本"}</span>
                    </div>
                  </div>
                ))}
              </div>
              {editingSlot ? (
                <ImageEditPanel
                  title={imageVersionLabel(editingSourceImage || { slot: editingSlot })}
                  instruction={editInstruction}
                  onInstructionChange={setEditInstruction}
                  imageCount={editImageCount}
                  onImageCountChange={setEditImageCount}
                  onCancel={resetFixedImageEdit}
                  onSubmit={editFixedGeneratedImage}
                  editing={editingImage}
                  placeholder="只写这次要改的点；如果要拆成两张图，可以写清楚两张图各自承担什么内容"
                />
              ) : null}
            </section>
          </div>
        </section>
        <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
      </section>
    );
  }

  return (
    <section className="fixed-content-flow">
      <section className="fixed-line-strip">
        {lines.map((line) => (
          <button
            key={line.id}
            className={`fixed-line-card ${selectedLine.id === line.id ? "active" : ""}`}
            type="button"
            onClick={() => setSelectedLineId(line.id)}
          >
            <div>
              <span>{line.shortTitle}</span>
              <strong>{line.title}</strong>
              <p>{line.intent}</p>
            </div>
            <em>{formatNumber(line.notes.length)} 条</em>
          </button>
        ))}
      </section>

      <section className="fixed-workspace">
        <section className="panel fixed-note-panel">
          <SectionHeader icon={Filter} title={selectedLine.shortTitle} action={<StatusPill tone="blue">全行业</StatusPill>} />
          <div className="fixed-line-summary">
            <strong>{selectedLine.title}</strong>
            <span>{selectedLine.intent}</span>
          </div>
          <div className="fixed-note-list">
            {visibleNotes.length ? (
              visibleNotes.map((note) => (
                <article
                  key={note.note_id}
                  className={`fixed-note-card ${selectedNote?.note_id === note.note_id ? "active" : ""}`}
                  onClick={() => setSelectedNoteId(note.note_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedNoteId(note.note_id);
                  }}
                  role="button"
                  tabIndex="0"
                >
                  <div className="fixed-note-top">
                    <StatusPill tone={note.funnel_role === "转化" ? "green" : note.funnel_role === "信任" ? "blue" : "neutral"}>
                      {note.funnel_role || "未标注漏斗"}
                    </StatusPill>
                    <span>{formatDayLabel(note.note_date || note.publish_time)}</span>
                  </div>
                  <strong>{note.title || note.note_id}</strong>
                  <p>{textPreview(noteContentText(note), 128) || "-"}</p>
                  <div className="fixed-note-tags">
                    <span>{note.primary_target_persona || "未标注人群"}</span>
                    <span>全行业</span>
                  </div>
                  <div className="daily-note-metrics">
                    <NoteMetricChip label="互动" value={note.interaction_score} />
                    <NoteMetricChip label="赞" value={note.like_count} />
                    <NoteMetricChip label="藏" value={note.collected_count} />
                    <NoteMetricChip label="评" value={note.comments_count} />
                  </div>
                </article>
              ))
            ) : (
              <div className="fixed-content-empty">
                <Layers3 size={28} />
                <strong>暂无候选笔记</strong>
                <span>这条内容线近30天没有命中现有标签</span>
              </div>
            )}
          </div>
        </section>

        <section className="panel fixed-detail-panel">
          <SectionHeader
            icon={Target}
            title="资产执行"
            action={<StatusPill tone={running ? "amber" : fixedResult ? "green" : "neutral"}>{running ? "处理中" : fixedResult ? "已产出" : "待洗稿"}</StatusPill>}
          />
          {selectedNote ? (
            <>
              <div className="fixed-selected-head">
                <div>
                  <strong>{selectedNote.title || selectedNote.note_id}</strong>
                  <span>
                    {selectedNote.note_id} · {selectedNote.author_nickname || "-"}
                  </span>
                </div>
                <button className="primary-button" type="button" onClick={runFixedRewrite} disabled={running || loadingNoteDetail}>
                  <Sparkles size={15} />
                  {running ? "洗稿中" : "一键洗稿"}
                </button>
              </div>

              <div className="fixed-original-images">
                <div className="fixed-subhead">
                  <strong>原笔记图片</strong>
                </div>
                <div className="fixed-generation-options">
                  <SelectControl value={fixedSize} onChange={setFixedSize} label="尺寸" options={fixedImageSizeOptions} />
                </div>
                {sourceImages.length ? (
                  <div className="fixed-source-image-grid">
                    {sourceImages.map((image) => (
                      <button key={image.url} type="button" onClick={() => setPreviewImage(image)}>
                        <img src={image.url} alt={`原笔记图片 ${image.slot}`} />
                        <span>{image.slot}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="fixed-source-empty">{loadingNoteDetail ? "原图读取中" : "暂无原图预览"}</div>
                )}
              </div>

              <div className="fixed-asset-fields">
                <DetailTextBlock title="目标人群与痛点">
                  <p>
                    <strong>{selectedNote.primary_target_persona || selectedForm?.targetPersona || "未标注"}</strong>
                  </p>
                  <p>{selectedNote.true_pain_label || selectedForm?.userPain || "-"}</p>
                  <p>{selectedNote.pain_description || selectedNote.pain_evidence || ""}</p>
                </DetailTextBlock>
                <DetailTextBlock title="可复用逻辑">
                  <p>{selectedNote.business_logic || selectedNote.content_logic || selectedForm?.businessLogic || "-"}</p>
                  <p>{firstStructuredText(selectedNote.reusable_angles, selectedNote.funnel_role_reason || "")}</p>
                </DetailTextBlock>
                <DetailTextBlock title="视觉默认值">
                  <p>{selectedForm ? imagePromptSummary(selectedForm) : loadingNoteDetail ? "读取中" : "-"}</p>
                  <p>{selectedNote.visual_group_style_prompt || selectedNote.layout_structure || ""}</p>
                </DetailTextBlock>
              </div>

              <div className="fixed-progress-panel">
                <WorkflowSteps steps={fixedRewriteSteps} progress={progress} />
                <div className={`fixed-progress-message ${progress.status === "failed" ? "failed" : ""}`}>{progress.message}</div>
                {runningImageResult ? (
                  <div className="fixed-running-slots">
                    {imageSlotItems(runningImageResult)
                      .slice(0, selectedImageCount)
                      .map((slot) => (
                        <div key={slot.slot} className={slot.image?.url ? "done" : ""}>
                          {slot.image?.url ? <img src={slot.image.url} alt={`生成中图片 ${slot.slot}`} /> : <span>{imageTaskStatusLabel(slot.status === "empty" ? "processing" : slot.status)}</span>}
                        </div>
                      ))}
                  </div>
                ) : null}
                {fixedResult && progress.status === "done" ? (
                  <button className="primary-button" type="button" onClick={() => setResultOpen(true)}>
                    查看洗稿效果
                  </button>
                ) : null}
              </div>

              <div className="fixed-history-panel">
                <SectionHeader icon={Clock3} title="历史草稿" action={<StatusPill tone="neutral">{selectedNoteHistory.length}条</StatusPill>} />
                {selectedNoteHistory.length ? (
                  <div className="fixed-history-list">
                    {selectedNoteHistory.map((item) => (
                      <article className="fixed-history-item" key={item.id}>
                        <div className="fixed-history-head">
                          <div>
                            <strong>{item.form?.title || item.noteTitle || item.form?.noteId || "未命名草稿"}</strong>
                            <span>
                              {formatDateTimeSecond(item.createdAt || item.updatedAt)} · {item.form?.size || "1024x1536"} · {socialPlatformLabels[item.socialPlatform] || item.socialDraft?.platformLabel || "社媒"}
                            </span>
                          </div>
                          <div className="image-history-actions">
                            <button className="copy-button" type="button" onClick={() => restoreFixedHistoryItem(item)}>
                              恢复
                            </button>
                            <button className="copy-button" type="button" onClick={() => removeFixedHistoryItem(item.id)}>
                              删除
                            </button>
                          </div>
                        </div>
                        <p className="fixed-history-preview">{textPreview(sanitizeXhsDraftContent(item.socialDraft?.content || ""), 180) || "暂无社媒草稿"}</p>
                        <div className="image-history-thumbs fixed-history-thumbs">
                          {generatedImagesForSave(item.result).map((image, index) => (
                            <button type="button" key={`${item.id}-${image.slot}-${image.version}-${index}`} onClick={() => setPreviewImage(image)}>
                              <img src={image.url} alt={`历史图片 ${image.slot}-${image.version}`} />
                              <span>{image.label || (image.version > 1 ? `${image.slot}-${image.version}` : image.slot)}</span>
                            </button>
                          ))}
                        </div>
                        <div className="fixed-history-meta">
                          <span>{item.lineShortTitle || item.lineTitle || "固定内容线"}</span>
                          <span>{formatNumber(generatedImagesForSave(item.result).length)} 张</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="fixed-history-empty">当前笔记还没有历史草稿</div>
                )}
              </div>
              {detailMessage ? <div className="admin-message">{detailMessage}</div> : null}
            </>
          ) : (
            <div className="fixed-content-empty">
              <Layers3 size={28} />
              <strong>先选择候选笔记</strong>
              <span>左侧按内容线展示近30天互动权重最高的内容</span>
            </div>
          )}
        </section>
      </section>
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </section>
  );
}

function DraftReviewFlow({ data, onNavigate }) {
  const { drafts, persistDraft: persistReviewDraft } = useDraftReview(readReviewDrafts, writeReviewDraftItem, imageWorkflowHistoryUpdatedEvent, fixedContentHistoryUpdatedEvent);
  const [selectedReviewId, setSelectedReviewId] = useState(() => drafts[0]?.reviewId || "");
  const [noteDetail, setNoteDetail] = useState(null);
  const [loadingNoteDetail, setLoadingNoteDetail] = useState(false);
  const [detailMessage, setDetailMessage] = useState("");
  const [progress, setProgress] = useState({ status: "idle", activeStep: 0, message: "选择一条待审核草稿查看原文、改文案和改图" });
  const [previewImage, setPreviewImage] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [editingSocial, setEditingSocial] = useState(false);
  const [socialEditInstruction, setSocialEditInstruction] = useState("");
  const [editingImage, setEditingImage] = useState(false);
  const emptyDraftHint = "当前没有待审核草稿。先跑一次固定内容流或爆文洗稿流，历史会自动出现在这里。";

  useEffect(() => {
    if (!drafts.length) {
      setSelectedReviewId("");
      return;
    }
    if (!drafts.some((item) => item.reviewId === selectedReviewId)) {
      setSelectedReviewId(drafts[0]?.reviewId || "");
    }
  }, [drafts, selectedReviewId]);

  const selectedDraft = drafts.find((item) => item.reviewId === selectedReviewId) || drafts[0] || null;
  const selectedNoteId = draftItemNoteId(selectedDraft);
  const selectedTitle = selectedDraft ? draftItemTitle(selectedDraft) : "暂无待审核草稿";
  const selectedSocialContent = draftItemSocialContent(selectedDraft);
  const selectedDraftForm = selectedDraft?.form || {};
  const selectedDraftSocialDraft = selectedDraft?.socialDraft || null;
  const generatedImages = draftItemImages(selectedDraft);
  const generatedImageItems = imageVersionDisplayItems(selectedDraft?.result, selectedDraftForm.imageCount || selectedDraft?.result?.imageCount || 1, false);
  const sourceImages = noteDetail?.source_images?.length ? sourceImagesForNote(noteDetail) : draftItemSourceImages(selectedDraft);
  const originalContent = sanitizeXhsDraftContent(noteDetail?.content || selectedDraft?.form?.content || "");
  const selectedMetrics = noteDetail || selectedDraft || {};
  const progressMessage = !drafts.length && progress.status === "idle" ? emptyDraftHint : progress.message;

  function navigateTo(view) {
    if (typeof onNavigate === "function") onNavigate(view);
  }

  useEffect(() => {
    if (!selectedNoteId) {
      setNoteDetail(null);
      setDetailMessage("");
      return undefined;
    }

    let alive = true;
    setLoadingNoteDetail(true);
    setDetailMessage("");
    requestJson("/api/image-note", {
      method: "POST",
      body: JSON.stringify({ noteId: selectedNoteId }),
    })
      .then((payload) => {
        if (!alive) return;
        setNoteDetail(payload.note || null);
      })
      .catch((error) => {
        if (!alive) return;
        setNoteDetail(null);
        setDetailMessage(error.message || "读取笔记详情失败");
      })
      .finally(() => {
        if (alive) setLoadingNoteDetail(false);
      });

    return () => {
      alive = false;
    };
  }, [selectedNoteId]);

  function persistDraft(nextDraft) {
    const normalized = persistReviewDraft(nextDraft);
    setSelectedReviewId(normalized.reviewId);
    return normalized;
  }

  function updateProgress(activeStep, message, status = "running") {
    setProgress({ status, activeStep, message });
  }

  async function regenerateSocialDraft(event) {
    event.preventDefault();
    if (!selectedDraft) {
      setProgress({ status: "failed", activeStep: 0, message: "请先选择一条待审核草稿" });
      return;
    }
    if (!selectedNoteId) {
      setProgress({ status: "failed", activeStep: 0, message: "缺少 note_id，无法改文案" });
      return;
    }

    const startedAt = Date.now();
    setEditingSocial(true);
    updateProgress(1, selectedSocialContent ? "调用豆包改写文案" : "调用豆包生成文案");
    try {
      const payload = await requestJson("/api/social-generate", {
        method: "POST",
        body: JSON.stringify({
          platform: selectedDraft?.socialPlatform || "xhs",
          noteId: selectedNoteId,
          title: noteDetail?.title || selectedDraftForm.title || "",
          content: noteDetail?.content || selectedDraftForm.content || "",
          targetPersona: noteDetail?.primary_target_persona || selectedDraftForm.targetPersona || "",
          userPain: noteDetail?.true_pain_label || selectedDraftForm.userPain || "",
          businessLogic: noteDetail?.business_logic || selectedDraftForm.businessLogic || "",
          businessKnowledge: noteDetail?.business_knowledge || selectedDraftForm.businessKnowledge || "",
          imagePrompt: promptPayloadForSave(selectedDraftForm || emptyImageWorkflowForm),
          images: generatedImages,
          workflowAction: selectedSocialContent ? "social_edit" : "social_generate",
          currentSocialContent: selectedSocialContent,
          editInstruction: socialEditInstruction.trim(),
        }),
      });

      persistDraft({
        ...selectedDraft,
        socialPlatform: payload.platform || selectedDraft?.socialPlatform || "xhs",
        socialDraft: {
          platform: payload.platform || selectedDraft?.socialPlatform || "xhs",
          platformLabel: payload.platformLabel || socialPlatformLabels[payload.platform] || "小红书",
          content: sanitizeXhsDraftContent(payload.content),
          model: payload.model || "",
          latencyMs: payload.latencyMs || 0,
        },
      });
      setSocialEditInstruction("");
      updateProgress(3, payload.logWarning ? `文案已更新，监控日志：${payload.logWarning}` : "文案已更新", "done");
    } catch (error) {
      setProgress({ status: "failed", activeStep: 1, message: error.message || "文案生成失败" });
    } finally {
      setEditingSocial(false);
    }
  }

  async function editDraftImage(event) {
    event.preventDefault();
    if (!selectedDraft) {
      setProgress({ status: "failed", activeStep: 0, message: "请先选择一条待审核草稿" });
      return;
    }
    const slot = normalizeWorkflowImageCount(editingSlot);
    const instruction = editInstruction.trim();
    const editCount = Math.min(2, normalizeWorkflowImageCount(editImageCount));
    const currentImageResult = selectedDraft?.result;
    const sourceSlot = imageSlotItems(currentImageResult).find((item) => item.slot === slot);
    const sourceImage = editingSourceImage?.url ? editingSourceImage : sourceSlot?.image;
    if (!sourceImage?.url) {
      setProgress({ status: "failed", activeStep: 2, message: "请先选择当前草稿里的图片后再改图" });
      return;
    }
    if (!instruction) {
      setProgress({ status: "failed", activeStep: 2, message: "请填写这次要修改的点" });
      return;
    }

    const startedAt = Date.now();
    const originalPrompt = imagePromptAt(selectedDraftForm || emptyImageWorkflowForm, slot) || selectedDraftForm.imagePrompt || "";
    const editPrompts = Array.from({ length: editCount }, (_, index) => ({
      slot: index + 1,
      prompt: buildImageEditPrompt({ slot, originalPrompt, instruction, branchIndex: index + 1, branchTotal: editCount }),
    }));
    setEditingImage(true);
    updateProgress(2, editCount > 1 ? `第${slot}张改图并派生${editCount}张图任务创建中` : `第${slot}张改图任务创建中`);
    try {
      const payload = await requestJson("/api/image-generate", {
        method: "POST",
        body: JSON.stringify({
          noteId: selectedNoteId,
          title: selectedDraftForm.title || noteDetail?.title || "",
          content: selectedDraftForm.content || noteDetail?.content || "",
          targetPersona: selectedDraftForm.targetPersona || noteDetail?.primary_target_persona || "",
          userPain: selectedDraftForm.userPain || noteDetail?.true_pain_label || "",
          businessLogic: selectedDraftForm.businessLogic || noteDetail?.business_logic || "",
          businessKnowledge: selectedDraftForm.businessKnowledge || noteDetail?.business_knowledge || "",
          imagePrompt: editPrompts.map((item) => item.prompt).join("\n\n"),
          imagePrompts: editPrompts,
          unifiedVisualStyle: false,
          referenceImage: sourceImage.url,
          workflowAction: "image_edit",
          editSlot: slot,
          size: selectedDraftForm.size || "1024x1536",
          imageCount: editCount,
        }),
      });

      let editImages = (payload.images || []).map((image) => ({ ...image, sourceEditSlot: slot }));
      let taskState = (payload.tasks?.length ? payload.tasks : [{ slot: 1, taskId: payload.taskId, images: editImages }]).map((task, index) => ({
        slot: Number(task.slot || index + 1),
        taskId: task.taskId,
        status: task.images?.length ? "succeeded" : "processing",
        images: (task.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
      }));

      if (editImages.length < editCount) {
        if (!taskState.some((task) => task.taskId)) throw new Error("改图任务创建成功，但没有返回任务 ID");
        updateProgress(2, editCount > 1 ? `第${slot}张改图与新增图生成中` : `第${slot}张改图生成中`);
        for (let attempt = 0; attempt < maxImageTaskPollAttempts; attempt += 1) {
          await wait(imageTaskPollDelay(attempt));
          for (let index = 0; index < taskState.length; index += 1) {
            const task = taskState[index];
            if (!task?.taskId || task.images?.length) continue;
            const taskPayload = await requestJson(`/api/image-task?taskId=${encodeURIComponent(task.taskId)}`);
            taskState[index] = {
              ...task,
              status: taskPayload.status,
              images: (taskPayload.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
            };
            if (taskPayload.status === "failed") throw new Error(taskPayload.error || `第${slot}张改图失败`);
          }
          editImages = taskState.flatMap((task) => task.images || []);
          if (editImages.length >= editCount) break;
          const pendingLabels = taskState.filter((task) => !task.images?.length).map((task) => `派生${task.slot}${imageTaskStatusLabel(task.status)}`);
          updateProgress(2, pendingLabels.join("，") || `第${slot}张${imageTaskStatusLabel("processing")}`);
        }
      }

      if (editImages.length < editCount) throw new Error("改图任务仍在处理中，请稍后重试");
      const editResult = {
        ...payload,
        tasks: taskState,
        images: editImages,
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
      };
      const nextResult = appendEditedImages(currentImageResult, slot, editResult, editImages.slice(0, editCount), instruction, Date.now() - startedAt);
      persistDraft({
        ...selectedDraft,
        result: nextResult,
      });
      resetImageEdit();
      updateProgress(3, `第${slot}张已改图`, "done");
    } catch (error) {
      setProgress({ status: "failed", activeStep: 2, message: error.message || "改图失败" });
    } finally {
      setEditingImage(false);
    }
  }

  async function copyDraftContent() {
    if (!selectedDraft) {
      setProgress({ status: "failed", activeStep: 0, message: "当前没有可复制的待审核草稿" });
      return;
    }
    const content = selectedSocialContent;
    if (!content) {
      setProgress({ status: "failed", activeStep: 3, message: "当前草稿还没有可复制的小红书文案" });
      return;
    }
    try {
      await navigator.clipboard?.writeText(content);
      updateProgress(3, "小红书文案已复制", "done");
    } catch {
      updateProgress(3, "复制失败，请手动选中文案", "failed");
    }
  }

  async function downloadDraftPackage() {
    if (!selectedDraft) {
      updateProgress(3, "当前没有可下载的待审核草稿", "failed");
      return;
    }
    setSavingDraft(true);
    try {
      const response = await fetch("/api/draft-package", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          draftPackagePayloadFromItem(selectedDraft, {
            socialContent: selectedSocialContent,
            sourceImages,
            noteDetail,
          }),
        ),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition"), "待审核草稿.zip");
      downloadBlob(blob, filename);
      updateProgress(3, "草稿包已生成下载", "done");
    } catch (error) {
      updateProgress(3, error.message || "草稿包保存失败", "failed");
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <section className="draft-review-flow">
      <section className="panel draft-review-strip-panel">
        <SectionHeader
          icon={ListChecks}
          title="待审核草稿"
          action={
            <div className="header-actions">
              <button className="copy-button" type="button" onClick={() => navigateTo("fixedContent")}>
                返回固定内容流
              </button>
              <button className="copy-button" type="button" onClick={() => navigateTo("imageGen")}>
                返回爆文洗稿流
              </button>
              <StatusPill tone="neutral">{formatNumber(drafts.length)}条</StatusPill>
            </div>
          }
        />
        {drafts.length ? (
          <div className="draft-review-strip">
            {drafts.map((item) => {
              const images = draftItemImages(item);
              const socialContent = draftItemSocialContent(item);
              const active = selectedDraft?.reviewId === item.reviewId;
              return (
                <button
                  key={item.reviewId}
                  className={`draft-review-card ${active ? "active" : ""}`}
                  type="button"
                  onClick={() => setSelectedReviewId(item.reviewId)}
                >
                  <div className="draft-review-card-head">
                    <div>
                      <span>{item.sourceLabel || "待审核草稿"}</span>
                      <strong>{draftItemTitle(item)}</strong>
                      <p>{item.lineShortTitle || item.lineTitle || draftItemNoteId(item) || "-"}</p>
                    </div>
                    <StatusPill tone={socialContent ? "green" : "amber"}>{socialContent ? "可审阅" : "待生成"}</StatusPill>
                  </div>
                  <div className="draft-review-thumb-row">
                    {images.length ? (
                      images.map((image) => (
                        <span key={`${item.reviewId}-${image.slot}-${image.version}`} className="draft-review-thumb">
                          <img src={image.url} alt={`草稿图 ${image.slot}-${image.version}`} />
                          <em>{imageVersionBadge(image)}</em>
                        </span>
                      ))
                    ) : (
                      <div className="draft-review-thumb-empty">暂无图片</div>
                    )}
                  </div>
                  <p className="draft-review-card-preview">{socialContent ? textPreview(socialContent, 110) : "暂无小红书文案"}</p>
                  <div className="draft-review-card-meta">
                    <span>{formatDateTimeSecond(item.updatedAt || item.createdAt)}</span>
                    <span>{formatNumber(images.length)} 张图</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="draft-review-empty-shell">
            <div className="draft-review-empty-copy">
              <Layers3 size={28} />
              <strong>暂无待审核草稿</strong>
              <span>先跑一次固定内容流或爆文洗稿流，历史会自动进这里。</span>
            </div>
            <div className="draft-review-empty-actions">
              <button className="copy-button" type="button" onClick={() => navigateTo("fixedContent")}>
                去固定内容流
              </button>
              <button className="copy-button" type="button" onClick={() => navigateTo("imageGen")}>
                去爆文洗稿流
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel draft-review-progress-panel">
        <WorkflowSteps steps={reviewDraftSteps} progress={progress} />
        <div className={`fixed-progress-message ${progress.status === "failed" ? "failed" : ""}`}>{progressMessage}</div>
      </section>

      <section className="draft-review-grid">
        <section className="panel draft-review-original-panel">
          <SectionHeader
            icon={FileText}
            title="原红书内容"
            action={<StatusPill tone={selectedDraft ? "blue" : "neutral"}>{selectedDraft ? draftItemSourceLabel(selectedDraft) : "等待草稿"}</StatusPill>}
          />
          <div className="draft-review-head">
            <div>
              <strong>{selectedTitle}</strong>
              <span>
                {selectedNoteId || "-"} · {noteDetail?.author_nickname || selectedDraft?.authorNickname || "-"} · {formatDateTimeSecond(noteDetail?.note_date || selectedDraft?.noteDate || selectedDraft?.createdAt)}
              </span>
            </div>
            <div className="header-actions">
              <button className="copy-button" type="button" onClick={copyDraftContent} disabled={!selectedDraft || !selectedSocialContent}>
                复制文案
              </button>
              <button className="primary-button" type="button" onClick={downloadDraftPackage} disabled={savingDraft || !selectedDraft}>
                <Save size={15} />
                {savingDraft ? "下载中" : "下载内容包"}
              </button>
            </div>
          </div>
          <div className="note-analysis-metrics draft-review-metrics">
            <NoteMetricChip label="互动" value={selectedMetrics.interaction_score} />
            <NoteMetricChip label="赞" value={selectedMetrics.like_count} />
            <NoteMetricChip label="藏" value={selectedMetrics.collected_count} />
            <NoteMetricChip label="评" value={selectedMetrics.comments_count} />
          </div>
          <DetailTextBlock title="原笔记标题">
            <p>{noteDetail?.title || selectedTitle || "-"}</p>
          </DetailTextBlock>
          <DetailTextBlock title="原笔记文案">
            <textarea readOnly value={originalContent} rows={12} placeholder={loadingNoteDetail ? "原文读取中" : "暂无原文"} />
          </DetailTextBlock>
          <DetailTextBlock title="原笔记图片">
            {sourceImages.length ? (
              <div className="draft-review-source-grid">
                {sourceImages.map((image) => (
                  <button key={image.url} type="button" onClick={() => setPreviewImage(image)}>
                    <img src={image.url} alt={`原笔记图片 ${image.slot}`} />
                    <span>{image.slot}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="fixed-source-empty">{loadingNoteDetail ? "原图读取中" : "暂无原图预览"}</div>
            )}
          </DetailTextBlock>
        </section>

        <section className="panel draft-review-copy-panel">
          <SectionHeader
            icon={FileText}
            title="新红书文案"
            action={
              selectedDraftSocialDraft?.model ? (
                <StatusPill tone="green">{selectedDraftSocialDraft.model}</StatusPill>
              ) : (
                <StatusPill tone={selectedSocialContent ? "green" : "amber"}>{selectedSocialContent ? "已清洗" : "待生成"}</StatusPill>
              )
            }
          />
          <div className="draft-review-head">
            <div>
              <strong>{selectedDraft ? draftItemTitle(selectedDraft) : "等待草稿"}</strong>
              <span>
                {selectedNoteId || "-"} · {selectedDraft?.sourceLabel || "-"} · {formatDateTimeSecond(selectedDraft?.updatedAt || selectedDraft?.createdAt)}
              </span>
            </div>
            <button className="copy-button" type="button" onClick={copyDraftContent} disabled={!selectedDraft || !selectedSocialContent}>
              复制文案
            </button>
          </div>
          <textarea readOnly value={selectedSocialContent} rows={16} placeholder={loadingNoteDetail ? "文案读取中" : "生成后的小红书文案会显示在这里"} />
          <div className="draft-review-edit-card">
            <ImageWorkflowField
              label="文案修改提示词"
              value={socialEditInstruction}
              onChange={setSocialEditInstruction}
              placeholder="例如：更口语、更短，保留关键数据，把结尾改成评论引导"
              rows={4}
            />
            <div className="draft-review-actions">
              <button className="primary-button" type="button" onClick={regenerateSocialDraft} disabled={editingSocial || !selectedDraft}>
                <Sparkles size={15} />
                {editingSocial ? "改文案中" : selectedSocialContent ? "改文案" : "生成文案"}
              </button>
            </div>
          </div>
          {detailMessage ? <div className="admin-message">{detailMessage}</div> : null}
        </section>

        <section className="panel draft-review-image-panel">
          <SectionHeader icon={ImagePlus} title="洗稿图片" action={<StatusPill tone="neutral">{formatNumber(generatedImageItems.length)} 张</StatusPill>} />
          {generatedImageItems.length ? (
            <div className="draft-review-image-grid">
              {generatedImageItems.map((item) => (
                <div className="draft-review-image-card" key={item.key}>
                  <button type="button" className="draft-review-thumb-button" onClick={() => setPreviewImage(item.image)} disabled={!item.image?.url}>
                    <img src={item.image.url} alt={`洗稿图片 ${item.slot} ${item.image.version || 1}`} />
                    <span className="image-version-badge">{imageVersionBadge(item.image)}</span>
                  </button>
                  <div className="image-slot-actions">
                    <button className="copy-button" type="button" onClick={() => openImageEdit(item.slot, item.image)} disabled={editingImage}>
                      <PencilLine size={14} />
                      改图
                    </button>
                    <span>{item.isLatest ? "最新版本" : "历史版本"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="draft-review-empty">暂无图片结果，生成后会横向列在这里</div>
          )}
          {editingSlot ? (
            <ImageEditPanel
              title={imageVersionLabel(editingSourceImage || { slot: editingSlot })}
              instruction={editInstruction}
              onInstructionChange={setEditInstruction}
              imageCount={editImageCount}
              onImageCountChange={setEditImageCount}
              onCancel={resetImageEdit}
              onSubmit={editDraftImage}
              editing={editingImage}
              placeholder="只写这次要改的点；如果要拆成两张图，可以写清楚两张图各自承担什么内容"
            />
          ) : (
            <div className="draft-review-empty">{generatedImages.length ? "点击图片上的改图按钮继续调整" : "暂无图片结果"}</div>
          )}
        </section>
      </section>

      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </section>
  );
}

function LoginScreen({ onLogin, loading, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    await onLogin(username.trim(), password);
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand-block login-brand">
          <div className="brand-icon">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>GEO XHS</strong>
            <span>Intelligence</span>
          </div>
        </div>
        <div className="login-form">
          <label>
            <span>账号</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            登录
          </button>
          {error ? <div className="login-error">{error}</div> : null}
        </div>
      </form>
    </main>
  );
}

function insightSearchText(item) {
  return [
    item.title,
    item.note_id,
    item.note_date,
    item.content_excerpt,
    item.author_nickname,
    item.note_type,
    item.core_topic_category,
    item.primary_target_persona,
    arrayText(item.target_persona_tags),
    item.primary_industry,
    arrayText(item.industry_tags),
    item.funnel_role,
    item.true_pain_label,
    item.pain_description,
    item.business_logic,
    item.content_logic,
    arrayText(item.hook_types),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function ExpandableCellText({ value, max = 86 }) {
  const text = String(value || "-").trim() || "-";
  if (text.length <= max) return <div className="insight-table-text">{text}</div>;
  return (
    <details className="expandable-cell">
      <summary>
        <span>{textPreview(text, max)}</span>
        <em>展开</em>
      </summary>
      <p>{text}</p>
    </details>
  );
}

function InsightNoteTable({ rows, compact = false }) {
  if (!rows.length) return <div className="empty-state">暂无数据</div>;

  return (
    <div className="table-wrap insight-table-wrap">
      <table className="insight-table">
        <colgroup>
          <col className="insight-col-note" />
          <col className="insight-col-topic" />
          <col className="insight-col-persona" />
          <col className="insight-col-metrics" />
          <col className="insight-col-hook" />
          <col className="insight-col-business" />
        </colgroup>
        <thead>
          <tr>
            <th>笔记</th>
            <th>主题类型</th>
            <th>目标人群</th>
            <th>点赞/收藏/评论</th>
            <th>情绪钩子</th>
            <th>业务逻辑</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={`${item.note_id}-${item.primary_target_persona || ""}`}>
              <td>
                <div className="note-title">{item.title || item.note_id}</div>
                <div className="note-meta">
                  {item.note_id} · 笔记日期 {formatDayLabel(item.note_date || item.publish_time)}
                </div>
              </td>
              <td>
                <div className="insight-pill-wrap">
                  <StatusPill tone="blue">{item.core_topic_category || "未标注"}</StatusPill>
                </div>
                <div className="note-meta">{item.note_type || "-"}</div>
              </td>
              <td>
                <ExpandableCellText value={item.primary_target_persona || arrayText(item.target_persona_tags) || "未标注"} max={46} />
              </td>
              <td>
                <div className="insight-metrics-mini">
                  <span>
                    <em>赞</em>
                    <strong>{formatNumber(item.like_count)}</strong>
                  </span>
                  <span>
                    <em>藏</em>
                    <strong>{formatNumber(item.collected_count)}</strong>
                  </span>
                  <span>
                    <em>评</em>
                    <strong>{formatNumber(item.comments_count)}</strong>
                  </span>
                </div>
              </td>
              <td>
                <ExpandableCellText value={item.true_pain_label || item.pain_description || "-"} max={76} />
                {arrayText(item.hook_types) ? <TagLine values={item.hook_types} /> : null}
              </td>
              <td className="business-logic-cell">
                <ExpandableCellText value={item.business_logic || item.content_logic || "-"} max={108} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopicFrequencyList({ rows }) {
  const max = Math.max(1, ...rows.map((item) => Number(item.note_count || 0)));
  if (!rows.length) return <div className="empty-state">暂无数据</div>;

  return (
    <div className="topic-frequency-list">
      {rows.map((item) => {
        const width = Math.max(4, Math.round((Number(item.note_count || 0) / max) * 100));
        return (
          <div className="topic-frequency-row" key={item.core_topic_category || "未标注"}>
            <div className="topic-frequency-main">
              <span>{item.core_topic_category || "未标注"}</span>
              <strong>{formatNumber(item.note_count)}</strong>
            </div>
            <div className="topic-frequency-track" aria-hidden="true">
              <div style={{ width: `${width}%` }} />
            </div>
            <small>{formatPercent(item.share_pct)}</small>
          </div>
        );
      })}
    </div>
  );
}

function polarPoint(cx, cy, radius, angle) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function pieSlicePath(cx, cy, radius, startAngle, endAngle) {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function PersonaPieChart({ rows, selectedPersona, onSelect }) {
  const total = rows.reduce((sum, item) => sum + Number(item.note_count || 0), 0);
  let cursor = 0;
  const segments = rows.map((item, index) => {
    const value = Number(item.note_count || 0);
    const angle = total ? (value / total) * 360 : 0;
    const segment = {
      ...item,
      color: chartColors[index % chartColors.length],
      startAngle: cursor,
      endAngle: cursor + Math.min(angle, 359.99),
    };
    cursor += angle;
    return segment;
  });

  if (!rows.length) return <div className="empty-state">暂无数据</div>;

  return (
    <div className="persona-pie-layout">
      <svg className="persona-pie" viewBox="0 0 220 220" role="img" aria-label="目标人群占比">
        {segments.map((item) => {
          const label = item.primary_target_persona || "未标注";
          const selected = selectedPersona === label;
          return (
            <path
              key={label}
              className={`persona-pie-segment ${selected ? "selected" : ""}`}
              d={pieSlicePath(110, 110, 96, item.startAngle, item.endAngle)}
              fill={item.color}
              role="button"
              tabIndex="0"
              onClick={() => onSelect(selected ? "" : label)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(selected ? "" : label);
              }}
            />
          );
        })}
        <circle cx="110" cy="110" r="54" className="persona-pie-hole" />
        <text x="110" y="104" className="persona-pie-total">
          {formatNumber(total)}
        </text>
        <text x="110" y="126" className="persona-pie-caption">
          笔记
        </text>
      </svg>
      <div className="persona-legend">
        <button className={!selectedPersona ? "active" : ""} onClick={() => onSelect("")} type="button">
          <i style={{ background: "#8d9890" }} />
          <span>全部人群</span>
          <strong>{formatNumber(total)}</strong>
        </button>
        {segments.map((item) => {
          const label = item.primary_target_persona || "未标注";
          return (
            <button className={selectedPersona === label ? "active" : ""} key={label} onClick={() => onSelect(label)} type="button">
              <i style={{ background: item.color }} />
              <span>{label}</span>
              <strong>{formatNumber(item.note_count)}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const contentMetricCards = [
  { key: "note_count", overviewKey: "noteTotal", label: "笔记总数", icon: FileText, tone: "blue", sub: "当前周期" },
  { key: "like_total", overviewKey: "likeTotal", label: "笔记点赞", icon: Heart, tone: "purple", sub: "近30天趋势" },
  { key: "collected_total", overviewKey: "collectedTotal", label: "笔记收藏", icon: Bookmark, tone: "amber", sub: "近30天趋势" },
  { key: "comments_total", overviewKey: "commentsTotal", label: "笔记评论", icon: MessageCircle, tone: "teal", sub: "近30天趋势" },
];

function MiniSparkline({ rows, valueKey, color = "var(--blue)" }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const points = useMemo(() => {
    const values = rows.map((item) => Number(item[valueKey] || 0));
    const max = Math.max(1, ...values);
    return values.map((value, index) => {
      const x = rows.length <= 1 ? 80 : (index / (rows.length - 1)) * 160;
      const y = 44 - (value / max) * 36;
      return { x, y, value, date: rows[index]?.bucket_date || rows[index]?.bucket_start };
    });
  }, [rows, valueKey]);

  if (!points.length) return <div className="mini-sparkline-empty">暂无近30天数据</div>;

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div className="mini-sparkline">
      <svg viewBox="0 0 160 48" onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)} role="img" aria-label="近30天趋势">
        <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {hovered ? (
          <>
            <line x1={hovered.x} x2={hovered.x} y1="4" y2="46" className="mini-sparkline-hover-line" />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={color} className="mini-sparkline-dot" />
          </>
        ) : null}
      </svg>
      {hovered ? (
        <div className="mini-sparkline-tooltip" style={{ left: `${(hovered.x / 160) * 100}%` }}>
          <strong>{formatNumber(hovered.value)}</strong>
          <span>{formatShortDate(hovered.date)}</span>
        </div>
      ) : null}
    </div>
  );
}

function InsightMetricCard({ icon: Icon, label, value, sub, tone, sparkRows, sparkKey }) {
  const colorByTone = {
    blue: "var(--blue)",
    teal: "var(--teal)",
    purple: "var(--purple)",
    amber: "var(--amber)",
  };

  return (
    <section className={`stat insight-metric-card stat-${tone || "blue"}`}>
      <div className="stat-icon" aria-hidden="true">
        <Icon size={18} />
      </div>
      <div className="insight-metric-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-sub">{sub}</div>
        <MiniSparkline rows={sparkRows || []} valueKey={sparkKey} color={colorByTone[tone] || "var(--blue)"} />
      </div>
    </section>
  );
}

function ContentTrendChart({ rows, selectedDate, onSelectDate }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const prepared = useMemo(() => {
    const width = 920;
    const height = 330;
    const padLeft = 64;
    const padRight = 56;
    const padTop = 30;
    const padBottom = 56;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;
    const metricKeys = ["like_total", "collected_total", "comments_total"];
    const maxMetric = Math.max(1, ...rows.flatMap((row) => metricKeys.map((key) => Number(row[key] || 0))));
    const maxCount = Math.max(1, ...rows.map((row) => Number(row.note_count || 0)));
    const xFor = (index) => padLeft + (rows.length <= 1 ? innerW / 2 : (index / (rows.length - 1)) * innerW);
    const yMetric = (value) => padTop + innerH - (Number(value || 0) / maxMetric) * innerH;
    const yCount = (value) => padTop + innerH - (Number(value || 0) / maxCount) * innerH;
    const barWidth = Math.max(2, Math.min(28, innerW / Math.max(1, rows.length) / 2.2));
    const points = rows.map((row, index) => ({
      ...row,
      dateKey: dateKeyFromValue(row.bucket_date),
      x: xFor(index),
      countY: yCount(row.note_count),
      barHeight: padTop + innerH - yCount(row.note_count),
    }));
    const series = [
      { key: "like_total", label: "点赞数", color: "#18aee8" },
      { key: "collected_total", label: "收藏数", color: "#6fdc72" },
      { key: "comments_total", label: "评论数", color: "#ff5f7f" },
    ].map((item) => ({
      ...item,
      d: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${yMetric(point[item.key]).toFixed(1)}`).join(" "),
    }));
    const metricTicks = [0, maxMetric * 0.5, maxMetric].map((value) => Math.round(value));
    const countTicks = [0, maxCount * 0.5, maxCount].map((value) => Math.round(value));
    return { width, height, padLeft, padRight, padTop, padBottom, innerW, innerH, points, series, metricTicks, countTicks, yMetric, yCount, barWidth };
  }, [rows]);

  if (!rows.length) return <div className="empty-state">暂无趋势数据</div>;

  const hovered = hoverIndex !== null ? prepared.points[hoverIndex] : null;
  const visibleLabelStep = Math.max(1, Math.ceil(prepared.points.length / 8));
  const tooltipLeft = hovered ? Math.min(82, Math.max(18, (hovered.x / prepared.width) * 100)) : 50;

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (prepared.points.length - 1)));
  }

  return (
    <div className="content-trend-chart">
      <div className="content-trend-summary">
        当前周期共有 <strong>{formatNumber(rows.reduce((sum, item) => sum + Number(item.note_count || 0), 0))}</strong> 篇笔记
      </div>
      <svg viewBox={`0 0 ${prepared.width} ${prepared.height}`} onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)} role="img" aria-label="笔记数据表现分布">
        <title>笔记数据表现分布：曲线为点赞、收藏、评论，柱状为笔记篇数</title>
        {prepared.metricTicks.map((tick) => {
          const y = prepared.yMetric(tick);
          return (
            <g key={`metric-${tick}`}>
              <line x1={prepared.padLeft} x2={prepared.width - prepared.padRight} y1={y} y2={y} className={tick === 0 ? "chart-axis" : "chart-grid"} />
              <text x={prepared.padLeft - 10} y={y + 4} textAnchor="end" className="chart-label">
                {formatCompact(tick)}
              </text>
            </g>
          );
        })}
        {prepared.countTicks.map((tick) => {
          const y = prepared.yCount(tick);
          return (
            <text key={`count-${tick}`} x={prepared.width - prepared.padRight + 10} y={y + 4} className="chart-label">
              {formatCompact(tick)}
            </text>
          );
        })}
        {prepared.points.map((point, index) => (
          <rect
            key={`bar-${point.bucket_date}-${index}`}
            x={point.x - prepared.barWidth / 2}
            y={point.countY}
            width={prepared.barWidth}
            height={Math.max(1, point.barHeight)}
            rx="5"
            className={`content-trend-bar ${selectedDate === point.dateKey ? "selected" : ""}`}
            role="button"
            tabIndex="0"
            onClick={() => onSelectDate?.(point.dateKey)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelectDate?.(point.dateKey);
            }}
          />
        ))}
        {prepared.series.map((series) => (
          <path key={series.key} d={series.d} fill="none" stroke={series.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {hovered ? (
          <line x1={hovered.x} x2={hovered.x} y1={prepared.padTop} y2={prepared.height - prepared.padBottom} className="chart-hover-line" />
        ) : null}
        {prepared.points.map((point, index) =>
          index % visibleLabelStep === 0 || index === prepared.points.length - 1 ? (
            <text key={`label-${point.bucket_date}-${index}`} x={point.x} y={prepared.height - 22} textAnchor="middle" className="chart-label chart-x-label">
              {formatDayLabel(point.bucket_date)}
            </text>
          ) : null,
        )}
        <text x={prepared.padLeft} y={15} className="chart-axis-title">
          左轴：点赞/收藏/评论
        </text>
        <text x={prepared.width - prepared.padRight} y={15} textAnchor="end" className="chart-axis-title">
          右轴：笔记篇数
        </text>
      </svg>
      {hovered ? (
        <div className="content-trend-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <strong>{formatDayLabel(hovered.bucket_date)}</strong>
          <div>
            <span>笔记篇数</span>
            <b>{formatNumber(hovered.note_count)}</b>
            <span>点赞数</span>
            <b>{formatNumber(hovered.like_total)}</b>
            <span>收藏数</span>
            <b>{formatNumber(hovered.collected_total)}</b>
            <span>评论数</span>
            <b>{formatNumber(hovered.comments_total)}</b>
          </div>
        </div>
      ) : null}
      <div className="content-trend-legend">
        <span>
          <i className="legend-note-count" />
          笔记篇数
        </span>
        <span>
          <i style={{ background: "#18aee8" }} />
          点赞数
        </span>
        <span>
          <i style={{ background: "#6fdc72" }} />
          收藏数
        </span>
        <span>
          <i style={{ background: "#ff5f7f" }} />
          评论数
        </span>
      </div>
    </div>
  );
}

function NoteMetricChip({ label, value }) {
  return (
    <span className="note-metric-chip">
      <em>{label}</em>
      <strong>{formatNumber(value)}</strong>
    </span>
  );
}

function DailyNoteRail({ date, notes, selectedNoteId, onSelectNote }) {
  return (
    <section className="daily-note-rail">
      <div className="daily-note-rail-head">
        <div>
          <span>{date ? formatDayLabel(date) : "未选日期"}</span>
          <strong>笔记预览</strong>
        </div>
        <StatusPill tone="neutral">{formatNumber(notes.length)} 条 · 按互动量</StatusPill>
      </div>
      {notes.length ? (
        <div className="daily-note-strip">
          {notes.map((item) => (
            <article
              className={`daily-note-card ${selectedNoteId === item.note_id ? "active" : ""}`}
              key={item.note_id}
              onClick={() => onSelectNote(item.note_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectNote(item.note_id);
              }}
              role="button"
              tabIndex="0"
            >
              <div className="daily-note-basic">
                <div className="daily-note-card-top">
                  <StatusPill tone={item.funnel_role === "转化" ? "green" : item.funnel_role === "信任" ? "blue" : "neutral"}>
                    {item.funnel_role || "未标注漏斗"}
                  </StatusPill>
                  <span>{formatDayLabel(item.note_date || item.publish_time)}</span>
                </div>
                <strong>{item.title || item.note_id}</strong>
                <p>{textPreview(noteContentText(item), 132) || "-"}</p>
                <div className="daily-note-topic-row">
                  <span>{item.core_topic_category || "未标注话题"}</span>
                  <span>{arrayText(item.hook_types) || "未标注钩子"}</span>
                </div>
                <div className="daily-note-metrics">
                  <NoteMetricChip label="互动" value={item.interaction_score} />
                  <NoteMetricChip label="赞" value={item.like_count} />
                  <NoteMetricChip label="藏" value={item.collected_count} />
                  <NoteMetricChip label="评" value={item.comments_count} />
                </div>
              </div>
              <div className="daily-note-insight-grid">
                <section>
                  <h3>目标人群及痛点判断</h3>
                  <strong>{item.primary_target_persona || "未标注人群"}</strong>
                  <p>{item.true_pain_label || item.pain_description || "-"}</p>
                  <small>{item.target_persona_reason || item.pain_evidence || ""}</small>
                </section>
                <section>
                  <h3>业务逻辑和可复用角度</h3>
                  <strong>{item.business_logic || item.content_logic || "-"}</strong>
                  <p>{firstStructuredText(item.reusable_angles, item.funnel_role_reason || "")}</p>
                </section>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state daily-note-empty">暂无该日期笔记</div>
      )}
    </section>
  );
}

function DetailTextBlock({ title, children }) {
  return (
    <section className="note-detail-block">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function StructuredList({ value }) {
  const items = listItems(value);
  if (!items.length) return <p>-</p>;
  return (
    <ul className="structured-list">
      {items.slice(0, 6).map((item, index) => (
        <li key={`${structuredText(item)}-${index}`}>{structuredText(item)}</li>
      ))}
    </ul>
  );
}

function TagLine({ values }) {
  const items = listItems(values);
  if (!items.length) return <span>-</span>;
  return (
    <div className="note-tag-line">
      {items.slice(0, 8).map((item) => (
        <span key={String(item)}>{String(item)}</span>
      ))}
    </div>
  );
}

function NoteAnalysisBoard({ note, onClose }) {
  useEffect(() => {
    if (!note) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [note, onClose]);

  if (!note) return null;
  const contentText = noteContentText(note);
  return (
    <div
      className="note-analysis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="note-analysis-board note-analysis-modal" role="dialog" aria-modal="true" aria-labelledby="note-analysis-title">
      <div className="note-analysis-head">
        <div>
          <div className="note-analysis-kicker">
            <StatusPill tone="blue">{note.core_topic_category || "未标注主题"}</StatusPill>
            <StatusPill tone="neutral">{note.primary_target_persona || "未标注人群"}</StatusPill>
            {note.funnel_role ? <StatusPill tone={note.funnel_role === "转化" ? "green" : note.funnel_role === "信任" ? "blue" : "amber"}>{note.funnel_role}</StatusPill> : null}
          </div>
          <h3 id="note-analysis-title">{note.title || note.note_id}</h3>
          <p>
            {note.note_id} · {note.author_nickname || "-"} · 笔记日期 {formatDayLabel(note.note_date || note.publish_time)}
          </p>
        </div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="关闭笔记分析看板">
          <XCircle size={18} />
        </button>
      </div>

      <div className="note-analysis-metrics">
        <NoteMetricChip label="互动" value={note.interaction_score} />
        <NoteMetricChip label="点赞" value={note.like_count} />
        <NoteMetricChip label="收藏" value={note.collected_count} />
        <NoteMetricChip label="评论" value={note.comments_count} />
        <NoteMetricChip label="转发" value={note.share_count} />
        <NoteMetricChip label="热度" value={note.fresh_hot_score} />
      </div>

      <div className="note-analysis-grid">
        <DetailTextBlock title="笔记文案">
          <p>{contentText || "-"}</p>
        </DetailTextBlock>
        <DetailTextBlock title="痛点判断">
          <p>
            <strong>{note.true_pain_label || "-"}</strong>
          </p>
          <p>{note.pain_description || "-"}</p>
          <p>{note.pain_evidence || ""}</p>
          <div className="note-inline-meta">
            <span>{note.pain_authenticity || "未判断"}</span>
            <span>痛点置信 {formatScore(note.pain_confidence)}</span>
          </div>
        </DetailTextBlock>
        <DetailTextBlock title="人群与行业">
          <p>{note.target_persona_reason || "-"}</p>
          <TagLine values={note.target_persona_tags} />
          <div className="note-inline-meta">
            <span>{note.primary_industry || "未标注行业"}</span>
            <span>{arrayText(note.industry_tags) || "-"}</span>
          </div>
        </DetailTextBlock>
        <DetailTextBlock title="业务逻辑">
          <p>{note.business_logic || "-"}</p>
          <p>{note.content_logic || ""}</p>
          <p>{note.funnel_role_reason || ""}</p>
          <div className="note-inline-meta">
            <span>业务相关 {formatScore(note.business_relevance_score)}</span>
            <span>模型置信 {formatScore(note.llm_confidence)}</span>
          </div>
        </DetailTextBlock>
        <DetailTextBlock title="知识沉淀">
          <StructuredList value={note.knowledge_points} />
        </DetailTextBlock>
        <DetailTextBlock title="可复用角度">
          <StructuredList value={note.reusable_angles} />
        </DetailTextBlock>
        <DetailTextBlock title="承接与风险">
          <p>{note.cta_strategy || "-"}</p>
          <TagLine values={note.hook_types} />
          <StructuredList value={note.risk_flags} />
        </DetailTextBlock>
      </div>
      </section>
    </div>
  );
}

const wordCloudStopWords = new Set([
  "一个",
  "一些",
  "一种",
  "不是",
  "不能",
  "不要",
  "不同",
  "什么",
  "他们",
  "你们",
  "我们",
  "自己",
  "这个",
  "这些",
  "那些",
  "如何",
  "怎么",
  "为什么",
  "可以",
  "可能",
  "需要",
  "没有",
  "很多",
  "非常",
  "比较",
  "因为",
  "所以",
  "如果",
  "但是",
  "还是",
  "以及",
  "通过",
  "进行",
  "时候",
  "用户",
  "内容",
  "笔记",
  "小红书",
  "营销号",
  "焦虑",
  "痛点",
  "问题",
  "人群",
  "类型",
  "字段",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
]);

const wordCloudDomainDict = [
  "留学生 300 n",
  "应届生 260 n",
  "求职 260 n",
  "实习 240 n",
  "简历 220 n",
  "面试 220 n",
  "海投 180 n",
  "转专业 180 n",
  "职业规划 220 n",
  "背景提升 220 n",
  "信息差 220 n",
  "选校 180 n",
  "申请季 180 n",
  "低龄留学 160 n",
  "研究生 160 n",
  "本科生 160 n",
  "职场新人 160 n",
  "家长 160 n",
  "AI 180 eng",
  "AIGC 160 eng",
  "GEO 160 eng",
].join("\n");

let jiebaRuntimePromise;

function loadJiebaRuntime() {
  if (!jiebaRuntimePromise) {
    jiebaRuntimePromise = import("@isdk/nlp-jieba/web").then(async (module) => {
      if (typeof module.default === "function") await module.default();
      try {
        module.addDefaultDict?.();
        module.addDict?.(wordCloudDomainDict);
      } catch {
        // 分词词典加载失败时仍可使用 WASM 基础能力或 fallback。
      }
      return {
        split: (text) => module.split(text, { mode: "Search", hmm: true }),
      };
    });
  }
  return jiebaRuntimePromise;
}

function normalizeCloudText(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{N}+#\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCloudTerm(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}+#]/gu, "")
    .trim();
}

function isUsefulCloudTerm(value) {
  const text = normalizeCloudTerm(value);
  if (!text || wordCloudStopWords.has(text)) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  if (/^\d{2,4}[年月日天]?$/.test(text)) return false;
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
  if (chineseCount) return text.length >= 2 && text.length <= 12;
  if (latinCount) return text.length >= 2 && text.length <= 24;
  return false;
}

function fallbackSegmentText(value) {
  const text = normalizeCloudText(value);
  if (!text) return [];
  return text
    .split(/\s+/)
    .flatMap((part) => {
      if (/^[a-zA-Z][a-zA-Z0-9+#-]{1,24}$/.test(part)) return [part];
      return part.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    });
}

function segmentCloudText(value, segmenter) {
  const text = normalizeCloudText(value);
  if (!text) return [];
  if (!segmenter) return fallbackSegmentText(text);
  try {
    return segmenter(text);
  } catch {
    return fallbackSegmentText(text);
  }
}

function addCloudTerm(termMap, rawTerm, weight, interaction) {
  const term = normalizeCloudTerm(rawTerm);
  if (!isUsefulCloudTerm(term)) return;
  const current = termMap.get(term) || { text: term, count: 0, interaction: 0, weightedCount: 0 };
  current.count += 1;
  current.weightedCount += weight;
  current.interaction += interaction;
  termMap.set(term, current);
}

function buildSegmentedWordCloudTerms(rows, config, segmenter) {
  const termMap = new Map();
  rows.forEach((item) => {
    const interaction = Number(item.interaction_score || 0);
    const perNote = new Map();
    config.exactTerms(item).forEach((term) => addCloudTerm(perNote, term, 1.6, interaction));
    config.segmentTexts(item).forEach((text) => {
      segmentCloudText(text, segmenter).forEach((term) => addCloudTerm(perNote, term, 1, interaction));
    });
    perNote.forEach((value, term) => {
      const current = termMap.get(term) || { text: term, count: 0, interaction: 0, weightedCount: 0 };
      current.count += 1;
      current.weightedCount += value.weightedCount;
      current.interaction += interaction;
      termMap.set(term, current);
    });
  });
  return Array.from(termMap.values())
    .map((item) => ({
      ...item,
      value: Math.max(1, item.weightedCount * 10 + Math.log10(Math.max(1, item.interaction) + 1) * 3),
    }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.text.localeCompare(b.text, "zh-CN"))
    .slice(0, 60);
}

function WordCloudBox({ title, caption, terms, tone, loading }) {
  const options = useMemo(
    () => ({
      colors: tone === "red" ? ["#bc3d3a", "#a85e00", "#7153b8", "#2764cf"] : ["#2764cf", "#087b76", "#26814f", "#7153b8"],
      deterministic: true,
      enableTooltip: true,
      fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSizes: [12, 34],
      fontWeight: "800",
      padding: 3,
      rotationAngles: [0, 0],
      rotations: 1,
      scale: "sqrt",
      spiral: "archimedean",
      transitionDuration: 220,
    }),
    [tone],
  );
  const callbacks = useMemo(
    () => ({
      getWordTooltip: (word) => `${word.text}：${formatNumber(word.count)} 篇，互动 ${formatNumber(word.interaction)}`,
    }),
    [],
  );
  const topTerms = terms.slice(0, 6);

  return (
    <section className={`word-cloud-box word-cloud-${tone || "blue"}`}>
      <div className="word-cloud-head">
        <div>
          <span>{caption}</span>
          <h3>{title}</h3>
        </div>
        <StatusPill tone="neutral">{loading ? "分词中" : `${formatNumber(terms.length)} 个词`}</StatusPill>
      </div>
      {terms.length ? (
        <>
          <div className="word-cloud-render">
            <Suspense fallback={<div className="empty-state word-cloud-empty">词云加载中...</div>}>
              <ReactWordcloud callbacks={callbacks} maxWords={48} minSize={[300, 188]} options={options} words={terms} />
            </Suspense>
          </div>
          <div className="word-cloud-top-terms">
            {topTerms.map((item, index) => (
              <span key={item.text}>
                {index + 1}. {item.text}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state word-cloud-empty">暂无可聚合词</div>
      )}
    </section>
  );
}

function WordCloudPanel({ rows, personas, selectedPersona, onPersonaChange }) {
  const personaOptions = useMemo(
    () => [
      { value: "", label: "全部人群" },
      ...personas.map((item) => {
        const label = item.primary_target_persona || "未标注";
        return { value: label, label: `${label} · ${formatCompact(item.note_count)}` };
      }),
    ],
    [personas],
  );
  const scopedRows = useMemo(
    () => (selectedPersona ? rows.filter((item) => (item.primary_target_persona || "未标注") === selectedPersona) : rows),
    [rows, selectedPersona],
  );
  const [segmenter, setSegmenter] = useState(null);
  const [segmentStatus, setSegmentStatus] = useState("loading");

  useEffect(() => {
    let alive = true;
    loadJiebaRuntime()
      .then((runtime) => {
        if (!alive) return;
        setSegmenter(() => runtime.split);
        setSegmentStatus("ready");
      })
      .catch(() => {
        if (!alive) return;
        setSegmentStatus("fallback");
      });
    return () => {
      alive = false;
    };
  }, []);

  const emotionTerms = useMemo(
    () =>
      buildSegmentedWordCloudTerms(
        scopedRows,
        {
          exactTerms: (item) => [...listItems(item.hook_types), item.true_pain_label],
          segmentTexts: (item) => [item.true_pain_label, item.pain_description, item.pain_evidence],
        },
        segmenter,
      ),
    [scopedRows, segmenter],
  );
  const topicTerms = useMemo(
    () =>
      buildSegmentedWordCloudTerms(
        scopedRows,
        {
          exactTerms: (item) => [item.note_type, item.core_topic_category],
          segmentTexts: (item) => [item.title, noteContentText(item), item.business_logic, item.content_logic],
        },
        segmenter,
      ),
    [scopedRows, segmenter],
  );
  const segmentLabel = segmentStatus === "ready" ? "Jieba 分词" : segmentStatus === "fallback" ? "基础切分" : "Jieba 加载中";

  return (
    <section className="panel word-cloud-panel">
      <SectionHeader
        icon={Brain}
        title="周期词云洞察"
        action={<SelectControl label="人群筛选" value={selectedPersona} onChange={onPersonaChange} options={personaOptions} />}
      />
      <div className="word-cloud-meta">
        <span>{selectedPersona || "全部人群"}</span>
        <span>{formatNumber(scopedRows.length)} 条笔记</span>
        <span>{segmentLabel}</span>
      </div>
      <div className="word-cloud-grid">
        <WordCloudBox title="情绪钩子词云" caption="用户在焦虑什么" terms={emotionTerms} tone="red" loading={segmentStatus === "loading"} />
        <WordCloudBox title="笔记类型词云" caption="营销号在讲什么" terms={topicTerms} tone="blue" loading={segmentStatus === "loading"} />
      </div>
    </section>
  );
}

export {
  LoginScreen,
  ImageGenerationWorkflow as ImageGenView,
  FixedContentFlow as FixedContentView,
  DraftReviewFlow as DraftReviewView,
};
