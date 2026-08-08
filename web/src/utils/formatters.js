import { providerLabels } from "../constants/providerLabels";
import { monthLabel, padDatePart } from "./dates";
export { formatShortDate } from "./dates";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const compactFormatter = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const moneyFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return numberFormatter.format(number);
}

export function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return compactFormatter.format(number);
}

export function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return moneyFormatter.format(number);
}

export function formatMoneyDelta(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (number > 0) return `+${formatMoney(number)}`;
  if (number < 0) return `-${formatMoney(Math.abs(number))}`;
  return "0.00";
}

export function formatDelta(value) {
  const number = Number(value || 0);
  if (number > 0) return `+${formatCompact(number)}`;
  if (number < 0) return `-${formatCompact(Math.abs(number))}`;
  return "0";
}

export function formatSignedNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (number > 0) return `+${formatNumber(number)}`;
  if (number < 0) return `-${formatNumber(Math.abs(number))}`;
  return "0";
}

export function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${percentFormatter.format(number)}%`;
}

export function formatScore(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toFixed(1);
}

export function formatDate(value) {
  if (!value) return "-";
  return dateFormatter.format(new Date(value));
}

export function formatDateTimeSecond(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}月${date.getDate()}日${padDatePart(date.getHours())}时${padDatePart(date.getMinutes())}分${padDatePart(date.getSeconds())}秒`;
}

export function formatDuration(value) {
  if (!value) return "-";
  const seconds = Math.round(Number(value) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export function arrayText(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.join(" / ");
  return String(value);
}

export function textPreview(value, max = 150) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function compactProviderLabel(value) {
  return String(value || "")
    .replace(/（.*?）/g, "")
    .replace(/^火山\s*Ark\s*/, "")
    .replace(/^Ark\s*/, "")
    .trim();
}

export function providerTypeLabel(value) {
  const labels = {
    detail_api: "详情 API",
    llm_chat: "大模型",
    llm_vision: "图片解析",
    embedding: "Embedding",
    media_fetch: "媒体下载",
    speech_to_text: "视频转录",
    image_generation: "图像生成",
    other: "其他",
  };
  return labels[value] || value || "-";
}

export function providerDisplayName(item) {
  const code = typeof item === "string" ? item : item?.provider_code;
  return providerLabels[code] || (typeof item === "string" ? item : item?.display_name_cn) || code || "-";
}

export function modelDisplayName(item) {
  return item?.display_name_cn || item?.model_name || providerDisplayName(item);
}

export function endataRangeLabel(value) {
  const labels = {
    today: "今日",
    yesterday: "昨日",
    month: "本月",
  };
  return labels[value] || value || "-";
}

export function endataPeriodLabel(value, mode) {
  if (!value) return mode === "month" ? "暂无月份" : "暂无日期";
  return mode === "month" ? monthLabel(value) : value;
}

export function endataPeriodOptions(rows, mode) {
  const values = Array.from(new Set((rows || []).map((item) => item.period_key).filter(Boolean))).sort((a, b) => b.localeCompare(a));
  const latest = values[0] || "";
  return [
    {
      value: "latest",
      label: latest ? `最近${mode === "month" ? "月份" : "日期"}（${endataPeriodLabel(latest, mode)}）` : mode === "month" ? "暂无月份" : "暂无日期",
    },
    ...values.map((value) => ({ value, label: endataPeriodLabel(value, mode) })),
  ];
}

export function activeEndataPeriod(value, options) {
  if (value && value !== "latest") return value;
  return options.find((option) => option.value !== "latest")?.value || "";
}

export function statusTone(status) {
  if (status === "success" || status === "active" || status === true) return "green";
  if (status === "running") return "blue";
  if (status === "failed" || status === "timeout" || status === "rate_limited") return "red";
  if (status === "canceled" || status === "skipped") return "amber";
  return "neutral";
}

export function deltaClass(value) {
  const number = Number(value || 0);
  if (number > 0) return "endata-delta-up";
  if (number < 0) return "endata-delta-down";
  return "endata-delta-flat";
}

export function chartLabelLines(value) {
  const label = compactProviderLabel(value);
  if (label.length <= 8) return [label];
  if (label.length <= 14) return [label.slice(0, 7), label.slice(7)];
  return [label.slice(0, 7), `${label.slice(7, 13)}...`];
}
