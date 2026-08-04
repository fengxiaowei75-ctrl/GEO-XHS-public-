const { Pool } = require("pg");

let pool;

const requiredEnv = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"];

function hasDatabaseEnv() {
  return requiredEnv.every((key) => Boolean(process.env[key]));
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl:
        process.env.PGSSLMODE === "require"
          ? { rejectUnauthorized: false }
          : false,
      max: 2,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

async function query(client, text, params = []) {
  const { rows } = await client.query(text, params);
  return rows;
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
      kimiSuccessRuns: 90,
      kimiFailedRuns: 6,
      minPublishTime: "2024-11-08T00:00:00.000Z",
      maxPublishTime: "2026-07-31T00:00:00.000Z",
    },
    queueStatus: [{ status: "success", count: 199 }],
    topFresh: [
      {
        note_id: "6a1ba9a10000000006031daa",
        title: "每天拆解一个运营知识—GEO排名优化",
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
    failedQueue: [
      {
        note_id: "pending-recharge",
        error_preview: "Endata 返回：当前账户余额不足，请充值后重试失败详情任务",
      },
    ],
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  if (!hasDatabaseEnv()) {
    res.status(200).json(sampleData());
    return;
  }

  const client = await getPool().connect();
  try {
    const [
      overviewRows,
      queueStatus,
      topFresh,
      personaDistribution,
      funnelDistribution,
      industryDistribution,
      painMap,
      visualPatterns,
      recentRuns,
      failedQueue,
    ] = await Promise.all([
      query(
        client,
        `
        SELECT
          (SELECT count(*)::int FROM public.note_details WHERE detail_status='success') AS "noteDetailSuccess",
          (SELECT count(*)::int FROM public.note_details WHERE detail_status='failed') AS "noteDetailFailed",
          (SELECT count(*)::int FROM public.geo_note_content_assets WHERE analysis_status='success') AS "assetSuccess",
          (SELECT count(*)::int FROM public.geo_note_content_asset_vectors) AS "vectorCount",
          (SELECT count(*)::int FROM public.geo_note_content_asset_runs WHERE status='success') AS "kimiSuccessRuns",
          (SELECT count(*)::int FROM public.geo_note_content_asset_runs WHERE status='failed') AS "kimiFailedRuns",
          (SELECT min(publish_time) FROM public.geo_note_content_assets WHERE analysis_status='success') AS "minPublishTime",
          (SELECT max(publish_time) FROM public.geo_note_content_assets WHERE analysis_status='success') AS "maxPublishTime"
        `,
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
    ]);

    res.status(200).json({
      source: "database",
      generatedAt: new Date().toISOString(),
      overview: overviewRows[0],
      queueStatus,
      topFresh,
      personaDistribution,
      funnelDistribution,
      industryDistribution,
      painMap,
      visualPatterns,
      recentRuns,
      failedQueue,
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
