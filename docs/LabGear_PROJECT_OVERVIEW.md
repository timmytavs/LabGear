# LabGear — Project Overview and Development Record

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — System Security  
**Document version:** 1.0  
**Last updated:** November 6, 2026  
**Status:** Development in progress; not production-ready  
**Maintained in:** `docs/PROJECT_OVERVIEW.md`

> **Documentation rule:** Clearly distinguish implemented code, successful developer-reported tests, and planned functionality. A successful import or simulated test does not establish that an end-to-end feature is operational.

## 1. Project description

LabGear is a role-based web system for managing school laboratory equipment inventory, reservation requests, approval decisions, issuance, returns, and damage reports. It also includes registration, authentication, account management, and administrative security monitoring to satisfy the IT 107 system-security project requirements.

**Goal:** Replace fragmented/manual equipment-request records with an accountable workflow that records who requested equipment, who approved a request, which physical units were issued, and how those units were returned.

## 2. Intended users and responsibilities

| Role | Intended capabilities |
|---|---|
| **Student** | Browse equipment, submit and review own reservations, view borrowed equipment, manage own profile. |
| **Instructor** | Browse equipment, submit and review own reservations, view borrowed equipment, manage own profile. |
| **Laboratory Technician** | Review reservation requests, approve/reject requests as permitted, manage equipment issuance/returns, record damage, and maintain inventory. |
| **Administrator** | Manage user/account status and review security monitoring, activity logs, IP blocks, and suspicious-activity flags. |

**Access principle:** Student/Instructor self-registration must never grant Technician or Administrator privileges. Authorization belongs on the server; hiding UI elements alone is insufficient.

## 3. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite), JavaScript/CSS |
| Backend | Python 3.11.9, FastAPI, Uvicorn |
| ORM and validation | SQLAlchemy, Pydantic v2 |
| Database | PostgreSQL (`labgear_db`), pgAdmin 4 |
| Password and recovery-answer protection | Argon2id (`argon2-cffi`) |
| OTP digest protection | HMAC-SHA256 with an independent secret |
| Contact-number encryption | AES-256-GCM (`cryptography`) |
| Bot prevention | Google reCAPTCHA v2 Checkbox; backend SiteVerify |
| Email delivery | Gmail SMTP over SSL/TLS, port 465 |

## 4. System architecture

```text
React / Vite browser application
            |
            | HTTPS requests (planned integration)
            v
FastAPI routes and authorization checks
            |
            v
Pydantic request validation
            |
            v
Authentication, reservation, and inventory services
            |
            v
SQLAlchemy database sessions
            |
            v
PostgreSQL — labgear_db

External services called by the backend:
- Google reCAPTCHA SiteVerify
- Gmail SMTP for email OTP delivery
```

> The frontend currently contains significant preview/mock behavior; the complete browser-to-backend registration, authentication, and equipment workflows have **not** yet been confirmed end to end.

## 5. Repository layout

The following paths are the working conventions used during development (not an exhaustive directory listing):

```text
LabGear/
├── frontend/                     # React/Vite frontend
├── backend/
│   ├── .env                      # Private local credentials — never commit
│   ├── app/
│   │   ├── core/
│   │   │   ├── auth_security.py
│   │   │   └── auth_config.py
│   │   ├── db/
│   │   │   ├── base.py
│   │   │   ├── database.py
│   │   │   └── dependencies.py
│   │   ├── models/
│   │   │   ├── user.py
│   │   │   ├── auth.py
│   │   │   ├── security.py
│   │   │   ├── inventory.py
│   │   │   ├── reservations.py
│   │   │   └── registry.py
│   │   ├── schemas/
│   │   │   └── auth.py
│   │   └── services/
│   │       ├── registration_service.py
│   │       ├── captcha_service.py
│   │       └── email_delivery_service.py
│   ├── verify_auth_security_schema.py
│   ├── verify_inventory_schema.py
│   ├── verify_reservation_schema.py
│   └── test_registration_email_delivery.py
├── database/                     # Existing database assets/scripts
└── docs/
    └── PROJECT_OVERVIEW.md      # This file
```

