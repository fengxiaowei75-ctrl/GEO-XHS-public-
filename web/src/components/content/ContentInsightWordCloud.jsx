import { Brain } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import "tippy.js/dist/tippy.css";
import { StatusPill } from "../data/StatusPill";
import { SelectControl } from "../form/SelectControl";
import { SectionHeader } from "../layout/SectionHeader";
import { listItems, noteContentText } from "../../utils/collections";
import { formatCompact, formatNumber } from "../../utils/formatters";

const ReactWordcloud = lazy(() =>
  import("@cp949/react-wordcloud").then((module) => ({
    default: module.default || module.ReactWordcloud,
  })),
);

const wordCloudStopWords = new Set([
  "一个",
  "一些",
  "一种",
  "不是",
  "不能",
  "不要",
  "不同",
  "什么",
  "他们",
  "你们",
  "我们",
  "自己",
  "这个",
  "这些",
  "那些",
  "如何",
  "怎么",
  "为什么",
  "可以",
  "可能",
  "需要",
  "没有",
  "很多",
  "非常",
  "比较",
  "因为",
  "所以",
  "如果",
  "但是",
  "还是",
  "以及",
  "通过",
  "进行",
  "时候",
  "用户",
  "内容",
  "笔记",
  "小红书",
  "营销号",
  "焦虑",
  "痛点",
  "问题",
  "人群",
  "类型",
  "字段",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
]);

const wordCloudDomainDict = [
  "留学生 300 n",
  "应届生 260 n",
  "求职 260 n",
  "实习 240 n",
  "简历 220 n",
  "面试 220 n",
  "海投 180 n",
  "转专业 180 n",
  "职业规划 220 n",
  "背景提升 220 n",
  "信息差 220 n",
  "选校 180 n",
  "申请季 180 n",
  "低龄留学 160 n",
  "研究生 160 n",
  "本科生 160 n",
  "职场新人 160 n",
  "家长 160 n",
  "AI 180 eng",
  "AIGC 160 eng",
  "GEO 160 eng",
].join("\n");

let jiebaRuntimePromise;

function loadJiebaRuntime() {
  if (!jiebaRuntimePromise) {
    jiebaRuntimePromise = import("@isdk/nlp-jieba/web").then(async (module) => {
      if (typeof module.default === "function") await module.default();
      try {
        module.addDefaultDict?.();
        module.addDict?.(wordCloudDomainDict);
      } catch {
        // 分词词典加载失败时仍可使用 WASM 基础能力或 fallback。
      }
      return {
        split: (text) => module.split(text, { mode: "Search", hmm: true }),
      };
    });
  }
  return jiebaRuntimePromise;
}

function normalizeCloudText(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{N}+#\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCloudTerm(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}+#]/gu, "")
    .trim();
}

function isUsefulCloudTerm(value) {
  const text = normalizeCloudTerm(value);
  if (!text || wordCloudStopWords.has(text)) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  if (/^\d{2,4}[年月日天]?$/.test(text)) return false;
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
  if (chineseCount) return text.length >= 2 && text.length <= 12;
  if (latinCount) return text.length >= 2 && text.length <= 24;
  return false;
}

