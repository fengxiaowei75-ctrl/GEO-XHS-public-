import { Clock3, Filter, Layers3, Sparkles, Target } from "lucide-react";
import { SelectControl } from "../form/SelectControl";
import { SectionHeader } from "../layout/SectionHeader";
import { StatusPill } from "../data/StatusPill";
import { WorkflowSteps } from "./WorkflowSteps";
import { NoteMetricChip, DetailTextBlock, fixedRewriteSteps, fixedImageSizeOptions } from "../../views/workflowFixedHelpers";
import {
  firstStructuredText,
  noteContentText,
} from "../../utils/collections";
import {
  formatDateTimeSecond,
  formatNumber,
  textPreview,
} from "../../utils/formatters";
import {
  generatedImagesForSave,
  imagePromptSummary,
  imageSlotItems,
  imageTaskStatusLabel,
  socialPlatformLabels,
} from "../../views/workflowImageHelpers";
import { sanitizeXhsDraftContent } from "../../views/workflowHistoryHelpers";

export function FixedContentWorkspace({
  lines,
  selectedLine,
  selectedLineId,
  setSelectedLineId,
  visibleNotes,
  selectedNote,
  selectedNoteId,
  setSelectedNoteId,
  noteDetail,
  loadingNoteDetail,
  detailMessage,
  running,
  fixedSize,
  setFixedSize,
  selectedForm,
  sourceImages,
  selectedImageCount,
  runningImageResult,
  fixedResult,
  progress,
  selectedNoteHistory,
  removeFixedHistoryItem,
  runFixedRewrite,
  openFixedImageEdit,
  editingImage,
  editingSlot,
  editingSourceImage,
  editInstruction,
  setEditInstruction,
  editImageCount,
  setEditImageCount,
  resetFixedImageEdit,
  editFixedGeneratedImage,
  setPreviewImage,
  setFixedResult,
  setResultOpen,
  setProgress,
  setFixedSize: setFixedSizeState,
  setSelectedLineId: setSelectedLineIdState,
  setSelectedNoteId: setSelectedNoteIdState,
}) {
  function restoreFixedHistoryItem(item) {
    if (!item) return;
    setSelectedLineIdState(item.lineId || selectedLineId);
    setSelectedNoteIdState(item.noteId || item.form?.noteId || "");
    setFixedSizeState(item.form?.size || "1024x1536");
    setFixedResult({
      note: item.note || null,
      form: { ...item.form },
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
            <em>{formatNumber(line.notes?.length || 0)} 条</em>
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
                    <span>{formatDateTimeSecond(note.note_date || note.publish_time)}</span>
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
                  <SelectControl value={fixedSize} onChange={setFixedSizeState} label="尺寸" options={fixedImageSizeOptions} />
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
    </section>
  );
}
