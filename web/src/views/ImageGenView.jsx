import { useEffect, useMemo, useState } from "react";
import { ImageGenFormPanel } from "../components/workflows/ImageGenFormPanel";
import { ImageGenResultPanel } from "../components/workflows/ImageGenResultPanel";
import { useImageGeneration } from "../hooks/useImageGeneration";
import { requestJson } from "../hooks/useRequestJson";
import { formatDateTimeSecond } from "../utils/formatters";
import {
  appendEditedImages,
  buildImageEditPrompt,
  emptyImageWorkflowForm,
  generatedImagesForSave,
  hasWorkflowPrompt,
  imagePromptAt,
  imagePromptSummary,
  imageResultGroupId,
  imageSlotItems,
  imageTaskPollDelay,
  imageTaskStatusLabel,
  imageVersionBadge,
  imageVersionDisplayItems,
  imageVersionLabel,
  imageWorkflowFormFromNote,
  imageWorkflowHistoryUpdatedEvent,
  maxImageTaskPollAttempts,
  maxWorkflowImages,
  normalizeWorkflowImageCount,
  normalizeWorkflowImagePrompts,
  promptPayloadForSave,
  socialPlatformLabels,
  socialPlatformOptions,
  wait,
} from "./workflowImageHelpers";
import {
  compactImageResult,
  compactSocialDraft,
  downloadBlob,
  downloadTextFile,
  filenameFromDisposition,
  historyDocumentsForItem,
  historyFormSnapshot,
  readImageWorkflowHistory,
  sanitizeXhsDraftContent,
  upsertImageWorkflowHistoryItem,
  writeImageWorkflowHistory,
} from "./workflowHistoryHelpers";
import { sourceImagesForNote } from "./workflowFixedHelpers.jsx";
export function ImageGenView({ data }) {
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

  return (
    <section className="image-workflow-layout">
      <ImageGenFormPanel
        form={form}
        noteOptions={noteOptions}
        loadingNote={loadingNote}
        generating={generating}
        generatingSocial={generatingSocial}
        savingDraft={savingDraft}
        message={message}
        socialMessage={socialMessage}
        promptOpen={promptOpen}
        setPromptOpen={setPromptOpen}
        socialDraft={socialDraft}
        socialPlatform={socialPlatform}
        setSocialPlatform={setSocialPlatform}
        setSocialDraft={setSocialDraft}
        setSocialMessage={setSocialMessage}
        updateForm={updateForm}
        updateImagePrompt={updateImagePrompt}
        setForm={setForm}
        setNoteDetail={setNoteDetail}
        noteDetail={noteDetail}
        setLoadingNote={setLoadingNote}
        setMessage={setMessage}
        result={result}
        persistHistoryItem={persistHistoryItem}
        setGeneratingSocial={setGeneratingSocial}
        setSavingDraft={setSavingDraft}
        onSubmit={generateImage}
      />
      <ImageGenResultPanel
        result={result}
        form={form}
        historyItems={historyItems}
        editingSlot={editingSlot}
        editingSourceImage={editingSourceImage}
        editInstruction={editInstruction}
        setEditInstruction={setEditInstruction}
        editImageCount={editImageCount}
        setEditImageCount={setEditImageCount}
        resetImageEdit={resetImageEdit}
        editGeneratedImage={editGeneratedImage}
        editingImage={editingImage}
        generating={generating}
        openImageEdit={openImageEdit}
        previewImage={previewImage}
        setPreviewImage={setPreviewImage}
        restoreHistoryItem={restoreHistoryItem}
        removeHistoryItem={removeHistoryItem}
        socialPlatformLabels={socialPlatformLabels}
      />
    </section>
  );
}
