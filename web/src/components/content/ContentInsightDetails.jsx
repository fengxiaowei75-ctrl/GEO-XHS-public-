import { XCircle } from "lucide-react";
import { useEffect } from "react";
import { StatusPill } from "../data/StatusPill";
import { formatDayLabel } from "../../utils/dates";
import { listItems, noteContentText, structuredText } from "../../utils/collections";
import { arrayText, formatScore } from "../../utils/formatters";
import { NoteMetricChip } from "./ContentInsightCharts";

function DetailTextBlock({ title, children }) {
  return (
    <section className="note-detail-block">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function StructuredList({ value }) {
  const items = listItems(value);
  if (!items.length) return <p>-</p>;
  return (
    <ul className="structured-list">
      {items.slice(0, 6).map((item, index) => (
        <li key={`${structuredText(item)}-${index}`}>{structuredText(item)}</li>
      ))}
    </ul>
  );
}

export function TagLine({ values }) {
  const items = listItems(values);
  if (!items.length) return <span>-</span>;
  return (
    <div className="note-tag-line">
      {items.slice(0, 8).map((item) => (
        <span key={String(item)}>{String(item)}</span>
      ))}
    </div>
  );
}

export function NoteAnalysisBoard({ note, onClose }) {
  useEffect(() => {
    if (!note) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [note, onClose]);

  if (!note) return null;
  const contentText = noteContentText(note);
  return (
    <div
      className="note-analysis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="note-analysis-board note-analysis-modal" role="dialog" aria-modal="true" aria-labelledby="note-analysis-title">
      <div className="note-analysis-head">
        <div>
          <div className="note-analysis-kicker">
            <StatusPill tone="blue">{note.core_topic_category || "未标注主题"}</StatusPill>
            <StatusPill tone="neutral">{note.primary_target_persona || "未标注人群"}</StatusPill>
            {note.funnel_role ? <StatusPill tone={note.funnel_role === "转化" ? "green" : note.funnel_role === "信任" ? "blue" : "amber"}>{note.funnel_role}</StatusPill> : null}
          </div>
          <h3 id="note-analysis-title">{note.title || note.note_id}</h3>
          <p>
            {note.note_id} · {note.author_nickname || "-"} · 笔记日期 {formatDayLabel(note.note_date || note.publish_time)}
          </p>
        </div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="关闭笔记分析看板">
          <XCircle size={18} />
        </button>
      </div>

      <div className="note-analysis-metrics">
        <NoteMetricChip label="互动" value={note.interaction_score} />
        <NoteMetricChip label="点赞" value={note.like_count} />
        <NoteMetricChip label="收藏" value={note.collected_count} />
        <NoteMetricChip label="评论" value={note.comments_count} />
        <NoteMetricChip label="转发" value={note.share_count} />
        <NoteMetricChip label="热度" value={note.fresh_hot_score} />
      </div>

      <div className="note-analysis-grid">
        <DetailTextBlock title="笔记文案">
          <p>{contentText || "-"}</p>
        </DetailTextBlock>
        <DetailTextBlock title="痛点判断">
          <p>
            <strong>{note.true_pain_label || "-"}</strong>
          </p>
          <p>{note.pain_description || "-"}</p>
          <p>{note.pain_evidence || ""}</p>
          <div className="note-inline-meta">
            <span>{note.pain_authenticity || "未判断"}</span>
            <span>痛点置信 {formatScore(note.pain_confidence)}</span>
          </div>
        </DetailTextBlock>
        <DetailTextBlock title="人群与行业">
          <p>{note.target_persona_reason || "-"}</p>
          <TagLine values={note.target_persona_tags} />
          <div className="note-inline-meta">
            <span>{note.primary_industry || "未标注行业"}</span>
            <span>{arrayText(note.industry_tags) || "-"}</span>
          </div>
        </DetailTextBlock>
        <DetailTextBlock title="业务逻辑">
          <p>{note.business_logic || "-"}</p>
          <p>{note.content_logic || ""}</p>
          <p>{note.funnel_role_reason || ""}</p>
          <div className="note-inline-meta">
            <span>业务相关 {formatScore(note.business_relevance_score)}</span>
            <span>模型置信 {formatScore(note.llm_confidence)}</span>
          </div>
        </DetailTextBlock>
        <DetailTextBlock title="知识沉淀">
          <StructuredList value={note.knowledge_points} />
        </DetailTextBlock>
        <DetailTextBlock title="可复用角度">
          <StructuredList value={note.reusable_angles} />
        </DetailTextBlock>
        <DetailTextBlock title="承接与风险">
          <p>{note.cta_strategy || "-"}</p>
          <TagLine values={note.hook_types} />
          <StructuredList value={note.risk_flags} />
        </DetailTextBlock>
      </div>
      </section>
    </div>
  );
}
