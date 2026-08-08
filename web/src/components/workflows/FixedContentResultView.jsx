import { CheckCircle2, FileText, ImagePlus, PencilLine, Save } from "lucide-react";
import { ImageEditPanel } from "./ImageEditPanel";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SectionHeader } from "../layout/SectionHeader";
import { StatusPill } from "../data/StatusPill";
import { formatDateTimeSecond, formatNumber } from "../../utils/formatters";
import {
  generatedImagesForSave,
  imageVersionBadge,
  imageVersionDisplayItems,
  imageVersionLabel,
  promptPayloadForSave,
  maxWorkflowImages,
} from "../../views/workflowImageHelpers";
import {
  downloadBlob,
  filenameFromDisposition,
  sanitizeXhsDraftContent,
} from "../../views/workflowHistoryHelpers";
import { sourceImagesForNote } from "../../views/workflowFixedHelpers";

export function FixedContentResultView({
  fixedResult,
  progress,
  savingDraft,
  running,
  editingImage,
  editingSlot,
  editingSourceImage,
  editInstruction,
  editImageCount,
  setEditInstruction,
  setEditImageCount,
  resetFixedImageEdit,
  editFixedGeneratedImage,
  openFixedImageEdit,
  previewImage,
  setPreviewImage,
  setProgress,
  setSavingDraft,
  setResultOpen,
}) {
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
          sourceImages: Array.isArray(fixedResult.sourceImages) ? fixedResult.sourceImages.filter((image) => image?.url).slice(0, maxWorkflowImages) : sourceImagesForNote(fixedResult.note),
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

  const images = imageVersionDisplayItems(fixedResult.imageResult, fixedResult.form?.imageCount || 1, false);

  return (
    <section className="fixed-content-flow">
      <section className="panel fixed-result-panel">
        <SectionHeader icon={CheckCircle2} title="洗稿效果" action={<StatusPill tone="green">洗稿完成</StatusPill>} />
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
