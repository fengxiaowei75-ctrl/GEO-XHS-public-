import { CheckCircle2, Clock3, FileText, ImagePlus, Layers3, ListChecks, PencilLine, Save, Sparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ImageEditPanel } from "../components/workflows/ImageEditPanel";
import { ImagePreviewModal } from "../components/workflows/ImagePreviewModal";
import { ImageWorkflowField } from "../components/workflows/ImageWorkflowField";
import { SelectControl } from "../components/form/SelectControl";
import { SectionHeader } from "../components/layout/SectionHeader";
import { StatusPill } from "../components/data/StatusPill";
import { WorkflowSteps } from "../components/workflows/WorkflowSteps";
import { useDraftReview } from "../hooks/useDraftReview";
import { useImageGeneration } from "../hooks/useImageGeneration";
import { requestJson } from "../hooks/useRequestJson";
import { formatDateTimeSecond, formatNumber, textPreview } from "../utils/formatters";
import { firstStructuredText, listItems, noteContentText, structuredText } from "../utils/collections";
import { appendEditedImages, buildImageEditPrompt, emptyImageWorkflowForm, generatedImagesForSave, imagePromptAt, imageSlotItems, imageTaskPollDelay, imageTaskStatusLabel, imageVersionBadge, imageVersionDisplayItems, imageVersionLabel, maxImageTaskPollAttempts, maxWorkflowImages, normalizeWorkflowImageCount, promptPayloadForSave, wait, imageWorkflowHistoryUpdatedEvent, fixedContentHistoryUpdatedEvent, socialPlatformLabels } from "./workflowImageHelpers";
import { compactSocialDraft, draftItemImages, draftItemNoteId, draftItemSocialContent, draftItemSourceImages, draftItemSourceLabel, draftItemTitle, draftPackagePayloadFromItem, readFixedContentHistory, readReviewDrafts, readImageWorkflowHistory, sanitizeXhsDraftContent, writeReviewDraftItem, writeFixedContentHistory, writeImageWorkflowHistory } from "./workflowHistoryHelpers";
import { NoteMetricChip, DetailTextBlock, StructuredList, TagLine, reviewDraftSteps, sourceImagesForNote } from "./workflowFixedHelpers";
import { DraftReviewViewBody } from "../components/workflows/DraftReviewViewBody";
export function DraftReviewView({ data, onNavigate }) {
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
  const {
    editingSlot,
    editingSourceImage,
    editInstruction,
    editImageCount,
    setEditInstruction,
    setEditImageCount,
    openImageEdit,
    resetImageEdit,
  } = useImageGeneration({
    onOpen: (slot) => {
      setProgress((current) => ({ ...current, message: `准备修改第${slot}张图` }));
    },
  });

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
    <DraftReviewViewBody
      drafts={drafts}
      selectedReviewId={selectedReviewId}
      setSelectedReviewId={setSelectedReviewId}
      selectedDraft={selectedDraft}
      selectedNoteId={selectedNoteId}
      selectedTitle={selectedTitle}
      selectedSocialContent={selectedSocialContent}
      selectedDraftSocialDraft={selectedDraftSocialDraft}
      generatedImageItems={generatedImageItems}
      generatedImages={generatedImages}
      sourceImages={sourceImages}
      originalContent={originalContent}
      selectedMetrics={selectedMetrics}
      loadingNoteDetail={loadingNoteDetail}
      detailMessage={detailMessage}
      progress={progress}
      progressMessage={progressMessage}
      savingDraft={savingDraft}
      editingSocial={editingSocial}
      socialEditInstruction={socialEditInstruction}
      setSocialEditInstruction={setSocialEditInstruction}
      editingImage={editingImage}
      selectedDraftForm={selectedDraftForm}
      noteDetail={noteDetail}
      copyDraftContent={copyDraftContent}
      downloadDraftPackage={downloadDraftPackage}
      regenerateSocialDraft={regenerateSocialDraft}
      editDraftImage={editDraftImage}
      previewImage={previewImage}
      setPreviewImage={setPreviewImage}
      editingSlot={editingSlot}
      editingSourceImage={editingSourceImage}
      editInstruction={editInstruction}
      setEditInstruction={setEditInstruction}
      editImageCount={editImageCount}
      setEditImageCount={setEditImageCount}
      resetImageEdit={resetImageEdit}
      openImageEdit={openImageEdit}
      navigateTo={navigateTo}
    />
  );
}
