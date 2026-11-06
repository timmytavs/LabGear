# LabGear — API Reference and Implementation Tracker

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Secure Registration, Authentication and Monitoring System  
**Document:** `docs/API_REFERENCE.md`  
**Version:** 1.0 — development contract / inventory  
**Last reviewed:** November 6, 2026  
**Status:** **Draft; authentication and reservation API routes are not yet confirmed operational**

> **How to read this reference.** A Pydantic schema or Python service does **not** create an HTTP endpoint by itself. This document separates **reported existing routes**, **implemented but unmounted backend components**, and **proposed HTTP routes**. Paths, HTTP statuses, and response bodies labeled **PROPOSED** are design targets, **not current API behavior**. The definitive list of active routes must be obtained from the running FastAPI application or its OpenAPI schema.

---

## 1. Current implementation snapshot

The local stack uses **React/Vite** (frontend), **FastAPI/Python 3.11**, **SQLAlchemy/Pydantic v2** (backend), and **PostgreSQL** (`labgear_db`). Google reCAPTCHA v2 Checkbox and Gmail SMTP are being prepared for authentication security.

### Verified or reported components

| Item | Evidence / status | Important limit |
|---|---|---|
| FastAPI application foundation and root | **Reported created** during early backend steps | Exact route response not inspected for this document |
| PostgreSQL engine and per-request session dependency | **Reported tested** (Step 40) | A database connection is not an authenticated endpoint |
| ORM registry (16 tables; stock summary view separately) | **Reported tested** (Steps 30–35) | Table existence does not imply CRUD endpoints |
| Password and recovery-answer hashing | **Helper implemented and tested** (Step 36) | Login and password recovery not operational |
| OTP generation and HMAC verification helpers | **Helper implemented and tested** (Step 36) | Database-backed OTP verification is not yet implemented |
| Auth configuration (OTP/JWT/AES keys) | **Reported configured and tested** (Steps 37–43) | Key configuration does not issue valid sessions |
| Registration request/response Pydantic classes | **Implemented and import-tested** (Step 39) | Schemas do not register routes; validation gaps remain |
| Database session dependency (`get_db`) | **Reported tested** (Step 40) | Services must explicitly manage commits and authorization |
| Pending registration service | **Implemented but NOT exposed** (Step 47; Step 51 revision delivered) | No public registration route; Step 51 replacement not yet confirmed installed/tested |
| reCAPTCHA SiteVerify service | **Simulated checks passed**, config reported configured (Steps 45–47) | Not proven against a real browser-generated CAPTCHA token |
| Gmail SMTP OTP email service | **Reported real email delivery** (Steps 48–50) | A demonstration email does not activate a database account |
| Student/Instructor/Technician/Admin React pages | **Preview interface** | Frontend pages and mocked interactions do not prove an HTTP API |
| Database-backed OTP activation, real auth sessions, RBAC API and reservations | **Pending** | Do not claim these are live |

### Route availability — what can be stated now

| Path | Method | Status | Evidence limitation |
|---|---|---|---|
| `/` | `GET` | **Reported backend foundation** | Exact JSON/HTML body needs confirmation from `app.main` |
| `/docs` | `GET` | **Framework-provided if Swagger UI is enabled** | FastAPI defaults are not confirmation of your deployed settings |
| `/openapi.json` | `GET` | **Framework-provided if OpenAPI is enabled** | Inspect the actual generated document before listing active routes |
| All `/api/...` routes below | Various | **PROPOSED / NOT VERIFIED ACTIVE** | Do not send real user information or assume these routes currently exist |

> **Checkpoint:** Backend Step **51** changed registration OTP purpose to `register` to fit an expected database CHECK constraint, but the developer had **not yet reported Step 51's checks as complete** at the documentation checkpoint. The exact `users` model and live `app.main` router have not been inspected for this reference.

---

## 2. API conventions (proposed, not yet finalized)

