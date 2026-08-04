BEGIN;

UPDATE public.geo_ops_scripts
SET
  display_name_cn = '内容资产总结',
  description_cn = '聚合笔记详情和图片解析，计算互动/时效权重，调用豆包/Ark 内容模型生成笔记级内容资产。'
WHERE script_key = 'build_geo_content_assets';

UPDATE public.geo_ops_scripts
SET
  description_cn = '按 note_id 编排详情抓取、图片解析、内容资产总结和向量刷新。'
WHERE script_key = 'sync_xhs_note_by_id';

UPDATE public.geo_ops_scripts
SET
  description_cn = '监听 geo_note_ingest_queue，新 note_id 自动触发详情抓取、图片解析、内容资产总结和向量刷新。'
WHERE script_key = 'watch_geo_note_ingest_queue';

UPDATE public.geo_ops_api_registry
SET
  display_name_cn = 'Kimi 历史内容资产总结',
  is_active = false,
  description_cn = '历史内容资产总结 provider，仅用于查看旧调用记录。新任务默认使用 volcengine_ark_chat。'
WHERE provider_code = 'kimi_chat';

UPDATE public.geo_ops_model_configs
SET
  is_default = false,
  is_active = false
WHERE provider_code = 'kimi_chat';

INSERT INTO public.geo_ops_api_registry
  (provider_code, display_name_cn, provider_type, provider_name, endpoint_name, base_url, endpoint_path, default_model, is_billable, billing_unit, description_cn)
VALUES
  (
    'volcengine_ark_chat',
    '豆包内容资产总结',
    'llm_chat',
    'Volcengine Ark',
    'Chat Completions',
    'https://ark.cn-beijing.volces.com',
    '/api/v3/chat/completions',
    'doubao-seed-2-0-mini-260428',
    true,
    'token',
    '聚合小红书标题、文案、图片解析和互动数据，使用豆包模型输出笔记级内容资产。'
  )
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
  is_active = true,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO public.geo_ops_model_configs
  (provider_code, model_name, display_name_cn, model_role, is_default, is_active, temperature, thinking_mode, dimensions)
VALUES
  (
    'volcengine_ark_chat',
    'doubao-seed-2-0-mini-260428',
    '豆包 Seed 2.0 Mini 内容资产总结',
    'llm_chat',
    true,
    true,
    0.600,
    'disabled',
    NULL
  )
ON CONFLICT (provider_code, model_name) DO UPDATE SET
  display_name_cn = EXCLUDED.display_name_cn,
  model_role = EXCLUDED.model_role,
  is_default = true,
  is_active = true,
  temperature = EXCLUDED.temperature,
  thinking_mode = 'disabled',
  dimensions = EXCLUDED.dimensions,
  updated_at = CURRENT_TIMESTAMP;

UPDATE public.geo_ops_credentials
SET
  is_default = false,
  updated_at = CURRENT_TIMESTAMP
WHERE provider_code = 'volcengine_ark_chat';

INSERT INTO public.geo_ops_credentials
  (provider_code, credential_name, secret_ref, secret_mask, status, is_default, encrypted_secret)
VALUES
  ('volcengine_ark_chat', '豆包内容资产总结 Key', 'GEO_CONTENT_API_KEY', 'GEO_CONTENT_API_KEY', 'active', true, NULL)
ON CONFLICT (provider_code, credential_name) DO UPDATE SET
  credential_name = '豆包内容资产总结 Key',
  secret_ref = 'GEO_CONTENT_API_KEY',
  secret_mask = 'GEO_CONTENT_API_KEY',
  status = 'active',
  is_default = true,
  encrypted_secret = NULL,
  updated_at = CURRENT_TIMESTAMP;

UPDATE public.geo_ops_credentials
SET
  status = 'disabled',
  is_default = false,
  updated_at = CURRENT_TIMESTAMP
WHERE provider_code = 'kimi_chat';

COMMIT;
