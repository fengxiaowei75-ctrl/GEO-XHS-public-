# Database Access Model

This file defines the target PostgreSQL permission split for all three projects.
It is a policy document, not an executed migration.

## Roles

| Role | Used by | Scope |
|---|---|---|
| `xhs_geo_ro` | `xhs-canvas-generator`, DBeaver, dashboard read endpoints | Read-only access to approved tables/views |
| `xhs_geo_dashboard_rw` | `geo-xhs-dashboard` web auth and write APIs | Dashboard auth/session tables and API usage logs |
| `xhs_geo_worker_rw` | `geo-xhs-dashboard` server scripts | GEO ingest, image analysis, content assets, vectors, ops tables |
| `xhs_geo_gkf_rw` | `geo-knowledge-flow` app and summarizer | Knowledge, article, brief, and app-user tables |
| `xhs_geo_migration_owner` | Manual migrations only | DDL, grants, backfill, and schema changes |

## Practical Rules

- Runtime code must never use a migration/DDL account.
- DBeaver should use the read-only login `readonly_user` for daily browsing.
- The Coze `db-query` endpoint must also use `readonly_user`, never the write-capable login.
- `geo-xhs-dashboard` must not let a general admin query endpoint reach a write-capable account.
- `xhs-canvas-generator` must stay on a read-only account or read replica.
- `geo-knowledge-flow` should use its own write account, not the GEO worker account.

## Current Login Mapping

- `app_user` is the write-capable login for the main dashboard runtime and other non-Coze write flows.
- `readonly_user` is the read-only login for DBeaver and Coze `db-query`.

## Suggested Grants

```sql
-- Read-only baseline
GRANT CONNECT ON DATABASE xhs_geo TO xhs_geo_ro;
GRANT USAGE ON SCHEMA public TO xhs_geo_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO xhs_geo_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO xhs_geo_ro;

-- Dashboard app
GRANT CONNECT ON DATABASE xhs_geo TO xhs_geo_dashboard_rw;
GRANT USAGE ON SCHEMA public TO xhs_geo_dashboard_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_users TO xhs_geo_dashboard_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_sessions TO xhs_geo_dashboard_rw;
GRANT SELECT, INSERT ON public.geo_ops_api_call_logs TO xhs_geo_dashboard_rw;

-- GEO workers
GRANT CONNECT ON DATABASE xhs_geo TO xhs_geo_worker_rw;
GRANT USAGE ON SCHEMA public TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_details TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.image_analysis TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_note_ingest_queue TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_note_content_assets TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_note_content_asset_runs TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_note_content_asset_vectors TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_ops_scripts TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_ops_script_runs TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_ops_script_events TO xhs_geo_worker_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_ops_api_call_logs TO xhs_geo_worker_rw;

-- Knowledge flow
GRANT CONNECT ON DATABASE xhs_geo TO xhs_geo_gkf_rw;
GRANT USAGE ON SCHEMA public TO xhs_geo_gkf_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_users TO xhs_geo_gkf_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_knowledge TO xhs_geo_gkf_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_articles TO xhs_geo_gkf_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_daily_briefs TO xhs_geo_gkf_rw;
```

## Migration Order

1. Create or update the role definitions outside application runtime.
2. Apply grants.
3. Point each repo at its own account.
4. Revoke any shared legacy account only after the new accounts work.
