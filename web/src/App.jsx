import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  Database,
  FileText,
  Filter,
  Layers3,
  RefreshCcw,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sampleDashboard } from "./sampleData.js";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatNumber(value) {
  if (value === null || value === undefined) return "-";
  return numberFormatter.format(Number(value));
}

function formatScore(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toFixed(1);
}

function formatDate(value) {
  if (!value) return "-";
  return dateFormatter.format(new Date(value));
}

function arrayText(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.join(" / ");
  return String(value);
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
                <StatusPill
                  tone={
                    item.funnel_role === "转化"
                      ? "green"
                      : item.funnel_role === "信任"
                        ? "blue"
                        : "amber"
                  }
                >
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

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

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
  const isSample = data?.source === "sample";

  return (
    <main>
      <header className="topbar">
        <div>
          <div className="eyebrow">
            <Sparkles size={15} />
            GEO XHS Intelligence
          </div>
          <h1>内容资产驾驶舱</h1>
        </div>
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜索标题、人群、行业、痛点"
            />
          </div>
          <button className="icon-button" onClick={loadDashboard} disabled={loading} title="刷新数据">
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
                <BarRow
                  key={item.target_persona}
                  label={item.target_persona}
                  value={item.note_count}
                  max={maxPersona}
                  detail={`均时效分 ${formatScore(item.avg_fresh_hot_score)}`}
                />
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
              <BarRow
                key={item.industry}
                label={item.industry}
                value={item.note_count}
                max={maxIndustry}
                detail={`均时效分 ${formatScore(item.avg_fresh_hot_score)}`}
                tone="amber"
              />
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
                <StatusPill tone={item.status === "success" ? "green" : "red"}>{item.status}</StatusPill>
                <small>{item.latency_ms ? `${Math.round(item.latency_ms / 1000)}s` : "-"}</small>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
