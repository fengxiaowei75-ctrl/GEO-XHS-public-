import { describe, it, expect } from "vitest";
import { formatNumber, formatCompact, formatMoney, formatPercent, formatScore, formatDate, formatDuration, arrayText, textPreview } from "./formatters";

describe("formatNumber", () => {
  it("正常格式化数字", () => {
    expect(formatNumber(1234567.89)).toBe("1,234,567.89");
  });

  it("处理 null 和 undefined", () => {
    expect(formatNumber(null)).toBe("-");
    expect(formatNumber(undefined)).toBe("-");
  });

  it("处理空字符串", () => {
    expect(formatNumber("")).toBe("-");
  });

  it("处理 NaN 和 Infinity", () => {
    expect(formatNumber(NaN)).toBe("-");
    expect(formatNumber(Infinity)).toBe("-");
  });

  it("处理整数", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("保留 3 位小数", () => {
    expect(formatNumber(3.14159)).toBe("3.142");
  });
});

describe("formatCompact", () => {
  it("正常格式化大数字", () => {
    expect(formatCompact(1500)).toBe("1500");
    expect(formatCompact(1500000)).toBe("150万");
  });

  it("处理 null", () => {
    expect(formatCompact(null)).toBe("-");
  });

  it("处理 NaN", () => {
    expect(formatCompact(NaN)).toBe("-");
  });
});

describe("formatMoney", () => {
  it("正常格式化金额", () => {
    expect(formatMoney(1234.5)).toBe("1,234.50");
  });

  it("处理 null", () => {
    expect(formatMoney(null)).toBe("-");
  });

  it("处理 NaN", () => {
    expect(formatMoney(NaN)).toBe("-");
  });
});

describe("formatPercent", () => {
  it("正常格式化百分比", () => {
    expect(formatPercent(0.856)).toBe("0.86%");
  });

  it("处理 null 和 undefined", () => {
    expect(formatPercent(null)).toBe("-");
    expect(formatPercent(undefined)).toBe("-");
  });

  it("处理 0", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("处理负数", () => {
    expect(formatPercent(-0.123)).toBe("-0.12%");
  });
});

describe("formatScore", () => {
  it("正常格式化分数", () => {
    expect(formatScore(8.5)).toBe("8.5");
    expect(formatScore(8)).toBe("8.0");
  });

  it("处理 null", () => {
    expect(formatScore(null)).toBe("-");
  });
});

describe("formatDate", () => {
  it("正常格式化日期", () => {
    const date = new Date("2024-01-15T10:30:00");
    const result = formatDate(date.toISOString());
    expect(result).toMatch(/01[\/\-]15/);
  });

  it("处理 null", () => {
    expect(formatDate(null)).toBe("-");
  });
});

describe("formatDuration", () => {
  it("格式化秒", () => {
    expect(formatDuration(30000)).toBe("30s");
  });

  it("格式化分钟", () => {
    expect(formatDuration(120000)).toBe("2m");
  });

  it("格式化小时", () => {
    expect(formatDuration(7200000)).toBe("2h");
  });

  it("处理 null", () => {
    expect(formatDuration(null)).toBe("-");
  });
});

describe("arrayText", () => {
  it("连接数组", () => {
    expect(arrayText(["a", "b", "c"])).toBe("a / b / c");
  });

  it("处理 null", () => {
    expect(arrayText(null)).toBe("");
  });

  it("处理字符串", () => {
    expect(arrayText("hello")).toBe("hello");
  });
});

describe("textPreview", () => {
  it("返回完整文本", () => {
    expect(textPreview("hello world")).toBe("hello world");
  });

  it("截断长文本", () => {
    const long = "a".repeat(200);
    expect(textPreview(long)).toBe("a".repeat(150) + "...");
  });

  it("处理 null", () => {
    expect(textPreview(null)).toBe("");
  });
});
