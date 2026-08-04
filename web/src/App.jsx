import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  FileText,
  Filter,
  Gauge,
  KeyRound,
  Layers3,
  ListChecks,
  RefreshCcw,
  Search,
  Server,
  Sparkles,
  Target,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sampleDashboard } from "./sampleData.js";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const compactFormatter = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const navItems = [
  { id: "content", label: "内容资产", icon: Database },
  { id: "ops", label: "运行监控", icon: Gauge },
  { id: "models", label: "模型配置", icon: KeyRound },
];

const chartColors = ["#2764cf", "#087b76", "#a85e00", "#7153b8", "#bc3d3a", "#26814f"];
const providerLabels = {
  endata_xhs_note_detail: "Endata 详情抓取（按笔记ID抓标题/正文/互动）",
  volcengine_ark_vision: "豆包图片解析（首图/子图视觉信息）",
  volcengine_ark_chat: "豆包内容资产总结（痛点/人群/漏斗标签）",
  volcengine_ark_embedding: "豆包 Embedding（内容资产转向量）",
  kimi_chat: "Kimi 历史内容资产总结（旧模型记录）",
};

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return numberFormatter.format(Number(value));
}

function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "-";
  return compactFormatter.format(Number(value));
}

function formatDelta(value) {
  const number = Number(value || 0);
  if (number > 0) return `+${formatCompact(number)}`;
  if (number < 0) return `-${formatCompact(Math.abs(number))}`;
  return "0";
}

function formatScore(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(1);
}

