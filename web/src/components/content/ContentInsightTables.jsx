import { StatusPill } from "../data/StatusPill";
import { chartColors } from "../../constants/chartColors";
import { formatDayLabel } from "../../utils/dates";
import { arrayText, formatNumber, formatPercent, textPreview } from "../../utils/formatters";
import { TagLine } from "./ContentInsightDetails";

function ExpandableCellText({ value, max = 86 }) {
  const text = String(value || "-").trim() || "-";
  if (text.length <= max) return <div className="insight-table-text">{text}</div>;
  return (
    <details className="expandable-cell">
      <summary>
        <span>{textPreview(text, max)}</span>
        <em>展开</em>
      </summary>
      <p>{text}</p>
    </details>
  );
}

export function InsightNoteTable({ rows, compact = false }) {
  if (!rows.length) return <div className="empty-state">暂无数据</div>;

  return (
    <div className="table-wrap insight-table-wrap">
      <table className="insight-table">
        <colgroup>
          <col className="insight-col-note" />
          <col className="insight-col-topic" />
          <col className="insight-col-persona" />
          <col className="insight-col-metrics" />
          <col className="insight-col-hook" />
          <col className="insight-col-business" />
        </colgroup>
        <thead>
          <tr>
            <th>笔记</th>
            <th>主题类型</th>
            <th>目标人群</th>
            <th>点赞/收藏/评论</th>
            <th>情绪钩子</th>
            <th>业务逻辑</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={`${item.note_id}-${item.primary_target_persona || ""}`}>
              <td>
                <div className="note-title">{item.title || item.note_id}</div>
                <div className="note-meta">
                  {item.note_id} · 笔记日期 {formatDayLabel(item.note_date || item.publish_time)}
                </div>
              </td>
              <td>
                <div className="insight-pill-wrap">
                  <StatusPill tone="blue">{item.core_topic_category || "未标注"}</StatusPill>
                </div>
                <div className="note-meta">{item.note_type || "-"}</div>
              </td>
              <td>
                <ExpandableCellText value={item.primary_target_persona || arrayText(item.target_persona_tags) || "未标注"} max={46} />
              </td>
              <td>
                <div className="insight-metrics-mini">
                  <span>
                    <em>赞</em>
                    <strong>{formatNumber(item.like_count)}</strong>
                  </span>
                  <span>
                    <em>藏</em>
                    <strong>{formatNumber(item.collected_count)}</strong>
                  </span>
                  <span>
                    <em>评</em>
                    <strong>{formatNumber(item.comments_count)}</strong>
                  </span>
                </div>
              </td>
              <td>
                <ExpandableCellText value={item.true_pain_label || item.pain_description || "-"} max={76} />
                {arrayText(item.hook_types) ? <TagLine values={item.hook_types} /> : null}
              </td>
              <td className="business-logic-cell">
                <ExpandableCellText value={item.business_logic || item.content_logic || "-"} max={108} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TopicFrequencyList({ rows }) {
  const max = Math.max(1, ...rows.map((item) => Number(item.note_count || 0)));
  if (!rows.length) return <div className="empty-state">暂无数据</div>;

  return (
    <div className="topic-frequency-list">
      {rows.map((item) => {
        const width = Math.max(4, Math.round((Number(item.note_count || 0) / max) * 100));
        return (
          <div className="topic-frequency-row" key={item.core_topic_category || "未标注"}>
            <div className="topic-frequency-main">
              <span>{item.core_topic_category || "未标注"}</span>
              <strong>{formatNumber(item.note_count)}</strong>
            </div>
            <div className="topic-frequency-track" aria-hidden="true">
              <div style={{ width: `${width}%` }} />
            </div>
            <small>{formatPercent(item.share_pct)}</small>
          </div>
        );
      })}
    </div>
  );
}

function polarPoint(cx, cy, radius, angle) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function pieSlicePath(cx, cy, radius, startAngle, endAngle) {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export function PersonaPieChart({ rows, selectedPersona, onSelect }) {
  const total = rows.reduce((sum, item) => sum + Number(item.note_count || 0), 0);
  let cursor = 0;
  const segments = rows.map((item, index) => {
    const value = Number(item.note_count || 0);
    const angle = total ? (value / total) * 360 : 0;
    const segment = {
      ...item,
      color: chartColors[index % chartColors.length],
      startAngle: cursor,
      endAngle: cursor + Math.min(angle, 359.99),
    };
    cursor += angle;
    return segment;
  });

  if (!rows.length) return <div className="empty-state">暂无数据</div>;

  return (
    <div className="persona-pie-layout">
      <svg className="persona-pie" viewBox="0 0 220 220" role="img" aria-label="目标人群占比">
        {segments.map((item) => {
          const label = item.primary_target_persona || "未标注";
          const selected = selectedPersona === label;
          return (
            <path
              key={label}
              className={`persona-pie-segment ${selected ? "selected" : ""}`}
              d={pieSlicePath(110, 110, 96, item.startAngle, item.endAngle)}
              fill={item.color}
              role="button"
              tabIndex="0"
              onClick={() => onSelect(selected ? "" : label)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(selected ? "" : label);
              }}
            />
          );
        })}
        <circle cx="110" cy="110" r="54" className="persona-pie-hole" />
        <text x="110" y="104" className="persona-pie-total">
          {formatNumber(total)}
        </text>
        <text x="110" y="126" className="persona-pie-caption">
          笔记
        </text>
      </svg>
      <div className="persona-legend">
        <button className={!selectedPersona ? "active" : ""} onClick={() => onSelect("")} type="button">
          <i style={{ background: "#8d9890" }} />
          <span>全部人群</span>
          <strong>{formatNumber(total)}</strong>
        </button>
        {segments.map((item) => {
          const label = item.primary_target_persona || "未标注";
          return (
            <button className={selectedPersona === label ? "active" : ""} key={label} onClick={() => onSelect(label)} type="button">
              <i style={{ background: item.color }} />
              <span>{label}</span>
              <strong>{formatNumber(item.note_count)}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
