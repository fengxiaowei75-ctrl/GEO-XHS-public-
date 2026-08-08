import { Activity, AlertTriangle, BarChart3, Brain, CheckCircle2, Clock3, ListChecks, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiStatusComboChart } from "../components/charts/ApiStatusComboChart";
import { LineChart } from "../components/charts/LineChart";
import { TimeWindowSlider } from "../components/charts/TimeWindowSlider";
import { StatusPill } from "../components/data/StatusPill";
import { SelectControl } from "../components/form/SelectControl";
import { SegmentedControl } from "../components/form/SegmentedControl";
import { SectionHeader } from "../components/layout/SectionHeader";
import { EndataBalancePanel, EndataCompactPanel } from "../components/ops/EndataPanels";
import { modelProviderTypes } from "../constants/providerLabels";
import { addDays, buildBucketDomain, dayStart, getMonthKey, localDateInputValue, monthLabel, normalizeBucketStart } from "../utils/dates";
import { formatCompact, formatDate, formatDateTimeSecond, formatDuration, formatNumber, formatShortDate, modelDisplayName, providerDisplayName, statusTone } from "../utils/formatters";

export function OpsView({ data, apiDate, onApiDateChange }) {
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
  const modelRows = (ops.modelUsageSummary || []).filter((item) => modelProviderTypes.includes(item.provider_type));
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
    const isModel = modelProviderTypes.includes(item.provider_type);
    return isModel && (model === "all" || item.model_name === model);
  });
  const modelBaseRows = monthRows.filter((item) => {
    const isModel = modelProviderTypes.includes(item.provider_type);
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
            bucketRange={range}
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
            bucketRange={range}
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
