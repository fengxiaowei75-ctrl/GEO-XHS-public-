import { CheckCircle2, Clock3, FileText, ImagePlus, Layers3, PencilLine, Save, Sparkles, Target, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ImageEditPanel } from "../components/workflows/ImageEditPanel";
import { ImagePreviewModal } from "../components/workflows/ImagePreviewModal";
import { FixedContentResultView } from "../components/workflows/FixedContentResultView";
import { FixedContentWorkspace } from "../components/workflows/FixedContentWorkspace";
import { SelectControl } from "../components/form/SelectControl";
import { SectionHeader } from "../components/layout/SectionHeader";
import { StatusPill } from "../components/data/StatusPill";
import { WorkflowSteps } from "../components/workflows/WorkflowSteps";
import { useFixedContentActions } from "../hooks/useFixedContentActions";
import { useImageGeneration } from "../hooks/useImageGeneration";
import { requestJson } from "../hooks/useRequestJson";
import { arrayText, formatDateTimeSecond, formatNumber, textPreview } from "../utils/formatters";
import { firstStructuredText, listItems, noteContentText, structuredText } from "../utils/collections";
import { emptyImageWorkflowForm, imagePromptSummary, imagePromptAt, imageResultGroupId, imageSlotItems, imageTaskPollDelay, imageTaskStatusLabel, imageVersionBadge, imageVersionDisplayItems, imageVersionLabel, imageWorkflowFormFromNote, maxImageTaskPollAttempts, maxWorkflowImages, normalizeWorkflowImageCount, normalizeWorkflowImagePrompts, promptPayloadForSave, wait, buildImageEditPrompt, appendEditedImages, generatedImagesForSave, hasWorkflowPrompt } from "./workflowImageHelpers";
import { compactImageResult, compactSocialDraft, downloadBlob, filenameFromDisposition, historyFormSnapshot, readFixedContentHistory, sanitizeXhsDraftContent, upsertFixedContentHistoryItem, writeFixedContentHistory } from "./workflowHistoryHelpers";
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

  function removeFixedHistoryItem(id) {
    setHistoryItems((current) => {
      const next = current.filter((item) => item.id !== id);
      writeFixedContentHistory(next);
      return next;
    });
  }

  const { runFixedRewrite, editFixedGeneratedImage } = useFixedContentActions({
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
  });

  if (resultOpen && fixedResult) {
    return (
      <FixedContentResultView
        fixedResult={fixedResult}
        progress={progress}
        savingDraft={savingDraft}
        running={running}
        editingImage={editingImage}
        editingSlot={editingSlot}
        editingSourceImage={editingSourceImage}
        editInstruction={editInstruction}
        editImageCount={editImageCount}
        setEditInstruction={setEditInstruction}
        setEditImageCount={setEditImageCount}
        resetFixedImageEdit={resetFixedImageEdit}
        editFixedGeneratedImage={editFixedGeneratedImage}
        openFixedImageEdit={openFixedImageEdit}
        previewImage={previewImage}
        setPreviewImage={setPreviewImage}
        setProgress={setProgress}
        setSavingDraft={setSavingDraft}
        setResultOpen={setResultOpen}
      />
    );
  }

  return (
    <FixedContentWorkspace
      lines={lines}
      selectedLine={selectedLine}
      selectedLineId={selectedLineId}
      setSelectedLineId={setSelectedLineId}
      visibleNotes={visibleNotes}
      selectedNote={selectedNote}
      selectedNoteId={selectedNoteId}
      setSelectedNoteId={setSelectedNoteId}
      noteDetail={noteDetail}
      loadingNoteDetail={loadingNoteDetail}
      detailMessage={detailMessage}
      running={running}
      fixedSize={fixedSize}
      setFixedSize={setFixedSize}
      selectedForm={selectedForm}
      sourceImages={sourceImages}
      selectedImageCount={selectedImageCount}
      runningImageResult={runningImageResult}
      fixedResult={fixedResult}
      progress={progress}
      selectedNoteHistory={selectedNoteHistory}
      removeFixedHistoryItem={removeFixedHistoryItem}
      runFixedRewrite={runFixedRewrite}
      openFixedImageEdit={openFixedImageEdit}
      editingImage={editingImage}
      editingSlot={editingSlot}
      editingSourceImage={editingSourceImage}
      editInstruction={editInstruction}
      setEditInstruction={setEditInstruction}
      editImageCount={editImageCount}
      setEditImageCount={setEditImageCount}
      resetFixedImageEdit={resetFixedImageEdit}
      editFixedGeneratedImage={editFixedGeneratedImage}
      setPreviewImage={setPreviewImage}
      setFixedResult={setFixedResult}
      setResultOpen={setResultOpen}
      setProgress={setProgress}
      setFixedSizeState={setFixedSize}
      setSelectedLineIdState={setSelectedLineId}
      setSelectedNoteIdState={setSelectedNoteId}
    />
  );
}
