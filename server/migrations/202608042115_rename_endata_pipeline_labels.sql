BEGIN;

UPDATE public.geo_ops_scripts
SET
  display_name_cn = '详情预抓取（艺恩 API）',
  description_cn = '解析 Excel 或 note_id，单独调用艺恩 Endata 详情 API，写入 note_details；只负责详情入库，不做图片解析、内容总结和向量化。'
WHERE script_key = 'import_xhs_note_details_from_excel';

UPDATE public.geo_ops_scripts
SET
  display_name_cn = '笔记全流程编排（缺详情才调艺恩）',
  description_cn = '按 note_id 编排完整处理链路：若 note_details 已有成功详情则复用；缺少成功详情时才调用艺恩 API，然后继续图片解析、内容资产总结和向量刷新。'
WHERE script_key = 'sync_xhs_note_by_id';

UPDATE public.geo_ops_scripts
SET
  description_cn = '监听 geo_note_ingest_queue，新 note_id 自动触发笔记全流程编排；正常情况下同一笔记详情成功后不会重复调用艺恩。'
WHERE script_key = 'watch_geo_note_ingest_queue';

UPDATE public.geo_ops_api_registry
SET
  display_name_cn = '艺恩详情 API 调用',
  description_cn = '付费 API：按 note_id 拉取小红书标题、正文、互动量、图片和视频封面；通常由笔记全流程编排在缺少成功详情时调用一次。'
WHERE provider_code = 'endata_xhs_note_detail';

UPDATE public.geo_ops_credentials
SET
  credential_name = '艺恩 Endata 默认 Token'
WHERE provider_code = 'endata_xhs_note_detail'
  AND credential_name IN ('Endata 默认 Token', '艺恩默认 Token');

COMMIT;
