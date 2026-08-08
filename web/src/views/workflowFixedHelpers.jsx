import { normalizeWorkflowImagePrompts } from "./workflowImageHelpers";
import { arrayText } from "../utils/formatters";
import { listItems, noteContentText, structuredText } from "../utils/collections";

const fixedContentLineConfigs = [
  {
    id: "trend",
    title: "蹭热点/降维科普/行业趋势解读",
    shortTitle: "热点科普线",
    intent: "把 GEO、AI 搜索、营销趋势拆成公共认知入口。",
    targetPersonas: ["认知小白", "泛好奇者"],
    keywords: ["热点", "趋势", "科普", "入门", "小白", "一文看懂", "为什么", "AI", "GEO", "搜索"],
  },
  {
    id: "scenario",
    title: "垂直场景贴合，制造代入感",
    shortTitle: "垂直场景线",
    intent: "把通用 GEO 能力落到具体行业、具体角色和具体使用场景。",
    targetPersonas: ["垂直探路者"],
    keywords: ["场景", "行业", "案例", "怎么做", "落地", "实操", "路径", "方法"],
  },
  {
    id: "trust",
    title: "建立专业感、信任感，降低评估成本",
    shortTitle: "信任决策线",
    intent: "服务高焦虑决策、管理者和代理渠道，减少评估链路。",
    targetPersonas: ["行业焦虑决策者", "代理/渠道商"],
    keywords: ["信任", "转化", "决策", "成本", "评估", "避坑", "服务商", "管理者", "代理", "渠道"],
  },
];

const fixedRewriteSteps = ["读取笔记资产", "创建生图任务", "轮询图片结果", "生成小红书文案", "洗稿完成"];
const reviewDraftSteps = ["读取草稿", "调用豆包改文案", "调用多米改图", "写回草稿池"];
const fixedImageSizeOptions = [
  { value: "1024x1536", label: "小红书竖图 1024x1536" },
  { value: "1024x1024", label: "小红书方图 1024x1024" },
  { value: "1536x1024", label: "横图 1536x1024" },
];