- **Development base URL:** Common local FastAPI setup is `http://127.0.0.1:8000`. Verify Uvicorn's actual port and route prefix rather than assuming it.
- **Transport:** Use HTTPS for deployed systems. The React app should call the backend through a configured API base URL and a restricted CORS origin allowlist.
- **Payloads:** `Content-Type: application/json` for JSON requests. Use Pydantic models to validate all externally supplied fields.
- **Authorization:** Every sensitive endpoint must check authenticated identity, account eligibility, role, and record ownership **on the server**.
- **Secrets:** Never return password hashes, raw passwords, security answers, contact encryption keys, OTP digests, SMTP passwords, JWT signing keys, or internal delivery objects.
- **Time:** Persist timezone-aware timestamps where supported and convert to **Asia/Manila** for user-facing audit presentation.
- **Privacy:** Protected account endpoints should avoid exposing whether an email or username exists. Return generic failure messages where needed to prevent enumeration.
- **CSRF:** The server must enforce the required CSRF defense when credentials are carried automatically by browser cookies.
- **Sessions:** Set `HttpOnly`, `Secure` when using HTTPS, and appropriate `SameSite`; enforce the nine-minute inactivity policy on the server. Implement token/session invalidation at logout.
- **Audit:** Log security events safely, excluding credentials and OTP values; keep security logs append-only.

### Suggested, not implemented, HTTP response categories

| Code | Meaning in a future API | Caution |
|---|---|---|
| `200 OK` | Read or action completed | Never return secret material |
| `201 Created` | New resource created | Registration may instead respond `202` while pending OTP |
| `202 Accepted` | Pending registration / email verification initiated | Should not imply that the account is active |
| `204 No Content` | Operation completed without body | Useful for authorized logout |
| `400 Bad Request` | Invalid domain request or expired OTP | Prefer generic public messages where needed |
| `401 Unauthorized` | Missing/invalid authentication | No detailed credential disclosure |
| `403 Forbidden` | Authenticated actor lacks permission | Keep RBAC on server |
| `404 Not Found` | Resource not found or intentionally concealed | Avoid cross-user record disclosures |
| `409 Conflict` | Conflicting reservation or unique constraint | Avoid account enumeration on signup |
| `422 Unprocessable Content` | Pydantic validation error (FastAPI default) | Sanitize error details; do not echo secret inputs |
| `429 Too Many Requests` | Abuse/rate limit, retry cooldown | Implement IP and account safeguards |
| `503 Service Unavailable` | Required external verification/delivery unavailable | Never bypass CAPTCHA/OTP on outage |

These response codes are **design suggestions**. No specific application response contract should be called final before a route exists and is tested.

---

## 3. Authentication request and response schemas — currently coded

**Source:** `backend/app/schemas/auth.py` (Step 39). The following are **Python/Pydantic request models**, not proof of live HTTP endpoints. The schema uses `extra="forbid"`; unknown fields are rejected.

| Schema | Main fields in current code | Role in proposed API |
|---|---|---|
| `RegistrationRequest` | Identity, names, birthdate, address, email, username, `password`, `confirm_password`, `role`, department, contact number, class/section, Q7/Q2/Q4 answers, privacy consent, `captcha_token`, honeypot `website` | Validate self-registration |
| `LoginRequest` | `username`, `password`, `captcha_token` | Validate first login step |
| `OTPVerifyRequest` | `user_id`, `purpose`, `otp` | Validate six-digit code format |
| `OTPResendRequest` | `user_id`, `purpose` | Validate resend input; cooldown must be enforced separately |
| `RecoveryStartRequest` | `identifier`, `captcha_token` | Validate initial forgot-password input |
| `RecoveryAnswerRequest` | `user_id`, `question_code` (`Q7`, `Q2`, `Q4`), `answer` | Validate recovery-answer input format |
| `ResetPasswordRequest` | `reset_token`, `new_password`, `confirm_new_password` | Validate password-reset request |
| `MessageResponse` | `message` | Generic response model |
| `RegistrationPendingResponse` | `message`, `user_id`, `verification_required` | **Draft only**; exposing IDs can assist enumeration |
| `LoginOTPRequiredResponse` | `message`, `user_id`, `otp_required` | **Draft only**; security review required before using publicly |
| `PublicAccountResponse` | `id_number`, `username`, `email`, `role`, `department`, `is_email_verified`, `account_status` | Candidate authenticated-account response; enforce owner/admin scope |

