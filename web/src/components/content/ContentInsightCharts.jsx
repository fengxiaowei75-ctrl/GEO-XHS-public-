import { Bookmark, FileText, Heart, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusPill } from "../data/StatusPill";
import { dateKeyFromValue, formatDayLabel } from "../../utils/dates";
import { firstStructuredText, noteContentText } from "../../utils/collections";
import { arrayText, formatCompact, formatNumber, formatShortDate, textPreview } from "../../utils/formatters";

export const contentMetricCards = [
  { key: "note_count", overviewKey: "noteTotal", label: "笔记总数", icon: FileText, tone: "blue", sub: "当前周期" },
  { key: "like_total", overviewKey: "likeTotal", label: "笔记点赞", icon: Heart, tone: "purple", sub: "近30天趋势" },
  { key: "collected_total", overviewKey: "collectedTotal", label: "笔记收藏", icon: Bookmark, tone: "amber", sub: "近30天趋势" },
  { key: "comments_total", overviewKey: "commentsTotal", label: "笔记评论", icon: MessageCircle, tone: "teal", sub: "近30天趋势" },
];

function MiniSparkline({ rows, valueKey, color = "var(--blue)" }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const points = useMemo(() => {
    const values = rows.map((item) => Number(item[valueKey] || 0));
    const max = Math.max(1, ...values);
    return values.map((value, index) => {
      const x = rows.length <= 1 ? 80 : (index / (rows.length - 1)) * 160;
      const y = 44 - (value / max) * 36;
      return { x, y, value, date: rows[index]?.bucket_date || rows[index]?.bucket_start };
    });
  }, [rows, valueKey]);

  if (!points.length) return <div className="mini-sparkline-empty">暂无近30天数据</div>;

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div className="mini-sparkline">
      <svg viewBox="0 0 160 48" onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)} role="img" aria-label="近30天趋势">
        <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {hovered ? (
          <>
            <line x1={hovered.x} x2={hovered.x} y1="4" y2="46" className="mini-sparkline-hover-line" />
            <circle cx={hovered.x} cy={hovered.y} r="4" fill={color} className="mini-sparkline-dot" />
          </>
        ) : null}
      </svg>
      {hovered ? (
        <div className="mini-sparkline-tooltip" style={{ left: `${(hovered.x / 160) * 100}%` }}>
          <strong>{formatNumber(hovered.value)}</strong>
          <span>{formatShortDate(hovered.date)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function InsightMetricCard({ icon: Icon, label, value, sub, tone, sparkRows, sparkKey }) {
  const colorByTone = {
    blue: "var(--blue)",
    teal: "var(--teal)",
    purple: "var(--purple)",
    amber: "var(--amber)",
  };

  return (
    <section className={`stat insight-metric-card stat-${tone || "blue"}`}>
      <div className="stat-icon" aria-hidden="true">
        <Icon size={18} />
      </div>
      <div className="insight-metric-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-sub">{sub}</div>
        <MiniSparkline rows={sparkRows || []} valueKey={sparkKey} color={colorByTone[tone] || "var(--blue)"} />
      </div>
    </section>
  );
}

export function ContentTrendChart({ rows, selectedDate, onSelectDate }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const prepared = useMemo(() => {
    const width = 920;
    const height = 330;
    const padLeft = 64;
    const padRight = 56;
    const padTop = 30;
    const padBottom = 56;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;
    const metricKeys = ["like_total", "collected_total", "comments_total"];
    const maxMetric = Math.max(1, ...rows.flatMap((row) => metricKeys.map((key) => Number(row[key] || 0))));
    const maxCount = Math.max(1, ...rows.map((row) => Number(row.note_count || 0)));
    const xFor = (index) => padLeft + (rows.length <= 1 ? innerW / 2 : (index / (rows.length - 1)) * innerW);
    const yMetric = (value) => padTop + innerH - (Number(value || 0) / maxMetric) * innerH;
    const yCount = (value) => padTop + innerH - (Number(value || 0) / maxCount) * innerH;
    const barWidth = Math.max(2, Math.min(28, innerW / Math.max(1, rows.length) / 2.2));
    const points = rows.map((row, index) => ({
      ...row,
      dateKey: dateKeyFromValue(row.bucket_date),
      x: xFor(index),
      countY: yCount(row.note_count),
      barHeight: padTop + innerH - yCount(row.note_count),
    }));
    const series = [
      { key: "like_total", label: "点赞数", color: "#18aee8" },
      { key: "collected_total", label: "收藏数", color: "#6fdc72" },
      { key: "comments_total", label: "评论数", color: "#ff5f7f" },
    ].map((item) => ({
      ...item,
      d: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${yMetric(point[item.key]).toFixed(1)}`).join(" "),
    }));
    const metricTicks = [0, maxMetric * 0.5, maxMetric].map((value) => Math.round(value));
    const countTicks = [0, maxCount * 0.5, maxCount].map((value) => Math.round(value));
    return { width, height, padLeft, padRight, padTop, padBottom, innerW, innerH, points, series, metricTicks, countTicks, yMetric, yCount, barWidth };
  }, [rows]);

  if (!rows.length) return <div className="empty-state">暂无趋势数据</div>;

  const hovered = hoverIndex !== null ? prepared.points[hoverIndex] : null;
  const visibleLabelStep = Math.max(1, Math.ceil(prepared.points.length / 8));
  const tooltipLeft = hovered ? Math.min(82, Math.max(18, (hovered.x / prepared.width) * 100)) : 50;

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * (prepared.points.length - 1)));
  }

  return (
    <div className="content-trend-chart">
      <div className="content-trend-summary">
        当前周期共有 <strong>{formatNumber(rows.reduce((sum, item) => sum + Number(item.note_count || 0), 0))}</strong> 篇笔记
      </div>
      <svg viewBox={`0 0 ${prepared.width} ${prepared.height}`} onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)} role="img" aria-label="笔记数据表现分布">
        <title>笔记数据表现分布：曲线为点赞、收藏、评论，柱状为笔记篇数</title>
        {prepared.metricTicks.map((tick) => {
          const y = prepared.yMetric(tick);
          return (
            <g key={`metric-${tick}`}>
              <line x1={prepared.padLeft} x2={prepared.width - prepared.padRight} y1={y} y2={y} className={tick === 0 ? "chart-axis" : "chart-grid"} />
              <text x={prepared.padLeft - 10} y={y + 4} textAnchor="end" className="chart-label">
                {formatCompact(tick)}
              </text>
            </g>
          );
        })}
        {prepared.countTicks.map((tick) => {
          const y = prepared.yCount(tick);
          return (
            <text key={`count-${tick}`} x={prepared.width - prepared.padRight + 10} y={y + 4} className="chart-label">
              {formatCompact(tick)}
            </text>
          );
        })}
        {prepared.points.map((point, index) => (
          <rect
            key={`bar-${point.bucket_date}-${index}`}
            x={point.x - prepared.barWidth / 2}
            y={point.countY}
            width={prepared.barWidth}
            height={Math.max(1, point.barHeight)}
            rx="5"
            className={`content-trend-bar ${selectedDate === point.dateKey ? "selected" : ""}`}
            role="button"
            tabIndex="0"
            onClick={() => onSelectDate?.(point.dateKey)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelectDate?.(point.dateKey);
            }}
          />
        ))}
        {prepared.series.map((series) => (
          <path key={series.key} d={series.d} fill="none" stroke={series.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {hovered ? (
          <line x1={hovered.x} x2={hovered.x} y1={prepared.padTop} y2={prepared.height - prepared.padBottom} className="chart-hover-line" />
        ) : null}
        {prepared.points.map((point, index) =>
          index % visibleLabelStep === 0 || index === prepared.points.length - 1 ? (
            <text key={`label-${point.bucket_date}-${index}`} x={point.x} y={prepared.height - 22} textAnchor="middle" className="chart-label chart-x-label">
              {formatDayLabel(point.bucket_date)}
            </text>
          ) : null,
        )}
        <text x={prepared.padLeft} y={15} className="chart-axis-title">
          左轴：点赞/收藏/评论
        </text>
        <text x={prepared.width - prepared.padRight} y={15} textAnchor="end" className="chart-axis-title">
          右轴：笔记篇数
        </text>
      </svg>
      {hovered ? (
        <div className="content-trend-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <strong>{formatDayLabel(hovered.bucket_date)}</strong>
          <div>
            <span>笔记篇数</span>
            <b>{formatNumber(hovered.note_count)}</b>
            <span>点赞数</span>
            <b>{formatNumber(hovered.like_total)}</b>
            <span>收藏数</span>
            <b>{formatNumber(hovered.collected_total)}</b>
            <span>评论数</span>
            <b>{formatNumber(hovered.comments_total)}</b>
          </div>
        </div>
      ) : null}
      <div className="content-trend-legend">
        <span>
          <i className="legend-note-count" />
          笔记篇数
        </span>
        <span>
          <i style={{ background: "#18aee8" }} />
          点赞数
        </span>
        <span>
          <i style={{ background: "#6fdc72" }} />
          收藏数
        </span>
        <span>
          <i style={{ background: "#ff5f7f" }} />
          评论数
        </span>
      </div>
    </div>
  );
}

export function NoteMetricChip({ label, value }) {
  return (
    <span className="note-metric-chip">
      <em>{label}</em>
      <strong>{formatNumber(value)}</strong>
    </span>
  );
}

export function DailyNoteRail({ date, notes, selectedNoteId, onSelectNote }) {
  return (
    <section className="daily-note-rail">
      <div className="daily-note-rail-head">
        <div>
          <span>{date ? formatDayLabel(date) : "未选日期"}</span>
          <strong>笔记预览</strong>
        </div>
        <StatusPill tone="neutral">{formatNumber(notes.length)} 条 · 按互动量</StatusPill>
      </div>
      {notes.length ? (
        <div className="daily-note-strip">
          {notes.map((item) => (
            <article
              className={`daily-note-card ${selectedNoteId === item.note_id ? "active" : ""}`}
              key={item.note_id}
              onClick={() => onSelectNote(item.note_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectNote(item.note_id);
              }}
              role="button"
              tabIndex="0"
            >
              <div className="daily-note-basic">
                <div className="daily-note-card-top">
                  <StatusPill tone={item.funnel_role === "转化" ? "green" : item.funnel_role === "信任" ? "blue" : "neutral"}>
                    {item.funnel_role || "未标注漏斗"}
                  </StatusPill>
                  <span>{formatDayLabel(item.note_date || item.publish_time)}</span>
                </div>
                <strong>{item.title || item.note_id}</strong>
                <p>{textPreview(noteContentText(item), 132) || "-"}</p>
                <div className="daily-note-topic-row">
                  <span>{item.core_topic_category || "未标注话题"}</span>
                  <span>{arrayText(item.hook_types) || "未标注钩子"}</span>
                </div>
                <div className="daily-note-metrics">
                  <NoteMetricChip label="互动" value={item.interaction_score} />
                  <NoteMetricChip label="赞" value={item.like_count} />
                  <NoteMetricChip label="藏" value={item.collected_count} />
                  <NoteMetricChip label="评" value={item.comments_count} />
                </div>
              </div>
              <div className="daily-note-insight-grid">
                <section>
                  <h3>目标人群及痛点判断</h3>
                  <strong>{item.primary_target_persona || "未标注人群"}</strong>
                  <p>{item.true_pain_label || item.pain_description || "-"}</p>
                  <small>{item.target_persona_reason || item.pain_evidence || ""}</small>
                </section>
                <section>
                  <h3>业务逻辑和可复用角度</h3>
                  <strong>{item.business_logic || item.content_logic || "-"}</strong>
                  <p>{firstStructuredText(item.reusable_angles, item.funnel_role_reason || "")}</p>
                </section>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state daily-note-empty">暂无该日期笔记</div>
      )}
    </section>
  );
}
