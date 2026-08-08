import { LogOut, RefreshCcw, Search, Sparkles } from "lucide-react";

export function Topbar({ title, user, activeView, filter, onFilterChange, onRefresh, refreshing, onLogout }) {
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">
          <Sparkles size={15} />
          GEO XHS Intelligence
        </div>
        <h1>{title}</h1>
      </div>
      <div className="toolbar">
        <span className="user-chip">
          {user.username} · {user.role}
        </span>
        {activeView === "content" ? (
          <div className="search-box">
            <Search size={16} />
            <input value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="搜索标题、人群、主题、痛点" />
          </div>
        ) : null}
        <button className="icon-button" onClick={onRefresh} disabled={refreshing} title="刷新数据" type="button">
          <RefreshCcw size={17} />
        </button>
        <button className="icon-button" onClick={onLogout} title="退出登录" type="button">
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}