function formatDate(value) {
  if (!value) return "-";
  return dateFormatter.format(new Date(value));
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

function LineChart({
  rows,
  seriesKey,
  seriesLabelKey = "display_name_cn",
  valueKey = "calls_total",
  bucketLabel = "时间桶",
  yLabel = "调用次数",
  emptyLabel = "暂无曲线数据",
}) {
  const [hoverBucket, setHoverBucket] = useState(null);
  const prepared = useMemo(() => {
    const buckets = [...new Set(rows.map((item) => item.bucket_start))].sort();
    const seriesIds = [...new Set(rows.map((item) => item[seriesKey] || item.provider_code || "unknown"))].filter(Boolean).slice(0, 8);
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
      const label = source?.[seriesLabelKey] || source?.display_name_cn || id;
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
  }, [rows, seriesKey, seriesLabelKey, valueKey]);

  if (!rows.length || !prepared.seriesData.length) {
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
        <Stat icon={Brain} label="内容资产" value={formatNumber(overview.assetSuccess)} sub={`总结成功 ${formatNumber(overview.kimiSuccessRuns)}`} tone="teal" />
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
  const ops = data?.ops || {};
  const overview = ops.overview || {};
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
  const usageRows = (ops.apiUsage?.[range] || []).map((item) => ({
    ...item,
    provider_label: providerLabelByCode.get(item.provider_code) || providerDisplayName(item),
    model_label: item.model_name || providerLabelByCode.get(item.provider_code) || providerDisplayName(item),
  }));
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
  const modelUsage = usageRows.filter((item) => {
    const isModel = ["llm_chat", "llm_vision", "embedding", "speech_to_text"].includes(item.provider_type);
    return isModel && (model === "all" || item.model_name === model);
  });

  function failureReasonText(item) {
    return [
      `API：${providerLabelByCode.get(item.provider_code) || providerDisplayName(item)}`,
      `状态：${item.status}`,
      `错误码：${item.error_code || "-"}`,
      `次数：${formatNumber(item.count)}`,
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

  return (
    <>
      <section className="stats-grid">
        <Stat icon={Gauge} label="API 调用" value={formatNumber(overview.apiCallsTotal)} sub={`失败 ${formatNumber(overview.apiCallsFailed || 0)}`} />
        <Stat icon={Brain} label="模型 Tokens" value={formatCompact(overview.totalTokens)} sub="按 provider usage 汇总" tone="teal" />
        <Stat icon={Server} label="运行脚本" value={formatNumber(overview.runningScripts)} sub={`活跃 API ${formatNumber(overview.activeProviders)}`} tone="purple" />
        <Stat icon={Cpu} label="模型配置" value={formatNumber(overview.activeModels)} sub="LLM / Vision / Embedding" tone="amber" />
      </section>

      <section className="ops-grid">
        <section className="panel ops-chart">
          <SectionHeader
            icon={BarChart3}
            title="API 调用曲线"
            action={
              <div className="header-actions">
                <SelectControl value={provider} onChange={setProvider} options={providerOptions} label="API" />
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
            }
          />
          <LineChart
            rows={filteredUsage}
            seriesKey="provider_code"
            seriesLabelKey="provider_label"
            bucketLabel={range === "hourly" ? "小时" : range === "daily" ? "日期" : "周"}
            yLabel="调用次数"
          />
        </section>

        <section className="panel ops-chart">
          <SectionHeader
            icon={Brain}
            title="大模型与 Embedding 曲线"
            action={<SelectControl value={model} onChange={setModel} options={modelOptions} label="模型" />}
          />
          <LineChart
            rows={modelUsage}
            seriesKey="model_name"
            seriesLabelKey="model_label"
            bucketLabel={range === "hourly" ? "小时" : range === "daily" ? "日期" : "周"}
            yLabel="调用次数"
          />
        </section>
      </section>

      <section className="ops-grid ops-grid-uneven">
        <section className="panel">
          <SectionHeader icon={Activity} title="API 调用概况" />
          <div className="ops-table-list">
            {apiRows.map((item) => (
              <div
                className={`ops-row ops-row-button ${detailProvider === item.provider_code ? "selected" : ""}`}
                key={item.provider_code}
                onClick={() => setDetailProvider(item.provider_code)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setDetailProvider(item.provider_code);
                }}
                role="button"
                tabIndex={0}
              >
                <div>
                  <strong>{providerDisplayName(item)}</strong>
                  <span>
                    {providerTypeLabel(item.provider_type)} · {item.billing_unit || "call"} · 涉及笔记 {formatNumber(item.notes_total)}
                  </span>
                </div>
                <div className="ops-metrics">
                  <b>{formatNumber(item.calls_total)}</b>
                  <button
                    className="metric-button metric-success"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetailProvider(item.provider_code);
                      setDetailStatus("success");
                    }}
                    type="button"
                  >
                    成功 {formatNumber(item.calls_success)}
                  </button>
                  <button
                    className={`metric-button ${Number(item.calls_failed) ? "metric-failed" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetailProvider(item.provider_code);
                      setDetailStatus("failed");
                    }}
                    type="button"
                  >
                    业务/接口失败 {formatNumber(item.calls_failed)}
                  </button>
                  <small>{formatCompact(item.total_tokens)} tokens</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
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
          <div className="table-wrap">
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
                    <td>{formatDate(item.started_at)}</td>
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
          <div className="ops-table-list">
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

        <section className="panel">
          <SectionHeader icon={FileText} title="脚本事件流" />
          <div className="event-stream">
            {(ops.scriptEvents || []).map((event) => (
              <div className={`event-item event-${event.level}`} key={event.event_id}>
                <div>
                  <strong>{event.message}</strong>
                  <span>
                    {event.display_name_cn || event.script_key} · {event.event_type} · {formatDate(event.event_time)}
                  </span>
                </div>
                <StatusPill tone={event.level === "error" ? "red" : "neutral"}>{event.level}</StatusPill>
              </div>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}

function ModelConfigView({ data }) {
  const ops = data?.ops || {};
  return (
    <>
      <section className="stats-grid stats-grid-three">
        <Stat icon={Brain} label="模型配置" value={formatNumber((ops.modelConfigs || []).length)} sub="chat / vision / embedding" />
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

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "dashboard request failed");
      setData(payload);
    } catch (err) {
      setData(sampleDashboard);
      if (!String(err.message || "").includes("Unexpected token '<'")) {
        setError(`使用样例数据预览：${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const isSample = data?.source === "sample";
  const activeTitle = navItems.find((item) => item.id === activeView)?.label || "内容资产";

  return (
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
  );
}
