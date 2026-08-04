BEGIN;

CREATE TABLE IF NOT EXISTS public.geo_ops_scripts (
  script_key text PRIMARY KEY,
  display_name_cn text NOT NULL,
  description_cn text NOT NULL,
  script_path text NOT NULL UNIQUE,
  script_type text NOT NULL DEFAULT 'python'
    CHECK (script_type IN ('python', 'systemd_service', 'migration', 'shell', 'other')),
  runtime_target text NOT NULL DEFAULT 'server'
    CHECK (runtime_target IN ('server', 'vercel', 'database', 'local', 'other')),
  service_name text,
  is_active boolean NOT NULL DEFAULT true,
  owner_scope text NOT NULL DEFAULT 'geo',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.geo_ops_scripts IS 'GEO 后台脚本注册表，用于 Web 自动展示脚本中文名、功能和运行状态';
COMMENT ON COLUMN public.geo_ops_scripts.script_key IS '稳定脚本标识，新增脚本时应先注册或由脚本启动时自动 upsert';
COMMENT ON COLUMN public.geo_ops_scripts.display_name_cn IS 'Web 看板展示用中文名';
COMMENT ON COLUMN public.geo_ops_scripts.description_cn IS '脚本功能中文说明';
COMMENT ON COLUMN public.geo_ops_scripts.service_name IS '如果脚本由 systemd 常驻运行，则记录对应 service 名称';

CREATE TABLE IF NOT EXISTS public.geo_ops_script_runs (
  script_run_id bigserial PRIMARY KEY,
  script_key text NOT NULL REFERENCES public.geo_ops_scripts(script_key),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout', 'canceled', 'skipped')),
  trigger_type text NOT NULL DEFAULT 'unknown'
    CHECK (trigger_type IN ('manual', 'systemd', 'queue', 'watch', 'cron', 'api', 'migration', 'unknown')),
  trigger_source text,
  job_ref_type text,
  job_ref_id text,
  note_id text,
  asset_id bigint,
  image_analysis_id bigint,
  worker_id text,
  host_name text,
  pid integer,
  git_commit_sha text,
  command jsonb NOT NULL DEFAULT '[]'::jsonb,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  env_profile text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  exit_code integer,
  processed_count integer,
  success_count integer,
  failed_count integer,
  skipped_count integer,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  stdout_tail text,
  stderr_tail text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.geo_ops_script_runs IS 'GEO 后台脚本每次运行记录，适合脚本列表、耗时、成功失败、最近错误监控';

CREATE INDEX IF NOT EXISTS idx_geo_ops_script_runs_script_started
  ON public.geo_ops_script_runs (script_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_script_runs_status_started
  ON public.geo_ops_script_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_script_runs_note
  ON public.geo_ops_script_runs (note_id);

CREATE TABLE IF NOT EXISTS public.geo_ops_script_events (
  event_id bigserial PRIMARY KEY,
  script_run_id bigint REFERENCES public.geo_ops_script_runs(script_run_id) ON DELETE CASCADE,
  script_key text REFERENCES public.geo_ops_scripts(script_key),
  event_time timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug', 'info', 'warning', 'error', 'critical')),
  event_type text NOT NULL DEFAULT 'log',
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.geo_ops_script_events IS '脚本事件流和滚动日志表，Web 可按脚本和时间倒序展示';

CREATE INDEX IF NOT EXISTS idx_geo_ops_script_events_run_time
  ON public.geo_ops_script_events (script_run_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_script_events_script_time
  ON public.geo_ops_script_events (script_key, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_script_events_level_time
  ON public.geo_ops_script_events (level, event_time DESC);

CREATE TABLE IF NOT EXISTS public.geo_ops_api_registry (
  provider_code text PRIMARY KEY,
  display_name_cn text NOT NULL,
  provider_type text NOT NULL
    CHECK (provider_type IN ('detail_api', 'llm_chat', 'llm_vision', 'embedding', 'media_fetch', 'speech_to_text', 'other')),
  provider_name text NOT NULL,
  endpoint_name text NOT NULL,
  base_url text,
  endpoint_path text,
  default_model text,
  is_billable boolean NOT NULL DEFAULT true,
  billing_unit text NOT NULL DEFAULT 'call',
  description_cn text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.geo_ops_api_registry IS '外部 API/provider 注册表，用于按 API 类型切换查看调用次数、失败率和限流';
COMMENT ON COLUMN public.geo_ops_api_registry.provider_code IS '稳定 provider 标识，如 kimi_chat、volcengine_ark_embedding';
COMMENT ON COLUMN public.geo_ops_api_registry.billing_unit IS '计费单位：call、token、image、minute、byte 等；真实费用可后续在 config 中配置';

CREATE TABLE IF NOT EXISTS public.geo_ops_credentials (
  credential_id bigserial PRIMARY KEY,
  provider_code text NOT NULL REFERENCES public.geo_ops_api_registry(provider_code),
  credential_name text NOT NULL,
  secret_ref text,
  encrypted_secret text,
  secret_mask text,
  secret_fingerprint text,
  encryption_key_name text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'rotated', 'revoked')),
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_code, credential_name)
);

COMMENT ON TABLE public.geo_ops_credentials IS 'API key 元数据和加密密文。不能存明文 key，Web 查询接口也不能返回 encrypted_secret 明文';
COMMENT ON COLUMN public.geo_ops_credentials.secret_ref IS '环境变量名或外部密钥引用，如 KIMI_API_KEY、ARK_API_KEY、ENDATA_TOKEN';
COMMENT ON COLUMN public.geo_ops_credentials.encrypted_secret IS '应用层加密后的 key，可为空。第一阶段可只用 secret_ref';
COMMENT ON COLUMN public.geo_ops_credentials.secret_mask IS '展示用 mask，如 sk-***abcd，不可用于还原 key';

CREATE INDEX IF NOT EXISTS idx_geo_ops_credentials_provider
  ON public.geo_ops_credentials (provider_code, status, is_default DESC);

CREATE TABLE IF NOT EXISTS public.geo_ops_model_configs (
  model_config_id bigserial PRIMARY KEY,
  provider_code text NOT NULL REFERENCES public.geo_ops_api_registry(provider_code),
  credential_id bigint REFERENCES public.geo_ops_credentials(credential_id),
  model_name text NOT NULL,
  display_name_cn text NOT NULL,
  model_role text NOT NULL
    CHECK (model_role IN ('llm_chat', 'llm_vision', 'embedding', 'speech_to_text', 'other')),
  base_url_override text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  temperature numeric(5,3),
  thinking_mode text,
  dimensions integer,
  max_context_tokens integer,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_code, model_name)
);

COMMENT ON TABLE public.geo_ops_model_configs IS '大模型、图片解析、embedding、视频转录模型配置表，支持 Web 多选模型曲线和模型切换';

CREATE INDEX IF NOT EXISTS idx_geo_ops_model_configs_provider
  ON public.geo_ops_model_configs (provider_code, model_role, is_active);

CREATE TABLE IF NOT EXISTS public.geo_ops_api_call_logs (
  api_call_id bigserial PRIMARY KEY,
  trace_id text,
  provider_code text NOT NULL REFERENCES public.geo_ops_api_registry(provider_code),
  model_config_id bigint REFERENCES public.geo_ops_model_configs(model_config_id),
  credential_id bigint REFERENCES public.geo_ops_credentials(credential_id),
  script_run_id bigint REFERENCES public.geo_ops_script_runs(script_run_id) ON DELETE SET NULL,
  script_key text REFERENCES public.geo_ops_scripts(script_key),
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'timeout', 'rate_limited', 'skipped', 'canceled')),
  http_method text,
  request_host text,
  request_path text,
  http_status integer,
  attempt_no integer NOT NULL DEFAULT 1,
  max_attempts integer,
  note_id text,
  asset_id bigint,
  image_analysis_id bigint,
  image_url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  latency_ms integer,
  request_bytes integer,
  response_bytes integer,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cached_tokens integer,
  estimated_units numeric(18,6),
  estimated_cost numeric(18,6),
  currency text,
  rate_limited boolean NOT NULL DEFAULT false,
  retry_after_ms integer,
  error_code text,
  error_message text,
  raw_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.geo_ops_api_call_logs IS '统一外部 API 调用日志。所有收费 API、模型、embedding、图片下载都应通过 gateway 写入此表';
COMMENT ON COLUMN public.geo_ops_api_call_logs.request_path IS '不应包含 token、key 等敏感 query；保存脱敏 path';
COMMENT ON COLUMN public.geo_ops_api_call_logs.raw_usage IS '模型返回的 usage 原始结构，如 prompt_tokens、completion_tokens、total_tokens';

CREATE INDEX IF NOT EXISTS idx_geo_ops_api_logs_started
  ON public.geo_ops_api_call_logs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_api_logs_provider_started
  ON public.geo_ops_api_call_logs (provider_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_api_logs_model_started
  ON public.geo_ops_api_call_logs (model_config_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_api_logs_status_started
  ON public.geo_ops_api_call_logs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_ops_api_logs_script_run
  ON public.geo_ops_api_call_logs (script_run_id);
CREATE INDEX IF NOT EXISTS idx_geo_ops_api_logs_note
  ON public.geo_ops_api_call_logs (note_id);

CREATE TABLE IF NOT EXISTS public.geo_ops_rate_limit_rules (
  rule_id bigserial PRIMARY KEY,
  provider_code text REFERENCES public.geo_ops_api_registry(provider_code),
  model_config_id bigint REFERENCES public.geo_ops_model_configs(model_config_id),
  credential_id bigint REFERENCES public.geo_ops_credentials(credential_id),
  rule_name text NOT NULL,
  period_seconds integer NOT NULL,
  max_calls integer,
  max_tokens integer,
  max_estimated_cost numeric(18,6),
  hard_block boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.geo_ops_rate_limit_rules IS 'API 网关限流规则。可按 provider/model/key 限制每小时/每日调用、token 或估算费用';

CREATE INDEX IF NOT EXISTS idx_geo_ops_rate_limit_rules_lookup
  ON public.geo_ops_rate_limit_rules (provider_code, model_config_id, credential_id, is_enabled);

CREATE TABLE IF NOT EXISTS public.geo_ops_usage_windows (
  usage_window_id bigserial PRIMARY KEY,
  provider_code text NOT NULL REFERENCES public.geo_ops_api_registry(provider_code),
  model_config_id bigint REFERENCES public.geo_ops_model_configs(model_config_id),
  credential_id bigint REFERENCES public.geo_ops_credentials(credential_id),
  window_seconds integer NOT NULL,
  window_start timestamptz NOT NULL,
  calls_total integer NOT NULL DEFAULT 0,
  tokens_total integer NOT NULL DEFAULT 0,
  estimated_cost numeric(18,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_code, model_config_id, credential_id, window_seconds, window_start)
);

COMMENT ON TABLE public.geo_ops_usage_windows IS '网关限流窗口计数表，用于强限流或快速读取当前小时/天用量';

CREATE OR REPLACE VIEW public.geo_ops_api_usage_hourly AS
SELECT
  date_trunc('hour', started_at) AS bucket_start,
  provider_code,
  model_config_id,
  operation,
  count(*)::integer AS calls_total,
  count(*) FILTER (WHERE status = 'success')::integer AS calls_success,
  count(*) FILTER (WHERE status <> 'success')::integer AS calls_failed,
  round(avg(latency_ms)::numeric, 1) AS avg_latency_ms,
  sum(COALESCE(input_tokens, 0))::bigint AS input_tokens,
  sum(COALESCE(output_tokens, 0))::bigint AS output_tokens,
  sum(COALESCE(total_tokens, 0))::bigint AS total_tokens,
  sum(COALESCE(estimated_cost, 0)) AS estimated_cost
FROM public.geo_ops_api_call_logs
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW public.geo_ops_api_usage_daily AS
SELECT
  date_trunc('day', started_at) AS bucket_start,
  provider_code,
  model_config_id,
  operation,
  count(*)::integer AS calls_total,
  count(*) FILTER (WHERE status = 'success')::integer AS calls_success,
  count(*) FILTER (WHERE status <> 'success')::integer AS calls_failed,
  round(avg(latency_ms)::numeric, 1) AS avg_latency_ms,
  sum(COALESCE(input_tokens, 0))::bigint AS input_tokens,
  sum(COALESCE(output_tokens, 0))::bigint AS output_tokens,
  sum(COALESCE(total_tokens, 0))::bigint AS total_tokens,
  sum(COALESCE(estimated_cost, 0)) AS estimated_cost
FROM public.geo_ops_api_call_logs
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW public.geo_ops_api_usage_weekly AS
SELECT
  date_trunc('week', started_at) AS bucket_start,
  provider_code,
  model_config_id,
  operation,
  count(*)::integer AS calls_total,
  count(*) FILTER (WHERE status = 'success')::integer AS calls_success,
  count(*) FILTER (WHERE status <> 'success')::integer AS calls_failed,
  round(avg(latency_ms)::numeric, 1) AS avg_latency_ms,
  sum(COALESCE(input_tokens, 0))::bigint AS input_tokens,
  sum(COALESCE(output_tokens, 0))::bigint AS output_tokens,
  sum(COALESCE(total_tokens, 0))::bigint AS total_tokens,
  sum(COALESCE(estimated_cost, 0)) AS estimated_cost
FROM public.geo_ops_api_call_logs
GROUP BY 1, 2, 3, 4;

INSERT INTO public.geo_ops_scripts
  (script_key, display_name_cn, description_cn, script_path, script_type, runtime_target, service_name)
VALUES
  ('import_xhs_note_details_from_excel', '小红书笔记详情抓取', '解析 Excel 或 note_id，调用 Endata 笔记详情接口，写入 note_details。', 'server/scripts/GEO/import_xhs_note_details_from_excel.py', 'python', 'server', NULL),
  ('analyze_xhs_geo_note_images', '笔记图片解析', '读取 note_details 图片，下载图片并调用 Ark 多模态模型，写入 image_analysis。', 'server/scripts/GEO/analyze_xhs_geo_note_images.py', 'python', 'server', NULL),
  ('build_geo_content_assets', 'Kimi 内容资产总结', '聚合笔记详情和图片解析，计算互动/时效权重，调用 Kimi 生成笔记级内容资产。', 'server/scripts/GEO/build_geo_content_assets.py', 'python', 'server', NULL),
  ('embed_geo_content_assets', '内容资产向量刷新', '调用 Ark embedding，把 geo_note_content_assets.asset_text 写入 pgvector。', 'server/scripts/GEO/embed_geo_content_assets.py', 'python', 'server', 'xhs-geo-asset-vector.service'),
  ('sync_xhs_note_by_id', '单条笔记编排入口', '按 note_id 编排详情抓取、图片解析、Kimi 总结和向量刷新。', 'server/scripts/GEO/sync_xhs_note_by_id.py', 'python', 'server', NULL),
  ('watch_geo_note_ingest_queue', '笔记队列常驻 worker', '监听 geo_note_ingest_queue，新 note_id 自动触发完整处理链路。', 'server/scripts/GEO/watch_geo_note_ingest_queue.py', 'python', 'server', 'xhs-geo-note-ingest-queue.service')
ON CONFLICT (script_key) DO UPDATE SET
  display_name_cn = EXCLUDED.display_name_cn,
  description_cn = EXCLUDED.description_cn,
  script_path = EXCLUDED.script_path,
  script_type = EXCLUDED.script_type,
  runtime_target = EXCLUDED.runtime_target,
  service_name = EXCLUDED.service_name,
  updated_at = now();

INSERT INTO public.geo_ops_api_registry
  (provider_code, display_name_cn, provider_type, provider_name, endpoint_name, base_url, endpoint_path, default_model, is_billable, billing_unit, description_cn)
VALUES
  ('endata_xhs_note_detail', 'Endata 小红书笔记详情', 'detail_api', 'Endata', 'GetStandardNoteInfo', 'https://dataapi.endata.com.cn', '/V2/Xhs/GetStandardNoteInfo', NULL, true, 'call', '按 note_id 拉取小红书笔记详情、互动量、图片、视频封面等。'),
  ('volcengine_ark_vision', '火山 Ark 图片多模态解析', 'llm_vision', 'Volcengine Ark', 'Responses', 'https://ark.cn-beijing.volces.com', '/api/v3/responses', 'doubao-seed-2-0-mini-260428', true, 'image_or_token', '解析小红书图片内容、OCR、视觉风格、内容逻辑。'),
  ('kimi_chat', 'Kimi 内容资产总结', 'llm_chat', 'Kimi', 'Chat Completions', 'https://api.kimi.com/coding/v1', '/chat/completions', 'kimi-k2.6', true, 'token', '聚合标题、文案、图片解析和互动数据，输出笔记级内容资产。'),
  ('volcengine_ark_embedding', '火山 Ark Embedding', 'embedding', 'Volcengine Ark', 'Multimodal Embeddings', 'https://ark.cn-beijing.volces.com', '/api/v3/embeddings/multimodal', 'doubao-embedding-vision-251215', true, 'token', '把内容资产文本转为 2048 维向量，写入 pgvector。'),
  ('xhs_image_download', '小红书图片下载', 'media_fetch', 'XHS/CDN', 'Image Download', NULL, NULL, NULL, false, 'byte', '下载笔记图片并转成 data_url 供多模态模型解析。'),
  ('future_video_transcription', '视频转录预留', 'speech_to_text', 'TBD', 'Speech To Text', NULL, NULL, NULL, true, 'minute', '未来接入视频转录时使用。')
ON CONFLICT (provider_code) DO UPDATE SET
  display_name_cn = EXCLUDED.display_name_cn,
  provider_type = EXCLUDED.provider_type,
  provider_name = EXCLUDED.provider_name,
  endpoint_name = EXCLUDED.endpoint_name,
  base_url = EXCLUDED.base_url,
  endpoint_path = EXCLUDED.endpoint_path,
  default_model = EXCLUDED.default_model,
  is_billable = EXCLUDED.is_billable,
  billing_unit = EXCLUDED.billing_unit,
  description_cn = EXCLUDED.description_cn,
  updated_at = now();

INSERT INTO public.geo_ops_model_configs
  (provider_code, model_name, display_name_cn, model_role, is_default, is_active, temperature, thinking_mode, dimensions)
VALUES
  ('kimi_chat', 'kimi-k2.6', 'Kimi K2.6 内容资产总结', 'llm_chat', true, true, 0.600, 'disabled', NULL),
  ('kimi_chat', 'moonshot-v1-32k', 'Moonshot v1 32k 旧配置', 'llm_chat', false, false, NULL, NULL, NULL),
  ('volcengine_ark_vision', 'doubao-seed-2-0-mini-260428', '豆包图片多模态解析', 'llm_vision', true, true, NULL, 'disabled', NULL),
  ('volcengine_ark_embedding', 'doubao-embedding-vision-251215', '豆包内容资产 Embedding', 'embedding', true, true, NULL, NULL, 2048)
ON CONFLICT (provider_code, model_name) DO UPDATE SET
  display_name_cn = EXCLUDED.display_name_cn,
  model_role = EXCLUDED.model_role,
  is_default = EXCLUDED.is_default,
  is_active = EXCLUDED.is_active,
  temperature = EXCLUDED.temperature,
  thinking_mode = EXCLUDED.thinking_mode,
  dimensions = EXCLUDED.dimensions,
  updated_at = now();

INSERT INTO public.geo_ops_credentials
  (provider_code, credential_name, secret_ref, secret_mask, status, is_default, encryption_key_name)
VALUES
  ('endata_xhs_note_detail', 'Endata 默认 Token', 'ENDATA_TOKEN', 'ENDATA_TOKEN', 'active', true, NULL),
  ('kimi_chat', 'Kimi 默认 Key', 'KIMI_API_KEY', 'KIMI_API_KEY', 'active', true, NULL),
  ('volcengine_ark_vision', 'Ark 默认 Key', 'ARK_API_KEY', 'ARK_API_KEY', 'active', true, NULL),
  ('volcengine_ark_embedding', 'Ark Embedding 默认 Key', 'ARK_API_KEY', 'ARK_API_KEY', 'active', true, NULL)
ON CONFLICT (provider_code, credential_name) DO UPDATE SET
  secret_ref = EXCLUDED.secret_ref,
  secret_mask = EXCLUDED.secret_mask,
  status = EXCLUDED.status,
  is_default = EXCLUDED.is_default,
  encryption_key_name = EXCLUDED.encryption_key_name,
  updated_at = now();

COMMIT;
