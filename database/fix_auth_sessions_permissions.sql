-- LabGear database hotfix: grant the backend role access to auth_sessions.
-- Destination: LabGear/database/fix_auth_sessions_permissions.sql
-- Run in pgAdmin 4 Query Tool against labgear_db as the table owner or a database admin.
-- Confirm the FastAPI DB username first; replace labgear_app below if different.
-- This script does not change, delete, or reset any user or session records.

BEGIN;

-- The FastAPI application needs to resolve objects in the public schema.
GRANT USAGE ON SCHEMA public TO labgear_app;

-- Sessions are read, inserted, and revoked/updated by the backend.
-- DELETE and all DDL privileges are intentionally NOT granted.
GRANT SELECT, INSERT, UPDATE ON TABLE public.auth_sessions TO labgear_app;

COMMIT;

-- Confirm permissions. All four results should read true.
SELECT
    has_schema_privilege('labgear_app', 'public', 'USAGE') AS schema_usage,
    has_table_privilege('labgear_app', 'public.auth_sessions', 'SELECT') AS can_select,
    has_table_privilege('labgear_app', 'public.auth_sessions', 'INSERT') AS can_insert,
    has_table_privilege('labgear_app', 'public.auth_sessions', 'UPDATE') AS can_update;

-- No sequence grant is required for the GENERATED ALWAYS AS IDENTITY column.
