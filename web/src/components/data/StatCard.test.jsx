import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "./StatCard";

// 模拟图标组件
function MockIcon({ size }) {
  return <svg data-testid="mock-icon" width={size} height={size} />;
}

describe("Stat", () => {
  it("正常渲染", () => {
    render(<Stat icon={MockIcon} label="用户数" value="1,234" />);
    expect(screen.getByText("用户数")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("渲染副标题", () => {
    render(<Stat icon={MockIcon} label="收入" value="¥100.00" sub="较昨日 +10%" />);
    expect(screen.getByText("较昨日 +10%")).toBeInTheDocument();
  });

  it("应用 tone 样式", () => {
    const { container } = render(<Stat icon={MockIcon} label="测试" value="1" tone="green" />);
    expect(container.querySelector(".stat-green")).toBeInTheDocument();
  });

  it("无副标题时不渲染 sub 元素", () => {
    const { container } = render(<Stat icon={MockIcon} label="测试" value="1" />);
    expect(container.querySelector(".stat-sub")).not.toBeInTheDocument();
  });

  it("渲染图标", () => {
    render(<Stat icon={MockIcon} label="测试" value="1" />);
    expect(screen.getByTestId("mock-icon")).toBeInTheDocument();
  });

  it("处理空值", () => {
    render(<Stat icon={MockIcon} label="空值测试" value="" />);
    expect(screen.getByText("空值测试")).toBeInTheDocument();
  });
});
