const { requireAuth } = require("./_auth");

const platformLabels = {
  xhs: "小红书",
  douyin: "抖音",
  wechat: "公众号",
  zhihu: "知乎",
};
const MAX_DRAFT_IMAGES = 80;
const MAX_IMAGE_PROMPT_CHARS = 60000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes = 16 * 1024 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error("请求体过大");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function cleanText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function safePathPart(value, fallback = "未命名") {
  const cleaned = cleanText(value, 80)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function datePrefix(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function markdownFor(input, platformLabel) {
  const imageRows = Array.isArray(input.images)
    ? input.images.slice(0, MAX_DRAFT_IMAGES).map((image, index) => {
        const label = imageVersionLabel(image, index);
        const instruction = cleanText(image?.editInstruction, 1200);
        return [`- ${label}: images/${imageFileStem(image, index)}`, instruction ? `  - 改图要求：${instruction}` : ""].filter(Boolean).join("\n");
      })
    : [];
  return [
    `# ${cleanText(input.title, 200) || "社媒草稿"}`,
    "",
    `平台：${platformLabel}`,
    `笔记 ID：${cleanText(input.noteId, 120) || "-"}`,
    `生产时间：${cleanText(input.producedAt, 80) || new Date().toISOString()}`,
    "",
    "## 生成社媒内容",
    "",
    cleanText(input.socialContent, 20000) || "暂无",
    "",
    "## 原始笔记标题",
    "",
    cleanText(input.title, 1000) || "暂无",
    "",
    "## 原始笔记文案",
    "",
    cleanText(input.content, 12000) || "暂无",
    "",
    "## 目标人群画像",
    "",
    cleanText(input.targetPersona, 4000) || "暂无",
    "",
    "## 用户痛点",
    "",
    cleanText(input.userPain, 5000) || "暂无",
    "",
    "## 业务逻辑",
    "",
    cleanText(input.businessLogic, 5000) || "暂无",
    "",
    "## 业务知识点",
    "",
    cleanText(input.businessKnowledge, 6000) || "暂无",
    "",
    "## 生图提示词",
    "",
    cleanText(input.imagePrompt, MAX_IMAGE_PROMPT_CHARS) || "暂无",
    "",
    "## 图片文件",
    "",
    imageRows.length ? imageRows.join("\n") : "暂无",
    "",
  ].join("\n");
}

function imageFileStem(image, index) {
  const slot = Number(image?.slot || 0);
  const version = Number(image?.version || 0);
  if (slot > 0 && version > 0) return `slot-${slot}-v${version}`;
  if (slot > 0) return `slot-${slot}-v1`;
  return `image-${index + 1}`;
}

function imageVersionLabel(image, index) {
  const slot = Number(image?.slot || 0);
  const version = Number(image?.version || 1);
  if (cleanText(image?.label, 120)) return cleanText(image.label, 120);
  if (slot > 0) return version > 1 ? `第${slot}张 v${version} 改图` : `第${slot}张 v1 原图`;
  return `图片 ${index + 1}`;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function extensionFromContentType(value) {
  const type = String(value || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "png";
}

function decodeDataUrl(url) {
  const matched = String(url || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!matched) return null;
  const mime = matched[1] || "image/png";
  const data = matched[2] ? Buffer.from(matched[3], "base64") : Buffer.from(decodeURIComponent(matched[3]), "utf8");
  return { data, extension: extensionFromContentType(mime) };
}

async function fetchImage(url) {
  const dataUrl = decodeDataUrl(url);
  if (dataUrl) return dataUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    const arrayBuffer = await response.arrayBuffer();
    return {
      data: Buffer.from(arrayBuffer),
      extension: extensionFromContentType(contentType),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
    return;
  }

  try {
    const user = await requireAuth(req, res, "content");
    if (!user) return;

    const input = await readJsonBody(req);
    const platform = platformLabels[input.platform] ? input.platform : "xhs";
    const platformLabel = platformLabels[platform];
    const title = safePathPart(input.title || input.noteId || "社媒草稿");
    const folder = `社媒草稿仓库/${platformLabel}/${datePrefix(input.producedAt)}_${title}`;
    const entries = [
      { name: `${folder}/社媒草稿.md`, data: markdownFor(input, platformLabel) },
      {
        name: `${folder}/素材字段.json`,
        data: JSON.stringify(
          {
            platform,
            platformLabel,
            noteId: cleanText(input.noteId, 120),
            title: cleanText(input.title, 1000),
            content: cleanText(input.content, 12000),
            targetPersona: cleanText(input.targetPersona, 4000),
            userPain: cleanText(input.userPain, 5000),
            businessLogic: cleanText(input.businessLogic, 5000),
            businessKnowledge: cleanText(input.businessKnowledge, 6000),
            imagePrompt: cleanText(input.imagePrompt, MAX_IMAGE_PROMPT_CHARS),
            socialContent: cleanText(input.socialContent, 20000),
            images: Array.isArray(input.images)
              ? input.images.slice(0, MAX_DRAFT_IMAGES).map((image, index) => ({
                  slot: Number(image?.slot || 0) || null,
                  version: Number(image?.version || 0) || null,
                  label: imageVersionLabel(image, index),
                  filenameStem: imageFileStem(image, index),
                  url: cleanText(image?.url || image, 4000),
                  editedAt: cleanText(image?.editedAt, 80),
                  editInstruction: cleanText(image?.editInstruction, 1200),
                }))
              : [],
            generatedAt: cleanText(input.producedAt, 80) || new Date().toISOString(),
            savedBy: user.user_id,
          },
          null,
          2,
        ),
      },
    ];

    const imageLinks = [];
    const images = Array.isArray(input.images) ? input.images.slice(0, MAX_DRAFT_IMAGES) : [];
    for (let index = 0; index < images.length; index += 1) {
      const url = cleanText(images[index]?.url || images[index], 4000);
      if (!url) continue;
      const stem = imageFileStem(images[index], index);
      const label = imageVersionLabel(images[index], index);
      imageLinks.push(`${label} (${stem}): ${url}`);
      try {
        const image = await fetchImage(url);
        entries.push({ name: `${folder}/images/${stem}.${image.extension}`, data: image.data });
      } catch (error) {
        imageLinks.push(`${label} (${stem}) 下载失败：${error.message}`);
      }
    }
    entries.push({ name: `${folder}/image-links.txt`, data: `${imageLinks.join("\n")}\n` });

    const zip = createZip(entries);
    const filename = `${safePathPart(`${platformLabel}_${datePrefix(input.producedAt)}_${title}`, "社媒草稿")}.zip`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.end(zip);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "草稿打包失败" });
  }
};