**Known validation details in the current file:**

- `id_number` and `user_id`: pattern `0000-0000` (eight digits in two groups).
- Self-registration role: `student` or `instructor` only. `technician` and `admin` exist in the broader role type but are not valid public signup roles.
- Registration age: at least 18, calculated using `Asia/Manila` date.
- Registration username: current regex accepts **6–17 characters including `._-`**. This is **not** compliant with the handout's requirement that usernames start with a letter and otherwise use letters/digits only. **Fix before public release.**
- Registration email: validated by Pydantic `EmailStr`.
- Password: at least 10 characters under current password helper; uppercase, lowercase, number and symbol; confirmation must match.
- Contact: currently 7–15 digits after removing formatting (maximum raw length 20).
- Security answers: current fields permit 1–200 characters and lack the handout's full 2–50 letters/spaces/no-double-spaces rule. **Fix before public release.**
- `privacy_consent`: must be exactly `true`.
- CAPTCHA token: required and must subsequently be verified by the server with Google.
- Honeypot `website`: defaults to empty string; the service rejects nonempty value.
- OTP string: exactly six digits; leading zeroes are preserved.

**Critical inconsistency to resolve:** `OTPVerifyRequest` and `OTPResendRequest` currently define `purpose` as `registration | login | recovery`; Step 51's registration service and the expected `email_otps` CHECK constraint use **`register | login | reset`**. The **request schema, OTP HMAC purpose, persisted purpose, and verifier must agree** before routes are enabled.

**Sensitive-field caution:** Current Pydantic `Field(exclude=True)` on sensitive request fields affects model serialization. It is **not** a substitute for request logging controls, redaction, permission checks, or safe FastAPI exception handlers.

---

## 4. Proposed authentication route inventory (NOT ACTIVE)

Paths in this section are **proposed conventions**. A developer must explicitly add and mount `APIRouter` handlers and write integration tests before changing the status to operational.

| Method | Proposed path | Intended actor | Intended behavior | Current implementation status |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | Public Student/Instructor | Validate request, CAPTCHA, consent, rate limits; create pending account and issue email OTP | **No route; service prepared** |
| `POST` | `/api/auth/register/verify-otp` | Pending registrant | Verify purpose-bound, unexpired, one-time code; activate account | **Not implemented** |
| `POST` | `/api/auth/register/resend-otp` | Pending registrant | Enforce resend policy; revoke prior OTP; send replacement | **Not implemented** |
| `POST` | `/api/auth/login` | Public | CAPTCHA, IP/lockout/credential verification; initiate login OTP | **Not implemented** |
| `POST` | `/api/auth/login/verify-otp` | OTP-pending account | Verify login OTP, then create authenticated session | **Not implemented** |
| `POST` | `/api/auth/logout` | Authenticated | Invalidate session and clear cookie | **Not implemented** |
| `GET` | `/api/auth/me` | Authenticated | Return only current account's approved public fields | **Not implemented** |
| `POST` | `/api/auth/forgot-password` | Public | CAPTCHA + generic account-recovery initiation | **Not implemented** |
| `POST` | `/api/auth/recovery/answer` | Recovery-in-progress | Verify authorized security answer | **Not implemented** |
| `POST` | `/api/auth/recovery/verify-otp` | Recovery-in-progress | Verify single-use reset OTP | **Not implemented** |
| `POST` | `/api/auth/reset-password` | Recovery-authorized | Enforce password history and update password safely | **Not implemented** |
| `POST` | `/api/account/change-password` | Authenticated | Verify existing password, reject last three, send alert | **Not implemented** |

### 4.1 Example proposed registration request (fictional test data only)

The payload below illustrates the current **Step 39 schema**, not an operational endpoint. `captcha_token` is a placeholder and will **fail real Google verification**.

```http
POST /api/auth/register HTTP/1.1
Content-Type: application/json
```

