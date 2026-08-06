const { Pool } = require("pg");
const { permissionCatalog, requireAuth } = require("./_auth");

let pool;

const endataEndpointMeta = {
  "/v2/xhs/getstandardnoteinfo": {
    display_name_cn: "艺恩详情 API 调用",
    description_cn: "按 note_id 拉取标题、正文、发布时间、互动量、图片和视频封面；通常由笔记全流程编排在缺少成功详情时调用一次。",
    scripts: [
      { script_key: "watch_geo_note_ingest_queue", display_name_cn: "GEO 笔记队列 worker", scope: "GEO 新笔记入库" },
      { script_key: "sync_xhs_note_by_id", display_name_cn: "笔记全流程编排（缺详情才调艺恩）", scope: "GEO 单条补全" },
      { script_key: "xhs_author_pipeline", display_name_cn: "麦富迪作者管线", scope: "麦富迪作者笔记详情" },
    ],
  },
  "/v2/xhs/getstandardusernotelist": {
    display_name_cn: "账号笔记列表",
    description_cn: "按小红书作者/账号分页拉取笔记列表，用于发现账号近期内容和后续详情抓取。",
    scripts: [
      { script_key: "xhs_author_pipeline", display_name_cn: "麦富迪作者管线", scope: "按作者拉取笔记列表" },
    ],
  },
  "/v2/xhs/getxhsnotelist_gb": {
    display_name_cn: "品牌/关键词笔记列表",
    description_cn: "按品牌词或关键词拉取小红书笔记列表，用于麦富迪品牌池和爆文候选发现。",
    scripts: [
      { script_key: "sync_xhs_maifudi_notes", display_name_cn: "麦富迪品牌笔记同步", scope: "按品牌/关键词拉取候选笔记" },
    ],
  },
  "/v2/xhs/getstandardcommentinfo": {
    display_name_cn: "小红书笔记评论信息",
    description_cn: "按笔记拉取评论相关数据，用于判断评论区情绪反馈、争议点和可复用互动钩子；目前该路径只在艺恩余额快照中出现，具体调用脚本需要接入网关日志后精确归因。",
    scripts: [
      { script_key: "untracked_endata_comment_consumer", display_name_cn: "未接入网关的评论抓取", scope: "余额快照已记录消耗，等待脚本接入 geo_ops_api_call_logs" },
    ],
  },
};

const endataEndpointCatalog = Object.entries(endataEndpointMeta).map(([url, meta]) => ({
  url,
  display_name_cn: meta.display_name_cn,
  description_cn: meta.description_cn,
  scripts: meta.scripts,
}));

function enrichEndataEndpoint(row) {
  const url = String(row.url || "").toLowerCase();
  const meta = endataEndpointMeta[url] || {
    display_name_cn: row.url || "未知艺恩接口",
    description_cn: "未登记中文解释的艺恩接口，需要根据实际脚本调用补充说明。",
    scripts: [{ script_key: "unknown", display_name_cn: "未登记脚本", scope: "等待脚本接入调用日志" }],
  };
  return {
    ...row,
    display_name_cn: meta.display_name_cn,
    description_cn: meta.description_cn,
    scripts: meta.scripts,
  };
}

function getPoolConfig() {
  const ssl = process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false;
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl, max: 2, idleTimeoutMillis: 30000 };

  const requiredEnv = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  if (!requiredEnv.every((key) => Boolean(process.env[key]))) return null;
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl,
    max: 2,
    idleTimeoutMillis: 30000,
  };
}

function getPool() {
  const config = getPoolConfig();
  if (!config) return null;
  if (!pool) pool = new Pool(config);
  return pool;
}

async function query(client, text, params = []) {
  const { rows } = await client.query(text, params);
  return rows;
}

function queryValue(req, key) {
  if (req.query && req.query[key] !== undefined) return Array.isArray(req.query[key]) ? req.query[key][0] : req.query[key];
  try {
    const url = new URL(req.url || "", "http://localhost");
    return url.searchParams.get(key);
  } catch {
    return "";
  }
}

