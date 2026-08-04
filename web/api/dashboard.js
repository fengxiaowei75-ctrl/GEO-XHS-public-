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
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
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
      contentAssetSuccessRuns: 90,
      contentAssetFailedRuns: 6,
      minPublishTime: "2024-11-08T00:00:00.000Z",
      maxPublishTime: "2026-07-31T00:00:00.000Z",
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
      modelConfigs: [],
      credentials: [],
      rateLimitRules: [],
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");

  if (!hasDatabaseEnv()) {
    res.status(200).json(sampleData());
    return;
  }

  const client = await getPool().connect();
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
      opsOverviewRows,
      apiStatusSummary,
      apiUsageHourly,
      apiUsageDaily,
      apiUsageWeekly,
      modelUsageSummary,
      scriptRunSummary,
      recentScriptRuns,
      scriptEvents,
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
          COALESCE(NULLIF(n.title, ''), NULLIF(a.title, ''), NULLIF(n.source_title, ''), '') AS note_title,
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
        ORDER BY l.started_at DESC, l.api_call_id DESC
        LIMIT 500
        `,
      ),
      query(
        client,
        `
        SELECT
          provider_code,
          status,
          COALESCE(error_code, 'business_or_unknown') AS error_code,
          COALESCE(NULLIF(error_message, ''), 'NULL_TEXT') AS error_message,
          count(*)::int AS count,
          min(started_at) AS first_started_at,
          max(started_at) AS latest_started_at
        FROM public.geo_ops_api_call_logs
        WHERE status <> 'success'
        GROUP BY provider_code, status, COALESCE(error_code, 'business_or_unknown'), COALESCE(NULLIF(error_message, ''), 'NULL_TEXT')
        ORDER BY count DESC, provider_code
        LIMIT 40
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
        GROUP BY r.provider_code, r.display_name_cn, r.provider_type, r.billing_unit
        ORDER BY
          CASE r.provider_code
            WHEN 'endata_xhs_note_detail' THEN 1
            WHEN 'volcengine_ark_vision' THEN 2
            WHEN 'volcengine_ark_chat' THEN 3
            WHEN 'kimi_chat' THEN 4
            WHEN 'volcengine_ark_embedding' THEN 5
            ELSE 20
          END,
          calls_total DESC,
          r.provider_code
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
        WHERE r.provider_type IN ('llm_chat', 'llm_vision', 'embedding', 'speech_to_text')
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
      ops: {
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
        modelConfigs,
        credentials,
        rateLimitRules,
      },
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