## 6. Database objects

The schema-verification work previously covered **16 tables** and **one view**. Their intended responsibilities are:

| Object | Purpose |
|---|---|
| `users` | Account identities, roles, authentication/account state |
| `user_security_answers` | Hashed recovery answers |
| `email_otps` | Email OTP records and verification state |
| `password_history` | Previous password hashes |
| `activity_logs` | Account/system audit activities |
| `ip_blocks` | Records of restricted IP addresses |
| `security_flags` | Security indicators or suspicious activity |
| `equipment_categories` | Equipment classification categories |
| `equipment` | Equipment product/catalog records |
| `equipment_units` | Individual physical equipment units |
| `reservations` | Reservation requests |
| `reservation_decisions` | Approval/rejection decision records |
| `reservation_units` | Association of reservations to equipment units |
| `equipment_issuances` | Equipment check-out/issuance events |
| `equipment_returns` | Equipment return events |
| `damage_reports` | Damage records and follow-up |
| `equipment_stock_summary` (view) | Inventory/stock summary |

Schema verification scripts and model registry checks were reported as passing during Steps 30–35. Their checks **do not** substitute for all constraint, permission, and end-to-end integration tests.

## 7. Intended business workflows

### 7.1 Registration and email verification

1. Student or Instructor completes the signup form and privacy consent.
2. FastAPI validates the request, validates CAPTCHA with Google, and enforces abuse controls.
3. Server prepares a pending user, password hash, hashed security answers, encrypted contact number, and a purpose-bound OTP digest.
4. Server stores pending records and sends the OTP by email, with safe handling of delivery failure.
5. User submits OTP; server checks expiry, attempt limit, one-time use, and purpose.
6. If successful, the user is marked email-verified and the account becomes active.

**Current status:** Password/OTP/encryption primitives, input schemas, a CAPTCHA service, pending-registration code, and SMTP service exist. Real Gmail delivery was reported successful in Step 50. The database-backed verification/activation transaction and public registration route **remain pending**.

### 7.2 Login and session management

1. User provides credentials and required CAPTCHA.
2. Server applies account eligibility, IP checks, progressive lockout, and password verification.
3. Email OTP is required as defined by the course requirements.
4. Server issues a restricted-duration authenticated session only after verification.
5. Role permissions and inactivity timeouts apply to protected requests.

**Current status:** Planned; do not treat the frontend login preview as live authentication.

### 7.3 Equipment reservation lifecycle

1. Student/Instructor browses the catalog and requests equipment.
2. Technician evaluates the request against inventory and policy.
3. Approved request is associated with available physical units.
4. Equipment is issued to the authorized borrower.
5. Return is recorded; damage is reported when applicable.
6. Inventory availability and history are updated consistently.

**Current status:** Frontend previews and database models exist; integrated backend operations are pending verification.

## 8. Security requirements and status

The IT 107 handout is the authoritative reference for the full list of **13 mandatory security requirements**. This overview records known requirements, but does not replace a requirement-by-requirement audit against that handout.

| Security control | Development status as of this document |
|---|---|
| Privacy notice and explicit consent | Frontend prepared; schema validation present; end-to-end enforcement pending |
| Password strength and Argon2id storage | Helper implemented and tested; live registration pending |
| Security recovery questions Q7, Q2, Q4 | Hash helpers and pending-registration preparation implemented; live recovery pending |
| Registration email OTP | Generation, HMAC digest, Gmail sending tested; database verification pending |
| Login and password-recovery OTP | Schemas/policy groundwork only; complete flows pending |
| CAPTCHA | Server-side Google verification service and registration integration coded; real browser flow pending |
| Account lockouts and login abuse checks | Policy constants prepared; transaction-safe enforcement pending |
| IP-rate threshold and blocking | Schema/models/policy prepared; operational enforcement pending |
| Nine-minute idle session timeout | Configuration present; real sessions and enforcement pending |
| Audit activity logs | DB models and registration logging preparation present; full events pending |
| Security flags and admin monitoring | DB models and frontend preview exist; integrated monitoring pending |
| Role-based access control | Role definitions and signup restrictions prepared; protected endpoint checks pending |
| Data protection / secure secrets | Three separate signing/encryption keys configured; encryption helper tested; production hardening pending |

