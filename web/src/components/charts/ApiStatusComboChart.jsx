import { useMemo, useState } from "react";
import { providerChartOrder } from "../../constants/providerLabels";
import { chartLabelLines, formatCompact, formatNumber, providerDisplayName, providerTypeLabel } from "../../utils/formatters";

export function ApiStatusComboChart({ rows, selectedProvider, selectedStatus, onSelect }) {
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
