
-- =========================================
-- LabGear - Reservation and Borrowing Tables
-- PostgreSQL
-- =========================================

BEGIN;

-- =========================================
-- 1. RESERVATIONS
-- =========================================

CREATE TABLE IF NOT EXISTS reservations (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    reservation_code VARCHAR(30) NOT NULL UNIQUE,

    requester_id VARCHAR(9) NOT NULL,

    equipment_id BIGINT NOT NULL,

    quantity INTEGER NOT NULL DEFAULT 1,

    purpose TEXT NOT NULL,

    reservation_start TIMESTAMPTZ NOT NULL,

    reservation_end TIMESTAMPTZ NOT NULL,

    status VARCHAR(25) NOT NULL DEFAULT 'pending',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_reservation_requester
        FOREIGN KEY (requester_id)
        REFERENCES users(id_number)
        ON DELETE RESTRICT,

    CONSTRAINT fk_reservation_equipment
        FOREIGN KEY (equipment_id)
        REFERENCES equipment(id)
        ON DELETE RESTRICT,

    CONSTRAINT valid_reservation_quantity
        CHECK (quantity BETWEEN 1 AND 50),

    CONSTRAINT valid_reservation_dates
        CHECK (reservation_end > reservation_start),

    CONSTRAINT valid_reservation_status
        CHECK (status IN (
            'pending',
            'approved',
            'rejected',
            'cancelled',
            'partially_issued',
            'issued',
            'completed'
        ))
);

CREATE INDEX IF NOT EXISTS idx_reservations_requester
ON reservations(requester_id);

CREATE INDEX IF NOT EXISTS idx_reservations_equipment_dates
ON reservations(equipment_id, reservation_start, reservation_end);

CREATE INDEX IF NOT EXISTS idx_reservations_status
ON reservations(status);


-- =========================================
-- 2. RESERVATION DECISIONS
-- =========================================

CREATE TABLE IF NOT EXISTS reservation_decisions (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    reservation_id BIGINT NOT NULL UNIQUE,

    decided_by VARCHAR(9) NOT NULL,

    decision VARCHAR(15) NOT NULL,

    remarks TEXT,

    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_decision_reservation
        FOREIGN KEY (reservation_id)
        REFERENCES reservations(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_decision_technician
        FOREIGN KEY (decided_by)
        REFERENCES users(id_number)
        ON DELETE RESTRICT,

    CONSTRAINT valid_reservation_decision
        CHECK (decision IN (
            'approved',
            'rejected'
        ))
);


-- =========================================
-- 3. RESERVATION UNITS
-- =========================================

CREATE TABLE IF NOT EXISTS reservation_units (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    reservation_id BIGINT NOT NULL,

    equipment_unit_id BIGINT NOT NULL,

    allocation_status VARCHAR(20) NOT NULL
        DEFAULT 'reserved',

    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_allocation_reservation
        FOREIGN KEY (reservation_id)
        REFERENCES reservations(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_allocation_unit
        FOREIGN KEY (equipment_unit_id)
        REFERENCES equipment_units(id)
        ON DELETE RESTRICT,

    CONSTRAINT unique_reservation_unit
        UNIQUE (reservation_id, equipment_unit_id),

    CONSTRAINT valid_allocation_status
        CHECK (allocation_status IN (
            'reserved',
            'issued',
            'returned',
            'cancelled'
        ))
);

CREATE INDEX IF NOT EXISTS idx_allocation_unit
ON reservation_units(equipment_unit_id);


-- =========================================
-- 4. EQUIPMENT ISSUANCES
-- =========================================

CREATE TABLE IF NOT EXISTS equipment_issuances (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    reservation_unit_id BIGINT NOT NULL UNIQUE,

    issued_by VARCHAR(9) NOT NULL,

    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    due_at TIMESTAMPTZ NOT NULL,

    condition_on_issue VARCHAR(20) NOT NULL,

    issuance_notes TEXT,

    CONSTRAINT fk_issuance_allocation
        FOREIGN KEY (reservation_unit_id)
        REFERENCES reservation_units(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_issuance_technician
        FOREIGN KEY (issued_by)
        REFERENCES users(id_number)
        ON DELETE RESTRICT,

    CONSTRAINT valid_issue_condition
        CHECK (condition_on_issue IN (
            'good',
            'fair',
            'worn'
        ))
);

CREATE INDEX IF NOT EXISTS idx_issuance_due
ON equipment_issuances(due_at);


-- =========================================
-- 5. EQUIPMENT RETURNS
-- =========================================

CREATE TABLE IF NOT EXISTS equipment_returns (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    issuance_id BIGINT NOT NULL UNIQUE,

    received_by VARCHAR(9) NOT NULL,

    returned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    return_condition VARCHAR(25) NOT NULL,

    return_notes TEXT,

    CONSTRAINT fk_return_issuance
        FOREIGN KEY (issuance_id)
        REFERENCES equipment_issuances(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_return_technician
        FOREIGN KEY (received_by)
        REFERENCES users(id_number)
        ON DELETE RESTRICT,

    CONSTRAINT valid_return_condition
        CHECK (return_condition IN (
            'good',
            'damaged',
            'needs_maintenance'
        ))
);


-- =========================================
-- 6. DAMAGE REPORTS
-- =========================================

CREATE TABLE IF NOT EXISTS damage_reports (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    return_id BIGINT NOT NULL UNIQUE,

    reported_by VARCHAR(9) NOT NULL,

    damage_description TEXT NOT NULL,

    severity VARCHAR(20) NOT NULL,

    resolution_status VARCHAR(20) NOT NULL DEFAULT 'open',

    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    resolved_at TIMESTAMPTZ,

    resolution_notes TEXT,

    CONSTRAINT fk_damage_return
        FOREIGN KEY (return_id)
        REFERENCES equipment_returns(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_damage_reporter
        FOREIGN KEY (reported_by)
        REFERENCES users(id_number)
        ON DELETE RESTRICT,

    CONSTRAINT valid_damage_severity
        CHECK (severity IN (
            'minor',
            'moderate',
            'severe'
        )),

    CONSTRAINT valid_damage_resolution
        CHECK (resolution_status IN (
            'open',
            'in_review',
            'resolved'
        ))
);

CREATE INDEX IF NOT EXISTS idx_damage_status
ON damage_reports(resolution_status);

COMMIT;
