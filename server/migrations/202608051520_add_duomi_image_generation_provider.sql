BEGIN;

ALTER TABLE public.geo_ops_api_registry
  DROP CONSTRAINT IF EXISTS geo_ops_api_registry_provider_type_check;

ALTER TABLE public.geo_ops_api_registry
  ADD CONSTRAINT geo_ops_api_registry_provider_type_check
  CHECK (provider_type IN (
    'detail_api',
    'llm_chat',
    'llm_vision',
    'embedding',
    'media_fetch',
    'speech_to_text',
    'image_generation',
    'other'
  ));

ALTER TABLE public.geo_ops_model_configs
  DROP CONSTRAINT IF EXISTS geo_ops_model_configs_model_role_check;

ALTER TABLE public.geo_ops_model_configs
  ADD CONSTRAINT geo_ops_model_configs_model_role_check
  CHECK (model_role IN (
    'llm_chat',
    'llm_vision',
    'embedding',
    'speech_to_text',
    'image_generation',
    'other'
  ));

INSERT INTO public.geo_ops_api_registry
  (provider_code, display_name_cn, provider_type, provider_name, endpoint_name, base_url, endpoint_path, default_model, is_billable, billing_unit, description_cn)
VALUES
  (
    'duomi_image_generation',
    'Duomi 图像生成/图生图',
    'image_generation',
    'Duomi API',
    'ImagesGenerations/Tasks',
    'https://duomiapi.com',
    '/v1/images/generations',
    'gpt-image-2',
    true,
    'image',
    '使用 Duomi API 的 gpt-image-2 创建图像生成任务，并通过任务接口轮询结果。'
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

UPDATE public.geo_ops_model_configs
SET
  is_default = false,
  updated_at = CURRENT_TIMESTAMP
WHERE provider_code = 'duomi_image_generation';

INSERT INTO public.geo_ops_model_configs
  (provider_code, model_name, display_name_cn, model_role, is_default, is_active, temperature, thinking_mode, dimensions)
VALUES
  (
    'duomi_image_generation',
    'gpt-image-2',
    'Duomi gpt-image-2 图像生成',
    'image_generation',
    true,
    true,
    NULL,
    NULL,
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
  updated_at = CURRENT_TIMESTAMP;

UPDATE public.geo_ops_credentials
SET
  is_default = false,
  updated_at = CURRENT_TIMESTAMP
WHERE provider_code = 'duomi_image_generation';

INSERT INTO public.geo_ops_credentials
  (provider_code, credential_name, secret_ref, secret_mask, status, is_default, encryption_key_name)
VALUES
  ('duomi_image_generation', 'Duomi 图像生成默认 Key', 'IMAGE_GENERATION_API_KEY', 'IMAGE_GENERATION_API_KEY', 'active', true, NULL)
ON CONFLICT (provider_code, credential_name) DO UPDATE SET
  secret_ref = EXCLUDED.secret_ref,
  secret_mask = EXCLUDED.secret_mask,
  status = EXCLUDED.status,
  is_default = EXCLUDED.is_default,
  encrypted_secret = NULL,
  encryption_key_name = EXCLUDED.encryption_key_name,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