```json
{
  "id_number": "2026-0001",
  "first_name": "Sample",
  "middle_name": null,
  "family_name": "Student",
  "name_extension": null,
  "birthdate": "2000-01-01",
  "purok_street": "Sample Street",
  "barangay": "Sample",
  "municipality_city": "Sample City",
  "province": "Sample Province",
  "country": "Philippines",
  "zip_code": "6000",
  "email": "sample@example.com",
  "username": "samplestudent",
  "password": "DEMO-NotARealPassword#123",
  "confirm_password": "DEMO-NotARealPassword#123",
  "role": "student",
  "department": "Information Technology",
  "contact_number": "09123456789",
  "class_section_or_unit": "BSIT 3A",
  "security_answer_q7": "Sample School",
  "security_answer_q2": "Sample Friend",
  "security_answer_q4": "Sample Name",
  "privacy_consent": true,
  "captcha_token": "PLACEHOLDER_NOT_VALID_FOR_GOOGLE",
  "website": ""
}
```

**Note:** The sample password intentionally indicates a demo placeholder; do not put passwords in screenshots, committed fixtures, or shared bug reports. Real CAPTCHA tokens must come from the authorized frontend and be verified by Google's server.

### 4.2 Example proposed login request

```json
{
  "username": "samplestudent",
  "password": "DEMO-NotARealPassword#123",
  "captcha_token": "PLACEHOLDER_NOT_VALID_FOR_GOOGLE"
}
```

**No full-authentication session may be issued before the required login OTP succeeds.** Account lockout/IP controls must be enforced for both known and unknown accounts without leaking identifiers.

### 4.3 Example proposed OTP verification shape

**Schema as currently written in Step 39** (not yet reconciled):

```json
{
  "user_id": "2026-0001",
  "purpose": "registration",
  "otp": "000007"
}
```

**Required future correction:** persisted database and Step 51 registration HMAC purpose use `register`. Once the schema is fixed, the matching API shape should use `"purpose": "register"`; do not deploy either spelling until code and database match. Never return OTP value to the browser except through the user's submitted input; never echo it in a response.

### 4.4 Example proposed safe registration response

**Illustration only, not an existing endpoint response:**

```json
{
  "message": "If the request is eligible, check your email for verification instructions."
}
```

The actual API needs a reviewed strategy to correlate pending verification attempts without revealing whether an identifier already exists, and enforce expiry/attempt/resend limits.

---

## 5. Backend components already prepared (NOT HTTP routes)

| Module | Relevant functions/classes | Integration notes |
|---|---|---|
| `app/core/auth_security.py` | `hash_password`, `verify_password`, `password_was_used`, `hash_security_answer`, `verify_security_answer`, `generate_email_otp`, `hash_email_otp`, `verify_email_otp` | Password/answer Argon2id; OTP HMAC keyed and purpose-bound. OTP expiry and attempts require DB service. |
| `app/core/auth_config.py` | `AuthSettings`, `load_auth_settings()` | Loads three independent keys; policy constants do not enforce themselves. |
| `app/db/dependencies.py` | `get_db`, `DbSession` | One session per request; no auto-commit. |
| `app/services/captcha_service.py` | `verify_registration_captcha` | Google SiteVerify and hostname allowlist; real browser token still requires testing. |
| `app/services/registration_service.py` | `register_pending_user`, `_prepare_records`, `PendingRegistration` | Pending record creation; no route. Step 51 corrects purpose to `register` if applied. |
| `app/services/email_delivery_service.py` | `load_smtp_settings`, `send_registration_otp` | SMTP SSL on port 465; send is separate from account creation. |
| `backend/test_registration_email_delivery.py` | Executable dry-run / explicitly authorized live send | Reported real email delivery successful; no database write/activation. |

**Integration caveat:** `register_pending_user` currently commits pending records and returns a plaintext OTP via an internal `PendingRegistration`. Before exposing registration, design a failure-safe email-delivery lifecycle, proper rate limits, and a no-plaintext-OTP response. Do not import or serialize `PendingRegistration` in public response models.

