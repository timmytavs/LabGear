
-- =========================================
-- LabGear - Security Monitoring Tables
-- PostgreSQL
-- =========================================

BEGIN;

-- =========================================
-- 1. ACTIVITY LOGS
-- =========================================

CREATE TABLE IF NOT EXISTS activity_logs (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    event_type VARCHAR(50) NOT NULL,

    username_typed TEXT,

    user_id VARCHAR(9),

    ip_address INET,

    user_agent TEXT,

    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_activity_log_user
        FOREIGN KEY (user_id)
        REFERENCES users(id_number)
        ON DELETE SET NULL
);

-- Activity log indexes

CREATE INDEX IF NOT EXISTS idx_activity_created
ON activity_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_event
ON activity_logs(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_ip
ON activity_logs(ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_user
ON activity_logs(user_id, created_at DESC);


-- =========================================
-- 2. IP BLOCKS
-- =========================================

CREATE TABLE IF NOT EXISTS ip_blocks (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    ip_address INET NOT NULL,

    reason VARCHAR(255) NOT NULL,

    failure_count INTEGER NOT NULL DEFAULT 0,

    blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    blocked_until TIMESTAMPTZ NOT NULL,

    CONSTRAINT valid_failure_count
        CHECK (failure_count >= 0),

    CONSTRAINT valid_block_duration
        CHECK (blocked_until > blocked_at)
);

CREATE INDEX IF NOT EXISTS idx_ip_blocks_address
ON ip_blocks(ip_address, blocked_until DESC);


-- =========================================
-- 3. SECURITY FLAGS
-- =========================================

CREATE TABLE IF NOT EXISTS security_flags (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    pattern_type VARCHAR(40) NOT NULL,

    target_value VARCHAR(255) NOT NULL,

    severity VARCHAR(10) NOT NULL,

    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    flag_date DATE NOT NULL DEFAULT
        ((NOW() AT TIME ZONE 'Asia/Manila')::date),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_security_pattern
        CHECK (pattern_type IN (
            'IP_OVER_THRESHOLD',
            'ACCOUNT_TARGETED',
            'OTP_GUESSING',
            'OFF_HOURS_LOGIN'
        )),

    CONSTRAINT valid_flag_severity
        CHECK (severity IN (
            'LOW',
            'MEDIUM',
            'HIGH'
        )),

    CONSTRAINT unique_daily_security_flag
        UNIQUE (
            pattern_type,
            target_value,
            flag_date
        )
);

CREATE INDEX IF NOT EXISTS idx_security_flags_created
ON security_flags(created_at DESC);

COMMIT;
