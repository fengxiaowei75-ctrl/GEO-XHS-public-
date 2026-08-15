import { strFromU8, unzipSync } from "fflate";

function columnIndex(reference = "A1") {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function xml(bytes) {
  const document = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error(`Excel 文件结构无效：${parserError.textContent?.trim() || "XML 解析失败"}`);
  return document;
}

function elements(document, localName) {
  return [...document.getElementsByTagNameNS("*", localName), ...document.getElementsByTagName(localName)]
    .filter((item, index, all) => all.indexOf(item) === index);
}

function xlsxRows(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const shared = files["xl/sharedStrings.xml"]
    ? elements(xml(files["xl/sharedStrings.xml"]), "si").map((item) => elements(item, "t").map((node) => node.textContent || "").join(""))
    : [];
  const workbook = xml(files["xl/workbook.xml"]);
  const firstSheet = elements(workbook, "sheet")[0];
  if (!firstSheet) throw new Error("Excel 中没有工作表");
  const relationshipId = firstSheet.getAttribute("r:id");
  const relationships = xml(files["xl/_rels/workbook.xml.rels"]);
  const target = elements(relationships, "Relationship").find((item) => item.getAttribute("Id") === relationshipId)?.getAttribute("Target");
  const normalizedTarget = target?.replace(/^\//, "") || "worksheets/sheet1.xml";
  const sheetPath = normalizedTarget.startsWith("xl/") ? normalizedTarget : `xl/${normalizedTarget}`;
  if (!files[sheetPath]) throw new Error("无法读取 Excel 第一张工作表");
  return elements(xml(files[sheetPath]), "row").map((row) => {
    const values = [];
    elements(row, "c").forEach((cell) => {
      const index = columnIndex(cell.getAttribute("r"));
      const type = cell.getAttribute("t");
      const raw = type === "inlineStr" ? elements(cell, "t").map((node) => node.textContent || "").join("") : elements(cell, "v")[0]?.textContent || "";
      values[index] = type === "s" ? shared[Number(raw)] || "" : raw;
    });
    return values.map((value) => value ?? "");
  });
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  row.push(value);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

function objectsFromRows(rows) {
  if (rows.length < 2) throw new Error("文件至少需要表头和一行数据");
  const headers = rows[0].map((header) => String(header || "").trim());
  if (!headers.some(Boolean)) throw new Error("文件缺少表头");
  return rows.slice(1).filter((row) => row.some((value) => String(value || "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header || `未命名列${index + 1}`, row[index] ?? ""])));
}

export function noteIdForImport(row) {
  const explicit = row.note_id || row.xhs_id || row.XhsId || row["笔记ID"] || row["作品ID"];
  if (String(explicit || "").trim()) return String(explicit).trim();
  const url = String(row.source_note_url || row.note_url || row["笔记链接"] || row["作品链接"] || "");
  return url.match(/(?:explore|discovery\/item)\/([^/?#\s]+)/i)?.[1] || "";
}

export async function parseImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const parsed = JSON.parse(await file.text());
    const rows = Array.isArray(parsed) ? parsed : parsed.rows;
    if (!Array.isArray(rows)) throw new Error("JSON 必须是数组或包含 rows 数组");
    return rows;
  }
  if (name.endsWith(".csv")) return objectsFromRows(csvRows(await file.text()));
  if (name.endsWith(".xlsx")) return objectsFromRows(xlsxRows(await file.arrayBuffer()));
  throw new Error("仅支持 .xlsx、.csv 和 .json 文件");
}
