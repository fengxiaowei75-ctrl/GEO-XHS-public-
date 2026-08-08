import { requestJson } from "./useRequestJson";
import {
  appendEditedImages,
  buildImageEditPrompt,
  imagePromptAt,
  imageTaskPollDelay,
  imageTaskStatusLabel,
  maxImageTaskPollAttempts,
  normalizeWorkflowImageCount,
  normalizeWorkflowImagePrompts,
  promptPayloadForSave,
  wait,
  generatedImagesForSave,
  hasWorkflowPrompt,
} from "../views/workflowImageHelpers";

export function useFixedContentActions({
  selectedNote,
  selectedLine,
  fixedSize,
  noteDetail,
  fixedResult,
  selectedImageCount,
  editInstruction,
  editingSlot,
  editingSourceImage,
  editImageCount,
  progress,
  persistFixedHistoryItem,
  ensureNoteDetail,
  setRunning,
  setRunningImageResult,
  setFixedResult,
  setProgress,
  setEditingImage,
  resetFixedImageEdit,
}) {
  async function runFixedRewrite() {
    if (!selectedNote?.note_id) {
      setProgress({ status: "failed", activeStep: 0, message: "请先选择一条候选笔记" });
      return;
    }
    setRunning(true);
    setFixedResult(null);
    setRunningImageResult(null);
    try {
      setProgress({ status: "running", activeStep: 0, message: "读取笔记详情、内容资产字段和原图提示词" });
      const detail = await ensureNoteDetail(selectedNote.note_id);
      const form = { ...detail, size: fixedSize };
      if (!form.noteId) throw new Error("没有读取到可用笔记资产");
      if (!hasWorkflowPrompt(form)) throw new Error("该笔记缺少可用生图提示词，需要先完成图片解析/内容资产沉淀");

      const startedAt = Date.now();
      const imageCount = normalizeWorkflowImageCount(form.imageCount);
      const imagePrompts = normalizeWorkflowImagePrompts(form.imagePrompts).slice(0, imageCount);
      setProgress({ status: "running", activeStep: 1, message: `创建 Duomi 生图任务（${fixedSize}）` });
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
        setProgress({ status: "running", activeStep: 2, message: "任务已创建，开始轮询图片结果" });

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
          setProgress({ status: "running", activeStep: 2, message: pendingLabels.join("，") || "图片生成中" });
        }
        if ((imageResult.images || []).length < imageCount) throw new Error("图像生成仍在处理中，请稍后重新点击洗稿或检查任务状态");
      }

      setProgress({ status: "running", activeStep: 3, message: "图片已生成，开始调用豆包生成小红书文案" });
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
        sourceImages: detail?.source_images || [],
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
      setProgress({ status: "failed", activeStep: Math.min(progress.activeStep || 0, 4), message: error.message || "洗稿失败" });
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
    const sourceSlot = currentImageResult ? currentImageResult.images?.find((image) => Number(image.slot) === slot) : null;
    const sourceImage = editingSourceImage?.url ? editingSourceImage : sourceSlot || null;
    if (!sourceImage?.url) {
      setProgress((current) => ({ ...current, status: "failed", message: "请先生成当前图片后再改图" }));
      return;
    }
    if (!instruction) {
      setProgress((current) => ({ ...current, status: "failed", message: "请填写这次要修改的点" }));
      return;
    }

    const startedAt = Date.now();
    const originalPrompt = imagePromptAt(fixedResult.form || {}, slot) || fixedResult.form?.imagePrompt || "";
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
      const nextFixedResult = { ...fixedResult, imageResult: nextResult, historyId: fixedResult.historyId || `fixed-content-${fixedResult.form.noteId}` };
      setFixedResult(nextFixedResult);
      persistFixedHistoryItem(nextFixedResult, fixedResult.socialDraft);
      resetFixedImageEdit();
      setProgress({ status: "done", activeStep: 4, message: `第${slot}张已改图` });
    } catch (error) {
      setProgress((current) => ({ ...current, status: "failed", message: error.message || "改图失败" }));
    } finally {
      setEditingImage(false);
    }
  }

  return { runFixedRewrite, editFixedGeneratedImage };
}
