import { useMemo, useState } from "react";
import { chartColors } from "../../constants/chartColors";
import { formatCompact, formatDelta, formatNumber } from "../../utils/formatters";
import { formatBucket } from "../../utils/dates";

export function LineChart({
  rows,
  seriesKey,
  seriesLabelKey = "display_name_cn",
  seriesDomain = [],
  bucketDomain = [],
  bucketRange = "hourly",
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
              {formatBucket(bucket, bucketRange)}
            </text>
          );
        })}
      </svg>
      {hoverIndex >= 0 ? (
        <div className="chart-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <strong>{formatBucket(hoverBucket, bucketRange)}</strong>
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