**Known development policy settings:** Registration OTP: **180 seconds**, **3 failed attempts**, **60-second resend cooldown**; idle session: **540 seconds**; progressive login lockouts: **24/48/96 seconds**; IP threshold: **14 failures in 10 minutes**. These are *configuration or intended policy values*, not proof of enforcement.

## 9. Private environment configuration

Keep the actual values in `backend/.env` only, excluded from version control. Never include passwords, OTPs, access tokens, or secrets in reports, screenshots, issues, or Git history.

```text
# Database configuration: preserve the existing LabGear database variables.
LABGEAR_OTP_HMAC_KEY_HEX
LABGEAR_JWT_KEY_HEX
LABGEAR_CONTACT_AES_KEY_HEX
LABGEAR_RECAPTCHA_SECRET_KEY
LABGEAR_RECAPTCHA_ALLOWED_HOSTNAMES
LABGEAR_SMTP_HOST
LABGEAR_SMTP_USERNAME
LABGEAR_SMTP_PASSWORD
LABGEAR_SMTP_FROM_EMAIL
```

**Important:** Do not rotate the AES contact key without a controlled decryption/re-encryption plan. Changing OTP and JWT secrets can invalidate outstanding codes/sessions.

## 10. Developer run and verification commands

From the `backend/` folder, with the virtual environment activated:

```powershell
python -m app.models.registry
python verify_auth_security_schema.py
python verify_inventory_schema.py
python verify_reservation_schema.py
python test_registration_email_delivery.py
```

The email test defaults to **DRY RUN**. A live test requires the script's explicit `--send` flag and confirmation. Do not run live email tests repeatedly without a reason.

Typical local servers, when their entry points are configured:

```powershell
# backend/
python -m uvicorn app.main:app --reload

# frontend/ (in another terminal)
npm run dev
```

Do not assume routes are operational merely because the development servers start.

## 11. Development checkpoint and next steps

**Reported completed:**
- Frontend UI steps 1–18 (mostly previews, not full end-to-end integration).
- Database modeling and schema/registry checks through Backend Step 35.
- Authentication/security setup and test work through Backend Step 50, including reported real Gmail SMTP delivery.

**Most recent delivered change:** Backend **Step 51** provides a proposed correction to the registration OTP purpose from `registration` to `register`, to match the expected PostgreSQL check constraint. **Step 51 has not yet been confirmed complete by the developer.** Validate it before proceeding. The Pydantic OTP purpose schema and any other consumers must also be aligned to the database's accepted values.

**Next development work:**
1. Confirm Step 51's purpose/constraint compatibility test.
2. Implement database-backed OTP verification with row locks, expiry, failed-attempt limit, one-time use, and account activation.
3. Build safe OTP resend and email-delivery failure behavior, with abuse/rate limits.
4. Complete signup/login/password recovery API routes, session expiry, RBAC, and admin monitoring.
5. Integrate the React frontend with the FastAPI endpoints and perform end-to-end tests.
6. Audit all 13 mandatory security requirements against the original instructor handout.

## 12. Planned documents in `docs/`

These documents should be developed **one file at a time**, based on verified project code, database output, and the instructor's requirements:

| Planned file | Content |
|---|---|
| `SECURITY_REQUIREMENTS.md` | 13-requirement checklist with evidence and implementation status |
| `DATABASE_DICTIONARY.md` | Verified columns, keys, constraints, tables, relationships, and view |
| `API_REFERENCE.md` | Actual endpoints, request/response contracts, authentication requirements |
| `TEST_LOG.md` | Tests, commands, screenshots, results, limitations |
| `USER_GUIDE.md` | Student, Instructor, Technician, and Administrator walkthroughs |

## 13. Maintenance rule

Update this document whenever a feature is implemented and tested. Record **what code exists**, **what the developer actually tested**, and **what remains incomplete**. Do not change a status to *complete* based solely on planned code, imports, or example output.
