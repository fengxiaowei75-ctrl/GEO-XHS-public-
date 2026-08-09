BEGIN;

INSERT INTO public.geo_ops_rate_limit_rules (
  provider_code,
  model_config_id,
  credential_id,
  rule_name,
  period_seconds,
  max_calls,
  max_tokens,
  max_estimated_cost,
  hard_block,
  is_enabled,
  metadata
)
SELECT
  v.provider_code,
  v.model_config_id,
  v.credential_id,
  v.rule_name,
  v.period_seconds,
  v.max_calls,
  v.max_tokens,
  v.max_estimated_cost,
  v.hard_block,
  v.is_enabled,
  v.metadata
FROM (
  VALUES
    (
      'endata_xhs_note_detail',
      NULL::bigint,
      NULL::bigint,
      '艺恩详情 API 每日调用上限',
      86400,
      300,
      NULL::integer,
      NULL::numeric(18,6),
      true,
      true,
      '{"scope":"provider_daily_cap","policy":"external_cost_guard"}'::jsonb
    ),
    (
      'duomi_image_generation',
      NULL::bigint,
      NULL::bigint,
      '多米图片生成每日调用上限',
      86400,
      100,
      NULL::integer,
      NULL::numeric(18,6),
      true,
      true,
      '{"scope":"provider_daily_cap","policy":"external_cost_guard"}'::jsonb
    )
) AS v(
  provider_code,
  model_config_id,
  credential_id,
  rule_name,
  period_seconds,
  max_calls,
  max_tokens,
  max_estimated_cost,
  hard_block,
  is_enabled,
  metadata
)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.geo_ops_rate_limit_rules r
  WHERE r.provider_code = v.provider_code
    AND r.model_config_id IS NOT DISTINCT FROM v.model_config_id
    AND r.credential_id IS NOT DISTINCT FROM v.credential_id
    AND r.rule_name = v.rule_name
    AND r.period_seconds = v.period_seconds
);

COMMIT;
