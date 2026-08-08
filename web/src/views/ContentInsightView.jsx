import { Activity, BarChart3, Database, FileText, Filter, Target, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ContentTrendChart, DailyNoteRail, InsightMetricCard, contentMetricCards } from "../components/content/ContentInsightCharts";
import { NoteAnalysisBoard } from "../components/content/ContentInsightDetails";
import { InsightNoteTable, PersonaPieChart, TopicFrequencyList } from "../components/content/ContentInsightTables";
import { WordCloudPanel } from "../components/content/ContentInsightWordCloud";
import { StatusPill } from "../components/data/StatusPill";
import { SectionHeader } from "../components/layout/SectionHeader";
import { arrayText, formatNumber } from "../utils/formatters";
import { dateKeyFromValue, formatDayLabel, noteDateKey, rangeForLastDays, todayInputValue } from "../utils/dates";

function insightSearchText(item) {
  return [
    item.title,
    item.note_id,
    item.note_date,
    item.content_excerpt,
    item.author_nickname,
    item.note_type,
    item.core_topic_category,
    item.primary_target_persona,
    arrayText(item.target_persona_tags),
    item.primary_industry,
    arrayText(item.industry_tags),
    item.funnel_role,
    item.true_pain_label,
    item.pain_description,
    item.business_logic,
    item.content_logic,
    arrayText(item.hook_types),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function ContentInsightView({ data, loading, filter, contentStart, contentEnd, onContentRangeApply }) {
  const [selectedPersona, setSelectedPersona] = useState("");
  const [wordCloudPersona, setWordCloudPersona] = useState("");
  const [selectedTrendDate, setSelectedTrendDate] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [draftStart, setDraftStart] = useState(contentStart || "");
  const [draftEnd, setDraftEnd] = useState(contentEnd || "");
  const insight = data?.contentInsight || {};
  const overview = insight.overview || {};
  const topicRows = insight.topicFrequency || [];
  const personaRows = insight.personaDistribution || [];
  const noteRows = insight.noteAnalysis || [];
  const trendRows = insight.trendDaily || [];
  const sparkRows = insight.sparklineDaily || [];
  const keyword = filter.trim().toLowerCase();

  useEffect(() => {
    setDraftStart(contentStart || "");
    setDraftEnd(contentEnd || "");
  }, [contentStart, contentEnd]);

  useEffect(() => {
    if (!selectedPersona) return;
    const exists = personaRows.some((item) => (item.primary_target_persona || "未标注") === selectedPersona);
    if (!exists) setSelectedPersona("");
  }, [personaRows, selectedPersona]);

  useEffect(() => {
    if (!wordCloudPersona) return;
    const exists = personaRows.some((item) => (item.primary_target_persona || "未标注") === wordCloudPersona);
    if (!exists) setWordCloudPersona("");
  }, [personaRows, wordCloudPersona]);

  const trendDateKeys = useMemo(() => trendRows.map((item) => dateKeyFromValue(item.bucket_date)).filter(Boolean), [trendRows]);

  useEffect(() => {
    if (!trendDateKeys.length) {
      setSelectedTrendDate("");
      return;
    }
    if (!selectedTrendDate || !trendDateKeys.includes(selectedTrendDate)) {
      setSelectedTrendDate(trendDateKeys[trendDateKeys.length - 1]);
    }
  }, [selectedTrendDate, trendDateKeys]);

  const filteredNotes = useMemo(() => {
    if (!keyword) return noteRows;
    return noteRows.filter((item) => insightSearchText(item).includes(keyword));
  }, [keyword, noteRows]);

  const selectedDayNotes = useMemo(
    () =>
      filteredNotes
        .filter((item) => noteDateKey(item) === selectedTrendDate)
        .sort((a, b) => Number(b.interaction_score || 0) - Number(a.interaction_score || 0)),
    [filteredNotes, selectedTrendDate],
  );

  const personaDetailRows = useMemo(() => {
    if (!selectedPersona) return filteredNotes;
    return filteredNotes.filter((item) => (item.primary_target_persona || "未标注") === selectedPersona);
  }, [filteredNotes, selectedPersona]);

  const selectedNote = useMemo(
    () => selectedDayNotes.find((item) => item.note_id === selectedNoteId) || null,
    [selectedDayNotes, selectedNoteId],
  );

  useEffect(() => {
    if (selectedNoteId && !selectedNote) setSelectedNoteId("");
  }, [selectedNote, selectedNoteId]);

  const rangeStart = overview.minNoteDate || overview.minCapturedAt;
  const rangeEnd = overview.maxNoteDate || overview.maxCapturedAt;
  const rangeMeta = rangeStart
    ? `${formatDayLabel(rangeStart)} - ${formatDayLabel(rangeEnd)}`
    : "无数据";
  const activeRangeLabel =
    contentStart || contentEnd ? `${contentStart || "最早"} - ${contentEnd || "今天"}` : "累计";

  function applyQuickRange(days) {
    const maxNoteDate = /^\d{4}-\d{2}-\d{2}/.test(String(rangeEnd || "")) ? String(rangeEnd).slice(0, 10) : "";
    const end = maxNoteDate || draftEnd || todayInputValue();
    const next = rangeForLastDays(days, end);
    setDraftStart(next.start);
    setDraftEnd(next.end);
  }

  return (
    <>
      <section className="content-section">
        <div className="content-section-heading">
          <div>
            <div className="eyebrow">
              <BarChart3 size={15} />
              Note Data
            </div>
            <h2>笔记数据概览</h2>
          </div>
          <StatusPill tone="neutral">当前筛选 {activeRangeLabel}</StatusPill>
        </div>

        <section className="panel content-range-panel">
          <SectionHeader icon={Filter} title="周期筛选" />
          <div className="content-filter-row">
            <div className="content-range-actions">
              {[30, 90, 180].map((days) => (
                <button className="copy-button" onClick={() => applyQuickRange(days)} type="button" key={days}>
                  近{days}天
                </button>
              ))}
              <button
                className="copy-button"
                onClick={() => {
                  setDraftStart("");
                  setDraftEnd("");
                }}
                type="button"
              >
                清空
              </button>
            </div>
            <label>
              <span>开始日期</span>
              <input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} />
            </label>
            <label>
              <span>结束日期</span>
              <input type="date" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} />
            </label>
            <div className="content-range-meta">
              <span>数据范围</span>
              <strong>{rangeMeta}</strong>
            </div>
            <button className="primary-button content-apply-button" onClick={() => onContentRangeApply({ start: draftStart, end: draftEnd })} type="button">
              确定
            </button>
          </div>
        </section>

        <section className="stats-grid content-stats-grid">
          {contentMetricCards.map((item) => (
            <InsightMetricCard
              key={item.key}
              icon={item.icon}
              label={item.label}
              value={formatNumber(overview[item.overviewKey])}
              sub={item.sub}
              tone={item.tone}
              sparkRows={sparkRows}
              sparkKey={item.key}
            />
          ))}
        </section>

        <WordCloudPanel
          rows={noteRows}
          personas={personaRows}
          selectedPersona={wordCloudPersona}
          onPersonaChange={setWordCloudPersona}
        />

        <section className="panel content-trend-panel">
          <SectionHeader icon={Activity} title="笔记数据表现分布" action={<StatusPill tone="neutral">{loading && !data ? "加载中" : `${formatNumber(trendRows.length)} 天`}</StatusPill>} />
          <ContentTrendChart
            rows={trendRows}
            selectedDate={selectedTrendDate}
            onSelectDate={(date) => {
              setSelectedTrendDate(date);
              setSelectedNoteId("");
            }}
          />
          <DailyNoteRail
            date={selectedTrendDate}
            notes={selectedDayNotes}
            selectedNoteId={selectedNoteId}
            onSelectNote={setSelectedNoteId}
          />
        </section>

        <section className="panel panel-table">
          <SectionHeader
            icon={FileText}
            title="笔记明细"
            action={<StatusPill tone="neutral">{loading && !data ? "加载中" : `${formatNumber(filteredNotes.length)} 条`}</StatusPill>}
          />
          {loading && !data ? <div className="loading">加载中</div> : <InsightNoteTable rows={filteredNotes} />}
        </section>
      </section>

      <section className="content-section">
        <div className="content-section-heading">
          <div>
            <div className="eyebrow">
              <Users size={15} />
              Demand Analysis
            </div>
            <h2>笔记类型及目标人群分析</h2>
          </div>
        </div>

        <section className="content-insight-grid">
          <section className="panel">
            <SectionHeader icon={Database} title="笔记类型占比" />
            <TopicFrequencyList rows={topicRows} />
          </section>

          <section className="panel">
            <SectionHeader icon={Users} title="目标人群占比" />
            <PersonaPieChart rows={personaRows} selectedPersona={selectedPersona} onSelect={setSelectedPersona} />
          </section>
        </section>

        <section className="panel panel-table persona-detail-panel">
          <SectionHeader
            icon={Target}
            title="人群笔记明细"
            action={<StatusPill tone={selectedPersona ? "blue" : "neutral"}>{selectedPersona || "全部人群"}</StatusPill>}
          />
          <InsightNoteTable rows={personaDetailRows} compact />
        </section>
      </section>
      <NoteAnalysisBoard note={selectedNote} onClose={() => setSelectedNoteId("")} />
    </>
  );
}