function fallbackSegmentText(value) {
  const text = normalizeCloudText(value);
  if (!text) return [];
  return text
    .split(/\s+/)
    .flatMap((part) => {
      if (/^[a-zA-Z][a-zA-Z0-9+#-]{1,24}$/.test(part)) return [part];
      return part.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    });
}

function segmentCloudText(value, segmenter) {
  const text = normalizeCloudText(value);
  if (!text) return [];
  if (!segmenter) return fallbackSegmentText(text);
  try {
    return segmenter(text);
  } catch {
    return fallbackSegmentText(text);
  }
}

function addCloudTerm(termMap, rawTerm, weight, interaction) {
  const term = normalizeCloudTerm(rawTerm);
  if (!isUsefulCloudTerm(term)) return;
  const current = termMap.get(term) || { text: term, count: 0, interaction: 0, weightedCount: 0 };
  current.count += 1;
  current.weightedCount += weight;
  current.interaction += interaction;
  termMap.set(term, current);
}

function buildSegmentedWordCloudTerms(rows, config, segmenter) {
  const termMap = new Map();
  rows.forEach((item) => {
    const interaction = Number(item.interaction_score || 0);
    const perNote = new Map();
    config.exactTerms(item).forEach((term) => addCloudTerm(perNote, term, 1.6, interaction));
    config.segmentTexts(item).forEach((text) => {
      segmentCloudText(text, segmenter).forEach((term) => addCloudTerm(perNote, term, 1, interaction));
    });
    perNote.forEach((value, term) => {
      const current = termMap.get(term) || { text: term, count: 0, interaction: 0, weightedCount: 0 };
      current.count += 1;
      current.weightedCount += value.weightedCount;
      current.interaction += interaction;
      termMap.set(term, current);
    });
  });
  return Array.from(termMap.values())
    .map((item) => ({
      ...item,
      value: Math.max(1, item.weightedCount * 10 + Math.log10(Math.max(1, item.interaction) + 1) * 3),
    }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.text.localeCompare(b.text, "zh-CN"))
    .slice(0, 60);
}

function WordCloudBox({ title, caption, terms, tone, loading }) {
  const options = useMemo(
    () => ({
      colors: tone === "red" ? ["#bc3d3a", "#a85e00", "#7153b8", "#2764cf"] : ["#2764cf", "#087b76", "#26814f", "#7153b8"],
      deterministic: true,
      enableTooltip: true,
      fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSizes: [12, 34],
      fontWeight: "800",
      padding: 3,
      rotationAngles: [0, 0],
      rotations: 1,
      scale: "sqrt",
      spiral: "archimedean",
      transitionDuration: 220,
    }),
    [tone],
  );
  const callbacks = useMemo(
    () => ({
      getWordTooltip: (word) => `${word.text}：${formatNumber(word.count)} 篇，互动 ${formatNumber(word.interaction)}`,
    }),
    [],
  );
  const topTerms = terms.slice(0, 6);

  return (
    <section className={`word-cloud-box word-cloud-${tone || "blue"}`}>
      <div className="word-cloud-head">
        <div>
          <span>{caption}</span>
          <h3>{title}</h3>
        </div>
        <StatusPill tone="neutral">{loading ? "分词中" : `${formatNumber(terms.length)} 个词`}</StatusPill>
      </div>
      {terms.length ? (
        <>
          <div className="word-cloud-render">
            <Suspense fallback={<div className="empty-state word-cloud-empty">词云加载中...</div>}>
              <ReactWordcloud callbacks={callbacks} maxWords={48} minSize={[300, 188]} options={options} words={terms} />
            </Suspense>
          </div>
          <div className="word-cloud-top-terms">
            {topTerms.map((item, index) => (
              <span key={item.text}>
                {index + 1}. {item.text}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state word-cloud-empty">暂无可聚合词</div>
      )}
    </section>
  );
}

export function WordCloudPanel({ rows, personas, selectedPersona, onPersonaChange }) {
  const personaOptions = useMemo(
    () => [
      { value: "", label: "全部人群" },
      ...personas.map((item) => {
        const label = item.primary_target_persona || "未标注";
        return { value: label, label: `${label} · ${formatCompact(item.note_count)}` };
      }),
    ],
    [personas],
  );
  const scopedRows = useMemo(
    () => (selectedPersona ? rows.filter((item) => (item.primary_target_persona || "未标注") === selectedPersona) : rows),
    [rows, selectedPersona],
  );
  const [segmenter, setSegmenter] = useState(null);
  const [segmentStatus, setSegmentStatus] = useState("loading");

  useEffect(() => {
    let alive = true;
    loadJiebaRuntime()
      .then((runtime) => {
        if (!alive) return;
        setSegmenter(() => runtime.split);
        setSegmentStatus("ready");
      })
      .catch(() => {
        if (!alive) return;
        setSegmentStatus("fallback");
      });
    return () => {
      alive = false;
    };
  }, []);

  const emotionTerms = useMemo(
    () =>
      buildSegmentedWordCloudTerms(
        scopedRows,
        {
          exactTerms: (item) => [...listItems(item.hook_types), item.true_pain_label],
          segmentTexts: (item) => [item.true_pain_label, item.pain_description, item.pain_evidence],
        },
        segmenter,
      ),
    [scopedRows, segmenter],
  );
  const topicTerms = useMemo(
    () =>
      buildSegmentedWordCloudTerms(
        scopedRows,
        {
          exactTerms: (item) => [item.note_type, item.core_topic_category],
          segmentTexts: (item) => [item.title, noteContentText(item), item.business_logic, item.content_logic],
        },
        segmenter,
      ),
    [scopedRows, segmenter],
  );
  const segmentLabel = segmentStatus === "ready" ? "Jieba 分词" : segmentStatus === "fallback" ? "基础切分" : "Jieba 加载中";

  return (
    <section className="panel word-cloud-panel">
      <SectionHeader
        icon={Brain}
        title="周期词云洞察"
        action={<SelectControl label="人群筛选" value={selectedPersona} onChange={onPersonaChange} options={personaOptions} />}
      />
      <div className="word-cloud-meta">
        <span>{selectedPersona || "全部人群"}</span>
        <span>{formatNumber(scopedRows.length)} 条笔记</span>
        <span>{segmentLabel}</span>
      </div>
      <div className="word-cloud-grid">
        <WordCloudBox title="情绪钩子词云" caption="用户在焦虑什么" terms={emotionTerms} tone="red" loading={segmentStatus === "loading"} />
        <WordCloudBox title="笔记类型词云" caption="营销号在讲什么" terms={topicTerms} tone="blue" loading={segmentStatus === "loading"} />
      </div>
    </section>
  );
}
