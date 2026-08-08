export function Stat({ icon: Icon, label, value, tone = "blue", sub }) {
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
