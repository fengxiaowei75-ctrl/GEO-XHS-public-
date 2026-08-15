const crypto = require("crypto");
const { readJsonBody, requireAuth, sendJson, withAuthClient } = require("./_auth");

const MAX_ROWS = 500;

function text(value, max = 5000) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function integer(value) {
  const result = Number(String(value ?? "").replaceAll(",", "").trim() || 0);
  return Number.isFinite(result) ? Math.max(0, Math.trunc(result)) : 0;
}

function noteIdFrom(row) {
  const explicit = text(row.note_id || row.xhs_id || row.XhsId || row["笔记ID"] || row["作品ID"], 160);
  if (explicit) return explicit;
  const url = text(row.source_note_url || row.note_url || row["笔记链接"] || row["作品链接"], 1000);
  const match = url?.match(/(?:explore|discovery\/item)\/([^/?#\s]+)/i);
  return match?.[1] || null;
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return null;
}

function normalizeRow(row, index, batchId) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`第 ${index + 1} 行不是有效对象`);
  const noteId = noteIdFrom(row);
  if (!noteId || !/^[A-Za-z0-9_-]{6,160}$/.test(noteId)) throw new Error(`第 ${index + 1} 行缺少有效的笔记ID或笔记链接`);
  return {
    noteId,
    sourceFile: text(pick(row, "source_file", "来源文件"), 500) || `web:${batchId}`,
    sourceRow: integer(pick(row, "source_row", "原始行号")) || index + 2,
    sourceKeyword: text(pick(row, "source_keyword", "关键词", "搜索词"), 120) || batchId,
    sourceImage: text(pick(row, "source_image", "图片", "封面图"), 2000),
    sourceTitle: text(pick(row, "source_title", "标题"), 2000),
    sourceAuthor: text(pick(row, "source_author", "博主", "作者"), 500),
    sourceAuthorProfileUrl: text(pick(row, "source_author_profile_url", "博主主页链接", "作者主页"), 2000),
    sourceNoteType: text(pick(row, "source_note_type", "笔记类型", "作品类型"), 100),
    sourceLikeCount: integer(pick(row, "source_like_count", "点赞数")),
    sourceCollectedCount: integer(pick(row, "source_collected_count", "收藏数")),
    sourceCommentsCount: integer(pick(row, "source_comments_count", "评论数")),
    sourceShareCount: integer(pick(row, "source_share_count", "分享数")),
    sourceContent: text(pick(row, "source_content", "内容", "正文"), 50000),
    sourcePublishTimeText: text(pick(row, "source_publish_time_text", "发布时间"), 200),
    sourceAuthorRegion: text(pick(row, "source_author_region", "博主-地区", "作者地区", "地区"), 200),
    sourceNoteUrl: text(pick(row, "source_note_url", "note_url", "笔记链接", "作品链接"), 2000),
    raw: row,
  };
}

async function importRows(client, rows, batchId) {
  const imported = [];
  const skipped = [];
  await client.query("BEGIN");
  try {
    const existing = await client.query(
      "SELECT note_id FROM public.note_details WHERE note_id = ANY($1::text[])",
      [rows.map((row) => row.noteId)]
    );
    const existingIds = new Set(existing.rows.map((item) => item.note_id));
    for (const row of rows) {
      if (existingIds.has(row.noteId)) {
        skipped.push({ note_id: row.noteId, reason: "数据库已存在" });
        continue;
      }
      await client.query(`
        INSERT INTO public.note_details (
          note_id, source_file, source_row, source_keyword, source_image, source_title,
          source_author, source_author_profile_url, source_note_type, source_like_count,
          source_collected_count, source_comments_count, source_share_count, source_content,
          source_publish_time_text, source_author_region, source_note_url, source_raw_json,
          detail_status, detail_error, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,'pending',NULL,now())
        ON CONFLICT (note_id) DO NOTHING
          source_file=EXCLUDED.source_file, source_row=EXCLUDED.source_row,
          source_keyword=EXCLUDED.source_keyword, source_image=EXCLUDED.source_image,
          source_title=EXCLUDED.source_title, source_author=EXCLUDED.source_author,
          source_author_profile_url=EXCLUDED.source_author_profile_url,
          source_note_type=EXCLUDED.source_note_type, source_like_count=EXCLUDED.source_like_count,
          source_collected_count=EXCLUDED.source_collected_count,
          source_comments_count=EXCLUDED.source_comments_count,
          source_share_count=EXCLUDED.source_share_count, source_content=EXCLUDED.source_content,
          source_publish_time_text=EXCLUDED.source_publish_time_text,
          source_author_region=EXCLUDED.source_author_region,
          source_note_url=EXCLUDED.source_note_url, source_raw_json=EXCLUDED.source_raw_json,
          detail_status=CASE WHEN note_details.detail_status='success' THEN note_details.detail_status ELSE 'pending' END,
          detail_error=NULL, updated_at=now()
      `, [row.noteId, row.sourceFile, row.sourceRow, row.sourceKeyword, row.sourceImage, row.sourceTitle,
        row.sourceAuthor, row.sourceAuthorProfileUrl, row.sourceNoteType, row.sourceLikeCount,
        row.sourceCollectedCount, row.sourceCommentsCount, row.sourceShareCount, row.sourceContent,
        row.sourcePublishTimeText, row.sourceAuthorRegion, row.sourceNoteUrl, JSON.stringify(row.raw)]);
      const queued = await client.query(`
        INSERT INTO public.geo_note_ingest_queue (input_value,note_id,source_keyword,priority,status,attempts,max_attempts,last_error,locked_by,locked_at,started_at,finished_at,updated_at)
        VALUES ($1,$2,$3,100,'pending',0,3,NULL,NULL,NULL,NULL,NULL,now())
        ON CONFLICT (note_id) DO NOTHING
        RETURNING queue_id,status
      `, [row.sourceNoteUrl || row.noteId, row.noteId, batchId]);
      if (queued.rows[0]) imported.push({ note_id: row.noteId, queue_id: Number(queued.rows[0].queue_id), status: queued.rows[0].status });
      else skipped.push({ note_id: row.noteId, reason: "队列中已存在" });
    }
    await client.query("COMMIT");
    return { imported, skipped };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function recentBatches(client) {
  const result = await client.query(`
    SELECT source_keyword AS batch_id, count(*)::int AS total,
      count(*) FILTER (WHERE status='pending')::int AS pending,
      count(*) FILTER (WHERE status='running')::int AS running,
      count(*) FILTER (WHERE status='success')::int AS success,
      count(*) FILTER (WHERE status='failed')::int AS failed,
      min(created_at) AS created_at, max(updated_at) AS updated_at
    FROM public.geo_note_ingest_queue
    WHERE source_keyword LIKE 'web_upload_%'
    GROUP BY source_keyword
    ORDER BY max(created_at) DESC
    LIMIT 20
  `);
  return result.rows;
}

module.exports = async function handler(req, res) {
  try {
    const actor = await requireAuth(req, res, "content");
    if (!actor) return;
    if (req.method === "GET") {
      const batches = await withAuthClient(recentBatches);
      sendJson(res, 200, { ok: true, batches });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      sendJson(res, 405, { ok: false, error: "仅支持 GET 和 POST" });
      return;
    }
    const payload = await readJsonBody(req);
    if (!Array.isArray(payload.rows) || !payload.rows.length) throw Object.assign(new Error("没有可导入的数据"), { statusCode: 400 });
    if (payload.rows.length > MAX_ROWS) throw Object.assign(new Error(`单次最多导入 ${MAX_ROWS} 条`), { statusCode: 400 });
    const batchId = `web_upload_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const normalized = payload.rows.map((row, index) => normalizeRow(row, index, batchId));
    const duplicateIds = normalized.filter((row, index) => normalized.findIndex((item) => item.noteId === row.noteId) !== index).map((row) => row.noteId);
    if (duplicateIds.length) throw Object.assign(new Error(`文件内存在重复笔记ID：${[...new Set(duplicateIds)].slice(0, 5).join("、")}`), { statusCode: 400 });
    const result = await withAuthClient((client) => importRows(client, normalized, batchId));
    sendJson(res, 201, {
      ok: true,
      batch_id: batchId,
      imported_count: result.imported.length,
      skipped_count: result.skipped.length,
      items: result.imported,
      skipped: result.skipped,
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "原始数据导入失败" });
  }
};
