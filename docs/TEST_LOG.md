# LabGear — Test Log and Verification Evidence

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Secure Registration, Authentication and Monitoring System  
**Document:** `docs/TEST_LOG.md`  
**Version:** 1.0 — working test register  
**Updated:** November 6, 2026  
**Overall status:** **Development in progress; end-to-end authentication and reservations not yet verified**

> **Evidence rule:** A user's **DONE** confirmation means a step was reported completed; it is not a saved console transcript. Local source compilation, a simulated/mocked test, a live provider connection, and a fully integrated user-flow test are different levels of evidence. This document never presents simulated results as successful production workflows.

---

## 1. How to use this document

Every time a feature is tested:

1. Record the date/time (Philippine Time), file/commit version, test command or steps, and actual observed result.
2. Save a screenshot or sanitized terminal transcript in the project's chosen evidence location; keep personal data and secrets out of screenshots and Git.
3. Mark **PASS** only if the **actual** output matches the expected behavior; otherwise mark **FAIL** and record the corrective action.
4. Distinguish **unit/simulation**, **read-only database inspection**, **live external-service test**, and **end-to-end browser/API test**.
5. Link relevant evidence to the instructor's handout criteria (F, S, G, D, P) and to `docs/SECURITY_REQUIREMENTS.md`.

**Status legend:**

| Status | Definition |
|---|---|
| **Reported PASS** | Developer said **DONE** or equivalent; full test transcript/screenshot not retained in this document. |
| **Reported live PASS** | Developer indicated actual interaction with PostgreSQL, Gmail SMTP, or the Gmail inbox. Still attach evidence before submission. |
| **Prepared / simulated** | Python imports, mocks, in-memory objects, dry runs, or component-level tests; does not prove the public workflow works. |
| **Pending verification** | File delivered, but developer has not yet reported successful testing. |
| **Not implemented / not tested** | No demonstrated working implementation or live evidence. |
| **Needs recheck** | A later change or discovered incompatibility makes older evidence insufficient. |

**Source priority:** Actual LabGear command output / screenshots > current files and models > user-reported step completion > planned design. Do not silently upgrade status based on the existence of a file.

---

## 2. Current project test environment

| Item | Project setup / notes |
|---|---|
| OS | Windows 11 |
| Backend directory | `C:\Users\Administrator\Documents\LabGear\backend` |
| Frontend directory | `C:\Users\Administrator\Documents\LabGear\frontend` |
| Backend | Python 3.11.9; FastAPI; SQLAlchemy; Pydantic v2 |
| Frontend | React / Vite; preview and mock flows exist |
| Database | PostgreSQL database `labgear_db` via application credentials in private `.env` |
| Local URLs | Backend commonly `http://127.0.0.1:8000`; frontend commonly `http://localhost:5173` — confirm running ports |
| Security helpers | Argon2id, HMAC-SHA256, AES-256-GCM, Google reCAPTCHA v2, Gmail SMTP SSL/TLS |
| Secrets handling | `.env` is private and intended to be untracked; do not copy its contents into the test log |
| Local timezone | Asia/Manila (PHT, UTC+08:00) |

