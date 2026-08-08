import { formatShortDate } from "../../utils/dates";

export function TimeWindowSlider({ days, onChange, startDate, endDate }) {
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
