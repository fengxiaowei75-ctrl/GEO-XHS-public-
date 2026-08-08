import { Gauge } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LineChart } from "../charts/LineChart";
import { StatusPill } from "../data/StatusPill";
import { SelectControl } from "../form/SelectControl";
import { SegmentedControl } from "../form/SegmentedControl";
import { SectionHeader } from "../layout/SectionHeader";
import { latestEndataSnapshot } from "../../utils/collections";
import { buildBucketDomain, dayStart, getMonthKey, latestBucketDate, localDateInputValue, monthLabel, normalizeBucketStart } from "../../utils/dates";
import { activeEndataPeriod, deltaClass, endataPeriodOptions, endataRangeLabel, formatDate, formatDateTimeSecond, formatDuration, formatMoney, formatMoneyDelta, formatNumber, formatPercent, formatSignedNumber } from "../../utils/formatters";

export function EndataCompactPanel({ endata }) {
  const snapshots = endata?.latestSnapshots || [];
  const endpoints = endata?.endpoints || [];
  const latestSnapshot = latestEndataSnapshot(snapshots, "today");
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

export function EndataBalancePanel({ endata }) {
  const [endataChartMode, setEndataChartMode] = useState("day");
  const [endataChartDay, setEndataChartDay] = useState("latest");
  const [endataChartMonth, setEndataChartMonth] = useState("latest");
  const snapshots = endata?.latestSnapshots || [];
  const endpoints = endata?.endpoints || [];
  const endpointHistoryHourly = (endata?.endpointHistoryHourly || endata?.endpointHistory || []).map((item) => ({
    ...item,
    bucket_start: normalizeBucketStart(item.bucket_start, "hourly"),
    period_key: item.period_key || localDateInputValue(item.bucket_start),
    display_name_cn: item.display_name_cn || item.url,
  }));
  const endpointHistoryDaily = (endata?.endpointHistoryDaily || []).map((item) => ({
    ...item,
    bucket_start: normalizeBucketStart(item.bucket_start, "daily"),
    period_key: item.period_key || getMonthKey(item.bucket_start),
    display_name_cn: item.display_name_cn || item.url,
  }));
  const scriptUsageHourly = (endata?.scriptUsageHourly || []).map((item) => ({
    ...item,
    bucket_start: normalizeBucketStart(item.bucket_start, "hourly"),
    period_key: item.period_key || localDateInputValue(item.bucket_start),
    display_name_cn: item.display_name_cn || item.script_key || "未记录脚本",
  }));
  const scriptUsageDaily = (endata?.scriptUsageDaily || []).map((item) => ({
    ...item,
    bucket_start: normalizeBucketStart(item.bucket_start, "daily"),
    period_key: item.period_key || getMonthKey(item.bucket_start),
    display_name_cn: item.display_name_cn || item.script_key || "未记录脚本",
  }));
  const latestSnapshot = latestEndataSnapshot(snapshots, "today");
  const monthSnapshot = latestEndataSnapshot(snapshots, "month");
  const dayOptions = useMemo(() => endataPeriodOptions([...endpointHistoryHourly, ...scriptUsageHourly], "day"), [endpointHistoryHourly, scriptUsageHourly]);
  const monthOptions = useMemo(() => endataPeriodOptions([...endpointHistoryDaily, ...scriptUsageDaily], "month"), [endpointHistoryDaily, scriptUsageDaily]);
  useEffect(() => {
    if (endataChartDay !== "latest" && !dayOptions.some((option) => option.value === endataChartDay)) setEndataChartDay("latest");
  }, [endataChartDay, dayOptions]);
  useEffect(() => {
    if (endataChartMonth !== "latest" && !monthOptions.some((option) => option.value === endataChartMonth)) setEndataChartMonth("latest");
  }, [endataChartMonth, monthOptions]);
  const isDayView = endataChartMode === "day";
  const activeDay = activeEndataPeriod(endataChartDay, dayOptions);
  const activeMonth = activeEndataPeriod(endataChartMonth, monthOptions);
  const activePeriod = isDayView ? activeDay : activeMonth;
  const endpointChartRows = (isDayView ? endpointHistoryHourly : endpointHistoryDaily).filter((item) => item.period_key === activePeriod);
  const scriptChartRows = (isDayView ? scriptUsageHourly : scriptUsageDaily).filter((item) => item.period_key === activePeriod);
  const chartBucketDomain = useMemo(() => {
    if (isDayView) {
      if (!activeDay) return [];
      const start = new Date(`${activeDay}T00:00:00`);
      const end = new Date(`${activeDay}T23:00:00`);
      return buildBucketDomain(start, end, "hourly");
    }
    if (!activeMonth) return [];
    const start = new Date(`${activeMonth}-01T00:00:00`);
    const latestDate = latestBucketDate([...endpointChartRows, ...scriptChartRows]);
    const end = latestDate ? dayStart(latestDate) : new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return buildBucketDomain(start, end, "daily");
  }, [isDayView, activeDay, activeMonth, endpointChartRows, scriptChartRows]);
  const chartBucketLabel = isDayView ? "小时" : "日期";
  const chartPeriodText = isDayView ? activeDay || "未选择日期" : monthLabel(activeMonth);
  const endpointSeriesDomain = useMemo(() => {
    const entries = endpointChartRows
      .filter((item) => item.url)
      .map((item) => [item.url, { id: item.url, label: item.display_name_cn || item.url }]);
    return Array.from(new Map(entries).values()).slice(0, 8);
  }, [endpointChartRows]);
  const scriptSeriesDomain = useMemo(() => {
    const entries = scriptChartRows
      .filter((item) => item.script_key)
      .map((item) => [item.script_key, { id: item.script_key, label: item.display_name_cn || item.script_key }]);
    return Array.from(new Map(entries).values()).slice(0, 8);
  }, [scriptChartRows]);
  const scriptSummary = useMemo(() => {
    const byScript = new Map();
    scriptChartRows.forEach((row) => {
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
  }, [scriptChartRows]);

  return (
    <section className="panel endata-panel">
      <SectionHeader
        icon={Gauge}
        title="艺恩余额与接口消耗"
        action={
          <div className="header-actions endata-toolbar">
            <StatusPill tone="neutral">30 秒刷新</StatusPill>
            <div className="endata-period-controls">
              <SegmentedControl
                value={endataChartMode}
                onChange={setEndataChartMode}
                options={[
                  { value: "day", label: "日" },
                  { value: "month", label: "月" },
                ]}
              />
              <SelectControl
                value={isDayView ? endataChartDay : endataChartMonth}
                onChange={isDayView ? setEndataChartDay : setEndataChartMonth}
                options={isDayView ? dayOptions : monthOptions}
                label={isDayView ? "日期" : "月份"}
              />
            </div>
          </div>
        }
      />

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
            <span>{chartPeriodText} · {isDayView ? "小时走势" : "每日走势"}</span>
          </div>
          <LineChart
            rows={endpointChartRows}
            seriesKey="url"
            seriesLabelKey="display_name_cn"
            seriesDomain={endpointSeriesDomain}
            bucketDomain={chartBucketDomain}
            bucketRange={isDayView ? "hourly" : "daily"}
            valueKey="count"
            bucketLabel={chartBucketLabel}
            yLabel="累计成功调用"
            emptyLabel="暂无接口调用快照"
          />
        </div>
        <div className="endata-chart-block">
          <div className="endata-block-title">
            <strong>脚本调用波动</strong>
            <span>{chartPeriodText} · {isDayView ? "小时走势" : "每日走势"}</span>
          </div>
          <LineChart
            rows={scriptChartRows}
            seriesKey="script_key"
            seriesLabelKey="display_name_cn"
            seriesDomain={scriptSeriesDomain}
            bucketDomain={chartBucketDomain}
            bucketRange={isDayView ? "hourly" : "daily"}
            valueKey="calls_total"
            bucketLabel={chartBucketLabel}
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
            {endpoints.length ? (
              endpoints.map((item) => (
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
              ))
            ) : (
              <tr>
                <td className="endata-empty-cell" colSpan="4">
                  暂无艺恩接口详情
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
