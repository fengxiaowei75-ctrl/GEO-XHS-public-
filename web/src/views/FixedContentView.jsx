import { CheckCircle2, Clock3, FileText, ImagePlus, Layers3, PencilLine, Save, Sparkles, Target, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ImageEditPanel } from "../components/workflows/ImageEditPanel";
import { ImagePreviewModal } from "../components/workflows/ImagePreviewModal";
import { SelectControl } from "../components/form/SelectControl";
import { SectionHeader } from "../components/layout/SectionHeader";
import { StatusPill } from "../components/data/StatusPill";
import { WorkflowSteps } from "../components/workflows/WorkflowSteps";
import { useImageGeneration } from "../hooks/useImageGeneration";
import { requestJson } from "../hooks/useRequestJson";
import { arrayText, formatDateTimeSecond, formatNumber, textPreview } from "../utils/formatters";
import { firstStructuredText, listItems, noteContentText, structuredText } from "../utils/collections";
import { emptyImageWorkflowForm, imagePromptSummary, imagePromptAt, imageResultGroupId, imageSlotItems, imageTaskPollDelay, imageTaskStatusLabel, imageVersionBadge, imageVersionDisplayItems, imageVersionLabel, imageWorkflowFormFromNote, maxImageTaskPollAttempts, maxWorkflowImages, normalizeWorkflowImageCount, normalizeWorkflowImagePrompts, promptPayloadForSave, wait, buildImageEditPrompt, appendEditedImages, generatedImagesForSave, hasWorkflowPrompt } from "./workflowImageHelpers";
import { compactSocialDraft, downloadBlob, filenameFromDisposition, historyFormSnapshot, readFixedContentHistory, sanitizeXhsDraftContent, upsertFixedContentHistoryItem, writeFixedContentHistory } from "./workflowHistoryHelpers";
import { fixedContentLineConfigs, fixedRewriteSteps, fixedImageSizeOptions, uniqueTextItems, notePersonaItems, noteKeywordText, noteMatchesPersonas, fixedLineScore, sortHotNotes, dedupeNotes, groupFixedNotes, buildFixedContentLines, sourceImagesForNote, NoteMetricChip, DetailTextBlock } from "./workflowFixedHelpers";
export function FixedContentView({ data }) {
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
