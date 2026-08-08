import { FileText, ImagePlus, Layers3, ListChecks, PencilLine, Save, Sparkles } from "lucide-react";
import { ImageEditPanel } from "./ImageEditPanel";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ImageWorkflowField } from "./ImageWorkflowField";
import { SectionHeader } from "../layout/SectionHeader";
import { StatusPill } from "../data/StatusPill";
import { WorkflowSteps } from "./WorkflowSteps";
import { NoteMetricChip, DetailTextBlock, reviewDraftSteps } from "../../views/workflowFixedHelpers";
import {
  draftItemImages,
  draftItemNoteId,
  draftItemSocialContent,
  draftItemSourceLabel,
  draftItemTitle,
} from "../../views/workflowHistoryHelpers";
import { formatDateTimeSecond, formatNumber, textPreview } from "../../utils/formatters";
import { imageVersionBadge, imageVersionLabel } from "../../views/workflowImageHelpers";

export function DraftReviewViewBody({
  drafts,
  selectedReviewId,
  setSelectedReviewId,
  selectedDraft,
  selectedNoteId,
  selectedTitle,
  selectedSocialContent,
  selectedDraftSocialDraft,
  generatedImageItems,
  generatedImages,
  sourceImages,
  originalContent,
  selectedMetrics,
  loadingNoteDetail,
  detailMessage,
  progress,
  progressMessage,
  savingDraft,
  editingSocial,
  socialEditInstruction,
  setSocialEditInstruction,
  editingImage,
  selectedDraftForm,
  noteDetail,
  copyDraftContent,
  downloadDraftPackage,
  regenerateSocialDraft,
  editDraftImage,
  previewImage,
  setPreviewImage,
  editingSlot,
  editingSourceImage,
  editInstruction,
  setEditInstruction,
  editImageCount,
  setEditImageCount,
  resetImageEdit,
  openImageEdit,
  navigateTo,
}) {
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
