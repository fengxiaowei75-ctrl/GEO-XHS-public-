import { detailFieldLabels } from "../constants/detailFieldLabels";
import { arrayText } from "./formatters";

export function listItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      return [text];
    }
    return [text];
  }
  return [value];
}

export function structuredText(item) {
  if (!item) return "";
  if (typeof item !== "object") return String(item);
  return Object.entries(item)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${detailFieldLabels[key] || key}：${arrayText(value)}`)
    .join("；");
}

export function firstStructuredText(value, fallback = "") {
  const first = listItems(value)[0];
  return first ? structuredText(first) : fallback;
}

export function noteContentText(item) {
  return item?.content_excerpt || item?.asset_text_excerpt || item?.content_logic || item?.business_logic || "";
}

export function latestEndataSnapshot(snapshots, rangeKey) {
  const candidates = (snapshots || []).filter((item) => item?.range_key === rangeKey);
  if (!candidates.length) return {};
  return [...candidates].sort((a, b) => {
    const endCodeCompare = String(b?.end_code || "").localeCompare(String(a?.end_code || ""));
    if (endCodeCompare) return endCodeCompare;
    const beginCodeCompare = String(b?.begin_code || "").localeCompare(String(a?.begin_code || ""));
    if (beginCodeCompare) return beginCodeCompare;
    return new Date(b?.sampled_at || 0).getTime() - new Date(a?.sampled_at || 0).getTime();
  })[0];
}
