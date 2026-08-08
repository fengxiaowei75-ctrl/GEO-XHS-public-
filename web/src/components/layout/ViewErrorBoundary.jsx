import { AlertTriangle } from "lucide-react";
import { Component } from "react";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "../data/StatusPill";

export class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error || "页面渲染失败");
      return (
        <section className="panel draft-review-empty-shell draft-review-error-panel">
          <SectionHeader icon={AlertTriangle} title="页面加载失败" action={<StatusPill tone="neutral">错误</StatusPill>} />
          <div className="draft-review-empty-copy">
            <AlertTriangle size={28} />
            <strong>当前功能页渲染失败</strong>
            <span>{message}</span>
          </div>
          <div className="draft-review-empty-actions">
            <button className="copy-button" type="button" onClick={() => this.props.onNavigate?.("fixedContent")}>
              去固定内容流
            </button>
            <button className="copy-button" type="button" onClick={() => this.props.onNavigate?.("imageGen")}>
              去爆文洗稿流
            </button>
            <button className="copy-button" type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
