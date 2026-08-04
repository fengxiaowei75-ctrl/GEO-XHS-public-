BEGIN;

UPDATE public.geo_ops_api_call_logs l
SET
  status = 'failed',
  error_code = COALESCE(l.error_code, 'endata_business_code'),
  error_message = n.detail_error,
  metadata = COALESCE(l.metadata, '{}'::jsonb) || jsonb_build_object(
    'business_status_corrected', true,
    'business_status_source', 'note_details.detail_status'
  )
FROM public.note_details n
WHERE l.provider_code = 'endata_xhs_note_detail'
  AND l.operation = 'note_detail_fetch'
  AND l.status = 'success'
  AND l.note_id = n.note_id
  AND n.detail_status = 'failed';

COMMIT;