function parseApiDate(req) {
  const value = String(queryValue(req, "apiDate") || "").trim();
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function parseDateParam(req, key) {
  const value = String(queryValue(req, key) || "").trim();
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function canAccess(user, permission) {
  return Boolean(user && (user.role === "admin" || user.permissions?.[permission] === true));
}

function sampleData() {
  return {
    source: "sample",
    generatedAt: new Date().toISOString(),
    overview: {
      noteDetailSuccess: 90,
      noteDetailFailed: 110,
      assetSuccess: 90,
      vectorCount: 90,
      contentAssetSuccessRuns: 90,
      contentAssetFailedRuns: 6,
      minPublishTime: "2024-11-08T00:00:00.000Z",
      maxPublishTime: "2026-07-31T00:00:00.000Z",
    },
    contentInsight: {
      range: {
        start: "",
        end: "",
        minNoteDate: "2026-05-31T00:00:00.000Z",
        maxNoteDate: "2026-07-19T00:00:00.000Z",
        minCapturedAt: "2026-05-31T00:00:00.000Z",
        maxCapturedAt: "2026-07-19T00:00:00.000Z",
      },
      overview: {
        noteTotal: 90,
        interactionTotal: 128460,
        likeTotal: 82400,
        collectedTotal: 28600,
        commentsTotal: 8740,
        minNoteDate: "2026-05-31T00:00:00.000Z",
        maxNoteDate: "2026-07-19T00:00:00.000Z",
        minCapturedAt: "2026-05-31T00:00:00.000Z",
        maxCapturedAt: "2026-07-19T00:00:00.000Z",
      },
      topicFrequency: [
        { core_topic_category: "GEO避坑", note_count: 24, share_pct: 26.67 },
        { core_topic_category: "AI搜索优化", note_count: 19, share_pct: 21.11 },
        { core_topic_category: "品牌流量增长", note_count: 16, share_pct: 17.78 },
      ],
      personaDistribution: [
        { primary_target_persona: "垂直探路者", note_count: 36, share_pct: 40 },
        { primary_target_persona: "行业焦虑决策者", note_count: 28, share_pct: 31.11 },
        { primary_target_persona: "行业观望者", note_count: 18, share_pct: 20 },
      ],
      noteAnalysis: [
        {
          note_id: "6a1ba9a10000000006031daa",
          title: "每天拆解一个运营知识-GEO排名优化",
          content_excerpt: "GEO 不只是把关键词塞进标题，而是让 AI 搜索能识别你的专业答案、案例证据和可信来源。先搭建内容资产，再用结构化表达把解决方案讲清楚。",
          author_nickname: "GEO增长研究所",
          note_date: "2026-05-31T00:00:00.000Z",
          captured_at: "2026-08-04T00:00:00.000Z",
          publish_time: "2026-05-31T00:00:00.000Z",
          note_type: "图文",
          core_topic_category: "GEO避坑",
          primary_target_persona: "垂直探路者",
          target_persona_tags: ["垂直探路者", "行业焦虑决策者"],
          target_persona_reason: "内容先解释操作路径，再给验证指标，适合已经准备试水 GEO 的运营和业务负责人。",
          primary_industry: "数字营销/内容运营",
          industry_tags: ["数字营销", "内容运营", "AI营销"],
          funnel_role: "信任",
          funnel_role_reason: "通过拆解方法论降低理解成本，帮助账号建立专业可信度。",
          like_count: 612,
          collected_count: 240,
          comments_count: 58,
          share_count: 18,
          interaction_score: 968,
          fresh_hot_score: 361.2,
          true_pain_label: "决策困难+效率问题",
          pain_description: "担心错过 AI 搜索流量入口，但不知道从哪里开始做。",
          pain_evidence: "评论区集中询问操作步骤、检测工具和投入优先级。",
          pain_authenticity: "真实痛点",
          pain_confidence: 0.86,
          business_relevance_score: 0.91,
          llm_confidence: 0.84,
          knowledge_points: [
            { point: "GEO 内容结构", explanation: "让模型识别结论、证据、场景和可信来源。", reuse_angle: "适合复用为教程型选题" },
          ],
          reusable_angles: [
            { angle: "从 SEO 到 GEO 的迁移清单", suitable_persona: "垂直探路者", suggested_funnel_role: "信任", why_it_works: "用旧认知承接新概念" },
          ],
          title_templates: ["{{行业}}做GEO前，先把这{{数字}}件事想清楚"],
          business_logic: "用清单式步骤把复杂概念拆成可执行动作。",
          content_logic: "先抛结论，再拆误区、步骤和验证指标。",
          hook_types: ["避坑", "清单"],
          cta_strategy: "适合引导用户领取检查清单或咨询诊断。",
          risk_flags: ["不要承诺绝对排名"],
          visual_group_style_prompt: "白底知识卡片，蓝黑正文，关键结论用浅黄色强调，高信息密度，适合小红书竖图教程。",
          visual_main_colors: "白色、蓝色、黑色、浅黄色",
          visual_emotion: "专业、可信、可执行",
          information_density_level: "高密度",
          information_density_reason: "单图承载结论、步骤和指标，文字较多但层级清晰。",
          layout_structure: "顶部抛结论，中部三步拆解，底部给行动检查项。",
          cover_text_logic: "用反常识标题打破只做 SEO 的旧认知。",
          asset_text_excerpt: "这条笔记适合沉淀为 GEO 入门教程资产，核心价值在于把抽象概念拆成业务可执行步骤。",
          note_url: "",
        },
      ],
      trendDaily: [
        { bucket_date: "2026-07-13", note_count: 8, like_total: 5200, collected_total: 1800, comments_total: 360 },
        { bucket_date: "2026-07-14", note_count: 10, like_total: 6800, collected_total: 2400, comments_total: 420 },
        { bucket_date: "2026-07-15", note_count: 7, like_total: 4300, collected_total: 1600, comments_total: 310 },
        { bucket_date: "2026-07-16", note_count: 12, like_total: 7600, collected_total: 3100, comments_total: 540 },
        { bucket_date: "2026-07-17", note_count: 15, like_total: 9800, collected_total: 3900, comments_total: 690 },
        { bucket_date: "2026-07-18", note_count: 16, like_total: 11200, collected_total: 4200, comments_total: 730 },
        { bucket_date: "2026-07-19", note_count: 22, like_total: 13600, collected_total: 5200, comments_total: 920 },
      ],
      sparklineDaily: [
        { bucket_date: "2026-07-13", note_count: 8, like_total: 5200, collected_total: 1800, comments_total: 360 },
        { bucket_date: "2026-07-14", note_count: 10, like_total: 6800, collected_total: 2400, comments_total: 420 },
        { bucket_date: "2026-07-15", note_count: 7, like_total: 4300, collected_total: 1600, comments_total: 310 },
        { bucket_date: "2026-07-16", note_count: 12, like_total: 7600, collected_total: 3100, comments_total: 540 },
        { bucket_date: "2026-07-17", note_count: 15, like_total: 9800, collected_total: 3900, comments_total: 690 },
        { bucket_date: "2026-07-18", note_count: 16, like_total: 11200, collected_total: 4200, comments_total: 730 },
        { bucket_date: "2026-07-19", note_count: 22, like_total: 13600, collected_total: 5200, comments_total: 920 },
      ],
    },
    queueStatus: [{ status: "success", count: 199 }],
    topFresh: [
      {
        note_id: "6a1ba9a10000000006031daa",
        title: "每天拆解一个运营知识-GEO排名优化",
        publish_time: "2026-05-31T00:00:00.000Z",
        interaction_score: 968,
        fresh_hot_score: 361.2,
        true_pain_label: "决策困难+效率问题",
        primary_target_persona: "垂直探路者",
        target_persona_tags: ["垂直探路者", "行业观望者", "行业焦虑决策者"],
        primary_industry: "数字营销/内容运营",
        industry_tags: ["数字营销", "内容运营", "AI营销", "MarTech"],
        funnel_role: "信任",
      },
    ],
    personaDistribution: [
      { target_persona: "垂直探路者", note_count: 36, avg_fresh_hot_score: 68.2 },
      { target_persona: "行业焦虑决策者", note_count: 28, avg_fresh_hot_score: 74.6 },
      { target_persona: "行业观望者", note_count: 18, avg_fresh_hot_score: 51.4 },
    ],
    funnelDistribution: [
      { funnel_role: "信任", note_count: 42, avg_fresh_hot_score: 58.6 },
      { funnel_role: "曝光", note_count: 29, avg_fresh_hot_score: 83.1 },
      { funnel_role: "转化", note_count: 19, avg_fresh_hot_score: 47.3 },
    ],
    industryDistribution: [
      { industry: "AI营销", note_count: 40, avg_fresh_hot_score: 62.3 },
      { industry: "数字营销", note_count: 32, avg_fresh_hot_score: 59.8 },
      { industry: "内容运营", note_count: 24, avg_fresh_hot_score: 53.1 },
    ],
    painMap: [
      {
        true_pain_label: "决策困难+效率问题",
        pain_authenticity: "真实痛点",
        note_count: 12,
        avg_fresh_hot_score: 81.4,
        example_note_ids: ["6a1ba9a10000000006031daa"],
      },
    ],
    visualPatterns: [
      {
        information_density_level: "超高密度",
        visual_main_colors: "暖米黄、红色、黑色、绿色点缀",
        visual_emotion: "专业可信、知识沉淀感",
        note_count: 21,
        avg_fresh_hot_score: 76.9,
      },
    ],
    recentRuns: [],
    failedQueue: [],
    ops: {
      overview: {
        apiCallsTotal: 1219,
        apiCallsFailed: 139,
        totalTokens: 1018740,
        runningScripts: 2,
        activeProviders: 6,
        activeModels: 4,
      },
      apiStatusSummary: [
        {
          provider_code: "volcengine_ark_chat",
          display_name_cn: "豆包内容资产总结",
          provider_type: "llm_chat",
          calls_total: 1,
          calls_success: 1,
          calls_failed: 0,
          total_tokens: 13246,
          avg_latency_ms: 48200,
          latest_started_at: "2026-08-04T14:29:52.122Z",
        },
        {
          provider_code: "kimi_chat",
          display_name_cn: "Kimi 历史内容资产总结",
          provider_type: "llm_chat",
          calls_total: 96,
          calls_success: 90,
          calls_failed: 6,
          total_tokens: 1018740,
          avg_latency_ms: 50000,
          latest_started_at: "2026-08-04T02:06:17.122Z",
        },
      ],
      apiUsage: { hourly: [], daily: [], weekly: [] },
      modelUsageSummary: [],
      scriptRunSummary: [],
      recentScriptRuns: [],
      scriptEvents: [],
      endataBalance: {
        latestSnapshots: [
          {
            range_key: "today",
            begin_code: "20260804",
            end_code: "20260804",
            sampled_at: "2026-08-04T06:36:00.000Z",
            ok: true,
            residue_fee: 9992.56,
            previous_residue_fee: 9992.57,
            balance_delta: -0.01,
            success_count: 7681,
            previous_success_count: 7680,
            success_count_delta: 1,
            snapshot_count: 120,
            latency_ms: 420,
          },
        ],
        endpoints: [
          {
            url: "/v2/xhs/getstandardnoteinfo",
            display_name_cn: "艺恩详情 API 调用",
            description_cn: "按 note_id 拉取标题、正文、发布时间、互动量、图片和视频封面；通常由笔记全流程编排在缺少成功详情时调用一次。",
            count: 6925,
            previous_count: 6924,
            count_delta: 1,
            share_pct: 90.16,
            sampled_at: "2026-08-04T06:36:00.000Z",
            scripts: endataEndpointMeta["/v2/xhs/getstandardnoteinfo"].scripts,
          },
          {
            url: "/v2/xhs/getstandardusernotelist",
            display_name_cn: "账号笔记列表",
            description_cn: "按小红书作者/账号分页拉取笔记列表，用于发现账号近期内容和后续详情抓取。",
            count: 477,
            previous_count: 477,
            count_delta: 0,
            share_pct: 6.21,
            sampled_at: "2026-08-04T06:36:00.000Z",
            scripts: endataEndpointMeta["/v2/xhs/getstandardusernotelist"].scripts,
          },
          {
            url: "/v2/xhs/getxhsnotelist_gb",
            display_name_cn: "品牌/关键词笔记列表",
            description_cn: "按品牌词或关键词拉取小红书笔记列表，用于麦富迪品牌池和爆文候选发现。",
            count: 279,
            previous_count: 279,
            count_delta: 0,
            share_pct: 3.63,
            sampled_at: "2026-08-04T06:36:00.000Z",
            scripts: endataEndpointMeta["/v2/xhs/getxhsnotelist_gb"].scripts,
          },
          {
            url: "/v2/xhs/getstandardcommentinfo",
            display_name_cn: "小红书笔记评论信息",
            description_cn: "按笔记拉取评论相关数据，用于判断评论区情绪反馈、争议点和可复用互动钩子；目前该路径只在艺恩余额快照中出现，具体调用脚本需要接入网关日志后精确归因。",
            count: 17,
            previous_count: 17,
            count_delta: 0,
            share_pct: 0.22,
            sampled_at: "2026-08-04T06:36:00.000Z",
            scripts: endataEndpointMeta["/v2/xhs/getstandardcommentinfo"].scripts,
          },
        ],
        endpointHistory: [
          { bucket_start: "2026-08-04T06:34:00.000Z", url: "/v2/xhs/getstandardnoteinfo", display_name_cn: "艺恩详情 API 调用", count: 6923, share_pct: 90.16 },
          { bucket_start: "2026-08-04T06:35:00.000Z", url: "/v2/xhs/getstandardnoteinfo", display_name_cn: "艺恩详情 API 调用", count: 6924, share_pct: 90.16 },
          { bucket_start: "2026-08-04T06:36:00.000Z", url: "/v2/xhs/getstandardnoteinfo", display_name_cn: "艺恩详情 API 调用", count: 6925, share_pct: 90.16 },
          { bucket_start: "2026-08-04T06:34:00.000Z", url: "/v2/xhs/getstandardusernotelist", display_name_cn: "账号笔记列表", count: 477, share_pct: 6.21 },
          { bucket_start: "2026-08-04T06:35:00.000Z", url: "/v2/xhs/getstandardusernotelist", display_name_cn: "账号笔记列表", count: 477, share_pct: 6.21 },
          { bucket_start: "2026-08-04T06:36:00.000Z", url: "/v2/xhs/getstandardusernotelist", display_name_cn: "账号笔记列表", count: 477, share_pct: 6.21 },
          { bucket_start: "2026-08-04T06:34:00.000Z", url: "/v2/xhs/getstandardcommentinfo", display_name_cn: "小红书笔记评论信息", count: 17, share_pct: 0.22 },
          { bucket_start: "2026-08-04T06:35:00.000Z", url: "/v2/xhs/getstandardcommentinfo", display_name_cn: "小红书笔记评论信息", count: 17, share_pct: 0.22 },
          { bucket_start: "2026-08-04T06:36:00.000Z", url: "/v2/xhs/getstandardcommentinfo", display_name_cn: "小红书笔记评论信息", count: 17, share_pct: 0.22 },
        ],
        scriptUsageHourly: [
          {
            bucket_start: "2026-08-04T06:00:00.000Z",
            script_key: "watch_geo_note_ingest_queue",
            display_name_cn: "GEO 笔记队列 worker",
            url: "/v2/xhs/getstandardnoteinfo",
            endpoint_display_name_cn: "艺恩详情 API 调用",
            operation: "note_detail_fetch",
            calls_total: 8,
            calls_success: 8,
            calls_failed: 0,
          },
        ],
      },
      modelConfigs: [],
      credentials: [],
      rateLimitRules: [],
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const dbPool = getPool();
  if (!dbPool) {
    res.status(200).json(sampleData());
    return;
  }

  let user;
  try {
    user = await requireAuth(req, res);
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message || "认证失败" });
    return;
  }
  if (!user) return;

  const apiDate = parseApiDate(req);
  const apiDateParams = apiDate ? [apiDate] : [];
  const apiDateWhere = apiDate ? "l.started_at >= $1::date AND l.started_at < $1::date + interval '1 day'" : "TRUE";
  const apiDateJoin = apiDate ? "AND l.started_at >= $1::date AND l.started_at < $1::date + interval '1 day'" : "";
  const contentStart = parseDateParam(req, "contentStart");
  const contentEnd = parseDateParam(req, "contentEnd");
  const contentParams = [];
  const contentDateColumn = "COALESCE(a.publish_time, n.publish_time)";
  const contentWhereParts = ["a.analysis_status = 'success'", `${contentDateColumn} IS NOT NULL`];
  if (contentStart) {
    contentParams.push(contentStart);
    contentWhereParts.push(`${contentDateColumn} >= $${contentParams.length}::date`);
  }
  if (contentEnd) {
    contentParams.push(contentEnd);
    contentWhereParts.push(`${contentDateColumn} < $${contentParams.length}::date + interval '1 day'`);
  }
  const contentWhere = contentWhereParts.join(" AND ");

  const client = await dbPool.connect();
  try {
    const [
      overviewRows,
      recentApiCalls,
      apiFailureReasons,
      queueStatus,
      topFresh,
      personaDistribution,
      funnelDistribution,
      industryDistribution,
      painMap,
      visualPatterns,
      recentRuns,
      failedQueue,
      contentOverviewRows,
      contentTopicFrequency,
      contentPersonaDistribution,
      contentNoteAnalysis,
      contentTrendDaily,
      contentSparklineDaily,
      fixedContentNotes,
      opsOverviewRows,
      apiStatusSummary,
      apiUsageHourly,
      apiUsageDaily,
      apiUsageWeekly,
      modelUsageSummary,
      scriptRunSummary,
      recentScriptRuns,
      scriptEvents,
      endataLatestSnapshots,
      endataEndpointDetails,
      endataEndpointHistoryHourly,
      endataEndpointHistoryDaily,
      endataScriptUsageHourly,
      endataScriptUsageDaily,
      modelConfigs,
      credentials,
      rateLimitRules,
    ] = await Promise.all([
      query(
        client,
        `
        SELECT
          (SELECT count(*)::int FROM public.note_details WHERE detail_status='success') AS "noteDetailSuccess",
          (SELECT count(*)::int FROM public.note_details WHERE detail_status='failed') AS "noteDetailFailed",
          (SELECT count(*)::int FROM public.geo_note_content_assets WHERE analysis_status='success') AS "assetSuccess",
          (SELECT count(*)::int FROM public.geo_note_content_asset_vectors) AS "vectorCount",
          (SELECT count(*)::int FROM public.geo_note_content_asset_runs WHERE status='success') AS "contentAssetSuccessRuns",
          (SELECT count(*)::int FROM public.geo_note_content_asset_runs WHERE status='failed') AS "contentAssetFailedRuns",
          (SELECT min(publish_time) FROM public.geo_note_content_assets WHERE analysis_status='success') AS "minPublishTime",
          (SELECT max(publish_time) FROM public.geo_note_content_assets WHERE analysis_status='success') AS "maxPublishTime"
        `,
      ),
      query(
        client,
        `
        SELECT
          l.api_call_id,
          l.provider_code,
          r.display_name_cn,
          r.provider_type,
          l.operation,
          l.status,
          l.http_status,
          l.note_id,
          COALESCE(
            NULLIF(n.title, ''),
            NULLIF(a.title, ''),
            NULLIF(n.source_title, ''),
            NULLIF(left(trim(regexp_replace(COALESCE(n.content, a.content, n.source_content, ''), '[[:space:]]+', ' ', 'g')), 80), ''),
            ''
          ) AS note_title,
          COALESCE(m.model_name, '') AS model_name,
          l.started_at,
          l.latency_ms,
          l.total_tokens,
          l.error_code,
          left(l.error_message, 240) AS error_message
        FROM public.geo_ops_api_call_logs l
        JOIN public.geo_ops_api_registry r ON r.provider_code = l.provider_code
        LEFT JOIN public.geo_ops_model_configs m ON m.model_config_id = l.model_config_id
        LEFT JOIN public.note_details n ON n.note_id = l.note_id
        LEFT JOIN public.geo_note_content_assets a ON a.note_id = l.note_id
        WHERE ${apiDateWhere}
        ORDER BY l.started_at DESC, l.api_call_id DESC
        LIMIT 500
        `,
        apiDateParams,
      ),
      query(
        client,
        `
        SELECT
          l.provider_code,
          l.status,
          COALESCE(l.error_code, 'business_or_unknown') AS error_code,
          COALESCE(NULLIF(l.error_message, ''), 'NULL_TEXT') AS error_message,
          count(*)::int AS count,
          min(l.started_at) AS first_started_at,
          max(l.started_at) AS latest_started_at
        FROM public.geo_ops_api_call_logs l
        WHERE l.status <> 'success'
          AND ${apiDateWhere}
        GROUP BY l.provider_code, l.status, COALESCE(l.error_code, 'business_or_unknown'), COALESCE(NULLIF(l.error_message, ''), 'NULL_TEXT')
        ORDER BY count DESC, l.provider_code
        LIMIT 40
        `,
        apiDateParams,
      ),
      query(
        client,
        `
        SELECT status, count(*)::int
        FROM public.geo_note_ingest_queue
        GROUP BY status
        ORDER BY status
        `,
      ),
      query(
        client,
        `
        SELECT
          note_id,
          title,
          publish_time,
          interaction_score,
          round(fresh_hot_score::numeric, 2)::float AS fresh_hot_score,
          true_pain_label,
          primary_target_persona,
          target_persona_tags,
          primary_industry,
          industry_tags,
          funnel_role
        FROM public.geo_note_content_assets
        WHERE analysis_status = 'success'
        ORDER BY fresh_hot_score DESC NULLS LAST
        LIMIT 12
        `,
      ),
      query(
        client,
        `
        SELECT
          tag AS target_persona,
          count(*)::int AS note_count,
          round(avg(fresh_hot_score)::numeric, 2)::float AS avg_fresh_hot_score
        FROM public.geo_note_content_assets a
        CROSS JOIN LATERAL unnest(a.target_persona_tags) AS tag
        WHERE a.analysis_status = 'success'
        GROUP BY tag
        ORDER BY note_count DESC, avg_fresh_hot_score DESC
        LIMIT 10
        `,
      ),
      query(
        client,
        `
        SELECT
          funnel_role,
          count(*)::int AS note_count,
          round(avg(fresh_hot_score)::numeric, 2)::float AS avg_fresh_hot_score
        FROM public.geo_note_content_assets
        WHERE analysis_status = 'success'
        GROUP BY funnel_role
        ORDER BY note_count DESC
        `,
      ),
      query(
        client,
        `
        SELECT
          tag AS industry,
          count(*)::int AS note_count,
          round(avg(fresh_hot_score)::numeric, 2)::float AS avg_fresh_hot_score
        FROM public.geo_note_content_assets a
        CROSS JOIN LATERAL unnest(a.industry_tags) AS tag
        WHERE a.analysis_status = 'success'
        GROUP BY tag
        ORDER BY note_count DESC, avg_fresh_hot_score DESC
        LIMIT 12
        `,
      ),
      query(
        client,
        `
        SELECT
          true_pain_label,
          pain_authenticity,
          count(*)::int AS note_count,
          round(avg(fresh_hot_score)::numeric, 2)::float AS avg_fresh_hot_score,
          (array_agg(note_id ORDER BY fresh_hot_score DESC))[1:4] AS example_note_ids
        FROM public.geo_note_content_assets
        WHERE analysis_status = 'success'
        GROUP BY true_pain_label, pain_authenticity
        ORDER BY note_count DESC, avg_fresh_hot_score DESC
        LIMIT 10
        `,
      ),
      query(
        client,
        `
        SELECT
          information_density_level,
          visual_main_colors,
          visual_emotion,
          count(*)::int AS note_count,
          round(avg(fresh_hot_score)::numeric, 2)::float AS avg_fresh_hot_score
        FROM public.geo_note_content_assets
        WHERE analysis_status = 'success'
        GROUP BY information_density_level, visual_main_colors, visual_emotion
        ORDER BY avg_fresh_hot_score DESC NULLS LAST, note_count DESC
        LIMIT 10
        `,
      ),
      query(
        client,
        `
        SELECT
          run_id,
          note_id,
          model_name,
          status,
          latency_ms,
          created_at
        FROM public.geo_note_content_asset_runs
        ORDER BY run_id DESC
        LIMIT 8
        `,
      ),
      query(
        client,
        `
        SELECT
          queue_id,
          note_id,
          status,
          attempts,
          max_attempts,
          left(last_error, 200) AS error_preview,
          updated_at
        FROM public.geo_note_ingest_queue
        WHERE status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 8
        `,
      ),
      query(
        client,
        `
        SELECT
          count(DISTINCT a.note_id)::int AS "noteTotal",
          COALESCE(sum(a.interaction_score), 0)::bigint AS "interactionTotal",
          COALESCE(sum(a.like_count), 0)::bigint AS "likeTotal",
          COALESCE(sum(a.collected_count), 0)::bigint AS "collectedTotal",
          COALESCE(sum(a.comments_count), 0)::bigint AS "commentsTotal",
          min(${contentDateColumn}) AS "minNoteDate",
          max(${contentDateColumn}) AS "maxNoteDate",
          min(${contentDateColumn}) AS "minCapturedAt",
          max(${contentDateColumn}) AS "maxCapturedAt",
          min(a.publish_time) AS "minPublishTime",
          max(a.publish_time) AS "maxPublishTime"
        FROM public.geo_note_content_assets a
        LEFT JOIN public.note_details n ON n.note_id = a.note_id
        WHERE ${contentWhere}
        `,
        contentParams,
      ),
      query(
        client,
        `
        SELECT
          COALESCE(NULLIF(trim(a.core_topic_category), ''), '未标注') AS core_topic_category,
          count(*)::int AS note_count,
          round((count(*)::numeric * 100) / NULLIF(sum(count(*)) OVER (), 0), 2)::float AS share_pct
        FROM public.geo_note_content_assets a
        LEFT JOIN public.note_details n ON n.note_id = a.note_id
        WHERE ${contentWhere}
        GROUP BY COALESCE(NULLIF(trim(a.core_topic_category), ''), '未标注')
        ORDER BY note_count DESC, core_topic_category
        LIMIT 100
        `,
        contentParams,
      ),
      query(
        client,
        `
        SELECT
          COALESCE(NULLIF(trim(a.primary_target_persona), ''), '未标注') AS primary_target_persona,
          count(*)::int AS note_count,
          round((count(*)::numeric * 100) / NULLIF(sum(count(*)) OVER (), 0), 2)::float AS share_pct
        FROM public.geo_note_content_assets a
        LEFT JOIN public.note_details n ON n.note_id = a.note_id
        WHERE ${contentWhere}
        GROUP BY COALESCE(NULLIF(trim(a.primary_target_persona), ''), '未标注')
        ORDER BY note_count DESC, primary_target_persona
        `,
        contentParams,
      ),
      query(
        client,
        `
        SELECT
          a.note_id,
          COALESCE(
            NULLIF(a.title, ''),
            NULLIF(n.title, ''),
            NULLIF(n.source_title, ''),
            NULLIF(left(trim(regexp_replace(COALESCE(a.content, n.content, n.source_content, ''), '[[:space:]]+', ' ', 'g')), 80), ''),
            a.note_id
          ) AS title,
          left(trim(regexp_replace(COALESCE(a.content, n.content, n.source_content, ''), '[[:space:]]+', ' ', 'g')), 720) AS content_excerpt,
          a.author_nickname,
          ${contentDateColumn} AS note_date,
          n.fetched_at AS captured_at,
          a.publish_time,
          a.note_type,
          a.core_topic_category,
          COALESCE(NULLIF(trim(a.primary_target_persona), ''), '未标注') AS primary_target_persona,
          a.target_persona_tags,
          a.target_persona_reason,
          a.primary_industry,
          a.industry_tags,
          a.funnel_role,
          a.funnel_role_reason,
          a.like_count,
          a.collected_count,
          a.comments_count,
          a.share_count,
          a.interaction_score,
          round(a.fresh_hot_score::numeric, 2)::float AS fresh_hot_score,
          a.true_pain_label,
          a.pain_description,
          a.pain_evidence,
          a.pain_authenticity,
          round(a.pain_confidence::numeric, 2)::float AS pain_confidence,
          round(a.business_relevance_score::numeric, 2)::float AS business_relevance_score,
          round(a.llm_confidence::numeric, 2)::float AS llm_confidence,
          a.knowledge_points,
          a.reusable_angles,
          a.title_templates,
          a.business_logic,
          a.content_logic,
          a.hook_types,
          a.cta_strategy,
          a.risk_flags,
          a.visual_group_style_prompt,
          a.visual_main_colors,
          a.visual_emotion,
          a.information_density_level,
          a.information_density_reason,
          a.layout_structure,
          a.cover_text_logic,
          left(COALESCE(a.asset_text, ''), 1200) AS asset_text_excerpt,
          a.note_url
        FROM public.geo_note_content_assets a
        LEFT JOIN public.note_details n ON n.note_id = a.note_id
        WHERE ${contentWhere}
        ORDER BY a.interaction_score DESC NULLS LAST, ${contentDateColumn} DESC NULLS LAST
        LIMIT 1000
        `,
        contentParams,
      ),
      query(
        client,
        `
        SELECT
          ${contentDateColumn}::date AS bucket_date,
          count(DISTINCT a.note_id)::int AS note_count,
          COALESCE(sum(a.like_count), 0)::bigint AS like_total,
          COALESCE(sum(a.collected_count), 0)::bigint AS collected_total,
          COALESCE(sum(a.comments_count), 0)::bigint AS comments_total
        FROM public.geo_note_content_assets a
        LEFT JOIN public.note_details n ON n.note_id = a.note_id
        WHERE ${contentWhere}
        GROUP BY ${contentDateColumn}::date
        ORDER BY bucket_date
        `,
        contentParams,
      ),
      query(
        client,
        `
        WITH bounds AS (
          SELECT COALESCE(max(${contentDateColumn})::date, CURRENT_DATE) AS end_day
          FROM public.geo_note_content_assets a
          LEFT JOIN public.note_details n ON n.note_id = a.note_id
          WHERE a.analysis_status = 'success'
        ),
        days AS (
          SELECT generate_series((SELECT end_day - 29 FROM bounds), (SELECT end_day FROM bounds), interval '1 day')::date AS bucket_date
        ),
        agg AS (
          SELECT
            ${contentDateColumn}::date AS bucket_date,
            count(DISTINCT a.note_id)::int AS note_count,
            COALESCE(sum(a.like_count), 0)::bigint AS like_total,
            COALESCE(sum(a.collected_count), 0)::bigint AS collected_total,
            COALESCE(sum(a.comments_count), 0)::bigint AS comments_total
          FROM public.geo_note_content_assets a
          LEFT JOIN public.note_details n ON n.note_id = a.note_id
          WHERE a.analysis_status = 'success'
            AND ${contentDateColumn} >= (SELECT end_day - 29 FROM bounds)
            AND ${contentDateColumn} < (SELECT end_day + 1 FROM bounds)
          GROUP BY ${contentDateColumn}::date
        )
        SELECT
          d.bucket_date,
          COALESCE(a.note_count, 0)::int AS note_count,
          COALESCE(a.like_total, 0)::bigint AS like_total,
          COALESCE(a.collected_total, 0)::bigint AS collected_total,
          COALESCE(a.comments_total, 0)::bigint AS comments_total
        FROM days d
        LEFT JOIN agg a ON a.bucket_date = d.bucket_date
        ORDER BY d.bucket_date
        `,
      ),
      query(
        client,
        `
        WITH bounds AS (
          SELECT COALESCE(max(${contentDateColumn})::date, CURRENT_DATE) AS end_day
          FROM public.geo_note_content_assets a
          LEFT JOIN public.note_details n ON n.note_id = a.note_id
          WHERE a.analysis_status = 'success'
            AND ${contentDateColumn} IS NOT NULL
        )
        SELECT
          a.note_id,
          COALESCE(
            NULLIF(a.title, ''),
            NULLIF(n.title, ''),
            NULLIF(n.source_title, ''),
            NULLIF(left(trim(regexp_replace(COALESCE(a.content, n.content, n.source_content, ''), '[[:space:]]+', ' ', 'g')), 80), ''),
            a.note_id
          ) AS title,
          left(trim(regexp_replace(COALESCE(a.content, n.content, n.source_content, ''), '[[:space:]]+', ' ', 'g')), 720) AS content_excerpt,
          a.author_nickname,
          ${contentDateColumn} AS note_date,
          n.fetched_at AS captured_at,
          a.publish_time,
          a.note_type,
          a.core_topic_category,
          COALESCE(NULLIF(trim(a.primary_target_persona), ''), '未标注') AS primary_target_persona,
          a.target_persona_tags,
          a.target_persona_reason,
          a.primary_industry,
          a.industry_tags,
          a.funnel_role,
          a.funnel_role_reason,
          a.like_count,
          a.collected_count,
          a.comments_count,
          a.share_count,
          a.interaction_score,
          round(a.fresh_hot_score::numeric, 2)::float AS fresh_hot_score,
          a.true_pain_label,
          a.pain_description,
          a.pain_evidence,
          a.pain_authenticity,
          round(a.pain_confidence::numeric, 2)::float AS pain_confidence,
          round(a.business_relevance_score::numeric, 2)::float AS business_relevance_score,
          round(a.llm_confidence::numeric, 2)::float AS llm_confidence,
          a.knowledge_points,
          a.reusable_angles,
          a.title_templates,
          a.business_logic,
          a.content_logic,
          a.hook_types,
          a.cta_strategy,
          a.risk_flags,
          a.visual_group_style_prompt,
          a.visual_main_colors,
          a.visual_emotion,
          a.information_density_level,
          a.information_density_reason,
          a.layout_structure,
          a.cover_text_logic,
          left(COALESCE(a.asset_text, ''), 1200) AS asset_text_excerpt,
          a.note_url
        FROM public.geo_note_content_assets a
        LEFT JOIN public.note_details n ON n.note_id = a.note_id
        CROSS JOIN bounds b
        WHERE a.analysis_status = 'success'
          AND ${contentDateColumn} IS NOT NULL
          AND ${contentDateColumn} >= b.end_day - interval '29 days'
          AND ${contentDateColumn} < b.end_day + interval '1 day'
        ORDER BY a.interaction_score DESC NULLS LAST, a.fresh_hot_score DESC NULLS LAST, ${contentDateColumn} DESC NULLS LAST
        LIMIT 240
        `,
      ),
      query(
        client,
        `
        SELECT
          (SELECT count(*)::int FROM public.geo_ops_api_call_logs) AS "apiCallsTotal",
          (SELECT count(*)::int FROM public.geo_ops_api_call_logs WHERE status <> 'success') AS "apiCallsFailed",
          (SELECT COALESCE(sum(total_tokens), 0)::bigint FROM public.geo_ops_api_call_logs) AS "totalTokens",
          (SELECT count(*)::int FROM public.geo_ops_script_runs WHERE status = 'running') AS "runningScripts",
          (SELECT count(*)::int FROM public.geo_ops_api_registry WHERE is_active) AS "activeProviders",
          (SELECT count(*)::int FROM public.geo_ops_model_configs WHERE is_active) AS "activeModels"
        `,
      ),
      query(
        client,
        `
        SELECT
          r.provider_code,
          r.display_name_cn,
          r.provider_type,
          r.billing_unit,
          count(l.api_call_id)::int AS calls_total,
          count(*) FILTER (WHERE l.status = 'success')::int AS calls_success,
          count(*) FILTER (WHERE l.status <> 'success')::int AS calls_failed,
          count(DISTINCT l.note_id) FILTER (WHERE l.note_id IS NOT NULL)::int AS notes_total,
          count(DISTINCT l.note_id) FILTER (WHERE l.note_id IS NOT NULL AND l.status = 'success')::int AS notes_success,
          count(DISTINCT l.note_id) FILTER (WHERE l.note_id IS NOT NULL AND l.status <> 'success')::int AS notes_failed,
          COALESCE(sum(l.total_tokens), 0)::bigint AS total_tokens,
          round(avg(l.latency_ms)::numeric, 1)::float AS avg_latency_ms,
          max(l.started_at) AS latest_started_at
        FROM public.geo_ops_api_registry r
        LEFT JOIN public.geo_ops_api_call_logs l ON l.provider_code = r.provider_code
          ${apiDateJoin}
        GROUP BY r.provider_code, r.display_name_cn, r.provider_type, r.billing_unit
        ORDER BY
          CASE r.provider_code
            WHEN 'endata_xhs_note_detail' THEN 1
            WHEN 'volcengine_ark_vision' THEN 2
            WHEN 'volcengine_ark_chat' THEN 3
            WHEN 'kimi_chat' THEN 4
            WHEN 'volcengine_ark_embedding' THEN 5
            WHEN 'volcengine_ark_image_generation' THEN 6
            WHEN 'duomi_image_generation' THEN 7
            ELSE 20
          END,
          calls_total DESC,
          r.provider_code
        `,
        apiDateParams,
      ),
      query(
        client,
        `
        SELECT
          u.bucket_start,
          u.provider_code,
          r.display_name_cn,
          r.provider_type,
          m.model_name,
          m.model_role,
          u.operation,
          u.calls_total,
          u.calls_success,
          u.calls_failed,
          u.avg_latency_ms,
          u.input_tokens,
          u.output_tokens,
          u.total_tokens
        FROM public.geo_ops_api_usage_hourly u
        JOIN public.geo_ops_api_registry r ON r.provider_code = u.provider_code
        LEFT JOIN public.geo_ops_model_configs m ON m.model_config_id = u.model_config_id
        WHERE u.bucket_start >= now() - interval '30 days'
        ORDER BY u.bucket_start, u.provider_code, u.operation
        `,
      ),
      query(
        client,
        `
        SELECT
          u.bucket_start,
          u.provider_code,
          r.display_name_cn,
          r.provider_type,
          m.model_name,
          m.model_role,
          u.operation,
          u.calls_total,
          u.calls_success,
          u.calls_failed,
          u.avg_latency_ms,
          u.input_tokens,
          u.output_tokens,
          u.total_tokens
        FROM public.geo_ops_api_usage_daily u
        JOIN public.geo_ops_api_registry r ON r.provider_code = u.provider_code
        LEFT JOIN public.geo_ops_model_configs m ON m.model_config_id = u.model_config_id
        WHERE u.bucket_start >= now() - interval '60 days'
        ORDER BY u.bucket_start, u.provider_code, u.operation
        `,
      ),
      query(
        client,
        `
        SELECT
          u.bucket_start,
          u.provider_code,
          r.display_name_cn,
          r.provider_type,
          m.model_name,
          m.model_role,
          u.operation,
          u.calls_total,
          u.calls_success,
          u.calls_failed,
          u.avg_latency_ms,
          u.input_tokens,
          u.output_tokens,
          u.total_tokens
        FROM public.geo_ops_api_usage_weekly u
        JOIN public.geo_ops_api_registry r ON r.provider_code = u.provider_code
        LEFT JOIN public.geo_ops_model_configs m ON m.model_config_id = u.model_config_id
        WHERE u.bucket_start >= now() - interval '26 weeks'
        ORDER BY u.bucket_start, u.provider_code, u.operation
        `,
      ),
      query(
        client,
        `
        SELECT
          COALESCE(m.model_name, l.provider_code) AS model_name,
          COALESCE(m.display_name_cn, r.display_name_cn) AS display_name_cn,
          r.provider_code,
          r.provider_type,
          m.model_role,
          count(*)::int AS calls_total,
          count(*) FILTER (WHERE l.status <> 'success')::int AS calls_failed,
          COALESCE(sum(l.total_tokens), 0)::bigint AS total_tokens,
          max(l.started_at) AS latest_started_at
        FROM public.geo_ops_api_call_logs l
        JOIN public.geo_ops_api_registry r ON r.provider_code = l.provider_code
        LEFT JOIN public.geo_ops_model_configs m ON m.model_config_id = l.model_config_id
        WHERE r.provider_type IN ('llm_chat', 'llm_vision', 'embedding', 'speech_to_text', 'image_generation')
        GROUP BY COALESCE(m.model_name, l.provider_code), COALESCE(m.display_name_cn, r.display_name_cn),
          r.provider_code, r.provider_type, m.model_role
        ORDER BY calls_total DESC, model_name
        `,
      ),
      query(
        client,
        `
        SELECT
          s.script_key,
          s.display_name_cn,
          s.description_cn,
          s.service_name,
          s.is_active,
          count(r.script_run_id)::int AS runs_total,
          count(r.script_run_id) FILTER (WHERE r.status = 'running')::int AS running_count,
          count(r.script_run_id) FILTER (WHERE r.status = 'failed')::int AS failed_count,
          latest.status AS latest_status,
          latest.started_at AS latest_started_at,
          latest.finished_at AS latest_finished_at
        FROM public.geo_ops_scripts s
        LEFT JOIN public.geo_ops_script_runs r ON r.script_key = s.script_key
        LEFT JOIN LATERAL (
          SELECT status, started_at, finished_at
          FROM public.geo_ops_script_runs lr
          WHERE lr.script_key = s.script_key
          ORDER BY lr.started_at DESC
          LIMIT 1
        ) latest ON true
        GROUP BY s.script_key, s.display_name_cn, s.description_cn, s.service_name, s.is_active,
          latest.status, latest.started_at, latest.finished_at
        ORDER BY s.script_key
        `,
      ),
      query(
        client,
        `
        SELECT
          r.script_run_id,
          r.script_key,
          s.display_name_cn,
          r.status,
          r.trigger_type,
          r.note_id,
          r.job_ref_id,
          r.started_at,
          r.finished_at,
          r.duration_ms,
          r.success_count,
          r.failed_count,
          left(r.error_message, 240) AS error_message
        FROM public.geo_ops_script_runs r
        LEFT JOIN public.geo_ops_scripts s ON s.script_key = r.script_key
        ORDER BY r.started_at DESC
        LIMIT 30
        `,
      ),
      query(
        client,
        `
        SELECT
          e.event_id,
          e.script_key,
          s.display_name_cn,
          e.event_time,
          e.level,
          e.event_type,
          e.message,
          e.payload
        FROM public.geo_ops_script_events e
        LEFT JOIN public.geo_ops_scripts s ON s.script_key = e.script_key
        ORDER BY e.event_time DESC, e.event_id DESC
        LIMIT 80
        `,
      ),
      query(
        client,
        `
        WITH base AS (
          SELECT s.*
          FROM public.endata_visit_stat_snapshots s
          WHERE s.url_filter = ''
            AND s.range_key IN ('today', 'yesterday', 'month')
            AND s.sampled_at >= now() - interval '90 days'
        ),
        periods AS (
          SELECT
            range_key,
            url_filter,
            begin_code,
            end_code,
            max(sampled_at) AS latest_sampled_at
          FROM base
          GROUP BY range_key, url_filter, begin_code, end_code
        ),
        latest_periods AS (
          SELECT
            *,
            row_number() OVER (
              PARTITION BY range_key, url_filter
              ORDER BY end_code DESC, begin_code DESC, latest_sampled_at DESC
            ) AS period_rn
          FROM periods
        ),
        ranked AS (
          SELECT
            s.*,
            lead(s.residue_fee) OVER (PARTITION BY s.range_key, s.begin_code, s.end_code, s.url_filter ORDER BY s.sampled_at DESC) AS previous_residue_fee,
            lead(s.success_count) OVER (PARTITION BY s.range_key, s.begin_code, s.end_code, s.url_filter ORDER BY s.sampled_at DESC) AS previous_success_count,
            lead(s.sampled_at) OVER (PARTITION BY s.range_key, s.begin_code, s.end_code, s.url_filter ORDER BY s.sampled_at DESC) AS previous_sampled_at,
            count(*) OVER (PARTITION BY s.range_key, s.begin_code, s.end_code, s.url_filter)::int AS snapshot_count,
            row_number() OVER (PARTITION BY s.range_key, s.begin_code, s.end_code, s.url_filter ORDER BY s.sampled_at DESC) AS rn
          FROM base s
          JOIN latest_periods p
            ON p.range_key = s.range_key
           AND p.url_filter = s.url_filter
           AND p.begin_code = s.begin_code
           AND p.end_code = s.end_code
           AND p.period_rn = 1
        )
        SELECT
          snapshot_id,
          range_key,
          begin_code,
          end_code,
          sampled_at,
          ok,
          http_status,
          code,
          msg,
          residue_fee::float AS residue_fee,
          previous_residue_fee::float AS previous_residue_fee,
          (residue_fee - previous_residue_fee)::float AS balance_delta,
          success_count,
          previous_success_count,
          (success_count - previous_success_count)::int AS success_count_delta,
          previous_sampled_at,
          snapshot_count,
          latency_ms,
          error
        FROM ranked
        WHERE rn = 1
        ORDER BY
          CASE range_key WHEN 'today' THEN 1 WHEN 'yesterday' THEN 2 WHEN 'month' THEN 3 ELSE 9 END,
          end_code DESC,
          begin_code DESC,
          sampled_at DESC
        `,
      ),
      query(
        client,
        `
        WITH ranked AS (
          SELECT
            s.snapshot_id,
            s.range_key,
            s.begin_code,
            s.end_code,
            s.sampled_at,
            s.success_count,
            row_number() OVER (PARTITION BY s.range_key, s.begin_code, s.end_code ORDER BY s.sampled_at DESC) AS rn,
            lead(s.snapshot_id) OVER (PARTITION BY s.range_key, s.begin_code, s.end_code ORDER BY s.sampled_at DESC) AS previous_snapshot_id
          FROM public.endata_visit_stat_snapshots s
          WHERE s.range_key = 'today'
            AND s.url_filter = ''
            AND s.ok = true
            AND s.sampled_at >= now() - interval '14 days'
        ),
        latest AS (
          SELECT *
          FROM ranked
          WHERE rn = 1
          ORDER BY end_code DESC, begin_code DESC, sampled_at DESC
          LIMIT 1
        )
        SELECT
          d.url,
          d.count,
          d.share_pct::float AS share_pct,
          COALESCE(pd.count, 0) AS previous_count,
          (d.count - COALESCE(pd.count, 0))::int AS count_delta,
          latest.sampled_at,
          latest.begin_code,
          latest.end_code,
          latest.success_count
        FROM latest
        JOIN public.endata_visit_stat_details d ON d.snapshot_id = latest.snapshot_id
        LEFT JOIN public.endata_visit_stat_details pd
          ON pd.snapshot_id = latest.previous_snapshot_id AND pd.url = d.url
        ORDER BY d.count DESC, d.url
        `,
      ),
      query(
        client,
        `
        WITH hourly_snapshots AS (
          SELECT
            s.snapshot_id,
            s.begin_code,
            s.end_code,
            to_char(to_date(s.begin_code, 'YYYYMMDD'), 'YYYY-MM-DD') AS period_key,
            to_char(date_trunc('hour', s.sampled_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket_start,
            row_number() OVER (
              PARTITION BY s.begin_code, s.end_code, date_trunc('hour', s.sampled_at AT TIME ZONE 'Asia/Shanghai')
              ORDER BY s.sampled_at DESC
            ) AS rn
          FROM public.endata_visit_stat_snapshots s
          WHERE s.range_key = 'today'
            AND s.url_filter = ''
            AND s.ok = true
            AND s.begin_code = s.end_code
            AND s.sampled_at >= now() - interval '45 days'
        )
        SELECT
          hs.period_key,
          hs.bucket_start,
          hs.begin_code,
          hs.end_code,
          d.url,
          d.count,
          d.share_pct::float AS share_pct
        FROM hourly_snapshots hs
        JOIN public.endata_visit_stat_details d ON d.snapshot_id = hs.snapshot_id
        WHERE hs.rn = 1
        ORDER BY hs.period_key, hs.bucket_start, d.url
        `,
      ),
      query(
        client,
        `
        WITH daily_snapshots AS (
          SELECT
            s.snapshot_id,
            s.begin_code,
            s.end_code,
            to_char(to_date(s.begin_code, 'YYYYMMDD'), 'YYYY-MM') AS period_key,
            to_char(to_date(s.end_code, 'YYYYMMDD'), 'YYYY-MM-DD"T"00:00:00') AS bucket_start,
            row_number() OVER (
              PARTITION BY s.begin_code, s.end_code
              ORDER BY s.sampled_at DESC
            ) AS rn
          FROM public.endata_visit_stat_snapshots s
          WHERE s.range_key = 'month'
            AND s.url_filter = ''
            AND s.ok = true
            AND s.sampled_at >= now() - interval '18 months'
        )
        SELECT
          ds.period_key,
          ds.bucket_start,
          ds.begin_code,
          ds.end_code,
          d.url,
          d.count,
          d.share_pct::float AS share_pct
        FROM daily_snapshots ds
        JOIN public.endata_visit_stat_details d ON d.snapshot_id = ds.snapshot_id
        WHERE ds.rn = 1
        ORDER BY ds.period_key, ds.bucket_start, d.url
        `,
      ),
      query(
        client,
        `
        SELECT
          to_char(l.started_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS period_key,
          to_char(date_trunc('hour', l.started_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket_start,
          COALESCE(l.script_key, 'unknown') AS script_key,
          COALESCE(s.display_name_cn, l.script_key, '未记录脚本') AS display_name_cn,
          CASE
            WHEN lower(COALESCE(l.request_path, '')) IN (
              '/v2/xhs/getstandardnoteinfo',
              '/v2/xhs/getstandardusernotelist',
              '/v2/xhs/getxhsnotelist_gb',
              '/v2/xhs/getstandardcommentinfo'
            ) THEN lower(l.request_path)
            WHEN l.provider_code = 'endata_xhs_note_detail' THEN '/v2/xhs/getstandardnoteinfo'
            ELSE lower(COALESCE(l.request_path, l.provider_code))
          END AS url,
          l.operation,
          count(*)::int AS calls_total,
          count(*) FILTER (WHERE l.status = 'success')::int AS calls_success,
          count(*) FILTER (WHERE l.status <> 'success')::int AS calls_failed
        FROM public.geo_ops_api_call_logs l
        LEFT JOIN public.geo_ops_scripts s ON s.script_key = l.script_key
        WHERE (
            l.provider_code LIKE 'endata%'
            OR lower(COALESCE(l.request_path, '')) IN (
              '/v2/xhs/getstandardnoteinfo',
              '/v2/xhs/getstandardusernotelist',
              '/v2/xhs/getxhsnotelist_gb',
              '/v2/xhs/getstandardcommentinfo'
            )
          )
          AND l.started_at >= now() - interval '45 days'
        GROUP BY 1, 2, 3, 4, 5, 6
        ORDER BY period_key, bucket_start, calls_total DESC, script_key
        `,
      ),
      query(
        client,
        `
        SELECT
          to_char(l.started_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS period_key,
          to_char(date_trunc('day', l.started_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD"T"00:00:00') AS bucket_start,
          COALESCE(l.script_key, 'unknown') AS script_key,
          COALESCE(s.display_name_cn, l.script_key, '未记录脚本') AS display_name_cn,
          CASE
            WHEN lower(COALESCE(l.request_path, '')) IN (
              '/v2/xhs/getstandardnoteinfo',
              '/v2/xhs/getstandardusernotelist',
              '/v2/xhs/getxhsnotelist_gb',
              '/v2/xhs/getstandardcommentinfo'
            ) THEN lower(l.request_path)
            WHEN l.provider_code = 'endata_xhs_note_detail' THEN '/v2/xhs/getstandardnoteinfo'
            ELSE lower(COALESCE(l.request_path, l.provider_code))
          END AS url,
          l.operation,
          count(*)::int AS calls_total,
          count(*) FILTER (WHERE l.status = 'success')::int AS calls_success,
          count(*) FILTER (WHERE l.status <> 'success')::int AS calls_failed
        FROM public.geo_ops_api_call_logs l
        LEFT JOIN public.geo_ops_scripts s ON s.script_key = l.script_key
        WHERE (
            l.provider_code LIKE 'endata%'
            OR lower(COALESCE(l.request_path, '')) IN (
              '/v2/xhs/getstandardnoteinfo',
              '/v2/xhs/getstandardusernotelist',
              '/v2/xhs/getxhsnotelist_gb',
              '/v2/xhs/getstandardcommentinfo'
            )
          )
          AND l.started_at >= now() - interval '18 months'
        GROUP BY 1, 2, 3, 4, 5, 6
        ORDER BY period_key, bucket_start, calls_total DESC, script_key
        `,
      ),
      query(
        client,
        `
        SELECT
          m.model_config_id,
          m.provider_code,
          r.display_name_cn AS provider_display_name_cn,
          m.model_name,
          m.display_name_cn,
          m.model_role,
          m.is_default,
          m.is_active,
          m.temperature,
          m.thinking_mode,
          m.dimensions,
          m.base_url_override,
          m.updated_at
        FROM public.geo_ops_model_configs m
        JOIN public.geo_ops_api_registry r ON r.provider_code = m.provider_code
        ORDER BY m.model_role, m.provider_code, m.is_default DESC, m.model_name
        `,
      ),
      query(
        client,
        `
        SELECT
          c.credential_id,
          c.provider_code,
          r.display_name_cn AS provider_display_name_cn,
          c.credential_name,
          c.secret_ref,
          c.secret_mask,
          c.status,
          c.is_default,
          c.updated_at
        FROM public.geo_ops_credentials c
        JOIN public.geo_ops_api_registry r ON r.provider_code = c.provider_code
        ORDER BY c.provider_code, c.is_default DESC, c.credential_name
        `,
      ),
      query(
        client,
        `
        SELECT
          rule_id,
          provider_code,
          rule_name,
          period_seconds,
          max_calls,
          max_tokens,
          max_estimated_cost,
          hard_block,
          is_enabled
        FROM public.geo_ops_rate_limit_rules
        ORDER BY is_enabled DESC, provider_code, period_seconds
        `,
      ),
    ]);
    const endataEndpoints = endataEndpointDetails.length ? endataEndpointDetails.map(enrichEndataEndpoint) : endataEndpointCatalog;
    const enrichedEndataHistoryHourly = endataEndpointHistoryHourly.map(enrichEndataEndpoint);
    const enrichedEndataHistoryDaily = endataEndpointHistoryDaily.map(enrichEndataEndpoint);
    const enrichedEndataScriptUsageHourly = endataScriptUsageHourly.map((row) => {
      const endpoint = enrichEndataEndpoint(row);
      return {
        ...row,
        endpoint_display_name_cn: endpoint.display_name_cn,
        endpoint_description_cn: endpoint.description_cn,
        endpoint_scripts: endpoint.scripts,
      };
    });
    const enrichedEndataScriptUsageDaily = endataScriptUsageDaily.map((row) => {
      const endpoint = enrichEndataEndpoint(row);
      return {
        ...row,
        endpoint_display_name_cn: endpoint.display_name_cn,
        endpoint_description_cn: endpoint.description_cn,
        endpoint_scripts: endpoint.scripts,
      };
    });
    const canContent = canAccess(user, "content");
    const canOps = canAccess(user, "ops");
    const canModels = canAccess(user, "models");
    const opsPayload = {};
    if (canOps) {
      Object.assign(opsPayload, {
        overview: opsOverviewRows[0],
        apiStatusSummary,
        recentApiCalls,
        apiFailureReasons,
        apiUsage: {
          hourly: apiUsageHourly,
          daily: apiUsageDaily,
          weekly: apiUsageWeekly,
        },
        modelUsageSummary,
        scriptRunSummary,
        recentScriptRuns,
        scriptEvents,
        apiDateFilter: apiDate,
        endataBalance: {
          latestSnapshots: endataLatestSnapshots,
          endpoints: endataEndpoints,
          endpointHistory: enrichedEndataHistoryHourly,
          endpointHistoryHourly: enrichedEndataHistoryHourly,
          endpointHistoryDaily: enrichedEndataHistoryDaily,
          scriptUsageHourly: enrichedEndataScriptUsageHourly,
          scriptUsageDaily: enrichedEndataScriptUsageDaily,
        },
      });
    }
    if (canModels) {
      Object.assign(opsPayload, {
        modelConfigs,
        credentials,
        rateLimitRules,
      });
    }

    res.status(200).json({
      ok: true,
      source: "database",
      generatedAt: new Date().toISOString(),
      auth: {
        user,
        permissions: permissionCatalog,
      },
      overview: canContent ? overviewRows[0] : null,
      contentInsight: canContent
        ? {
            range: {
              start: contentStart,
              end: contentEnd,
              minNoteDate: contentOverviewRows[0]?.minNoteDate || null,
              maxNoteDate: contentOverviewRows[0]?.maxNoteDate || null,
              minCapturedAt: contentOverviewRows[0]?.minCapturedAt || null,
              maxCapturedAt: contentOverviewRows[0]?.maxCapturedAt || null,
              minPublishTime: contentOverviewRows[0]?.minPublishTime || null,
              maxPublishTime: contentOverviewRows[0]?.maxPublishTime || null,
            },
            overview: contentOverviewRows[0] || null,
            topicFrequency: contentTopicFrequency,
            personaDistribution: contentPersonaDistribution,
            noteAnalysis: contentNoteAnalysis,
            trendDaily: contentTrendDaily,
            sparklineDaily: contentSparklineDaily,
          }
        : null,
      queueStatus: canContent ? queueStatus : [],
      topFresh: canContent ? topFresh : [],
      fixedContent: canContent
        ? {
            windowDays: 30,
            notes: fixedContentNotes,
          }
        : { windowDays: 30, notes: [] },
      personaDistribution: canContent ? personaDistribution : [],
      funnelDistribution: canContent ? funnelDistribution : [],
      industryDistribution: canContent ? industryDistribution : [],
      painMap: canContent ? painMap : [],
      visualPatterns: canContent ? visualPatterns : [],
      recentRuns: canContent ? recentRuns : [],
      failedQueue: canContent ? failedQueue : [],
      ops: opsPayload,
    });
  } catch (error) {
    res.status(500).json({
      error: "dashboard_query_failed",
      message: error.message,
    });
  } finally {
    client.release();
  }
};