---

## 6. Proposed equipment and reservations API (NOT ACTIVE)

Paths and request/response bodies **have not yet been defined in code**. The following is a planning inventory derived from LabGear's roles, React preview screens, and SQLAlchemy tables—not a description of endpoints already running.

| Method | Proposed path | Allowed role(s) | Purpose | Status |
|---|---|---|---|---|
| `GET` | `/api/equipment` | Authenticated users | Browse catalog and stock availability | **Planned** |
| `GET` | `/api/equipment/{equipment_id}` | Authenticated users | Read details for one item | **Planned** |
| `POST` | `/api/reservations` | Student, Instructor | Request equipment and reservation dates/quantity | **Planned** |
| `GET` | `/api/reservations/me` | Student, Instructor | List only the user's reservations | **Planned** |
| `GET` | `/api/reservations/{reservation_id}` | Owner or authorized staff | Inspect permitted reservation detail | **Planned** |
| `POST` | `/api/technician/reservations/{reservation_id}/decision` | Technician | Approve/reject with audit trail | **Planned** |
| `POST` | `/api/technician/reservations/{reservation_id}/issue` | Technician | Issue approved physical units | **Planned** |
| `POST` | `/api/technician/issuances/{issuance_id}/return` | Technician | Record actual return | **Planned** |
| `POST` | `/api/technician/damage-reports` | Technician | Record damage and affected units | **Planned** |
| `POST` / `PATCH` | `/api/technician/equipment` / `/api/technician/equipment/{id}` | Technician (policy-dependent) | Maintain inventory | **Planned** |

Required service protections include per-record ownership checks, quantity/stock consistency, state-transition guards, transaction locks for simultaneous reservations, prevention of repeated returns or double issuing, and append-only decision/issuance/return history. Exact statuses, column mappings, and authorization must be reconciled with actual PostgreSQL CHECK constraints and role rules before implementation.

---

## 7. Proposed administrator/security-monitoring API (NOT ACTIVE)

| Method | Proposed path | Required role | Purpose | Status |
|---|---|---|---|---|
| `GET` | `/api/admin/users` | Administrator | Filter/list account states and roles | **Planned** |
| `PATCH` | `/api/admin/users/{user_id}/status` | Administrator | Authorized status change with audit | **Planned** |
| `GET` | `/api/admin/security/summary` | Administrator | Security summary counters | **Planned** |
| `GET` | `/api/admin/security/logs` | Administrator | Filtered recent security events | **Planned** |
| `GET` | `/api/admin/security/ip-blocks` | Administrator | IP-block reports | **Planned** |
| `GET` | `/api/admin/security/flags` | Administrator | Suspicious-activity flags | **Planned** |
| `GET` | `/api/admin/security/dashboard-data` | Administrator | JSON backing the read-only dashboard | **Planned** |

The handout requires the monitoring **dashboard itself** to be read-only, with role checks enforced in HTML and JSON access paths. The separate administrative ability to change user status must be explicitly authorized, designed and audited; it is **not** a function of the read-only monitoring dashboard. A server-side monitoring script is planned and must **not** be exposed as a browser-accessible endpoint.

**Monitoring design targets:** six summary counts, failed-logins-per-hour chart, top five IPs, recent events with filters, security flags, and 60-second client refresh. Do not expose passwords, raw OTPs or unredacted sensitive details in log APIs. Dashboard access and forbidden access attempts should themselves be auditable.

---

## 8. Security requirements before declaring any route operational

