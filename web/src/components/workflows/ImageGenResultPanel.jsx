import { Clock3, FileText, ImagePlus, PencilLine } from "lucide-react";
import { ImageEditPanel } from "./ImageEditPanel";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SectionHeader } from "../layout/SectionHeader";
import { StatusPill } from "../data/StatusPill";
import {
  formatDateTimeSecond,
  formatDuration,
  formatNumber,
} from "../../utils/formatters";
import {
  generatedImagesForSave,
  imageTaskStatusLabel,
  imageVersionBadge,
  imageVersionDisplayItems,
  imageVersionLabel,
} from "../../views/workflowImageHelpers";
import { downloadTextFile, historyDocumentsForItem } from "../../views/workflowHistoryHelpers";

export function ImageGenResultPanel({
  result,
  form,
  historyItems,
  editingSlot,
  editingSourceImage,
  editInstruction,
  setEditInstruction,
  editImageCount,
  setEditImageCount,
  resetImageEdit,
  editGeneratedImage,
  editingImage,
  generating,
  openImageEdit,
  previewImage,
  setPreviewImage,
  restoreHistoryItem,
  removeHistoryItem,
  socialPlatformLabels,
}) {
  return (
    <section className="panel image-workflow-output">
      <SectionHeader icon={ImagePlus} title="生成结果" action={result?.model ? <StatusPill tone="green">{result.model}</StatusPill> : null} />
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
                    <span>
                      {formatDateTimeSecond(item.createdAt)} · {socialPlatformLabels[item.socialPlatform] || item.socialDraft?.platformLabel || "社媒"}
                    </span>
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
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </section>
  );
}
