import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Filter,
  Gauge,
  Heart,
  KeyRound,
  Layers3,
  ListChecks,
  LogOut,
  MessageCircle,
  RefreshCcw,
  Save,
  Search,
  Shield,
  Sparkles,
  Target,
  UserPlus,
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
  { id: "content", label: "GEO红书需求洞察", icon: Database, permission: "content" },
  { id: "ops", label: "运行监控", icon: Gauge, permission: "ops" },
  { id: "models", label: "模型配置", icon: KeyRound, permission: "models" },
  { id: "admin", label: "管理员配置", icon: Shield, permission: "admin" },
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

function listItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      return [text];
    }
    return [text];
  }
  return [value];
}

const detailFieldLabels = {
  point: "知识点",
  explanation: "解释",
  reuse_angle: "复用方向",
  angle: "角度",
  suitable_persona: "适合人群",
  suggested_funnel_role: "漏斗作用",
  why_it_works: "有效原因",
};

function structuredText(item) {
  if (!item) return "";
  if (typeof item !== "object") return String(item);
  return Object.entries(item)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${detailFieldLabels[key] || key}：${arrayText(value)}`)
    .join("；");
}

function firstStructuredText(value, fallback = "") {
  const first = listItems(value)[0];
  return first ? structuredText(first) : fallback;
}

function textPreview(value, max = 150) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function noteContentText(item) {
  return item?.content_excerpt || item?.asset_text_excerpt || item?.content_logic || item?.business_logic || "";
}

function dateKeyFromValue(value) {
  if (!value) return "";
  const matched = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (matched) return matched[1];
  return localDateInputValue(value);
}

function formatDayLabel(value) {
  const key = dateKeyFromValue(value);
  if (!key) return "-";
  return `${key.slice(5, 7)}/${key.slice(8, 10)}`;
}

function noteDateKey(item) {
  return dateKeyFromValue(item?.note_date || item?.publish_time);
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

function canAccess(user, permission) {
  return Boolean(user && (user.role === "admin" || user.permissions?.[permission] === true));
}

function firstAllowedView(user) {
  return navItems.find((item) => canAccess(user, item.permission))?.id || "content";
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

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
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

function localDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function todayInputValue() {
  return localDateInputValue(new Date());
}

function rangeForLastDays(days, endValue = "") {
  const end = endValue ? new Date(`${endValue}T00:00:00`) : new Date();
  if (Number.isNaN(end.getTime())) return { start: "", end: "" };
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, Number(days || 1)) + 1);
  return {
    start: localDateInputValue(start),
    end: localDateInputValue(end),
  };
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

function LoginScreen({ onLogin, loading, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    await onLogin(username.trim(), password);
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand-block login-brand">
          <div className="brand-icon">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>GEO XHS</strong>
            <span>Intelligence</span>
          </div>
        </div>
        <div className="login-form">
          <label>
            <span>账号</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            登录
          </button>
          {error ? <div className="login-error">{error}</div> : null}
        </div>
      </form>
    </main>
  );
}

function insightSearchText(item) {
  return [
    item.title,
    item.note_id,
    item.note_date,
    item.content_excerpt,
    item.author_nickname,
    item.note_type,
    item.core_topic_category,
    item.primary_target_persona,
    arrayText(item.target_persona_tags),
    item.primary_industry,
    arrayText(item.industry_tags),
    item.funnel_role,
    item.true_pain_label,
    item.pain_description,
    item.business_logic,
    item.content_logic,
    arrayText(item.hook_types),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

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

function InsightNoteTable({ rows, compact = false }) {
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

function TopicFrequencyList({ rows }) {
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

function PersonaPieChart({ rows, selectedPersona, onSelect }) {
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

const contentMetricCards = [
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

function InsightMetricCard({ icon: Icon, label, value, sub, tone, sparkRows, sparkKey }) {
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

function ContentTrendChart({ rows, selectedDate, onSelectDate }) {
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

function NoteMetricChip({ label, value }) {
  return (
    <span className="note-metric-chip">
      <em>{label}</em>
      <strong>{formatNumber(value)}</strong>
    </span>
  );
}

function DailyNoteRail({ date, notes, selectedNoteId, onSelectNote }) {
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

function TagLine({ values }) {
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

function NoteAnalysisBoard({ note, onClose }) {
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

function clusterNotePayload(item) {
  return {
    note_id: item.note_id,
    title: item.title,
    content_excerpt: noteContentText(item),
    core_topic_category: item.core_topic_category,
    note_type: item.note_type,
    primary_target_persona: item.primary_target_persona,
    true_pain_label: item.true_pain_label,
    pain_description: item.pain_description,
    hook_types: listItems(item.hook_types),
    business_logic: item.business_logic,
    content_logic: item.content_logic,
    reusable_angles_preview: firstStructuredText(item.reusable_angles),
    interaction_score: Number(item.interaction_score || 0),
    like_count: Number(item.like_count || 0),
    collected_count: Number(item.collected_count || 0),
    comments_count: Number(item.comments_count || 0),
  };
}

function clusterCacheKey(rows, persona, rangeLabel) {
  const noteKey = rows
    .slice()
    .sort((a, b) => Number(b.interaction_score || 0) - Number(a.interaction_score || 0))
    .slice(0, 80)
    .map((item) => `${item.note_id}:${item.interaction_score || 0}`)
    .join("|");
  return `geo_cluster_map:${rangeLabel}:${persona || "all"}:${noteKey}`;
}

function localMindMapFromRows(rows, persona) {
  const groups = new Map();
  rows.forEach((item) => {
    const name = item.core_topic_category || item.note_type || "未标注主题";
    const current = groups.get(name) || { name, notes: [], interaction: 0 };
    current.notes.push(item);
    current.interaction += Number(item.interaction_score || 0);
    groups.set(name, current);
  });
  const clusters = Array.from(groups.values())
    .sort((a, b) => b.interaction - a.interaction)
    .slice(0, 6)
    .map((group, index) => {
      const topNote = group.notes.sort((a, b) => Number(b.interaction_score || 0) - Number(a.interaction_score || 0))[0] || {};
      return {
        id: `local_${index + 1}`,
        name: group.name,
        insight: topNote.content_logic || topNote.business_logic || "本类内容围绕同一主题反复教育用户认知。",
        anxiety: topNote.true_pain_label || topNote.pain_description || "用户焦虑点待补充",
        what_marketers_say: topNote.core_topic_category || group.name,
        recommended_action: topNote.business_logic || "可沉淀为选题方向，并结合高互动笔记做脚本拆解。",
        weight: Math.min(100, Math.round(Math.log10(group.interaction + 10) * 25)),
        note_ids: group.notes.slice(0, 5).map((item) => item.note_id),
        children: [
          { id: `${index + 1}_pain`, name: "用户焦虑", insight: topNote.true_pain_label || topNote.pain_description || "-", weight: 80 },
          { id: `${index + 1}_reuse`, name: "复用角度", insight: firstStructuredText(topNote.reusable_angles, topNote.business_logic || "-"), weight: 70 },
        ],
      };
    });
  return {
    title: `${persona || "全部人群"}内容自然聚类`,
    summary: `基于当前周期 ${formatNumber(rows.length)} 条笔记生成的本地预览。线上点击会调用内容总结大模型生成更自然的聚类。`,
    clusters,
  };
}

function ClusterMindMap({ mindMap }) {
  if (!mindMap?.clusters?.length) return <div className="empty-state cluster-empty">暂无聚类导图</div>;
  return (
    <div className="cluster-map">
      <div className="cluster-root-node">
        <span>自然聚类</span>
        <strong>{mindMap.title || "内容聚类导图"}</strong>
        <p>{mindMap.summary || "-"}</p>
      </div>
      <div className="cluster-branch-list">
        {mindMap.clusters.map((cluster, index) => (
          <article className="cluster-branch" key={cluster.id || `${cluster.name}-${index}`}>
            <div className="cluster-branch-card">
              <div className="cluster-branch-head">
                <span>#{index + 1}</span>
                <strong>{cluster.name}</strong>
                <em>{Math.round(Number(cluster.weight || 0))}</em>
              </div>
              <p>{cluster.insight || "-"}</p>
              <div className="cluster-branch-grid">
                <section>
                  <h3>用户焦虑</h3>
                  <p>{cluster.anxiety || "-"}</p>
                </section>
                <section>
                  <h3>营销号在讲</h3>
                  <p>{cluster.what_marketers_say || "-"}</p>
                </section>
                <section>
                  <h3>运营动作</h3>
                  <p>{cluster.recommended_action || "-"}</p>
                </section>
              </div>
              <div className="cluster-note-ids">
                {(cluster.note_ids || []).slice(0, 5).map((noteId) => (
                  <span key={noteId}>{noteId}</span>
                ))}
              </div>
            </div>
            <div className="cluster-child-list">
              {(cluster.children || []).map((child) => (
                <div className="cluster-child" key={child.id || child.name}>
                  <strong>{child.name}</strong>
                  <p>{child.insight || "-"}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function NaturalClusterPanel({ rows, personas, selectedPersona, onPersonaChange, rangeLabel, source }) {
  const personaOptions = useMemo(
    () => [
      { value: "", label: "全部人群" },
      ...personas.map((item) => {
        const label = item.primary_target_persona || "未标注";
        return { value: label, label: `${label} · ${formatCompact(item.note_count)}` };
      }),
    ],
    [personas],
  );
  const scopedRows = useMemo(
    () => (selectedPersona ? rows.filter((item) => (item.primary_target_persona || "未标注") === selectedPersona) : rows),
    [rows, selectedPersona],
  );
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState(null);
  const cacheKey = useMemo(() => clusterCacheKey(scopedRows, selectedPersona, rangeLabel), [scopedRows, selectedPersona, rangeLabel]);

  useEffect(() => {
    setError("");
    setMeta(null);
    try {
      const cached = window.localStorage.getItem(cacheKey);
      const parsed = cached ? JSON.parse(cached) : null;
      setResult(parsed);
      if (parsed) setMeta({ cached: true, generatedAt: parsed.generatedAt, model: parsed.model, noteCount: parsed.noteCount, latencyMs: parsed.latencyMs });
    } catch {
      setResult(null);
    }
  }, [cacheKey]);

  async function generateMindMap() {
    setLoading(true);
    setError("");
    try {
      if (source === "sample") {
        const mindMap = localMindMapFromRows(scopedRows, selectedPersona || "全部人群");
        const next = { mindMap, generatedAt: new Date().toISOString(), model: "local-preview", noteCount: scopedRows.length };
        setResult(next);
        setMeta({ cached: false, generatedAt: next.generatedAt, model: next.model, noteCount: scopedRows.length });
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {
          // 缓存失败不影响本次导图展示。
        }
        return;
      }
      const notes = scopedRows
        .slice()
        .sort((a, b) => Number(b.interaction_score || 0) - Number(a.interaction_score || 0))
        .slice(0, 80)
        .map(clusterNotePayload);
      const payload = await requestJson("/api/content-cluster", {
        method: "POST",
        body: JSON.stringify({
          rangeLabel,
          persona: selectedPersona,
          notes,
          forceRefresh: true,
        }),
      });
      const next = {
        mindMap: payload.mindMap,
        generatedAt: payload.generatedAt,
        model: payload.model,
        noteCount: payload.noteCount,
        latencyMs: payload.latencyMs,
      };
      setResult(next);
      setMeta({ cached: false, generatedAt: payload.generatedAt, model: payload.model, noteCount: payload.noteCount, latencyMs: payload.latencyMs });
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(next));
      } catch {
        // 缓存失败不影响本次导图展示。
      }
    } catch (err) {
      setError(err.message || "聚类导图生成失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel cluster-panel">
      <SectionHeader
        icon={Brain}
        title="自然聚类思维导图"
        action={<SelectControl label="人群筛选" value={selectedPersona} onChange={onPersonaChange} options={personaOptions} />}
      />
      <div className="cluster-toolbar">
        <div>
          <strong>{selectedPersona || "全部人群"}</strong>
          <span>{rangeLabel} · {formatNumber(scopedRows.length)} 条笔记 · 最多发送互动最高的 80 条给模型</span>
        </div>
        <button className="primary-button cluster-generate-button" disabled={loading || !scopedRows.length} onClick={generateMindMap} type="button">
          {loading ? "生成中..." : result ? "重新生成导图" : "生成聚类导图"}
        </button>
      </div>
      {meta ? (
        <div className="cluster-meta">
          <span>{meta.cached ? "已显示浏览器缓存结果" : "最新模型结果"}</span>
          <span>{meta.model || "content model"}</span>
          {meta.latencyMs ? <span>{formatDuration(meta.latencyMs)}</span> : null}
          {meta.generatedAt ? <span>{formatDate(meta.generatedAt)}</span> : null}
        </div>
      ) : null}
      {error ? <div className="login-error cluster-error">{error}</div> : null}
      {loading && !result ? <div className="loading cluster-loading">大模型正在做自然聚类</div> : <ClusterMindMap mindMap={result?.mindMap} />}
    </section>
  );
}

function ContentDashboard({ data, loading, filter, contentStart, contentEnd, onContentRangeApply }) {
  const [selectedPersona, setSelectedPersona] = useState("");
  const [clusterPersona, setClusterPersona] = useState("");
  const [selectedTrendDate, setSelectedTrendDate] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [draftStart, setDraftStart] = useState(contentStart || "");
  const [draftEnd, setDraftEnd] = useState(contentEnd || "");
  const insight = data?.contentInsight || {};
  const overview = insight.overview || {};
  const topicRows = insight.topicFrequency || [];
  const personaRows = insight.personaDistribution || [];
  const noteRows = insight.noteAnalysis || [];
  const trendRows = insight.trendDaily || [];
  const sparkRows = insight.sparklineDaily || [];
  const keyword = filter.trim().toLowerCase();

  useEffect(() => {
    setDraftStart(contentStart || "");
    setDraftEnd(contentEnd || "");
  }, [contentStart, contentEnd]);

  useEffect(() => {
    if (!selectedPersona) return;
    const exists = personaRows.some((item) => (item.primary_target_persona || "未标注") === selectedPersona);
    if (!exists) setSelectedPersona("");
  }, [personaRows, selectedPersona]);

  useEffect(() => {
    if (!clusterPersona) return;
    const exists = personaRows.some((item) => (item.primary_target_persona || "未标注") === clusterPersona);
    if (!exists) setClusterPersona("");
  }, [personaRows, clusterPersona]);

  const trendDateKeys = useMemo(() => trendRows.map((item) => dateKeyFromValue(item.bucket_date)).filter(Boolean), [trendRows]);

  useEffect(() => {
    if (!trendDateKeys.length) {
      setSelectedTrendDate("");
      return;
    }
    if (!selectedTrendDate || !trendDateKeys.includes(selectedTrendDate)) {
      setSelectedTrendDate(trendDateKeys[trendDateKeys.length - 1]);
    }
  }, [selectedTrendDate, trendDateKeys]);

  const filteredNotes = useMemo(() => {
    if (!keyword) return noteRows;
    return noteRows.filter((item) => insightSearchText(item).includes(keyword));
  }, [keyword, noteRows]);

  const selectedDayNotes = useMemo(
    () =>
      filteredNotes
        .filter((item) => noteDateKey(item) === selectedTrendDate)
        .sort((a, b) => Number(b.interaction_score || 0) - Number(a.interaction_score || 0)),
    [filteredNotes, selectedTrendDate],
  );

  const personaDetailRows = useMemo(() => {
    if (!selectedPersona) return filteredNotes;
    return filteredNotes.filter((item) => (item.primary_target_persona || "未标注") === selectedPersona);
  }, [filteredNotes, selectedPersona]);

  const selectedNote = useMemo(
    () => selectedDayNotes.find((item) => item.note_id === selectedNoteId) || null,
    [selectedDayNotes, selectedNoteId],
  );

  useEffect(() => {
    if (selectedNoteId && !selectedNote) setSelectedNoteId("");
  }, [selectedNote, selectedNoteId]);

  const rangeStart = overview.minNoteDate || overview.minCapturedAt;
  const rangeEnd = overview.maxNoteDate || overview.maxCapturedAt;
  const rangeMeta = rangeStart
    ? `${formatDayLabel(rangeStart)} - ${formatDayLabel(rangeEnd)}`
    : "无数据";
  const activeRangeLabel =
    contentStart || contentEnd ? `${contentStart || "最早"} - ${contentEnd || "今天"}` : "累计";

  function applyQuickRange(days) {
    const maxNoteDate = /^\d{4}-\d{2}-\d{2}/.test(String(rangeEnd || "")) ? String(rangeEnd).slice(0, 10) : "";
    const end = maxNoteDate || draftEnd || todayInputValue();
    const next = rangeForLastDays(days, end);
    setDraftStart(next.start);
    setDraftEnd(next.end);
  }

  return (
    <>
      <section className="content-section">
        <div className="content-section-heading">
          <div>
            <div className="eyebrow">
              <BarChart3 size={15} />
              Note Data
            </div>
            <h2>笔记数据概览</h2>
          </div>
          <StatusPill tone="neutral">当前筛选 {activeRangeLabel}</StatusPill>
        </div>

        <section className="panel content-range-panel">
          <SectionHeader icon={Filter} title="周期筛选" />
          <div className="content-filter-row">
            <div className="content-range-actions">
              {[30, 90, 180].map((days) => (
                <button className="copy-button" onClick={() => applyQuickRange(days)} type="button" key={days}>
                  近{days}天
                </button>
              ))}
              <button
                className="copy-button"
                onClick={() => {
                  setDraftStart("");
                  setDraftEnd("");
                }}
                type="button"
              >
                清空
              </button>
            </div>
            <label>
              <span>开始日期</span>
              <input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} />
            </label>
            <label>
              <span>结束日期</span>
              <input type="date" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} />
            </label>
            <div className="content-range-meta">
              <span>数据范围</span>
              <strong>{rangeMeta}</strong>
            </div>
            <button className="primary-button content-apply-button" onClick={() => onContentRangeApply({ start: draftStart, end: draftEnd })} type="button">
              确定
            </button>
          </div>
        </section>

        <section className="stats-grid content-stats-grid">
          {contentMetricCards.map((item) => (
            <InsightMetricCard
              key={item.key}
              icon={item.icon}
              label={item.label}
              value={formatNumber(overview[item.overviewKey])}
              sub={item.sub}
              tone={item.tone}
              sparkRows={sparkRows}
              sparkKey={item.key}
            />
          ))}
        </section>

        <NaturalClusterPanel
          rows={noteRows}
          personas={personaRows}
          selectedPersona={clusterPersona}
          onPersonaChange={setClusterPersona}
          rangeLabel={activeRangeLabel}
          source={data?.source}
        />

        <section className="panel content-trend-panel">
          <SectionHeader icon={Activity} title="笔记数据表现分布" action={<StatusPill tone="neutral">{loading && !data ? "加载中" : `${formatNumber(trendRows.length)} 天`}</StatusPill>} />
          <ContentTrendChart
            rows={trendRows}
            selectedDate={selectedTrendDate}
            onSelectDate={(date) => {
              setSelectedTrendDate(date);
              setSelectedNoteId("");
            }}
          />
          <DailyNoteRail
            date={selectedTrendDate}
            notes={selectedDayNotes}
            selectedNoteId={selectedNoteId}
            onSelectNote={setSelectedNoteId}
          />
        </section>

        <section className="panel panel-table">
          <SectionHeader
            icon={FileText}
            title="笔记明细"
            action={<StatusPill tone="neutral">{loading && !data ? "加载中" : `${formatNumber(filteredNotes.length)} 条`}</StatusPill>}
          />
          {loading && !data ? <div className="loading">加载中</div> : <InsightNoteTable rows={filteredNotes} />}
        </section>
      </section>

      <section className="content-section">
        <div className="content-section-heading">
          <div>
            <div className="eyebrow">
              <Users size={15} />
              Demand Analysis
            </div>
            <h2>笔记类型及目标人群分析</h2>
          </div>
        </div>

        <section className="content-insight-grid">
          <section className="panel">
            <SectionHeader icon={Database} title="笔记类型占比" />
            <TopicFrequencyList rows={topicRows} />
          </section>

          <section className="panel">
            <SectionHeader icon={Users} title="目标人群占比" />
            <PersonaPieChart rows={personaRows} selectedPersona={selectedPersona} onSelect={setSelectedPersona} />
          </section>
        </section>

        <section className="panel panel-table persona-detail-panel">
          <SectionHeader
            icon={Target}
            title="人群笔记明细"
            action={<StatusPill tone={selectedPersona ? "blue" : "neutral"}>{selectedPersona || "全部人群"}</StatusPill>}
          />
          <InsightNoteTable rows={personaDetailRows} compact />
        </section>
      </section>
      <NoteAnalysisBoard note={selectedNote} onClose={() => setSelectedNoteId("")} />
    </>
  );
}

function OpsDashboard({ data, apiDate, onApiDateChange }) {
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
  const apiDateOptions = useMemo(() => {
    const days = new Map();
    (ops.apiUsage?.daily || []).forEach((item) => {
      const date = localDateInputValue(item.bucket_start);
      if (!date) return;
      days.set(date, Number(days.get(date) || 0) + Number(item.calls_total || 0));
    });
    return [
      { value: "", label: "累计" },
      ...Array.from(days.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, count]) => ({ value: date, label: `${date} · ${formatCompact(count)}次` })),
    ];
  }, [ops.apiUsage]);
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
          <SectionHeader
            icon={Activity}
            title="API 调用概况"
            action={<SelectControl value={apiDate || ""} onChange={onApiDateChange} options={apiDateOptions} label="日期" />}
          />
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
                      <div className="note-title">{item.note_title || item.note_id || "未抓到详情"}</div>
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

function emptyUserForm(permissionCatalog = {}) {
  return {
    user_id: "",
    username: "",
    password: "",
    role: "viewer",
    active: true,
    permissions: Object.fromEntries(Object.keys(permissionCatalog).map((key) => [key, key === "content" || key === "ops"])),
  };
}

function AdminConfigView({ currentUser, permissionCatalog }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(() => emptyUserForm(permissionCatalog));
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const permissionEntries = Object.entries(permissionCatalog || {});

  async function loadUsers() {
    setLoadingUsers(true);
    setMessage("");
    try {
      const payload = await requestJson("/api/admin/users");
      setUsers(payload.users || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setForm((current) => {
      const merged = { ...emptyUserForm(permissionCatalog), ...current };
      merged.permissions = { ...emptyUserForm(permissionCatalog).permissions, ...(current.permissions || {}) };
      return merged;
    });
  }, [permissionCatalog]);

  function resetForm() {
    setForm(emptyUserForm(permissionCatalog));
    setMessage("");
  }

  function editUser(user) {
    setForm({
      user_id: user.user_id,
      username: user.username || "",
      password: "",
      role: user.role || "viewer",
      active: user.active !== false,
      permissions: { ...emptyUserForm(permissionCatalog).permissions, ...(user.permissions || {}) },
    });
    setMessage(`正在编辑 ${user.username}`);
  }

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateRole(role) {
    setForm((current) => ({
      ...current,
      role,
      permissions: role === "admin" ? Object.fromEntries(permissionEntries.map(([key]) => [key, true])) : current.permissions,
    }));
  }

  function updatePermission(key, checked) {
    setForm((current) => ({
      ...current,
      permissions: { ...(current.permissions || {}), [key]: checked },
    }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        user_id: form.user_id || null,
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        active: form.active,
        permissions: form.permissions,
      };
      const result = await requestJson("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUsers(result.users || []);
      setMessage("已保存");
      if (!form.user_id) resetForm();
      else updateForm({ password: "" });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="stats-grid stats-grid-three">
        <Stat icon={Users} label="账号数量" value={formatNumber(users.length)} sub={loadingUsers ? "加载中" : "dashboard_users"} />
        <Stat
          icon={Shield}
          label="管理员"
          value={formatNumber(users.filter((user) => user.role === "admin").length)}
          sub={`当前 ${currentUser?.username || "-"}`}
          tone="teal"
        />
        <Stat
          icon={KeyRound}
          label="权限项"
          value={formatNumber(permissionEntries.length)}
          sub="页面级访问控制"
          tone="amber"
        />
      </section>

      <section className="admin-layout">
        <section className="panel">
          <SectionHeader
            icon={form.user_id ? Save : UserPlus}
            title={form.user_id ? "更新账号" : "创建账号"}
            action={
              <button className="copy-button" onClick={resetForm} type="button">
                新建
              </button>
            }
          />
          <form className="admin-form" onSubmit={save}>
            <label>
              <span>账号</span>
              <input value={form.username} onChange={(event) => updateForm({ username: event.target.value })} required />
            </label>
            <label>
              <span>{form.user_id ? "新密码" : "密码"}</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => updateForm({ password: event.target.value })}
                placeholder={form.user_id ? "留空不修改" : ""}
                required={!form.user_id}
              />
            </label>
            <div className="admin-form-row">
              <label>
                <span>角色</span>
                <select value={form.role} onChange={(event) => updateRole(event.target.value)}>
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label className="admin-check">
                <input checked={form.active} onChange={(event) => updateForm({ active: event.target.checked })} type="checkbox" />
                启用
              </label>
            </div>
            <div className="permission-grid">
              {permissionEntries.map(([key, label]) => (
                <label key={key} className={form.role === "admin" ? "disabled" : ""}>
                  <input
                    checked={form.role === "admin" || Boolean(form.permissions?.[key])}
                    disabled={form.role === "admin"}
                    onChange={(event) => updatePermission(key, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <button className="primary-button" disabled={saving} type="submit">
              保存账号
            </button>
            {message ? <div className="admin-message">{message}</div> : null}
          </form>
        </section>

        <section className="panel panel-table">
          <SectionHeader icon={Users} title="账号列表" />
          <div className="table-wrap">
            <table className="admin-user-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>权限</th>
                  <th>最近登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id}>
                    <td>
                      <div className="note-title">{user.username}</div>
                      <div className="note-meta">#{user.user_id}</div>
                    </td>
                    <td>{user.role}</td>
                    <td>
                      <StatusPill tone={user.active ? "green" : "neutral"}>{user.active ? "active" : "disabled"}</StatusPill>
                    </td>
                    <td>
                      <div className="admin-perm-tags">
                        {permissionEntries
                          .filter(([key]) => user.role === "admin" || user.permissions?.[key])
                          .map(([key, label]) => (
                            <span key={`${user.user_id}-${key}`}>{label}</span>
                          ))}
                      </div>
                    </td>
                    <td>{formatDateTimeSecond(user.last_login_at)}</td>
                    <td>
                      <button className="copy-button" onClick={() => editUser(user)} type="button">
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {!users.length ? (
                  <tr>
                    <td colSpan="6">{loadingUsers ? "加载中" : "暂无账号"}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [filter, setFilter] = useState("");
  const [activeView, setActiveView] = useState("content");
  const [apiDate, setApiDate] = useState("");
  const [contentStart, setContentStart] = useState("");
  const [contentEnd, setContentEnd] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [permissionCatalog, setPermissionCatalog] = useState({});

  async function loadSession() {
    setAuthLoading(true);
    try {
      const payload = await requestJson("/api/me");
      setPermissionCatalog(payload.permissions || {});
      if (payload.authenticated && payload.user) {
        setCurrentUser(payload.user);
        setActiveView((current) => (canAccess(payload.user, navItems.find((item) => item.id === current)?.permission) ? current : firstAllowedView(payload.user)));
      } else {
        setCurrentUser(null);
        setData(null);
      }
    } catch (err) {
      setCurrentUser(null);
      setLoginError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogin(username, password) {
    setLoginLoading(true);
    setLoginError("");
    try {
      const payload = await requestJson("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setPermissionCatalog(payload.permissions || {});
      setCurrentUser(payload.user);
      setActiveView(firstAllowedView(payload.user));
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await requestJson("/api/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // Local state still needs clearing even if the session was already expired.
    }
    setCurrentUser(null);
    setData(null);
    setError("");
    setLoginError("");
  }

  async function loadDashboard(options = {}) {
    if (!currentUser) return;
    const isBackground = Boolean(options.background);
    if (!isBackground) {
      setLoading(true);
      setError("");
    }
    try {
      const selectedApiDate = options.apiDateOverride ?? apiDate;
      const selectedContentStart = options.contentStartOverride ?? contentStart;
      const selectedContentEnd = options.contentEndOverride ?? contentEnd;
      const params = new URLSearchParams();
      if (selectedApiDate) params.set("apiDate", selectedApiDate);
      if (selectedContentStart) params.set("contentStart", selectedContentStart);
      if (selectedContentEnd) params.set("contentEnd", selectedContentEnd);
      const query = params.toString() ? `?${params.toString()}` : "";
      const payload = await requestJson(`/api/dashboard${query}`);
      setData(payload);
    } catch (err) {
      if (err.status === 401) {
        setCurrentUser(null);
        setData(null);
        return;
      }
      setData((current) => current || sampleDashboard);
      if (!isBackground && !String(err.message || "").includes("Unexpected token '<'")) {
        setError(`使用样例数据预览：${err.message}`);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (!currentUser) return undefined;
    loadDashboard();
    const timer = window.setInterval(() => loadDashboard({ background: true }), 30000);
    return () => window.clearInterval(timer);
  }, [currentUser?.user_id, apiDate, contentStart, contentEnd]);

  useEffect(() => {
    if (!currentUser) return;
    const item = navItems.find((navItem) => navItem.id === activeView);
    if (!item || !canAccess(currentUser, item.permission)) {
      setActiveView(firstAllowedView(currentUser));
    }
  }, [activeView, currentUser]);

  function handleApiDateChange(value) {
    setApiDate(value);
  }

  function handleContentRangeApply(nextRange) {
    if (Object.prototype.hasOwnProperty.call(nextRange, "start")) setContentStart(nextRange.start);
    if (Object.prototype.hasOwnProperty.call(nextRange, "end")) setContentEnd(nextRange.end);
  }

  const isSample = data?.source === "sample";
  const allowedNavItems = navItems.filter((item) => canAccess(currentUser, item.permission));
  const activeTitle = allowedNavItems.find((item) => item.id === activeView)?.label || allowedNavItems[0]?.label || "GEO XHS";

  if (authLoading) {
    return (
      <main className="login-screen">
        <div className="loading">加载中</div>
      </main>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={loginError} />;
  }

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
            {allowedNavItems.map((item) => {
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
              <span className="user-chip">
                {currentUser.username} · {currentUser.role}
              </span>
              {activeView === "content" ? (
                <div className="search-box">
                  <Search size={16} />
                  <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索标题、人群、主题、痛点" />
                </div>
              ) : null}
              <button className="icon-button" onClick={loadDashboard} disabled={loading} title="刷新数据" type="button">
                <RefreshCcw size={17} />
              </button>
              <button className="icon-button" onClick={handleLogout} title="退出登录" type="button">
                <LogOut size={17} />
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

          {activeView === "content" ? (
            <ContentDashboard
              data={data}
              loading={loading}
              filter={filter}
              contentStart={contentStart}
              contentEnd={contentEnd}
              onContentRangeApply={handleContentRangeApply}
            />
          ) : null}
          {activeView === "ops" ? <OpsDashboard data={data} apiDate={apiDate} onApiDateChange={handleApiDateChange} /> : null}
          {activeView === "models" ? <ModelConfigView data={data} /> : null}
          {activeView === "admin" ? <AdminConfigView currentUser={currentUser} permissionCatalog={permissionCatalog} /> : null}
        </main>
      </div>
      <ChatWidget />
    </>
  );
}
