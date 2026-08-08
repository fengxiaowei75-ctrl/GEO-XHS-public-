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
import { requestJson } from "../hooks/useRequestJson";
import { formatDateTimeSecond, formatNumber, textPreview } from "../utils/formatters";
import { firstStructuredText, listItems, noteContentText, structuredText } from "../utils/collections";
import { appendEditedImages, buildImageEditPrompt, emptyImageWorkflowForm, generatedImagesForSave, imagePromptAt, imageSlotItems, imageTaskPollDelay, imageTaskStatusLabel, imageVersionBadge, imageVersionDisplayItems, imageVersionLabel, maxImageTaskPollAttempts, maxWorkflowImages, normalizeWorkflowImageCount, promptPayloadForSave, wait, imageWorkflowHistoryUpdatedEvent, fixedContentHistoryUpdatedEvent } from "./workflowImageHelpers";
import { compactSocialDraft, draftItemImages, draftItemNoteId, draftItemSocialContent, draftItemSourceImages, draftItemSourceLabel, draftItemTitle, draftPackagePayloadFromItem, readFixedContentHistory, readReviewDrafts, readImageWorkflowHistory, sanitizeXhsDraftContent, writeReviewDraftItem, writeFixedContentHistory, writeImageWorkflowHistory } from "./workflowHistoryHelpers";
import { NoteMetricChip, DetailTextBlock, StructuredList, TagLine, reviewDraftSteps, sourceImagesForNote } from "./workflowFixedHelpers";
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
