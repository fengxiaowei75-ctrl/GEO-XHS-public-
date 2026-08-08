import { Sparkles } from "lucide-react";

export function Sidebar({ items, active, onChange }) {
  return (
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
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onChange(item.id)} type="button">
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
