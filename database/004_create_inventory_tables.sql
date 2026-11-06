
-- =========================================
-- LabGear - Equipment Inventory Tables
-- PostgreSQL
-- =========================================

BEGIN;

-- =========================================
-- 1. EQUIPMENT CATEGORIES
-- =========================================

CREATE TABLE IF NOT EXISTS equipment_categories (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    category_name VARCHAR(80) NOT NULL,

    description TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_category_name
ON equipment_categories (LOWER(category_name));


-- =========================================
-- 2. EQUIPMENT CATALOG
-- =========================================

CREATE TABLE IF NOT EXISTS equipment (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    category_id BIGINT NOT NULL,

    equipment_code VARCHAR(30) NOT NULL UNIQUE,

    equipment_name VARCHAR(120) NOT NULL,

    description TEXT,

    manufacturer VARCHAR(100),

    model_number VARCHAR(100),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_equipment_category
        FOREIGN KEY (category_id)
        REFERENCES equipment_categories(id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_equipment_category
ON equipment(category_id);

CREATE INDEX IF NOT EXISTS idx_equipment_name
ON equipment(equipment_name);


-- =========================================
-- 3. INDIVIDUAL EQUIPMENT UNITS
-- =========================================

CREATE TABLE IF NOT EXISTS equipment_units (

    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    equipment_id BIGINT NOT NULL,

    asset_tag VARCHAR(50) NOT NULL UNIQUE,

    serial_number VARCHAR(100) UNIQUE,

    storage_location VARCHAR(100),

    unit_status VARCHAR(20) NOT NULL
        DEFAULT 'available',

    acquired_at DATE,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_equipment_unit
        FOREIGN KEY (equipment_id)
        REFERENCES equipment(id)
        ON DELETE RESTRICT,

    CONSTRAINT valid_unit_status
        CHECK (unit_status IN (
            'available',
            'reserved',
            'issued',
            'returned',
            'damaged',
            'maintenance',
            'retired'
        ))
);

CREATE INDEX IF NOT EXISTS idx_equipment_units_equipment
ON equipment_units(equipment_id);

CREATE INDEX IF NOT EXISTS idx_equipment_units_status
ON equipment_units(unit_status);


-- =========================================
-- 4. INVENTORY STOCK SUMMARY VIEW
-- =========================================

CREATE OR REPLACE VIEW equipment_stock_summary AS

SELECT
    e.id AS equipment_id,
    e.equipment_code,
    e.equipment_name,
    c.category_name,

    COUNT(eu.id) AS total_units,

    COUNT(eu.id) FILTER (
        WHERE eu.unit_status = 'available'
    ) AS available_units,

    COUNT(eu.id) FILTER (
        WHERE eu.unit_status = 'reserved'
    ) AS reserved_units,

    COUNT(eu.id) FILTER (
        WHERE eu.unit_status = 'issued'
    ) AS issued_units,

    COUNT(eu.id) FILTER (
        WHERE eu.unit_status = 'damaged'
    ) AS damaged_units,

    COUNT(eu.id) FILTER (
        WHERE eu.unit_status = 'maintenance'
    ) AS maintenance_units

FROM equipment e

JOIN equipment_categories c
    ON e.category_id = c.id

LEFT JOIN equipment_units eu
    ON e.id = eu.equipment_id

GROUP BY
    e.id,
    e.equipment_code,
    e.equipment_name,
    c.category_name;

COMMIT;
