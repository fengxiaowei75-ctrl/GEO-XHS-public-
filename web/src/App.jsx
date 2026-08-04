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

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return numberFormatter.format(Number(value));
}

function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "-";
  return compactFormatter.format(Number(value));
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

function LineChart({ rows, seriesKey, valueKey = "calls_total", emptyLabel = "暂无曲线数据" }) {
  const prepared = useMemo(() => {
    const buckets = [...new Set(rows.map((item) => item.bucket_start))].sort();
    const series = [...new Set(rows.map((item) => item[seriesKey] || item.provider_code || "unknown"))].slice(0, 6);
    const maxValue = Math.max(1, ...rows.map((item) => Number(item[valueKey] || 0)));
    const bucketIndex = new Map(buckets.map((bucket, index) => [bucket, index]));
    const width = 720;
    const height = 230;
    const padX = 28;
    const padY = 24;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const paths = series.map((name, seriesIndex) => {
      const points = buckets.map((bucket) => {
        const value = rows
          .filter((item) => (item[seriesKey] || item.provider_code || "unknown") === name && item.bucket_start === bucket)
          .reduce((sum, item) => sum + Number(item[valueKey] || 0), 0);
        const x = padX + (buckets.length <= 1 ? innerW / 2 : (bucketIndex.get(bucket) / (buckets.length - 1)) * innerW);
        const y = padY + innerH - (value / maxValue) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return {
        name,
        color: chartColors[seriesIndex % chartColors.length],
        d: points.length ? `M ${points.join(" L ")}` : "",
      };
    });
    return { buckets, paths, width, height, maxValue };
  }, [rows, seriesKey, valueKey]);

  if (!rows.length || !prepared.paths.length) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${prepared.width} ${prepared.height}`} role="img">
        <line x1="28" x2="692" y1="206" y2="206" className="chart-axis" />
        <line x1="28" x2="28" y1="24" y2="206" className="chart-axis" />
        <line x1="28" x2="692" y1="115" y2="115" className="chart-grid" />
        {prepared.paths.map((path) => (
          <path key={path.name} d={path.d} fill="none" stroke={path.color} strokeWidth="3" strokeLinecap="round" />
        ))}
      </svg>
      <div className="chart-legend">
        {prepared.paths.map((path) => (
          <span key={path.name}>
            <i style={{ background: path.color }} />
            {path.name}
          </span>
        ))}
      </div>
      <div className="chart-scale">峰值 {formatCompact(prepared.maxValue)}</div>
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
        <Stat icon={Brain} label="Kimi 资产" value={formatNumber(overview.assetSuccess)} sub={`成功运行 ${formatNumber(overview.kimiSuccessRuns)}`} tone="teal" />
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
          <SectionHeader icon={Activity} title="最近 Kimi 运行" />
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
  const ops = data?.ops || {};
  const overview = ops.overview || {};
  const apiRows = ops.apiStatusSummary || [];
  const usageRows = ops.apiUsage?.[range] || [];
  const providerOptions = [
    { value: "all", label: "全部 API" },
    ...apiRows.map((item) => ({ value: item.provider_code, label: item.display_name_cn || item.provider_code })),
  ];
  const modelRows = (ops.modelUsageSummary || []).filter((item) => ["llm_chat", "llm_vision", "embedding", "speech_to_text"].includes(item.provider_type));
  const modelOptions = [
    { value: "all", label: "全部模型" },
    ...modelRows.map((item) => ({ value: item.model_name, label: item.model_name })),
  ];
  const filteredUsage = usageRows.filter((item) => provider === "all" || item.provider_code === provider);
  const modelUsage = usageRows.filter((item) => {
    const isModel = ["llm_chat", "llm_vision", "embedding", "speech_to_text"].includes(item.provider_type);
    return isModel && (model === "all" || item.model_name === model);
  });

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
          <LineChart rows={filteredUsage} seriesKey="provider_code" />
        </section>

        <section className="panel ops-chart">
          <SectionHeader
            icon={Brain}
            title="大模型与 Embedding 曲线"
            action={<SelectControl value={model} onChange={setModel} options={modelOptions} label="模型" />}
          />
          <LineChart rows={modelUsage} seriesKey="model_name" />
        </section>
      </section>

      <section className="ops-grid ops-grid-uneven">
        <section className="panel">
          <SectionHeader icon={Activity} title="API 调用概况" />
          <div className="ops-table-list">
            {apiRows.map((item) => (
              <div className="ops-row" key={item.provider_code}>
                <div>
                  <strong>{item.display_name_cn || item.provider_code}</strong>
                  <span>
                    {providerTypeLabel(item.provider_type)} · {item.billing_unit || "call"}
                  </span>
                </div>
                <div className="ops-metrics">
                  <b>{formatNumber(item.calls_total)}</b>
                  <StatusPill tone={Number(item.calls_failed) ? "red" : "green"}>失败 {formatNumber(item.calls_failed)}</StatusPill>
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
