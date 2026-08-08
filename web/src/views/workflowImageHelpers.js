import { textPreview } from "../utils/formatters";

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

export {
  emptyImageWorkflowForm,
  socialPlatformOptions,
  socialPlatformLabels,
  imageWorkflowHistoryKey,
  maxImageWorkflowHistory,
  fixedContentHistoryKey,
  maxFixedContentHistory,
  maxWorkflowImages,
  maxImageTaskPollAttempts,
  imageWorkflowHistoryUpdatedEvent,
  fixedContentHistoryUpdatedEvent,
  normalizeWorkflowImageCount,
  normalizeWorkflowImagePrompts,
  imagePromptAt,
  hasWorkflowPrompt,
  promptPayloadForSave,
  imagePromptSummary,
  imageWorkflowFormFromNote,
  imageTaskStatusLabel,
  imageResultGroupId,
  wait,
  imageTaskPollDelay,
  normalizeResultImage,
  dedupeImageVersions,
  imageVersionsForSlot,
  allImageVersions,
  imageSlotItems,
  imageVersionDisplayItems,
  imageVersionBadge,
  imageVersionLabel,
  generatedImagesForSave,
  buildImageEditPrompt,
  firstEmptyImageSlot,
  appendEditedImages,
  appendEditedSlotImage,
};