function uniqueTextItems(items) {
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

function notePersonaItems(item) {
  return uniqueTextItems([item.primary_target_persona, ...listItems(item.target_persona_tags)]);
}

function noteKeywordText(item) {
  return [
    item.title,
    noteContentText(item),
    item.core_topic_category,
    item.true_pain_label,
    item.pain_description,
    item.business_logic,
    item.content_logic,
    arrayText(item.hook_types),
    item.funnel_role,
    item.primary_industry,
    arrayText(item.industry_tags),
  ]
    .filter(Boolean)
    .join(" ");
}

function noteMatchesPersonas(item, personas) {
  const notePersonas = notePersonaItems(item);
  return personas.some((persona) => notePersonas.includes(persona));
}

function fixedLineScore(line, item) {
  let score = 0;
  if (noteMatchesPersonas(item, line.targetPersonas)) score += 12;
  const keywordText = noteKeywordText(item);
  score += line.keywords.filter((keyword) => keywordText.includes(keyword)).length * 2;
  if (line.id === "trend" && item.funnel_role === "曝光") score += 2;
  if (line.id === "trust" && ["信任", "转化"].includes(item.funnel_role)) score += 5;
  return score;
}

function sortHotNotes(rows) {
  return [...rows].sort((a, b) => {
    const interactionDelta = Number(b.interaction_score || 0) - Number(a.interaction_score || 0);
    if (interactionDelta) return interactionDelta;
    const freshDelta = Number(b.fresh_hot_score || 0) - Number(a.fresh_hot_score || 0);
    if (freshDelta) return freshDelta;
    return String(b.note_date || b.publish_time || "").localeCompare(String(a.note_date || a.publish_time || ""));
  });
}

function dedupeNotes(rows) {
  const seen = new Set();
  return rows.filter((item) => {
    const key = item?.note_id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupFixedNotes(line, notes) {
  return [{ id: "all", label: "全行业", notes: sortHotNotes(notes).slice(0, 18) }];
}

function buildFixedContentLines(rows) {
  const source = sortHotNotes(dedupeNotes(rows || []));
  return fixedContentLineConfigs.map((line) => {
    const matched = source
      .map((note) => ({ note, score: fixedLineScore(line, note) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.note.interaction_score || 0) - Number(a.note.interaction_score || 0))
      .map((item) => item.note);
    const fallbackSize = line.id === "trend" ? 24 : 16;
    const notes = matched.length ? matched.slice(0, 80) : source.slice(0, fallbackSize);
    return {
      ...line,
      notes,
      groups: groupFixedNotes(line, notes),
    };
  });
}

function sourceImagesForNote(note) {
  const items = [];
  const seen = new Set();
  function add(url, source = "image_analysis") {
    const imageUrl = String(url || "").trim();
    if (!imageUrl || seen.has(imageUrl)) return;
    seen.add(imageUrl);
    items.push({ url: imageUrl, source, slot: items.length + 1 });
  }
  (note?.source_images || []).forEach((image) => add(image.url || image.imageUrl, image.source || "source_image"));
  normalizeWorkflowImagePrompts(note?.image_prompts).forEach((prompt) => add(prompt.imageUrl, "image_analysis"));
  return items;
}

function NoteMetricChip({ label, value }) {
  return (
    <span className="note-metric-chip">
      <em>{label}</em>
      <strong>{formatNumber(value)}</strong>
    </span>
  );
}

function DailyNoteRail({ date, notes, selectedNoteId, onSelectNote }) {
  return (
    <section className="daily-note-rail">
      <div className="daily-note-rail-head">
        <div>
          <span>{date ? formatDayLabel(date) : "未选日期"}</span>
          <strong>笔记预览</strong>
        </div>
        <StatusPill tone="neutral">{formatNumber(notes.length)} 条 · 按互动量</StatusPill>
      </div>
      {notes.length ? (
        <div className="daily-note-strip">
          {notes.map((item) => (
            <article
              className={`daily-note-card ${selectedNoteId === item.note_id ? "active" : ""}`}
              key={item.note_id}
              onClick={() => onSelectNote(item.note_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectNote(item.note_id);
              }}
              role="button"
              tabIndex="0"
            >
              <div className="daily-note-basic">
                <div className="daily-note-card-top">
                  <StatusPill tone={item.funnel_role === "转化" ? "green" : item.funnel_role === "信任" ? "blue" : "neutral"}>
                    {item.funnel_role || "未标注漏斗"}
                  </StatusPill>
                  <span>{formatDayLabel(item.note_date || item.publish_time)}</span>
                </div>
                <strong>{item.title || item.note_id}</strong>
                <p>{textPreview(noteContentText(item), 132) || "-"}</p>
                <div className="daily-note-topic-row">
                  <span>{item.core_topic_category || "未标注话题"}</span>
                  <span>{arrayText(item.hook_types) || "未标注钩子"}</span>
                </div>
                <div className="daily-note-metrics">
                  <NoteMetricChip label="互动" value={item.interaction_score} />
                  <NoteMetricChip label="赞" value={item.like_count} />
                  <NoteMetricChip label="藏" value={item.collected_count} />
                  <NoteMetricChip label="评" value={item.comments_count} />
                </div>
              </div>
              <div className="daily-note-insight-grid">
                <section>
                  <h3>目标人群及痛点判断</h3>
                  <strong>{item.primary_target_persona || "未标注人群"}</strong>
                  <p>{item.true_pain_label || item.pain_description || "-"}</p>
                  <small>{item.target_persona_reason || item.pain_evidence || ""}</small>
                </section>
                <section>
                  <h3>业务逻辑和可复用角度</h3>
                  <strong>{item.business_logic || item.content_logic || "-"}</strong>
                  <p>{firstStructuredText(item.reusable_angles, item.funnel_role_reason || "")}</p>
                </section>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state daily-note-empty">暂无该日期笔记</div>
      )}
    </section>
  );
}

function DetailTextBlock({ title, children }) {
  return (
    <section className="note-detail-block">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function StructuredList({ value }) {
  const items = listItems(value);
  if (!items.length) return <p>-</p>;
  return (
    <ul className="structured-list">
      {items.slice(0, 6).map((item, index) => (
        <li key={`${structuredText(item)}-${index}`}>{structuredText(item)}</li>
      ))}
    </ul>
  );
}

function TagLine({ values }) {
  const items = listItems(values);
  if (!items.length) return <span>-</span>;
  return (
    <div className="note-tag-line">
      {items.slice(0, 8).map((item) => (
        <span key={String(item)}>{String(item)}</span>
      ))}
    </div>
  );
}

export {
  fixedContentLineConfigs,
  fixedRewriteSteps,
  reviewDraftSteps,
  fixedImageSizeOptions,
  uniqueTextItems,
  notePersonaItems,
  noteKeywordText,
  noteMatchesPersonas,
  fixedLineScore,
  sortHotNotes,
  dedupeNotes,
  groupFixedNotes,
  buildFixedContentLines,
  sourceImagesForNote,
  NoteMetricChip,
  DetailTextBlock,
  StructuredList,
  TagLine,
};
