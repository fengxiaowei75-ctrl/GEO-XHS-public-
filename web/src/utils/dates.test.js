import { describe, it, expect } from "vitest";
import { padDatePart, rangeForLastDays } from "./dates";

describe("padDatePart", () => {
  it("个位数补零", () => {
    expect(padDatePart(5)).toBe("05");
    expect(padDatePart(9)).toBe("09");
  });

  it("两位数不变", () => {
    expect(padDatePart(12)).toBe("12");
    expect(padDatePart(31)).toBe("31");
  });

  it("字符串也能处理", () => {
    expect(padDatePart("3")).toBe("03");
  });
});

describe("rangeForLastDays", () => {
  it("返回正确的日期范围", () => {
    const result = rangeForLastDays(7);
    expect(result).toHaveProperty("start");
    expect(result).toHaveProperty("end");
    expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("7 天范围", () => {
    const result = rangeForLastDays(7);
    const start = new Date(result.start + "T00:00:00");
    const end = new Date(result.end + "T00:00:00");
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(6); // 7 天范围 = 6 天间隔
  });

  it("空值默认 1 天", () => {
    const result = rangeForLastDays("");
    const start = new Date(result.start + "T00:00:00");
    const end = new Date(result.end + "T00:00:00");
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(0);
  });

  it("自定义结束日期", () => {
    const result = rangeForLastDays(3, "2024-01-15");
    expect(result.end).toBe("2024-01-15");
    expect(result.start).toBe("2024-01-13");
  });

  it("非法结束日期返回空字符串", () => {
    const result = rangeForLastDays(7, "invalid");
    expect(result.start).toBe("");
    expect(result.end).toBe("");
  });
});
