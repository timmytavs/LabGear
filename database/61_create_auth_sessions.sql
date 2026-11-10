-- LabGear Backend File 61 - database-backed authenticated sessions.
-- Destination: LabGear/database/61_create_auth_sessions.sql (CREATE)
-- Apply once using pgAdmin 4 Query Tool connected to labgear_db.
-- This script adds one table and three indexes. It does not modify existing users.
-- It is safe to rerun: existing objects are not dropped or cleared.
--
-- Session design (implemented in later backend files):
--   * Generate 32 random bytes for the session cookie; store only its HMAC digest.
--   * Generate an independent 32-byte CSRF token; store only its HMAC digest.
--   * Rotate the session identifier after full password + email OTP login.
--   * Enforce 540 seconds of inactivity using last_activity_at in PostgreSQL.
--   * Enforce an independent 12-hour absolute expiration via expires_at.
--   * Revoke a session on logout by setting revoked_at.
--   * Use HttpOnly, SameSite cookies and Secure outside localhost.
--   * The backend checks user state and role on each protected request.
-- This file creates storage only; it does NOT authenticate users by itself.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auth_sessions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id VARCHAR(9) NOT NULL,
    session_token_hash CHAR(64) NOT NULL,
    csrf_token_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    ip_address INET,
    user_agent TEXT,

    CONSTRAINT auth_sessions_user_fk
        FOREIGN KEY (user_id)
        REFERENCES public.users (id_number)
        ON DELETE CASCADE,

    CONSTRAINT auth_sessions_unique_token_hash
        UNIQUE (session_token_hash),

    CONSTRAINT auth_sessions_expires_after_creation
        CHECK (expires_at > created_at),

    CONSTRAINT auth_sessions_activity_after_creation
        CHECK (last_activity_at >= created_at),

    CONSTRAINT auth_sessions_revocation_after_creation
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
    ON public.auth_sessions (user_id, last_activity_at DESC)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_active_expiry_idx
    ON public.auth_sessions (expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_activity_idx
    ON public.auth_sessions (last_activity_at);

COMMIT;

-- Read-only confirmation. Expected: one row, table_name = auth_sessions.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'auth_sessions';

-- Read-only confirmation. Expected: 10 rows, one per column.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'auth_sessions'
ORDER BY ordinal_position;