**Recorded seed-derived configuration (confirm against the student's signed seed table):** minimum username 6; maximum username 17; minimum password 10; maximum name-field length 26; account lockout tiers at 3 / 6 / 9 failures for 24 / 48 / 96 seconds; 3-minute email OTP expiry; 9-minute idle timeout; 14 failures from one IP in 10 minutes triggers a 10-minute IP block; security questions Q7, Q2, and Q4. OTP resend: 60-second cooldown and at most three resends per 15 minutes. The last two values follow the handout's fixed OTP rules, not the seed.

---

## 3. Recorded development and test history

### 3.1 Frontend and database foundation

| Test ID | Steps | Test objective | Evidence status | Important limitations |
|---|---|---|---|---|
| LG-FE-001 | Frontend 1–18 | Render LabGear landing, role pages, catalog, reservations, technician workflow and admin previews | **Reported PASS** for development steps | Mostly preview/demo UI; real database-connected user flows not established. Fixed-sidebar/scroll issue was deferred. |
| LG-DB-030 | Backend 30 | Verify 7 auth/security tables (users, answers, OTPs, password history, logs, IP blocks, flags) | **Reported live PASS** | Read-only schema check covered selected properties, not every index/permission/trigger. |
| LG-DB-031 | Backend 31 | Import inventory ORM mapping and stock-summary view definition | **Reported PASS** | Imports do not prove transactional inventory functionality. |
| LG-DB-032 | Backend 32 | Check inventory categories, equipment, units and stock-summary view | **Reported live PASS** | Read-only schema check. |
| LG-DB-033 | Backend 33 | Import six reservations/issuance/return/damage ORM mappings | **Reported PASS** | Import check only. |
| LG-DB-034 | Backend 34 | Check six reservation-related PostgreSQL table definitions | **Reported live PASS** | Read-only schema check. |
| LG-DB-035 | Backend 35 | Register 16 ORM models; verify FK resolution and the separate stock-summary view | **Reported live PASS** | Database existence and mapper checks, not full application functionality. |

**Previously reported sample evidence from Step 30:**

```text
LabGear Schema Verification
READ-ONLY: No database changes.
Database: labgear_db
[users] PASS: 27 columns
[user_security_answers] PASS: 5 columns
[email_otps] PASS: 10 columns
[password_history] PASS: 4 columns
[activity_logs] PASS: 8 columns
[ip_blocks] PASS: 6 columns
[security_flags] PASS: 7 columns
RESULT: PASS - all 7 tables matched the checked properties.
```

> The summary above reflects the developer's earlier terminal output; attach the original screenshot/transcript rather than substituting this example as if it were newly captured.

### 3.2 Authentication preparation — Backend Steps 36–50

| Test ID | Step | Component or test | Reported result | What the result proves / does not prove |
|---|---:|---|---|---|
| LG-AUTH-036 | 36 | `app/core/auth_security.py`: Argon2id password and recovery-answer hashing, OTP generation, OTP digest verification | **Reported PASS** | Cryptographic helper checks only; no API authentication. |
| LG-AUTH-037 | 37 | `app/core/auth_config.py`: load distinct temporary OTP/JWT keys; policy values | **Reported PASS** | Configuration checks only. |
| LG-AUTH-038 | 38 | Protected `.env` and persistent OTP/JWT secrets | **Reported PASS** | Owner reports local key verification; never attach keys. |
| LG-AUTH-039 | 39 | `app/schemas/auth.py`: Pydantic imports, OTP six-digit validation | **Reported PASS** | Additional handout validation gaps exist; endpoint not live. |
| LG-DB-040 | 40 | `app/db/dependencies.py`: open Session, SELECT `current_database()`, SELECT 1, cleanup | **Reported live PASS** | Database reachability and read-only dependency, not account creation. |
| LG-AUTH-041 | 41 | `app/services/registration_service.py`: prepare hashed/encrypted records, no DB writes | **Reported PASS** | In-memory tests; registration route disabled. |
| LG-AUTH-042 | 42 | Permanent AES key in `.env`; encryption/decryption check | **Reported PASS** | Local cryptographic test; no data migration. |
| LG-AUTH-043 | 43 | Load distinct OTP, JWT and AES secrets through configuration | **Reported PASS** | Configuration check; no JWT issued. |
| LG-AUTH-044 | 44 | In-memory pending user, hashed answers/password, AES contact and OTP digest via permanent keys | **Reported PASS** | No PostgreSQL insert or browser registration. |
| LG-CAP-045 | 45 | `captcha_service.py`: mocked SiteVerify success, failure, hostname and outage checks | **Reported PASS** | No real Google browser token tested. |
| LG-CAP-046 | 46 | Google reCAPTCHA development key setup (`localhost`) and backend config loading | **Reported PASS** | Keys loaded; actual SiteVerify exchange still not demonstrated. |
| LG-CAP-047 | 47 | Registration gate: mocked CAPTCHA accepted/rejected, honeypot, role and consent checks | **Reported PASS** | Simulated verification only; public registration disabled. |
| LG-MAIL-048 | 48 | `email_delivery_service.py`: mocked SMTP auth/send, expired OTP and outage handling | **Reported PASS** | No real message sent in this test. |
| LG-MAIL-049 | 49 | Private Gmail SMTP settings and live Gmail SMTP authentication | **Reported live PASS** | Gmail accepted credentials over SSL; no email sent in this step. |
| LG-MAIL-050 | 50 | Dry run and authorized real registration test email to configured Gmail account | **Reported live PASS** | Test message was received; fictional OTP not stored in database and cannot activate an account. |

### 3.3 Current checkpoint — Backend Step 51

| Test ID | Check | State | Next action |
|---|---|---|---|
| LG-AUTH-051A | Step 51 replacement `registration_service.py` uses OTP purpose `register` | **Pending verification** | Developer paused for documentation before confirming Step 51 test output. |
| LG-AUTH-051B | OTP HMAC uses the same purpose `register` as the database row | **Pending verification** | Run Step 51 read-only/in-memory tests. |
| LG-AUTH-051C | PostgreSQL `email_otps.purpose` CHECK constraint actually includes `register` | **Pending verification** | Capture live constraint definition or read-only query. |
| LG-AUTH-051D | Existing Step 39 request schema permits compatible OTP purpose values | **Needs recheck / mismatch identified** | The earlier schema used `registration`, `login`, `recovery`; align it with `register`, `login`, `reset` before a public API is enabled. |
| LG-AUTH-052 | Transaction-safe registration OTP verification and account activation | **Not implemented / not tested** | Build and test after resolving model/constraint compatibility. |

**Important:** A successful OTP email delivery (Step 50) is **not** proof of a functional registration + account activation flow. Public registration/login remain disabled until security and API integration tests pass.

---

## 4. Instructor security requirements — evidence matrix

**Source:** IT 107 *Security1_Student_Handout*, section 12 (13 required protections), sections 6–14, and section 18 (self-test checklist). Use `docs/SECURITY_REQUIREMENTS.md` as the detailed implementation tracker. All items below require **end-to-end evidence** before marking them complete.

| No. | Protection | Evidence to capture | Current status |
|---:|---|---|---|
| 1 | SQL injection defense | Submit `' OR '1'='1` in login; confirm generic rejection, no SQL errors or unauthorized login; inspect parameterized SQL | **Pending E2E** |
| 2 | XSS defense | Submit `<script>alert(1)</script>` as entered login text; open admin activity log; verify rendered as harmless text | **Pending E2E** |
| 3 | CSRF defense | Remove/alter CSRF token from state-changing request; server rejects; valid request accepted | **Pending E2E** |
| 4 | Username enumeration | Compare wrong username vs. wrong password in login and recovery; messages and behavior must not reveal account existence | **Pending E2E** |
| 5 | IP blocking | Simulate 14 failures in 10 minutes across different accounts/IP scenarios; confirm 10-minute server-enforced block | **Pending E2E** |
| 6 | Session hardening | Login needs password **and OTP**; server-side 9-minute idle timeout, logout invalidation and browser Back test; secure cookies | **Pending E2E** |
| 7 | Password history | Reject reuse of any of last 3 password hashes in change/reset workflow | **Pending E2E** |
| 8 | Honeypot | Fill hidden registration field; server silently refuses without saving pending user | **Pending E2E** (gate mocked only) |
| 9 | Activity log | Verify required event types + timestamp/IP/user agent; append-only DB; dashboard filters | **Pending E2E** |
| 10 | Error handling | Submit malformed requests; confirm no Python, FastAPI, SQL, or stack-trace details are shown publicly; verify protected error logging | **Pending E2E** |
| 11 | Secrets | Check `.gitignore`, tracked files, deployed exposure, and full Git history for DB/SMTP/CAPTCHA/AES secrets | **Pending full audit** (`.env` handling reported checked) |
| 12 | Security headers | Check `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` on every page and applicable API response | **Pending E2E** |
| 13 | AES-256 encryption at rest | Database contact field unreadable; decrypt only for authenticated owner/authorized staff; unique IV / authentication tag | **Prepared / simulated** (Step 41/42; DB + owner access pending) |

> The 13 rows above reproduce the instructor handout's **section 12 protection order**, adapted to Python/FastAPI/React/PostgreSQL. **OTP, rate limiting, lockouts, CAPTCHA, admin monitoring and CLI detection are additional requirements in other sections**; their tests appear in Section 5. Do not claim compliance based only on simulated service tests.

---

## 5. IT 107 full-flow self-test plan (not yet executed end to end)

Use **test accounts** with accessible inboxes and an isolated development database. Avoid using real personal data in attack tests.

| ID | Instructor-style test | Expected secure outcome | Result | Evidence link |
|---|---|---|---|---|
| LG-E2E-01 | Open database records | Password, answer, OTP, contact cannot be read as plaintext | NOT RUN | — |
| LG-E2E-02 | Disable JS; submit invalid registration | Server rejects bad values | NOT RUN | — |
| LG-E2E-03 | Three bad logins then refresh/clear cookies | Login remains locked on server | NOT RUN | — |
| LG-E2E-04 | Hit each lockout tier | 24 / 48 / 96 sec, matching seed; failed count persistent | NOT RUN | — |
| LG-E2E-05 | Reach lockout tier; check alert email | Owner receives correct time (PHT), IP and browser | NOT RUN | — |
| LG-E2E-06 | Open protected page URL at OTP step | No access before successful OTP | NOT RUN | — |
| LG-E2E-07 | Open Change Password URL directly | Unauthorized request denied | NOT RUN | — |
| LG-E2E-08 | Wrong OTP three times, then correct | Correct old OTP no longer works | NOT RUN | — |
| LG-E2E-09 | Use OTP after 3 minutes | Expired OTP denied | NOT RUN | — |
| LG-E2E-10 | Issue new OTP, try old one | Old OTP denied; newest code only | NOT RUN | — |
| LG-E2E-11 | Resend rapidly and >3 times/15min | 60s cooldown / resend limit enforced | NOT RUN | — |
| LG-E2E-12 | Try SQL injection in username | No login and no SQL errors | NOT RUN | — |
| LG-E2E-13 | Inject XSS string into attempted username; view logs | No script execution in dashboard | NOT RUN | — |
| LG-E2E-14 | Remove CAPTCHA from register/login/recovery | Backend rejects request | NOT RUN | — |
| LG-E2E-15 | Remove/alter CSRF token | State-changing request rejected | NOT RUN | — |
| LG-E2E-16 | Compare wrong username/password responses | No account existence disclosure | NOT RUN | — |
| LG-E2E-17 | Try current/recent password during reset | Server rejects last 3 passwords | NOT RUN | — |
| LG-E2E-18 | Wait beyond idle timeout | Session invalidated; warn one minute before | NOT RUN | — |
| LG-E2E-19 | Non-admin visits admin dashboard/API | Access denied and logged | NOT RUN | — |
| LG-E2E-20 | Logout; Back; request admin JSON endpoint | Protected content not visible | NOT RUN | — |
| LG-E2E-21 | Open monitoring script in browser | No script execution / no access | NOT RUN | — |
| LG-E2E-22 | Test read-only log DB permissions | Application cannot alter/delete audit events | NOT RUN | — |
| LG-E2E-23 | Audit full Git history for secrets | No passwords, tokens or private keys committed | NOT RUN | — |
| LG-E2E-24 | Run monitoring script for four patterns | Flags written, same-day duplicates avoided, console report correct | NOT RUN | — |
| LG-E2E-25 | Reservation approve, issue, return, damage flows | Real DB state transitions authorized by role; inventory stays consistent | NOT RUN | — |

The `NOT RUN` values above mean **not verified by the evidence available for this log**, not necessarily that a feature will never exist.

---

## 6. Safe read-only verification commands

Run from `C:\Users\Administrator\Documents\LabGear\backend` after activating `.venv`. Keep original output for evidence. The four database verification scripts are intended to be **read-only**; review the file before running if it has changed.

```powershell
python verify_auth_security_schema.py
python verify_inventory_schema.py
python verify_reservation_schema.py
python -m app.models.registry
```

Basic syntax/import checks (not equivalent to end-to-end verification):

```powershell
python -m py_compile app/core/auth_security.py
python -m py_compile app/core/auth_config.py
python -m py_compile app/schemas/auth.py
python -m py_compile app/db/dependencies.py
python -m py_compile app/services/registration_service.py
python -m py_compile app/services/captcha_service.py
python -m py_compile app/services/email_delivery_service.py
python -m py_compile test_registration_email_delivery.py
```

Read-only check of PostgreSQL constraint definitions (does **not** insert or activate users):

```powershell
@'
from sqlalchemy import text
from app.db.database import engine
with engine.connect() as connection:
    for name, definition in connection.execute(text("""
        SELECT conname, pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE conrelid = 'public.email_otps'::regclass
          AND contype = 'c'
        ORDER BY conname
    """)):
        print(name, definition)
'@ | python
```

**Optional route inventory (read-only):** Confirm the FastAPI module and app object exist before running. If your current app is `app.main:app`:

```powershell
python -c "from app.main import app; print('\n'.join(sorted({f'{sorted(r.methods or [])} {r.path}' for r in app.routes})))"
```

> `test_registration_email_delivery.py --send` **sends a real email** when explicitly authorized. It does not create a database OTP, and running it again does not prove OTP verification. Never include a screenshot of the six-digit code in repository evidence.

---

## 7. Evidence naming and screenshot checklist

Suggested **local** evidence directory, created by the developer only when needed:

```text
LabGear/
  docs/
    TEST_LOG.md
    evidence/
      backend/
      frontend/
      security/
      email/
      database/
```

Name evidence files consistently: `LG-<ID>_YYYY-MM-DD_<short-name>.png`, e.g. `LG-DB-030_2026-11-06_auth-schema-check.png`. **Example names are not existing files.**

A useful screenshot should show the relevant test command or action **and** the result, without exposing private information. Prefer recording evidence of 3–5 meaningful scenarios per feature over many identical screenshots.

**Before capturing:**

- Close `.env`, passwords and API-key windows, inbox OTP messages, full session tokens and private account details.
- Mask recipient addresses, test-user identifiers, IPs and any data that identifies real people. Use fake test records for demonstrations.
- Do not store actual login/OTP codes or app passwords in console print statements or Git commits.
- Keep public documentation focused on results such as `True`, `PASS`, `401`, `403`, `429`, or sanitized screenshots.

---

## 8. Blank test-result record template

Copy the following block once for each **new** manual test. Do not overwrite previous rows; preserve failures and retest results.

```markdown
### Test LG-<CATEGORY>-<NUMBER> — <short objective>
- Date/time (PHT):
- Tester:
- Environment / branch / commit:
- Component / endpoint / route:
- Test level: unit / mocked / read-only DB / live provider / end-to-end
- Preconditions and test data (non-sensitive):
- Steps or command:
- Expected outcome:
- Actual outcome:
- Result: PASS / FAIL / BLOCKED / NOT RUN
- Evidence file(s):
- Defect ID, fix, and retest (if any):
- Related handout criterion / protection:
```

**Example of a clearly labeled reported result:**

```markdown
### Test LG-MAIL-050 — registration email reaches Gmail
- Test level: live provider; test-only OTP
- Expected: SMTP accepts one email and message arrives in configured inbox
- Actual: Developer replied DONE after reporting completion of the exercise
- Result: Reported live PASS — screenshot/transcript not attached here
- Scope: No database registration, OTP consumption, or account activation
- Evidence file(s): Pending sanitized inbox/terminal screenshot
```

---

## 9. Remaining work before final sign-off

**Priority 1 — Correctness:** Verify the Step 51 `register` OTP-purpose change against the real database and correct the Step 39 OTP purpose literals (`registration` / `recovery` vs. `register` / `reset`) before starting public endpoints. Check that the actual SQLAlchemy `User`, `EmailOTP` and `ActivityLog` models match the insert service; import tests alone do not prove an insert will succeed.

**Priority 2 — Account activation and security:** Implement database-backed OTP verification, attempt/expiry/single-use restrictions, resend revocation and rate limits, CAPTCHA and CSRF protection on all applicable routes, login lockouts, email alerts, user sessions and protected routes.

**Priority 3 — System integration:** Connect React forms to actual FastAPI APIs; enforce role authorization; test inventory, reservation, approvals, issuance, returns and damage reports against PostgreSQL.

**Priority 4 — Instructor evidence:** Capture a full end-to-end demo, admin log monitoring and CLI four-pattern report, privacy/error-message documentation, seed table, threat model, design decisions, development journal, appropriate SQL dump/test records and Git commit history. The handout requires **at least 30 commits over at least four weeks**; no claim is made here about the current repository meeting that requirement.

**Sign-off:** The project is **not yet ready for final security acceptance** based on the evidence currently in this document. Update this statement only after the remaining tests are run and recorded.

---

*Documentation basis: IT 107 student handout (sections 2, 6–18), LabGear development steps through Backend 51 (Step 51 delivered but unconfirmed), and project documents `PROJECT_OVERVIEW.md`, `SECURITY_REQUIREMENTS.md`, `DATABASE_DICTIONARY.md`, `API_REFERENCE.md`. All statuses refer to the evidence reported or available as of November 6, 2026.*
