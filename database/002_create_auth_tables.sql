
-- =========================================
-- LabGear - Authentication Tables
-- PostgreSQL
-- =========================================

BEGIN;

-- =========================================
-- 1. USER SECURITY ANSWERS
-- =========================================

CREATE TABLE IF NOT EXISTS user_security_answers (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id VARCHAR(9) NOT NULL,

    question_code VARCHAR(2) NOT NULL,

    answer_hash TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_security_answer_user
        FOREIGN KEY (user_id)
        REFERENCES users(id_number)
        ON DELETE CASCADE,

    CONSTRAINT valid_question_code
        CHECK (question_code IN ('Q7', 'Q2', 'Q4')),

    CONSTRAINT unique_user_question
        UNIQUE (user_id, question_code)
);


-- =========================================
-- 2. EMAIL OTP RECORDS
-- =========================================

CREATE TABLE IF NOT EXISTS email_otps (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id VARCHAR(9) NOT NULL,

    otp_hash TEXT NOT NULL,

    purpose VARCHAR(20) NOT NULL,

    failed_attempts INTEGER NOT NULL DEFAULT 0,

    is_resend BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    expires_at TIMESTAMPTZ NOT NULL,

    used_at TIMESTAMPTZ,

    revoked_at TIMESTAMPTZ,

    CONSTRAINT fk_email_otp_user
        FOREIGN KEY (user_id)
        REFERENCES users(id_number)
        ON DELETE CASCADE,

    CONSTRAINT valid_otp_purpose
        CHECK (purpose IN (
            'register',
            'login',
            'reset'
        )),

    CONSTRAINT valid_otp_attempts
        CHECK (
            failed_attempts >= 0
            AND failed_attempts <= 3
        ),

    CONSTRAINT valid_otp_expiry
        CHECK (expires_at > created_at)
);


-- =========================================
-- 3. PASSWORD HISTORY
-- =========================================

CREATE TABLE IF NOT EXISTS password_history (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id VARCHAR(9) NOT NULL,

    password_hash TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_password_history_user
        FOREIGN KEY (user_id)
        REFERENCES users(id_number)
        ON DELETE CASCADE
);


-- =========================================
-- INDEXES
-- =========================================

CREATE INDEX IF NOT EXISTS idx_security_answers_user
ON user_security_answers(user_id);

CREATE INDEX IF NOT EXISTS idx_email_otps_user_purpose
ON email_otps(user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_history_user
ON password_history(user_id, created_at DESC);


COMMIT;