1. **Validation:** Align registration names, usernames, security answers, ID, address and role restrictions with the actual instructor handout. Reconcile `register/login/reset` OTP purposes across schemas, storage and HMAC.
2. **CAPTCHA and CSRF:** Verify CAPTCHA server-side on registration, login and forgot-password forms; implement required server-side CSRF protection.
3. **OTP lifecycle:** Database-backed 180-second expiration, max three failed tries, single use, replacement invalidation, 60-second resend cooldown, max three resends in 15 minutes. Use locking/atomic transactions and a clear delivery-failure policy.
4. **Abuse resistance:** Progressive account lockouts (24/48/96 seconds at 3/6/9 failures); block IP after the assigned threshold of 14 failures over 10 minutes for ten minutes; use trusted proxy configuration when deriving client IP.
5. **Sessions:** Create authenticated sessions **only after full login OTP**. Enforce nine-minute idle timeout, secure cookies, rotation, CSRF protection, logout invalidation and role checks.
6. **Data access:** Enforce owner/role access to account, reservations, contact numbers and administrator reports. Encryption does not grant authorization.
7. **Errors and audit:** Generic outward auth errors; redact secret fields from validation details/logging; append-only activity logs; alert at required lockout tiers and password changes.
8. **Headers and deployment:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, safe CORS, HTTPS, secrets excluded from commits, and security tests.

References: `docs/SECURITY_REQUIREMENTS.md`, the original IT 107 instructor handout, and the local backend source. The precise 13-protection and S1–S11 mapping is maintained in `SECURITY_REQUIREMENTS.md`.

---

## 9. How to verify which routes are **actually** present (read-only)

Run from `C:\Users\Administrator\Documents\LabGear\backend`, with the correct virtual environment activated. If the ASGI app is named `app` in `app/main.py` (as in the earlier project setup), this prints routes registered in the Python application:

```powershell
python -c "from app.main import app; print([(sorted(getattr(r, 'methods', None) or []), r.path) for r in app.routes])"
```

For clearer line-by-line output, use the multiline version:

```powershell
@'
from app.main import app
for route in app.routes:
    methods = ','.join(sorted(getattr(route, 'methods', None) or []))
    print(f'{methods:12} {route.path}')
'@ | python
```

This is a route **inventory**, not proof that permissions, database operations, or external integrations work. If `app.main` cannot be imported, inspect the actual ASGI entrypoint; do not add or claim routes just to make the list match the proposals above.

When the API is running and OpenAPI is enabled, inspect Swagger at the application URL plus `/docs` and review the generated `/openapi.json`. Only promote a route to **implemented** after it appears in the route inventory; promote it to **tested** only after authorization, validation, errors and database effects have been independently verified.

### Safe evidence log template

| Date | Route | Method | Role/session | Test case | Actual status and sanitized response | Database effect | Evidence path |
|---|---|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | Not yet tested | Not yet tested | `docs/evidence/...` |

Avoid uploading screenshots that expose real email addresses, OTPs, contact details, passwords, environment variables, tokens or internal stack traces.

---

## 10. Outstanding contracts to finalize

| Priority | Question / discrepancy | Owner action |
|---|---|---|
| Critical | `registration/recovery` schema values vs `register/reset` DB and HMAC values | Fix Step 39 schemas and retest before creating OTP routes |
| Critical | Step 51 replacement not confirmed yet | Run its read-only verification and record result |
| Critical | Public pending registration returns an internal plaintext OTP object | Design email send orchestration and safe outward DTO with no OTP |
| Critical | No persistent OTP failure, expiry, resend and consumption service | Implement with database transactions and row locks |
| High | Incomplete field validation against IT 107 handout | Correct request validation and negative tests |
| High | Account enumeration risk in pending/login OTP response models | Finalize safe public messages and protected continuation method |
| High | Role permissions for equipment and administrator actions | Write explicit authorization matrix and server tests |
| High | Reservation transaction/state invariants | Match ORM/database constraints and concurrent-request behavior |
| High | No confirmed live API route map available in this document | Capture output of the read-only route listing and update sections 1, 4, 6 and 7 |
| High | Actual `users` mapping not inspected with this document | Reconcile response fields to existing 27-column User ORM and privacy policy |

**Next development checkpoint:** Verify Step 51, correct OTP purpose schema, then implement database-backed registration OTP verification and activation without exposing incomplete endpoints.

**Documentation maintenance:** Whenever a route is added, update its exact method/path, request and response schema, role requirements, status codes, known errors, relevant tests, and evidence. Never turn a *proposed* API into a *working* API by changing documentation alone.
