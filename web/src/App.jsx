import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Filter,
  Gauge,
  KeyRound,
  Layers3,
  ListChecks,
  RefreshCcw,
  Search,
  Sparkles,
  Target,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChatWidget } from "./components/ChatWidget";
import { sampleDashboard } from "./sampleData.js";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const compactFormatter = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const moneyFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

const navItems = [
  { id: "content", label: "内容资产", icon: Database },
  { id: "ops", label: "运行监控", icon: Gauge },
  { id: "models", label: "模型配置", icon: KeyRound },
];

const chartColors = ["#2764cf", "#087b76", "#a85e00", "#7153b8", "#bc3d3a", "#26814f"];
const providerLabels = {
  endata_xhs_note_detail: "艺恩详情 API 调用（按 note_id 抓标题/正文/互动）",
  volcengine_ark_vision: "豆包图片解析（首图/子图视觉信息）",
  volcengine_ark_chat: "豆包内容资产总结（痛点/人群/漏斗标签）",
  volcengine_ark_embedding: "豆包 Embedding（内容资产转向量）",
  kimi_chat: "Kimi 历史内容资产总结（旧模型记录）",
};
const providerChartOrder = new Map(
  ["endata_xhs_note_detail", "volcengine_ark_vision", "volcengine_ark_chat", "kimi_chat", "volcengine_ark_embedding"].map(
    (code, index) => [code, index],
  ),
);

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return numberFormatter.format(Number(value));
}

function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "-";
  return compactFormatter.format(Number(value));
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return moneyFormatter.format(number);
}

function formatMoneyDelta(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (number > 0) return `+${formatMoney(number)}`;
  if (number < 0) return `-${formatMoney(Math.abs(number))}`;
  return "0.00";
}

function formatDelta(value) {
  const number = Number(value || 0);
  if (number > 0) return `+${formatCompact(number)}`;
  if (number < 0) return `-${formatCompact(Math.abs(number))}`;
  return "0";
}

function formatSignedNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (number > 0) return `+${formatNumber(number)}`;
  if (number < 0) return `-${formatNumber(Math.abs(number))}`;
  return "0";
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${percentFormatter.format(number)}%`;
}

function formatScore(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(1);
}

function formatDate(value) {
  if (!value) return "-";
  return dateFormatter.format(new Date(value));
}

function formatDateTimeSecond(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}月${date.getDate()}日${padDatePart(date.getHours())}时${padDatePart(date.getMinutes())}分${padDatePart(date.getSeconds())}秒`;
}

function formatShortDate(value) {
  if (!value) return "-";
  return shortDateFormatter.format(new Date(value));
}

