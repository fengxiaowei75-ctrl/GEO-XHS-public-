const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

export function padDatePart(value) {
  return String(value).padStart(2, "0");
}

export function localDateTimeString(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:00`;
}

export function localDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function todayInputValue() {
  return localDateInputValue(new Date());
}

export function dateKeyFromValue(value) {
  if (!value) return "";
  const matched = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (matched) return matched[1];
  return localDateInputValue(value);
}

export function noteDateKey(item) {
  return dateKeyFromValue(item?.note_date || item?.publish_time);
}

export function formatDayLabel(value) {
  const key = dateKeyFromValue(value);
  if (!key) return "-";
  return `${key.slice(5, 7)}/${key.slice(8, 10)}`;
}

export function dayStart(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function rangeForLastDays(days, endValue = "") {
  const end = endValue ? new Date(`${endValue}T00:00:00`) : new Date();
  if (Number.isNaN(end.getTime())) return { start: "", end: "" };
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, Number(days || 1)) + 1);
  return {
    start: localDateInputValue(start),
    end: localDateInputValue(end),
  };
}

export function normalizeBucketStart(value, range) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setSeconds(0, 0);
  if (range === "hourly") {
    date.setMinutes(0, 0, 0);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return localDateTimeString(date);
}

export function buildBucketDomain(startDate, endDate, range) {
  if (!startDate || !endDate) return [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];
  if (range === "hourly") {
    cursor.setMinutes(0, 0, 0);
    end.setMinutes(0, 0, 0);
  } else {
    cursor.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
  }
  const buckets = [];
  while (cursor <= end) {
    buckets.push(localDateTimeString(cursor));
    if (range === "hourly") cursor.setHours(cursor.getHours() + 1);
    else if (range === "weekly") cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

export function formatBucket(value, range = "hourly") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  if (range === "daily" || range === "weekly") return shortDateFormatter.format(date);
  return dateFormatter.format(date);
}

export function formatShortDate(value) {
  if (!value) return "-";
  return shortDateFormatter.format(new Date(value));
}

export function getMonthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(value) {
  if (!value) return "无月份";
  const [year, month] = String(value).split("-");
  return `${year}年${month}月`;
}

export function latestBucketDate(rows) {
  const timestamps = (rows || []).map((item) => new Date(item.bucket_start).getTime()).filter((value) => !Number.isNaN(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps));
}
