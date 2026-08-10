import { AlertTriangle } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import "tippy.js/dist/tippy.css";
import { ChatWidget } from "./components/ChatWidget";
import { Sidebar } from "./components/layout/Sidebar";
import { Topbar } from "./components/layout/Topbar";
import { ViewErrorBoundary } from "./components/layout/ViewErrorBoundary";
import { navItems } from "./constants/navConfig";
import { useAuth } from "./hooks/useAuth";
import { useDashboardData } from "./hooks/useDashboardData";
import { LoginScreen } from "./views/LoginScreen";
import { canAccess, firstAllowedView } from "./utils/validators";

function lazyNamedView(factory, exportName) {
  return lazy(() => factory().then((module) => ({ default: module[exportName] })));
}

const ContentInsightView = lazyNamedView(() => import("./views/ContentInsightView"), "ContentInsightView");
const ImageGenView = lazyNamedView(() => import("./views/ImageGenView"), "ImageGenView");
const FixedContentView = lazyNamedView(() => import("./views/FixedContentView"), "FixedContentView");
const DraftReviewView = lazyNamedView(() => import("./views/DraftReviewView"), "DraftReviewView");
const OpsView = lazyNamedView(() => import("./views/OpsView"), "OpsView");
const ModelsView = lazyNamedView(() => import("./views/ModelsView"), "ModelsView");
const AdminView = lazyNamedView(() => import("./views/AdminView"), "AdminView");

const viewMap = {
  content: ContentInsightView,
  imageGen: ImageGenView,
  fixedContent: FixedContentView,
  draftReview: DraftReviewView,
  ops: OpsView,
  models: ModelsView,
  admin: AdminView,
};

function ViewLoading() {
  return (
    <div className="view-loading" style={{ padding: 40, textAlign: "center" }}>
      <div className="loading-spinner" />
      <span>加载中...</span>
    </div>
  );
}

export default function App() {
  const [filter, setFilter] = useState("");
  const [activeView, setActiveView] = useState("content");
  const [apiDate, setApiDate] = useState("");
  const [contentStart, setContentStart] = useState("");
  const [contentEnd, setContentEnd] = useState("");
  const auth = useAuth();
  const dashboard = useDashboardData({ currentUser: auth.user, apiDate, contentStart, contentEnd, onUnauthorized: auth.setUser });

  useEffect(() => {
    if (!auth.user) return;
    const item = navItems.find((navItem) => navItem.id === activeView);
    if (!item || !canAccess(auth.user, item.permission)) setActiveView(firstAllowedView(auth.user));
  }, [activeView, auth.user]);

  async function handleLogin(username, password) {
    const nextUser = await auth.login(username, password);
    if (nextUser) setActiveView(firstAllowedView(nextUser));
  }

  async function handleLogout() {
    await auth.logout();
    dashboard.setError("");
    auth.setLoginError("");
  }

  function handleContentRangeApply(nextRange) {
    if (Object.prototype.hasOwnProperty.call(nextRange, "start")) setContentStart(nextRange.start);
    if (Object.prototype.hasOwnProperty.call(nextRange, "end")) setContentEnd(nextRange.end);
  }

  if (auth.loading) return <main className="login-screen"><div className="loading">加载中</div></main>;
  if (!auth.user) return <LoginScreen onLogin={handleLogin} loading={auth.loginLoading} error={auth.loginError} />;

  const allowedNavItems = navItems.filter((item) => canAccess(auth.user, item.permission));
  const activeTitle = allowedNavItems.find((item) => item.id === activeView)?.label || allowedNavItems[0]?.label || "GEO XHS";
  const View = viewMap[activeView] || ContentInsightView;

  return (
    <>
      <div className="app-shell">
        <Sidebar items={allowedNavItems} active={activeView} onChange={setActiveView} />
        <main>
          <Topbar title={activeTitle} user={auth.user} activeView={activeView} filter={filter} onFilterChange={setFilter} onRefresh={dashboard.loadDashboard} refreshing={dashboard.loading} onLogout={handleLogout} />
          {dashboard.data?.source === "sample" ? <div className="notice"><AlertTriangle size={16} />当前为样例数据。部署到 Vercel 后配置 PostgreSQL 环境变量即可读取真实库。</div> : null}
          {dashboard.error ? <div className="notice notice-error"><AlertTriangle size={16} />{dashboard.error}</div> : null}
          <ViewErrorBoundary resetKey={activeView} onNavigate={setActiveView}>
            <Suspense fallback={<ViewLoading />}>
              <View
                data={dashboard.data}
                loading={dashboard.loading}
                filter={filter}
                contentStart={contentStart}
                contentEnd={contentEnd}
                onContentRangeApply={handleContentRangeApply}
                apiDate={apiDate}
                onApiDateChange={setApiDate}
                onNavigate={setActiveView}
                currentUser={auth.user}
                permissionCatalog={auth.permissionCatalog}
                onRefresh={dashboard.loadDashboard}
              />
            </Suspense>
          </ViewErrorBoundary>
        </main>
      </div>
      <ChatWidget />
    </>
  );
}