function formatDuration(value) {
  if (!value) return "-";
  const seconds = Math.round(Number(value) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function arrayText(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.join(" / ");
  return String(value);
}

function statusTone(status) {
  if (status === "success" || status === "active" || status === true) return "green";
  if (status === "running") return "blue";
  if (status === "failed" || status === "timeout" || status === "rate_limited") return "red";
  if (status === "canceled" || status === "skipped") return "amber";
  return "neutral";
}

function providerTypeLabel(value) {
  const labels = {
    detail_api: "详情 API",
    llm_chat: "大模型",
    llm_vision: "图片解析",
    embedding: "Embedding",
    media_fetch: "媒体下载",
    speech_to_text: "视频转录",
    other: "其他",
  };
  return labels[value] || value || "-";
}

function providerDisplayName(item) {
  const code = typeof item === "string" ? item : item?.provider_code;
  return providerLabels[code] || (typeof item === "string" ? item : item?.display_name_cn) || code || "-";
}

function endataRangeLabel(value) {
  const labels = {
    today: "今日",
    yesterday: "昨日",
    month: "本月",
  };
  return labels[value] || value || "-";
}

function deltaClass(value) {
  const number = Number(value || 0);
  if (number > 0) return "endata-delta-up";
  if (number < 0) return "endata-delta-down";
  return "endata-delta-flat";
}

function compactProviderLabel(value) {
  return String(value || "")
    .replace(/（.*?）/g, "")
    .replace(/^火山\s*Ark\s*/, "")
    .replace(/^Ark\s*/, "")
    .trim();
}

function chartLabelLines(value) {
  const label = compactProviderLabel(value);
  if (label.length <= 8) return [label];
  if (label.length <= 14) return [label.slice(0, 7), label.slice(7)];
  return [label.slice(0, 7), `${label.slice(7, 13)}...`];
}

function modelDisplayName(item) {
  return item?.display_name_cn || item?.model_name || providerDisplayName(item);
}

function Stat({ icon: Icon, label, value, tone = "blue", sub }) {
  return (
    <section className={`stat stat-${tone}`}>
      <div className="stat-icon" aria-hidden="true">
        <Icon size={18} />
      </div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub ? <div className="stat-sub">{sub}</div> : null}
      </div>
    </section>
  );
}

function BarRow({ label, value, max, detail, tone = "blue" }) {
  const width = max ? Math.max(4, Math.round((Number(value || 0) / max) * 100)) : 0;
  return (
    <div className="bar-row">
      <div className="bar-meta">
        <span>{label || "未标注"}</span>
        <strong>{formatNumber(value)}</strong>
      </div>
      <div className="bar-track" aria-hidden="true">
        <div className={`bar-fill bar-${tone}`} style={{ width: `${width}%` }} />
      </div>
      {detail ? <div className="bar-detail">{detail}</div> : null}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, action }) {
  return (
    <div className="section-header">
      <div className="section-title">
        <Icon size={17} />
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function StatusPill({ children, tone = "neutral" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function SelectControl({ value, onChange, options, label }) {
  return (
    <label className="select-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="segmented-control">
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function formatBucket(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return dateFormatter.format(date);
}

function getMonthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value) {
  if (!value) return "无月份";
  const [year, month] = value.split("-");
  return `${year}年${month}月`;
}

function dayStart(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function localDateTimeString(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:00`;
}

function normalizeBucketStart(value, range) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setSeconds(0, 0);
  if (range === "hourly") {
    date.setMinutes(0, 0, 0);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return localDateTimeString(date);
}

function buildBucketDomain(startDate, endDate, range) {
  if (!startDate || !endDate) return [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];
  if (range === "hourly") {
    cursor.setMinutes(0, 0, 0);
    end.setMinutes(0, 0, 0);
  } else {
    cursor.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
  }
  const buckets = [];
  while (cursor <= end) {
    buckets.push(localDateTimeString(cursor));
    if (range === "hourly") {
      cursor.setHours(cursor.getHours() + 1);
    } else {
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return buckets;
}

function TimeWindowSlider({ days, onChange, startDate, endDate }) {
  return (
    <section className="time-window-slider">
      <div className="time-window-meta">
        <strong>时间轴</strong>
        <span>
          {formatShortDate(startDate)} - {formatShortDate(endDate)} · 窗口 {days} 天
        </span>
      </div>
      <input
        aria-label="调整折线图时间轴天数"
        type="range"
        min="3"
        max="30"
        step="1"
        value={days}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="time-window-scale">
        <span>3天</span>
        <span>30天</span>
      </div>
    </section>
  );
}

function LineChart({
  rows,
  seriesKey,
  seriesLabelKey = "display_name_cn",
  seriesDomain = [],
  bucketDomain = [],
  valueKey = "calls_total",
  bucketLabel = "时间桶",
  yLabel = "调用次数",
  emptyLabel = "暂无曲线数据",
}) {
  const [hoverBucket, setHoverBucket] = useState(null);
  const prepared = useMemo(() => {
    const buckets = (bucketDomain.length ? bucketDomain : [...new Set(rows.map((item) => item.bucket_start))]).sort();
    const seriesLabelById = new Map(seriesDomain.map((item) => [item.id, item.label]));
    const seriesIds = (
      seriesDomain.length
        ? seriesDomain.map((item) => item.id)
        : [...new Set(rows.map((item) => item[seriesKey] || item.provider_code || "unknown"))]
    )
      .filter(Boolean)
      .slice(0, 8);
    const valueMap = new Map();
    rows.forEach((item) => {
      const id = item[seriesKey] || item.provider_code || "unknown";
      const bucket = item.bucket_start;
      const key = `${id}::${bucket}`;
      valueMap.set(key, Number(valueMap.get(key) || 0) + Number(item[valueKey] || 0));
    });
    const maxValue = Math.max(1, Math.ceil(Math.max(0, ...Array.from(valueMap.values()))));
    const bucketIndex = new Map(buckets.map((bucket, index) => [bucket, index]));
    const width = 720;
    const height = 280;
    const padLeft = 58;
    const padRight = 18;
    const padTop = 24;
    const padBottom = 52;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;
    const yTicks = [...new Set([0, Math.ceil(maxValue / 2), maxValue])];
    const xTicks = buckets.filter((_, index) => {
      if (buckets.length <= 3) return true;
      return index === 0 || index === Math.floor((buckets.length - 1) / 2) || index === buckets.length - 1;
    });
    const seriesData = seriesIds.map((id, seriesIndex) => {
      const source = rows.find((item) => (item[seriesKey] || item.provider_code || "unknown") === id);
      const label = seriesLabelById.get(id) || source?.[seriesLabelKey] || source?.display_name_cn || id;
      const values = buckets.map((bucket, index) => {
        const value = Number(valueMap.get(`${id}::${bucket}`) || 0);
        const previousBucket = index > 0 ? buckets[index - 1] : null;
        const previous = previousBucket ? Number(valueMap.get(`${id}::${previousBucket}`) || 0) : null;
        const x = padLeft + (buckets.length <= 1 ? innerW / 2 : (bucketIndex.get(bucket) / (buckets.length - 1)) * innerW);
        const y = padTop + innerH - (value / maxValue) * innerH;
        return { bucket, value, previous, delta: previous === null ? null : value - previous, x, y };
      });
      return {
        id,
        label,
        color: chartColors[seriesIndex % chartColors.length],
        d: values.length ? `M ${values.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" L ")}` : "",
        values,
      };
    });
    return { buckets, bucketIndex, xTicks, yTicks, seriesData, width, height, maxValue, padLeft, padRight, padTop, padBottom, innerW, innerH };
  }, [rows, seriesKey, seriesLabelKey, seriesDomain, bucketDomain, valueKey]);

  if (!prepared.buckets.length || !prepared.seriesData.length) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  const hoverIndex = hoverBucket ? prepared.bucketIndex.get(hoverBucket) : -1;
  const hoverX =
    hoverIndex >= 0
      ? prepared.padLeft + (prepared.buckets.length <= 1 ? prepared.innerW / 2 : (hoverIndex / (prepared.buckets.length - 1)) * prepared.innerW)
      : null;
  const hoverLeft = hoverX === null ? 0 : (hoverX / prepared.width) * 100;
  const tooltipLeft = Math.min(74, Math.max(26, hoverLeft));

  function handleMouseMove(event) {
    if (!prepared.buckets.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * prepared.width;
    const clamped = Math.max(prepared.padLeft, Math.min(prepared.width - prepared.padRight, x));
    const index =
      prepared.buckets.length <= 1 ? 0 : Math.round(((clamped - prepared.padLeft) / prepared.innerW) * (prepared.buckets.length - 1));
    setHoverBucket(prepared.buckets[Math.max(0, Math.min(prepared.buckets.length - 1, index))]);
  }

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${prepared.width} ${prepared.height}`} role="img" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverBucket(null)}>
        {prepared.yTicks.map((tick) => {
          const y = prepared.padTop + prepared.innerH - (tick / prepared.maxValue) * prepared.innerH;
          return (
            <g key={`y-${tick}`}>
              <line x1={prepared.padLeft} x2={prepared.width - prepared.padRight} y1={y} y2={y} className={tick === 0 ? "chart-axis" : "chart-grid"} />
              <text x={prepared.padLeft - 10} y={y + 4} textAnchor="end" className="chart-label">
                {formatCompact(tick)}
              </text>
            </g>
          );
        })}
        <line x1={prepared.padLeft} x2={prepared.padLeft} y1={prepared.padTop} y2={prepared.height - prepared.padBottom} className="chart-axis" />
        <text x={prepared.padLeft} y={12} className="chart-axis-title">
          纵轴：{yLabel}
        </text>
        <text x={prepared.width - prepared.padRight} y={prepared.height - 8} textAnchor="end" className="chart-axis-title">
          横轴：{bucketLabel}
        </text>
        {prepared.seriesData.map((series) => (
          <path key={series.id} d={series.d} fill="none" stroke={series.color} strokeWidth="3" strokeLinecap="round" />
        ))}
        {hoverIndex >= 0 ? (
          <>
            <line x1={hoverX} x2={hoverX} y1={prepared.padTop} y2={prepared.height - prepared.padBottom} className="chart-hover-line" />
            {prepared.seriesData.map((series) => {
              const point = series.values[hoverIndex];
              return <circle key={`${series.id}-hover`} cx={point.x} cy={point.y} r="4.5" fill={series.color} className="chart-hover-dot" />;
            })}
          </>
        ) : null}
        {prepared.xTicks.map((bucket) => {
          const x = prepared.padLeft + (prepared.buckets.length <= 1 ? prepared.innerW / 2 : (prepared.bucketIndex.get(bucket) / (prepared.buckets.length - 1)) * prepared.innerW);
          return (
            <text key={bucket} x={x} y={prepared.height - 26} textAnchor="middle" className="chart-label chart-x-label">
              {formatBucket(bucket)}
            </text>
          );
        })}
      </svg>
      {hoverIndex >= 0 ? (
        <div className="chart-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <strong>{formatBucket(hoverBucket)}</strong>
          <span>{bucketLabel}</span>
          <div className="chart-tooltip-list">
            {prepared.seriesData.map((series) => {
              const point = series.values[hoverIndex];
              return (
                <div className="chart-tooltip-row" key={series.id}>
                  <i style={{ background: series.color }} />
                  <em>{series.label}</em>
                  <b>{formatNumber(point.value)}</b>
                  <small>{point.delta === null ? "首个时间点" : `较前 ${formatDelta(point.delta)}`}</small>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="chart-legend">
        {prepared.seriesData.map((series) => (
          <span key={series.id}>
            <i style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
      <div className="chart-scale">
        横轴：{bucketLabel} · 纵轴：{yLabel} · 峰值 {formatCompact(prepared.maxValue)}
      </div>
    </div>
  );
}

function ApiStatusComboChart({ rows, selectedProvider, selectedStatus, onSelect }) {
  const [hoverProvider, setHoverProvider] = useState(null);
  const prepared = useMemo(() => {
    const chartRows = rows
      .map((item) => {
        const label = providerDisplayName(item);
        return {
          ...item,
          label,
          labelLines: chartLabelLines(label),
          calls_success: Number(item.calls_success || 0),
          calls_failed: Number(item.calls_failed || 0),
          calls_total: Number(item.calls_total || 0),
          total_tokens: Number(item.total_tokens || 0),
        };
      })
      .filter((item) => item.provider_code)
      .sort((a, b) => {
        const orderA = providerChartOrder.has(a.provider_code) ? providerChartOrder.get(a.provider_code) : 99;
        const orderB = providerChartOrder.has(b.provider_code) ? providerChartOrder.get(b.provider_code) : 99;
        if (orderA !== orderB) return orderA - orderB;
        return b.calls_total - a.calls_total || a.provider_code.localeCompare(b.provider_code);
      });
    const width = 900;
    const height = 320;
    const padLeft = 62;
    const padRight = 88;
    const padTop = 24;
    const padBottom = 58;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;
    const maxCalls = Math.max(1, ...chartRows.map((item) => item.calls_total));
    const maxTokens = Math.max(1, ...chartRows.map((item) => item.total_tokens));
    const callTicks = [...new Set([0, Math.ceil(maxCalls / 2), maxCalls])];
    const tokenTicks = [...new Set([0, Math.ceil(maxTokens / 2), maxTokens])];
    const slotW = chartRows.length ? innerW / chartRows.length : innerW;
    const barW = Math.max(24, Math.min(64, slotW * 0.52));
    const baseY = padTop + innerH;
    const yCall = (value) => baseY - (Number(value || 0) / maxCalls) * innerH;
    const yToken = (value) => baseY - (Number(value || 0) / maxTokens) * innerH;
    const positionedRows = chartRows.map((row, index) => {
      const x = padLeft + slotW * index + slotW / 2;
      let successH = row.calls_success > 0 ? Math.max(5, baseY - yCall(row.calls_success)) : 0;
      let failedH = row.calls_failed > 0 ? Math.max(5, baseY - yCall(row.calls_failed)) : 0;
      const overflow = Math.max(0, successH + failedH - innerH);
      if (overflow > 0) {
        if (successH >= failedH) successH = Math.max(0, successH - overflow);
        else failedH = Math.max(0, failedH - overflow);
      }
      const successY = baseY - successH;
      const failedY = successY - failedH;
      return { ...row, x, successH, failedH, successY, failedY, tokenY: yToken(row.total_tokens) };
    });
    const tokenLineD = positionedRows.length
      ? `M ${positionedRows.map((point) => `${point.x.toFixed(1)},${point.tokenY.toFixed(1)}`).join(" L ")}`
      : "";
    return {
      positionedRows,
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      innerW,
      innerH,
      baseY,
      barW,
      maxCalls,
      maxTokens,
      callTicks,
      tokenTicks,
      yCall,
      yToken,
      tokenLineD,
    };
  }, [rows]);

  if (!prepared.positionedRows.length) {
    return <div className="empty-state">暂无 API 调用概况</div>;
  }

  const hovered = prepared.positionedRows.find((item) => item.provider_code === hoverProvider);
  const tooltipLeft = hovered ? Math.min(76, Math.max(24, (hovered.x / prepared.width) * 100)) : 50;

  function selectSegment(event, providerCode, status) {
    event.preventDefault();
    onSelect(providerCode, status);
  }

  function handleSegmentKeyDown(event, providerCode, status) {
    if (event.key === "Enter" || event.key === " ") {
      selectSegment(event, providerCode, status);
    }
  }

  return (
    <div className="api-combo-chart">
      <svg className="api-combo-svg" viewBox={`0 0 ${prepared.width} ${prepared.height}`} role="img" aria-label="API 调用成功失败和 tokens 组合图">
        <title>API 调用情况：堆积柱为成功和失败次数，折线为 tokens</title>
        {prepared.callTicks.map((tick) => {
          const y = prepared.yCall(tick);
          return (
            <g key={`call-${tick}`}>
              <line x1={prepared.padLeft} x2={prepared.width - prepared.padRight} y1={y} y2={y} className={tick === 0 ? "chart-axis" : "chart-grid"} />
              <text x={prepared.padLeft - 10} y={y + 4} textAnchor="end" className="chart-label">
                {formatCompact(tick)}
              </text>
            </g>
          );
        })}
        {prepared.tokenTicks.map((tick) => {
          const y = prepared.yToken(tick);
          return (
            <text key={`token-${tick}`} x={prepared.width - prepared.padRight + 12} y={y + 4} className="chart-label combo-token-tick">
              {formatCompact(tick)}
            </text>
          );
        })}
        <line x1={prepared.padLeft} x2={prepared.padLeft} y1={prepared.padTop} y2={prepared.baseY} className="chart-axis" />
        <line x1={prepared.width - prepared.padRight} x2={prepared.width - prepared.padRight} y1={prepared.padTop} y2={prepared.baseY} className="chart-axis" />
        <text x={prepared.padLeft} y={12} className="chart-axis-title">
          左轴：调用次数
        </text>
        <text x={prepared.width - prepared.padRight} y={12} textAnchor="end" className="chart-axis-title">
          右轴：tokens
        </text>

        {prepared.positionedRows.map((row) => {
          const successSelected = selectedProvider === row.provider_code && selectedStatus === "success";
          const failedSelected = selectedProvider === row.provider_code && selectedStatus === "failed";
          return (
            <g
              key={row.provider_code}
              onMouseEnter={() => setHoverProvider(row.provider_code)}
              onMouseLeave={() => setHoverProvider(null)}
              onFocus={() => setHoverProvider(row.provider_code)}
              onBlur={() => setHoverProvider(null)}
            >
              {row.calls_success > 0 ? (
                <rect
                  className={`combo-bar-segment combo-bar-success ${successSelected ? "selected" : ""}`}
                  x={row.x - prepared.barW / 2}
                  y={row.successY}
                  width={prepared.barW}
                  height={row.successH}
                  rx="3"
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.label} 成功 ${row.calls_success} 次，点击查看成功明细`}
                  onClick={(event) => selectSegment(event, row.provider_code, "success")}
                  onKeyDown={(event) => handleSegmentKeyDown(event, row.provider_code, "success")}
                />
              ) : null}
              {row.calls_failed > 0 ? (
                <rect
                  className={`combo-bar-segment combo-bar-failed ${failedSelected ? "selected" : ""}`}
                  x={row.x - prepared.barW / 2}
                  y={row.failedY}
                  width={prepared.barW}
                  height={row.failedH}
                  rx="3"
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.label} 失败 ${row.calls_failed} 次，点击查看失败明细`}
                  onClick={(event) => selectSegment(event, row.provider_code, "failed")}
                  onKeyDown={(event) => handleSegmentKeyDown(event, row.provider_code, "failed")}
                />
              ) : null}
              <text x={row.x} y={Math.max(prepared.padTop + 12, row.failedY - 7)} textAnchor="middle" className="combo-total-label">
                {formatCompact(row.calls_total)}
              </text>
              {row.successH >= 22 ? (
                <text x={row.x} y={row.successY + row.successH / 2 + 4} textAnchor="middle" className="combo-segment-label">
                  {formatCompact(row.calls_success)}
                </text>
              ) : null}
              {row.failedH >= 22 ? (
                <text x={row.x} y={row.failedY + row.failedH / 2 + 4} textAnchor="middle" className="combo-segment-label">
                  {formatCompact(row.calls_failed)}
                </text>
              ) : null}
              {row.labelLines.map((line, lineIndex) => (
                <text
                  key={`${row.provider_code}-label-${lineIndex}`}
                  x={row.x}
                  y={prepared.height - 35 + lineIndex * 13}
                  textAnchor="middle"
                  className="chart-label combo-x-label"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}

        <path d={prepared.tokenLineD} fill="none" stroke="var(--purple)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="combo-token-line" />
        {prepared.positionedRows.map((row) => (
          <circle
            key={`${row.provider_code}-token`}
            cx={row.x}
            cy={row.tokenY}
            r="4.5"
            className="combo-token-dot"
            onMouseEnter={() => setHoverProvider(row.provider_code)}
            onMouseLeave={() => setHoverProvider(null)}
          />
        ))}
        <text x={prepared.width - prepared.padRight} y={prepared.height - 7} textAnchor="end" className="chart-axis-title">
          横轴：API 名称
        </text>
      </svg>

      {hovered ? (
        <div className="api-combo-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <strong>{hovered.label}</strong>
          <div className="api-combo-tooltip-grid">
            <span>成功</span>
            <b className="combo-success-text">{formatNumber(hovered.calls_success)}</b>
            <span>失败</span>
            <b className="combo-failed-text">{formatNumber(hovered.calls_failed)}</b>
            <span>Tokens</span>
            <b>{formatCompact(hovered.total_tokens)}</b>
            <span>涉及笔记</span>
            <b>{formatNumber(hovered.notes_total)}</b>
            <span>类型</span>
            <b>{providerTypeLabel(hovered.provider_type)}</b>
          </div>
        </div>
      ) : null}

      <div className="api-combo-legend">
        <span>
          <i className="legend-success" />
          成功次数
        </span>
        <span>
          <i className="legend-failed" />
          失败次数
        </span>
        <span>
          <i className="legend-token" />
          tokens
        </span>
      </div>
    </div>
  );
}

function EndataCompactPanel({ endata }) {
  const snapshots = endata?.latestSnapshots || [];
  const endpoints = endata?.endpoints || [];
  const latestSnapshot = snapshots.find((item) => item.range_key === "today") || snapshots[0] || {};
  const topEndpoints = endpoints.slice(0, 3);

  return (
    <section className="panel">
      <SectionHeader icon={Gauge} title="艺恩余额概览" action={<StatusPill tone={latestSnapshot.ok === false ? "red" : "green"}>{latestSnapshot.ok === false ? "异常" : "正常"}</StatusPill>} />
      {snapshots.length || endpoints.length ? (
        <>
          <div className="endata-compact-total">
            <div>
              <span>当前余额</span>
              <strong>{formatMoney(latestSnapshot.residue_fee)}</strong>
            </div>
            <em className={`endata-delta ${deltaClass(latestSnapshot.balance_delta)}`}>较上次 {formatMoneyDelta(latestSnapshot.balance_delta)}</em>
          </div>
          <div className="endata-mini-list">
            {topEndpoints.map((item) => (
              <div className="endata-mini-row" key={item.url}>
                <div>
                  <strong>{item.display_name_cn || item.url}</strong>
                  <span>{item.url}</span>
                </div>
                <div className="endata-mini-metric">
                  <b>{formatNumber(item.count)}</b>
                  <small className={deltaClass(item.count_delta)}>{formatSignedNumber(item.count_delta)}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="endata-compact-foot">
            <span>今日成功 {formatNumber(latestSnapshot.success_count)}</span>
            <span>采样 {formatDateTimeSecond(latestSnapshot.sampled_at)}</span>
          </div>
        </>
      ) : (
        <div className="empty-state">暂无艺恩余额快照</div>
      )}
    </section>
  );
}

function EndataBalancePanel({ endata }) {
  const snapshots = endata?.latestSnapshots || [];
  const endpoints = endata?.endpoints || [];
  const endpointHistory = (endata?.endpointHistory || []).map((item) => ({
    ...item,
    bucket_start: item.bucket_start,
    display_name_cn: item.display_name_cn || item.url,
  }));
  const scriptUsageRows = (endata?.scriptUsageHourly || []).map((item) => ({
    ...item,
    bucket_start: normalizeBucketStart(item.bucket_start, "hourly"),
    display_name_cn: item.display_name_cn || item.script_key || "未记录脚本",
  }));
  const latestSnapshot = snapshots.find((item) => item.range_key === "today") || snapshots[0] || {};
  const monthSnapshot = snapshots.find((item) => item.range_key === "month") || {};
  const endpointSeriesDomain = useMemo(() => {
    const entries = [...endpoints, ...endpointHistory]
      .filter((item) => item.url)
      .map((item) => [item.url, { id: item.url, label: item.display_name_cn || item.url }]);
    return Array.from(new Map(entries).values()).slice(0, 8);
  }, [endpoints, endpointHistory]);
  const scriptSeriesDomain = useMemo(() => {
    const entries = scriptUsageRows
      .filter((item) => item.script_key)
      .map((item) => [item.script_key, { id: item.script_key, label: item.display_name_cn || item.script_key }]);
    return Array.from(new Map(entries).values()).slice(0, 8);
  }, [scriptUsageRows]);
  const scriptSummary = useMemo(() => {
    const byScript = new Map();
    scriptUsageRows.forEach((row) => {
      const key = row.script_key || "unknown";
      const current = byScript.get(key) || {
        script_key: key,
        display_name_cn: row.display_name_cn || key,
        calls_total: 0,
        calls_success: 0,
        calls_failed: 0,
        endpoints: new Set(),
      };
      current.calls_total += Number(row.calls_total || 0);
      current.calls_success += Number(row.calls_success || 0);
      current.calls_failed += Number(row.calls_failed || 0);
      if (row.endpoint_display_name_cn || row.url) current.endpoints.add(row.endpoint_display_name_cn || row.url);
      byScript.set(key, current);
    });
    return Array.from(byScript.values())
      .map((item) => ({ ...item, endpoints: Array.from(item.endpoints) }))
      .sort((a, b) => b.calls_total - a.calls_total || a.script_key.localeCompare(b.script_key));
  }, [scriptUsageRows]);

  return (
    <section className="panel endata-panel">
      <SectionHeader icon={Gauge} title="艺恩余额与接口消耗" action={<StatusPill tone="neutral">30 秒刷新</StatusPill>} />

      <div className="endata-summary-grid">
        <div className="endata-metric-card">
          <span>当前余额</span>
          <strong>{formatMoney(latestSnapshot.residue_fee)}</strong>
          <small className={`endata-delta ${deltaClass(latestSnapshot.balance_delta)}`}>较上次 {formatMoneyDelta(latestSnapshot.balance_delta)}</small>
        </div>
        <div className="endata-metric-card">
          <span>今日成功调用</span>
          <strong>{formatNumber(latestSnapshot.success_count)}</strong>
          <small className={`endata-delta ${deltaClass(latestSnapshot.success_count_delta)}`}>较上次 {formatSignedNumber(latestSnapshot.success_count_delta)}</small>
        </div>
        <div className="endata-metric-card">
          <span>本月成功调用</span>
          <strong>{formatNumber(monthSnapshot.success_count)}</strong>
          <small>{monthSnapshot.begin_code && monthSnapshot.end_code ? `${monthSnapshot.begin_code} - ${monthSnapshot.end_code}` : "暂无本月快照"}</small>
        </div>
        <div className="endata-metric-card">
          <span>最近采样</span>
          <strong>{formatDate(latestSnapshot.sampled_at)}</strong>
          <small>
            {endataRangeLabel(latestSnapshot.range_key)} · {latestSnapshot.ok === false ? latestSnapshot.msg || "异常" : `耗时 ${formatDuration(latestSnapshot.latency_ms)}`}
          </small>
        </div>
      </div>

      <div className="endata-chart-grid">
        <div className="endata-chart-block">
          <div className="endata-block-title">
            <strong>接口累计调用波动</strong>
            <span>艺恩余额接口快照</span>
          </div>
          <LineChart
            rows={endpointHistory}
            seriesKey="url"
            seriesLabelKey="display_name_cn"
            seriesDomain={endpointSeriesDomain}
            valueKey="count"
            bucketLabel="采样时间"
            yLabel="累计成功调用"
            emptyLabel="暂无接口调用快照"
          />
        </div>
        <div className="endata-chart-block">
          <div className="endata-block-title">
            <strong>脚本调用波动</strong>
            <span>近 72 小时网关日志</span>
          </div>
          <LineChart
            rows={scriptUsageRows}
            seriesKey="script_key"
            seriesLabelKey="display_name_cn"
            seriesDomain={scriptSeriesDomain}
            valueKey="calls_total"
            bucketLabel="小时"
            yLabel="艺恩调用次数"
            emptyLabel="暂无脚本调用日志"
          />
        </div>
      </div>

      <div className="endata-script-breakdown">
        {scriptSummary.length ? (
          scriptSummary.slice(0, 6).map((item) => (
            <div className="endata-script-row" key={item.script_key}>
              <div>
                <strong>{item.display_name_cn}</strong>
                <span>{item.script_key}</span>
              </div>
              <div className="endata-script-metrics">
                <b>{formatNumber(item.calls_total)}</b>
                <small>
                  成功 {formatNumber(item.calls_success)} · 失败 {formatNumber(item.calls_failed)}
                </small>
                <em>{item.endpoints.join(" / ") || "-"}</em>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">暂无脚本调用拆分</div>
        )}
      </div>

      <div className="table-wrap endata-table-wrap">
        <table className="endata-endpoint-table">
          <thead>
            <tr>
              <th>接口路径</th>
              <th>中文解释</th>
              <th>调用情况</th>
              <th>相关脚本</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((item) => (
              <tr key={item.url}>
                <td>
                  <code className="endata-path">{item.url}</code>
                  <div className="note-meta">采样 {formatDateTimeSecond(item.sampled_at)}</div>
                </td>
                <td>
                  <div className="note-title">{item.display_name_cn || item.url}</div>
                  <div className="endata-description">{item.description_cn || "-"}</div>
                </td>
                <td>
                  <div className="endata-call-metric">
                    <strong>{formatNumber(item.count)}</strong>
                    <span>{formatPercent(item.share_pct)}</span>
                    <small className={`endata-delta ${deltaClass(item.count_delta)}`}>较上次 {formatSignedNumber(item.count_delta)}</small>
                  </div>
                </td>
                <td>
                  <div className="endpoint-script-tags">
                    {(item.scripts || []).map((script) => (
                      <span key={`${item.url}-${script.script_key}-${script.scope}`}>
                        {script.display_name_cn}
                        <em>{script.scope}</em>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DashboardTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>笔记</th>
            <th>时效分</th>
            <th>互动</th>
            <th>人群</th>
            <th>漏斗</th>
            <th>痛点</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.note_id}>
              <td>
                <div className="note-title">{item.title || item.note_id}</div>
                <div className="note-meta">
                  {item.note_id} · {formatDate(item.publish_time)}
                </div>
              </td>
              <td className="metric-cell">{formatScore(item.fresh_hot_score)}</td>
              <td className="metric-cell">{formatNumber(item.interaction_score)}</td>
              <td>
                <div className="clamped">{arrayText(item.target_persona_tags) || item.primary_target_persona}</div>
              </td>
              <td>
                <StatusPill tone={item.funnel_role === "转化" ? "green" : item.funnel_role === "信任" ? "blue" : "amber"}>
                  {item.funnel_role || "未标注"}
                </StatusPill>
              </td>
              <td>
                <div className="clamped">{item.true_pain_label || "-"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContentDashboard({ data, loading, filter }) {
  const filteredTopFresh = useMemo(() => {
    const rows = data?.topFresh || [];
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((item) =>
      [
        item.title,
        item.note_id,
        item.primary_target_persona,
        item.primary_industry,
        item.funnel_role,
        item.true_pain_label,
        arrayText(item.target_persona_tags),
        arrayText(item.industry_tags),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [data, filter]);

  const maxPersona = Math.max(1, ...(data?.personaDistribution || []).map((item) => Number(item.note_count || 0)));
  const maxIndustry = Math.max(1, ...(data?.industryDistribution || []).map((item) => Number(item.note_count || 0)));
  const maxPain = Math.max(1, ...(data?.painMap || []).map((item) => Number(item.note_count || 0)));
  const maxVisual = Math.max(1, ...(data?.visualPatterns || []).map((item) => Number(item.note_count || 0)));
  const overview = data?.overview || {};
  const queueSuccess = (data?.queueStatus || []).find((item) => item.status === "success")?.count || 0;
  const queueFailed = (data?.queueStatus || []).find((item) => item.status === "failed")?.count || 0;

  return (
    <>
      <section className="stats-grid">
        <Stat icon={Database} label="详情成功" value={formatNumber(overview.noteDetailSuccess)} sub={`失败 ${formatNumber(overview.noteDetailFailed || 0)}`} />
        <Stat
          icon={Brain}
          label="内容资产"
          value={formatNumber(overview.assetSuccess)}
          sub={`豆包总结成功 ${formatNumber(overview.contentAssetSuccessRuns ?? overview.kimiSuccessRuns)}`}
          tone="teal"
        />
        <Stat icon={Layers3} label="向量资产" value={formatNumber(overview.vectorCount)} sub="pgvector halfvec(2048)" tone="purple" />
        <Stat icon={Activity} label="队列完成" value={formatNumber(queueSuccess)} sub={queueFailed ? `失败 ${formatNumber(queueFailed)}` : "实时 worker active"} tone="amber" />
      </section>

      <section className="layout">
        <div className="main-column">
          <section className="panel panel-table">
            <SectionHeader
              icon={BarChart3}
              title="近期可复用爆文"
              action={
                <StatusPill tone="neutral">
                  <Filter size={13} />
                  fresh_hot_score
                </StatusPill>
              }
            />
            {loading && !data ? <div className="loading">加载中</div> : <DashboardTable rows={filteredTopFresh} />}
          </section>

          <section className="panel">
            <SectionHeader icon={Target} title="真实痛点地图" />
            <div className="stack">
              {(data?.painMap || []).map((item) => (
                <BarRow
                  key={`${item.true_pain_label}-${item.pain_authenticity}`}
                  label={`${item.true_pain_label || "未标注"} · ${item.pain_authenticity || "未知"}`}
                  value={item.note_count}
                  max={maxPain}
                  detail={`均时效分 ${formatScore(item.avg_fresh_hot_score)} · ${arrayText(item.example_note_ids)}`}
                  tone="green"
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="side-column">
          <section className="panel">
            <SectionHeader icon={Users} title="目标人群" />
            <div className="stack">
              {(data?.personaDistribution || []).map((item) => (
                <BarRow key={item.target_persona} label={item.target_persona} value={item.note_count} max={maxPersona} detail={`均时效分 ${formatScore(item.avg_fresh_hot_score)}`} />
              ))}
            </div>
          </section>

          <section className="panel">
            <SectionHeader icon={FileText} title="漏斗结构" />
            <div className="funnel-list">
              {(data?.funnelDistribution || []).map((item) => (
                <div className="funnel-item" key={item.funnel_role}>
                  <span>{item.funnel_role || "未标注"}</span>
                  <strong>{formatNumber(item.note_count)}</strong>
                  <small>{formatScore(item.avg_fresh_hot_score)}</small>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="lower-grid">
        <section className="panel">
          <SectionHeader icon={Database} title="行业机会" />
          <div className="stack">
            {(data?.industryDistribution || []).map((item) => (
              <BarRow key={item.industry} label={item.industry} value={item.note_count} max={maxIndustry} detail={`均时效分 ${formatScore(item.avg_fresh_hot_score)}`} tone="amber" />
            ))}
          </div>
        </section>

        <section className="panel">
          <SectionHeader icon={Sparkles} title="视觉资产" />
          <div className="stack">
            {(data?.visualPatterns || []).map((item, index) => (
              <BarRow
                key={`${item.information_density_level}-${item.visual_main_colors}-${index}`}
                label={`${item.information_density_level || "未标注"} · ${item.visual_main_colors || "无主色"}`}
                value={item.note_count}
                max={maxVisual}
                detail={item.visual_emotion || `均时效分 ${formatScore(item.avg_fresh_hot_score)}`}
                tone="purple"
              />
            ))}
          </div>
        </section>

        <section className="panel">
          <SectionHeader icon={Activity} title="最近内容资产总结" />
          <div className="run-list">
            {(data?.recentRuns || []).map((item) => (
              <div className="run-item" key={item.run_id}>
                <div>
                  <strong>#{item.run_id}</strong>
                  <span>{item.note_id}</span>
                </div>
                <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
                <small>{formatDuration(item.latency_ms)}</small>
              </div>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}

function OpsDashboard({ data }) {
  const [range, setRange] = useState("daily");
  const [provider, setProvider] = useState("all");
  const [model, setModel] = useState("all");
  const [detailProvider, setDetailProvider] = useState("all");
  const [detailStatus, setDetailStatus] = useState("failed");
  const [copiedReasonKey, setCopiedReasonKey] = useState("");
  const [chartMonth, setChartMonth] = useState("latest");
  const [visibleDays, setVisibleDays] = useState(14);
  const ops = data?.ops || {};
  const endataBalance = ops.endataBalance || {};
  const apiRows = ops.apiStatusSummary || [];
  const providerLabelByCode = useMemo(() => new Map(apiRows.map((item) => [item.provider_code, providerDisplayName(item)])), [apiRows]);
  const recentApiRows = (ops.recentApiCalls || []).map((item) => ({
    ...item,
    provider_label: providerLabelByCode.get(item.provider_code) || providerDisplayName(item),
  }));
  const detailRows = recentApiRows.filter((item) => {
    const providerMatched = detailProvider === "all" || item.provider_code === detailProvider;
    const statusMatched =
      detailStatus === "all" ||
      item.status === detailStatus ||
      (detailStatus === "failed" && item.status !== "success");
    return providerMatched && statusMatched;
  });
  const failureReasons = (ops.apiFailureReasons || []).filter((item) => detailProvider === "all" || item.provider_code === detailProvider);
  const rawUsageRows = (ops.apiUsage?.[range] || []).map((item) => ({
    ...item,
    bucket_start: normalizeBucketStart(item.bucket_start, range),
    provider_label: providerLabelByCode.get(item.provider_code) || providerDisplayName(item),
    model_label: item.model_name || providerLabelByCode.get(item.provider_code) || providerDisplayName(item),
  }));
  const monthOptions = useMemo(() => {
    const months = new Map();
    rawUsageRows.forEach((item) => {
      const key = getMonthKey(item.bucket_start);
      if (!key) return;
      const current = months.get(key) || { value: key, latest: 0, count: 0 };
      current.latest = Math.max(current.latest, new Date(item.bucket_start).getTime());
      current.count += Number(item.calls_total || 0);
      months.set(key, current);
    });
    return Array.from(months.values()).sort((a, b) => b.latest - a.latest);
  }, [rawUsageRows]);
  useEffect(() => {
    if (chartMonth !== "latest" && !monthOptions.some((item) => item.value === chartMonth)) {
      setChartMonth("latest");
    }
  }, [chartMonth, monthOptions]);
  const activeMonth = chartMonth === "latest" ? monthOptions[0]?.value || "" : chartMonth;
  const monthRows = rawUsageRows.filter((item) => getMonthKey(item.bucket_start) === activeMonth);
  const monthEndDate = monthRows.length
    ? new Date(Math.max(...monthRows.map((item) => new Date(item.bucket_start).getTime())))
    : null;
  const activeMonthStart = activeMonth ? new Date(Number(activeMonth.slice(0, 4)), Number(activeMonth.slice(5, 7)) - 1, 1) : null;
  const windowEnd = monthEndDate ? dayStart(monthEndDate) : null;
  const requestedWindowStart = windowEnd ? addDays(windowEnd, -(visibleDays - 1)) : null;
  const windowStart =
    requestedWindowStart && activeMonthStart && requestedWindowStart < activeMonthStart ? activeMonthStart : requestedWindowStart;
  const windowEndExclusive = windowEnd ? addDays(windowEnd, 1) : null;
  const bucketDomain =
    windowStart && monthEndDate && range !== "weekly" ? buildBucketDomain(windowStart, range === "hourly" ? monthEndDate : windowEnd, range) : [];
  const usageRows = monthRows.filter((item) => {
    if (!windowStart || !windowEndExclusive) return true;
    const bucketDate = new Date(item.bucket_start);
    return bucketDate >= windowStart && bucketDate < windowEndExclusive;
  });
  const chartMonthOptions = [
    { value: "latest", label: activeMonth ? `最近月份（${monthLabel(activeMonth)}）` : "最近月份" },
    ...monthOptions.map((item) => ({ value: item.value, label: `${monthLabel(item.value)} · ${formatCompact(item.count)}次` })),
  ];
  const rangeLabel = range === "hourly" ? "小时" : range === "daily" ? "日期" : "周";
  const providerOptions = [
    { value: "all", label: "全部 API" },
    ...apiRows.map((item) => ({ value: item.provider_code, label: providerDisplayName(item) })),
  ];
  const modelRows = (ops.modelUsageSummary || []).filter((item) => ["llm_chat", "llm_vision", "embedding", "speech_to_text"].includes(item.provider_type));
  const modelOptions = [
    { value: "all", label: "全部模型" },
    ...Array.from(new Map(modelRows.map((item) => [item.model_name, { value: item.model_name, label: modelDisplayName(item) }])).values()),
  ];
  const filteredUsage = usageRows.filter((item) => provider === "all" || item.provider_code === provider);
  const providerBaseRows = monthRows.filter((item) => provider === "all" || item.provider_code === provider);
  const providerSeriesDomain = Array.from(
    new Map(providerBaseRows.map((item) => [item.provider_code, { id: item.provider_code, label: item.provider_label }])).values(),
  );
  const modelUsage = usageRows.filter((item) => {
    const isModel = ["llm_chat", "llm_vision", "embedding", "speech_to_text"].includes(item.provider_type);
    return isModel && (model === "all" || item.model_name === model);
  });
  const modelBaseRows = monthRows.filter((item) => {
    const isModel = ["llm_chat", "llm_vision", "embedding", "speech_to_text"].includes(item.provider_type);
    return isModel && item.model_name && (model === "all" || item.model_name === model);
  });
  const modelSeriesDomain = Array.from(
    new Map(modelBaseRows.map((item) => [item.model_name, { id: item.model_name, label: item.model_label }])).values(),
  );

  function failureReasonText(item) {
    return [
      `API：${providerLabelByCode.get(item.provider_code) || providerDisplayName(item)}`,
      `状态：${item.status}`,
      `错误码：${item.error_code || "-"}`,
      `次数：${formatNumber(item.count)}`,
      `首次发生：${formatDateTimeSecond(item.first_started_at)}`,
      `最近发生：${formatDateTimeSecond(item.latest_started_at)}`,
      `原因：${item.error_message || "-"}`,
    ].join("\n");
  }

  async function copyFailureReason(item, key) {
    try {
      await navigator.clipboard?.writeText(failureReasonText(item));
    } catch {
      return;
    }
    setCopiedReasonKey(key);
    window.setTimeout(() => setCopiedReasonKey(""), 1200);
  }

  function handleApiComboSelect(providerCode, status) {
    setDetailProvider(providerCode);
    setDetailStatus(status);
  }

  return (
    <>
      <section className="chart-time-toolbar">
        <div className="chart-time-meta">
          <strong>曲线时间窗口</strong>
          <span>
            {activeMonth ? monthLabel(activeMonth) : "暂无月份"} · {formatShortDate(windowStart)} - {formatShortDate(windowEnd)} · 最长近30天
          </span>
        </div>
        <div className="header-actions">
          <SelectControl value={chartMonth} onChange={setChartMonth} options={chartMonthOptions} label="月份" />
          <SegmentedControl
            value={range}
            onChange={setRange}
            options={[
              { value: "hourly", label: "时" },
              { value: "daily", label: "日" },
              { value: "weekly", label: "周" },
            ]}
          />
        </div>
      </section>

      <section className="ops-grid">
        <section className="panel ops-chart">
          <SectionHeader
            icon={BarChart3}
            title="API 调用曲线"
            action={
              <div className="header-actions">
                <SelectControl value={provider} onChange={setProvider} options={providerOptions} label="API" />
              </div>
            }
          />
          <LineChart
            rows={filteredUsage}
            seriesKey="provider_code"
            seriesLabelKey="provider_label"
            seriesDomain={providerSeriesDomain}
            bucketDomain={bucketDomain}
            bucketLabel={rangeLabel}
            yLabel="调用次数"
          />
        </section>

        <section className="panel ops-chart">
          <SectionHeader
            icon={Brain}
            title="大模型与 Embedding Tokens"
            action={<SelectControl value={model} onChange={setModel} options={modelOptions} label="模型" />}
          />
          <LineChart
            rows={modelUsage}
            seriesKey="model_name"
            seriesLabelKey="model_label"
            seriesDomain={modelSeriesDomain}
            bucketDomain={bucketDomain}
            valueKey="total_tokens"
            bucketLabel={rangeLabel}
            yLabel="Tokens 消耗量"
            emptyLabel="暂无 tokens 消耗数据"
          />
        </section>
      </section>

      <TimeWindowSlider days={visibleDays} onChange={setVisibleDays} startDate={windowStart} endDate={windowEnd} />

      <section className="ops-grid ops-grid-uneven">
        <section className="panel ops-equal-panel api-overview-panel">
          <SectionHeader icon={Activity} title="API 调用概况" />
          <ApiStatusComboChart
            rows={apiRows}
            selectedProvider={detailProvider}
            selectedStatus={detailStatus}
            onSelect={handleApiComboSelect}
          />
        </section>

        <section className="panel ops-equal-panel script-status-panel">
          <SectionHeader icon={ListChecks} title="脚本运行状态" />
          <div className="script-grid">
            {(ops.scriptRunSummary || []).map((item) => (
              <div className="script-card" key={item.script_key}>
                <div className="script-card-top">
                  <strong>{item.display_name_cn || item.script_key}</strong>
                  <StatusPill tone={statusTone(item.latest_status)}>{item.latest_status || "none"}</StatusPill>
                </div>
                <p>{item.description_cn}</p>
                <div className="script-card-meta">
                  <span>{item.service_name || item.script_key}</span>
                  <span>运行 {formatNumber(item.runs_total)}</span>
                  <span>失败 {formatNumber(item.failed_count)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="ops-grid ops-grid-uneven">
        <section className="panel panel-table">
          <SectionHeader
            icon={detailStatus === "success" ? CheckCircle2 : XCircle}
            title="API 调用下钻"
            action={
              <div className="header-actions">
                <SelectControl value={detailProvider} onChange={setDetailProvider} options={providerOptions} label="API" />
                <SegmentedControl
                  value={detailStatus}
                  onChange={setDetailStatus}
                  options={[
                    { value: "failed", label: "失败" },
                    { value: "success", label: "成功" },
                    { value: "all", label: "全部" },
                  ]}
                />
              </div>
            }
          />
          <div className="table-wrap api-detail-scroll">
            <table className="api-detail-table">
              <thead>
                <tr>
                  <th>调用</th>
                  <th>状态</th>
                  <th>笔记</th>
                  <th>模型</th>
                  <th>时间</th>
                  <th>耗时</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.slice(0, 80).map((item) => (
                  <tr key={item.api_call_id}>
                    <td>
                      <div className="note-title">{item.provider_label || providerDisplayName(item)}</div>
                      <div className="note-meta">{item.operation}</div>
                    </td>
                    <td>
                      <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
                    </td>
                    <td>
                      <div className="note-title">{item.note_title || "无标题/未抓到详情"}</div>
                      <div className="note-meta">{item.note_id || "-"}</div>
                    </td>
                    <td>{item.model_name || "-"}</td>
                    <td>{formatDateTimeSecond(item.started_at)}</td>
                    <td>{formatDuration(item.latency_ms)}</td>
                    <td>
                      <div className="clamped">{item.error_message || item.error_code || "-"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <SectionHeader icon={AlertTriangle} title="失败原因聚合" />
          <div className="ops-table-list failure-reason-scroll">
            {failureReasons.length ? (
              failureReasons.map((item, index) => {
                const reasonKey = `${item.provider_code}-${item.status}-${item.error_code}-${index}`;
                return (
                  <div className="failure-reason-card" key={reasonKey}>
                    <div className="failure-reason-top">
                      <div>
                        <strong>{providerLabelByCode.get(item.provider_code) || providerDisplayName(item)}</strong>
                        <span>
                          {item.status} · {item.error_code || "unknown"} · {formatNumber(item.count)} 次
                        </span>
                      </div>
                      <button className="copy-button" onClick={() => copyFailureReason(item, reasonKey)} type="button">
                        {copiedReasonKey === reasonKey ? "已复制" : "复制"}
                      </button>
                    </div>
                    <div className="failure-reason-time">
                      <span>首次：{formatDateTimeSecond(item.first_started_at)}</span>
                      <span>最近：{formatDateTimeSecond(item.latest_started_at)}</span>
                    </div>
                    <pre className="failure-reason-message">{item.error_message || "-"}</pre>
                  </div>
                );
              })
            ) : (
              <div className="empty-state">当前筛选下没有失败原因</div>
            )}
          </div>
        </section>
      </section>

      <section className="ops-grid ops-grid-uneven">
        <section className="panel">
          <SectionHeader icon={Clock3} title="最近脚本运行" />
          <div className="run-list run-list-tall">
            {(ops.recentScriptRuns || []).map((item) => (
              <div className="run-item" key={item.script_run_id}>
                <div>
                  <strong>{item.display_name_cn || item.script_key}</strong>
                  <span>
                    #{item.script_run_id} · {item.trigger_type} · {formatDate(item.started_at)}
                  </span>
                </div>
                <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
                <small>{formatDuration(item.duration_ms)}</small>
              </div>
            ))}
          </div>
        </section>

        <EndataCompactPanel endata={endataBalance} />
      </section>

      <EndataBalancePanel endata={endataBalance} />
    </>
  );
}

function ModelConfigView({ data }) {
  const ops = data?.ops || {};
  return (
    <>
      <section className="stats-grid stats-grid-three">
        <Stat icon={Brain} label="模型配置" value={formatNumber((ops.modelConfigs || []).length)} sub="豆包 chat / vision / embedding" />
        <Stat icon={KeyRound} label="Key 元数据" value={formatNumber((ops.credentials || []).length)} sub="只展示 secret_ref 和 mask" tone="teal" />
        <Stat icon={Gauge} label="限流规则" value={formatNumber((ops.rateLimitRules || []).length)} sub="provider / model / key" tone="amber" />
      </section>

      <section className="panel">
        <SectionHeader icon={Brain} title="模型配置" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>Provider</th>
                <th>角色</th>
                <th>默认</th>
                <th>温度</th>
                <th>Thinking</th>
                <th>维度</th>
              </tr>
            </thead>
            <tbody>
              {(ops.modelConfigs || []).map((item) => (
                <tr key={item.model_config_id}>
                  <td>
                    <div className="note-title">{item.display_name_cn || item.model_name}</div>
                    <div className="note-meta">{item.model_name}</div>
                  </td>
                  <td>{item.provider_display_name_cn || item.provider_code}</td>
                  <td>{providerTypeLabel(item.model_role)}</td>
                  <td>
                    <StatusPill tone={item.is_default ? "green" : "neutral"}>{item.is_default ? "默认" : "备用"}</StatusPill>
                  </td>
                  <td>{item.temperature ?? "-"}</td>
                  <td>{item.thinking_mode || "-"}</td>
                  <td>{item.dimensions || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ops-grid">
        <section className="panel">
          <SectionHeader icon={KeyRound} title="Key 元数据" />
          <div className="ops-table-list">
            {(ops.credentials || []).map((item) => (
              <div className="ops-row" key={item.credential_id}>
                <div>
                  <strong>{item.credential_name}</strong>
                  <span>
                    {item.provider_display_name_cn || item.provider_code} · {item.secret_ref}
                  </span>
                </div>
                <div className="ops-metrics">
                  <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
                  <small>{item.secret_mask}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <SectionHeader icon={Gauge} title="限流规则" />
          {(ops.rateLimitRules || []).length ? (
            <div className="ops-table-list">
              {ops.rateLimitRules.map((item) => (
                <div className="ops-row" key={item.rule_id}>
                  <div>
                    <strong>{item.rule_name}</strong>
                    <span>
                      {item.provider_code || "global"} · {item.period_seconds}s
                    </span>
                  </div>
                  <div className="ops-metrics">
                    <b>{item.max_calls ? `${formatNumber(item.max_calls)} calls` : "-"}</b>
                    <StatusPill tone={item.is_enabled ? "green" : "neutral"}>{item.is_enabled ? "enabled" : "off"}</StatusPill>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">暂无限流规则</div>
          )}
        </section>
      </section>
    </>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [activeView, setActiveView] = useState("content");

  async function loadDashboard(options = {}) {
    const isBackground = Boolean(options.background);
    if (!isBackground) {
      setLoading(true);
      setError("");
    }
    try {
      const response = await fetch("/api/dashboard");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "dashboard request failed");
      setData(payload);
    } catch (err) {
      setData((current) => current || sampleDashboard);
      if (!isBackground && !String(err.message || "").includes("Unexpected token '<'")) {
        setError(`使用样例数据预览：${err.message}`);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    const timer = window.setInterval(() => loadDashboard({ background: true }), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const isSample = data?.source === "sample";
  const activeTitle = navItems.find((item) => item.id === activeView)?.label || "内容资产";

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <strong>GEO XHS</strong>
              <span>Intelligence</span>
            </div>
          </div>
          <nav>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)} type="button">
                  <Icon size={17} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main>
          <header className="topbar">
            <div>
              <div className="eyebrow">
                <Sparkles size={15} />
                GEO XHS Intelligence
              </div>
              <h1>{activeTitle}</h1>
            </div>
            <div className="toolbar">
              {activeView === "content" ? (
                <div className="search-box">
                  <Search size={16} />
                  <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索标题、人群、行业、痛点" />
                </div>
              ) : null}
              <button className="icon-button" onClick={loadDashboard} disabled={loading} title="刷新数据" type="button">
                <RefreshCcw size={17} />
              </button>
            </div>
          </header>

          {isSample ? (
            <div className="notice">
              <AlertTriangle size={16} />
              当前为样例数据。部署到 Vercel 后配置 PostgreSQL 环境变量即可读取真实库。
            </div>
          ) : null}

          {error ? (
            <div className="notice notice-error">
              <AlertTriangle size={16} />
              {error}
            </div>
          ) : null}

          {activeView === "content" ? <ContentDashboard data={data} loading={loading} filter={filter} /> : null}
          {activeView === "ops" ? <OpsDashboard data={data} /> : null}
          {activeView === "models" ? <ModelConfigView data={data} /> : null}
        </main>
      </div>
      <ChatWidget />
    </>
  );
}
