BEGIN;

INSERT INTO public.geo_ops_api_registry
  (provider_code, display_name_cn, provider_type, provider_name, endpoint_name, base_url, endpoint_path, default_model, is_billable, billing_unit, description_cn)
VALUES
  (
    'volcengine_ark_chat',
    '火山 Ark 豆包内容资产总结',
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
  updated_at = now();

INSERT INTO public.geo_ops_credentials
  (provider_code, credential_name, secret_ref, secret_mask, status, is_default, encryption_key_name)
VALUES
  (
    'volcengine_ark_chat',
    'Ark Chat 默认 Key',
    'ARK_CHAT_API_KEY',
    'ARK_CHAT_API_KEY',
    'active',
    true,
    NULL
  )
ON CONFLICT (provider_code, credential_name) DO UPDATE SET
  secret_ref = EXCLUDED.secret_ref,
  secret_mask = EXCLUDED.secret_mask,
  status = EXCLUDED.status,
  is_default = EXCLUDED.is_default,
  encryption_key_name = EXCLUDED.encryption_key_name,
  updated_at = now();

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
  is_default = EXCLUDED.is_default,
  is_active = EXCLUDED.is_active,
  temperature = EXCLUDED.temperature,
  thinking_mode = EXCLUDED.thinking_mode,
  dimensions = EXCLUDED.dimensions,
  updated_at = now();

UPDATE public.geo_ops_model_configs
SET is_default = false, updated_at = now()
WHERE provider_code = 'kimi_chat'
  AND model_name = 'kimi-k2.6';

COMMIT;
