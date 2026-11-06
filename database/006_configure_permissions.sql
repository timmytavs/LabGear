
-- =========================================
-- LabGear - Application Database Permissions
-- PostgreSQL
-- =========================================

BEGIN;

-- Reset direct table and sequence permissions
REVOKE ALL PRIVILEGES
ON ALL TABLES IN SCHEMA public
FROM labgear_app;

REVOKE ALL PRIVILEGES
ON ALL SEQUENCES IN SCHEMA public
FROM labgear_app;

-- Allow database and schema access
GRANT CONNECT ON DATABASE labgear_db
TO labgear_app;

GRANT USAGE ON SCHEMA public
TO labgear_app;

-- Tables that require record updates
GRANT SELECT, INSERT, UPDATE ON TABLE
    users,
    email_otps,
    equipment_categories,
    equipment,
    equipment_units,
    reservations,
    reservation_units,
    damage_reports
TO labgear_app;

-- Tables with append-only records
GRANT SELECT, INSERT ON TABLE
    user_security_answers,
    password_history,
    activity_logs,
    ip_blocks,
    security_flags,
    reservation_decisions,
    equipment_issuances,
    equipment_returns
TO labgear_app;

-- Inventory summary is read-only
GRANT SELECT ON TABLE
    equipment_stock_summary
TO labgear_app;

-- Allow identity columns to generate IDs
GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA public
TO labgear_app;

COMMIT;

-- =========================================
-- Verify Application Permissions
-- =========================================

SELECT
    has_table_privilege(
        'labgear_app',
        'public.users',
        'SELECT'
    ) AS users_read,

    has_table_privilege(
        'labgear_app',
        'public.reservations',
        'INSERT'
    ) AS reservations_insert,

    has_table_privilege(
        'labgear_app',
        'public.activity_logs',
        'INSERT'
    ) AS logs_insert,

    has_table_privilege(
        'labgear_app',
        'public.activity_logs',
        'UPDATE'
    ) AS logs_update,

    has_table_privilege(
        'labgear_app',
        'public.activity_logs',
        'DELETE'
    ) AS logs_delete,

    has_table_privilege(
        'labgear_app',
        'public.equipment_stock_summary',
        'SELECT'
    ) AS stock_view_read;
