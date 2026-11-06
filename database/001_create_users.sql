
-- =========================================
-- LabGear - Users Table
-- PostgreSQL
-- =========================================

CREATE TABLE IF NOT EXISTS users (

    -- Primary identifier
    id_number VARCHAR(9) PRIMARY KEY,

    -- Personal information
    first_name VARCHAR(26) NOT NULL,
    middle_name VARCHAR(26),
    family_name VARCHAR(26) NOT NULL,
    name_extension VARCHAR(26),

    birthdate DATE NOT NULL,

    -- Address
    purok_street VARCHAR(50) NOT NULL,
    barangay VARCHAR(50) NOT NULL,
    municipality_city VARCHAR(50) NOT NULL,
    province VARCHAR(50) NOT NULL,
    country VARCHAR(50) NOT NULL,
    zip_code VARCHAR(4) NOT NULL,

    -- Account credentials
    email VARCHAR(100) NOT NULL UNIQUE,
    username VARCHAR(17) NOT NULL,
    password_hash TEXT NOT NULL,

    -- LabGear-specific registration fields
    role VARCHAR(20) NOT NULL DEFAULT 'student',
    department VARCHAR(80) NOT NULL,
    contact_number_encrypted BYTEA NOT NULL,
    contact_number_iv BYTEA NOT NULL,
    class_section_or_unit VARCHAR(100) NOT NULL,

    -- Account verification
    is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    account_status VARCHAR(20) NOT NULL DEFAULT 'active',

    -- Authentication security
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,

    -- Privacy consent
    privacy_consent_at TIMESTAMPTZ NOT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_id_number
        CHECK (id_number ~ '^[0-9]{4}-[0-9]{4}$'),

    CONSTRAINT valid_zip_code
        CHECK (zip_code ~ '^[0-9]{4}$'),

    CONSTRAINT valid_username
        CHECK (username ~ '^[A-Za-z][A-Za-z0-9]{5,16}$'),

    CONSTRAINT valid_role
        CHECK (role IN (
            'student',
            'instructor',
            'technician',
            'admin'
        )),

    CONSTRAINT valid_account_status
        CHECK (account_status IN (
            'active',
            'inactive',
            'suspended'
        )),

    CONSTRAINT valid_failed_attempts
        CHECK (failed_login_attempts >= 0),

    CONSTRAINT valid_email_lowercase
        CHECK (email = LOWER(email))
);

-- Prevent usernames differing only by letter case
CREATE UNIQUE INDEX IF NOT EXISTS
    idx_users_username_lower
ON users (LOWER(username));
