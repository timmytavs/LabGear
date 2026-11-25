# LabGear — Test Log and Verification Evidence

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Secure Registration, Authentication and Monitoring System  
**Document:** `docs/TEST_LOG.md`  
**Version:** 2.1 — account lockout and UI verification update  
**Updated:** November 18, 2026  
**Overall status:** **Core authentication and Q1–Q8 recovery reported working; November 18 PostgreSQL evidence confirms 3/6/9 account lockout tiers at 15/30/60 seconds, and developer confirmed countdown persistence after refresh. IP-blocking regression, authoritative cross-device countdown, and final security evidence remain open.**

> **Evidence rule:** A developer's **DONE** confirmation records a reported completion, not an independently retained test transcript. Distinguish isolated syntax/mock tests, live database/provider checks, and end-to-end browser tests. Preserve historical failures and their fixes. The specific November 17 PowerShell outputs and November 18 PostgreSQL/browser screenshots mentioned below were directly shared; unshared test details remain labeled **reported**.

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
| Frontend | React / Vite; authentication, role-specific workflows, equipment and reservations integrated in later steps |
| Database | PostgreSQL database `labgear_db` via application credentials in private `.env` |
| Local URLs | React commonly `http://localhost:5173`; FastAPI commonly `http://localhost:8000` or `http://127.0.0.1:8000`. Use one consistent browser/API hostname for recovery cookies. |
| Security helpers | Argon2id, HMAC-SHA256, AES-256-GCM, Google reCAPTCHA v2, Gmail SMTP SSL/TLS |
| Secrets handling | `.env` is private and intended to be untracked; do not copy its contents into the test log |
| Local timezone | Asia/Manila (PHT, UTC+08:00) |

**Current instructor-wide settings (notice issued November 16, 2026; values reported PASS November 17 and account lockout tiers directly evidenced November 18):** username **6–20** characters; password minimum **8** characters; each name field maximum **50**; Forgot Password link after **2** failed logins; account lockouts at **3 / 6 / 9** failures for **15 / 30 / 60 seconds**; six-digit email OTP expiry **5 minutes**; idle timeout **15 minutes**; IP block at **10 failed attempts in 10 minutes**, lasting **10 minutes**; and **three distinct Q1–Q8** questions chosen by the registrant. Original D1/D2 calculation artifacts are **superseded**, not the current acceptance criteria. The handout also specifies OTP resend cooldown **60 seconds** and at most **3 resends per 15 minutes**; record separate edge-case evidence for those rules.

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

### 3.3 Authentication and security integration — later backend/frontend work

The records below **supplement** the original Steps 36–50, rather than erasing the earlier development history. Unless a console excerpt is given, a PASS is the developer's report, not a newly executed test by this document's author.

| Test ID | Stage / file(s) | Test performed or reported | Outcome | Evidence level / note |
|---|---|---|---|---|
| LG-AUTH-051-088 | Later backend authentication and React forms | Database-backed registration and email OTP, login with CAPTCHA/email OTP, username recovery and password-reset OTP | **Reported live PASS** | Developer tested running system after earlier Step 51 draft; original Step 51 'pending' checkpoint is obsolete. Retain specific negative-case outputs separately. |
| LG-AUTH-REC-FIX | `backend/app/services/password_recovery_service.py` | Fixed a read-only security-answer query that unnecessarily used `SELECT ... FOR UPDATE` | **Reported PASS** | Recovery OTP worked after this compatibility correction. |
| LG-SEC-CSRF | Auth routes and frontend clients | CSRF missing/altered token rejected | **Reported PASS** | Earlier LabGear security tests; preserve actual HTTP status evidence. |
| LG-SEC-HONEYPOT | Registration route/gate | Populated bot-trap field rejected | **Reported PASS** | Retain representative negative request and resulting no-insert proof. |
| LG-SEC-IP | Login security | IP block behavior during the earlier configuration | **Reported PASS (historical)** | Threshold was later changed to **10/10 min**; independent final multi-account test at the new threshold needs recorded evidence. |
| LG-SEC-HISTORY | Password change/reset | Reuse of current and two preceding passwords rejected | **Reported PASS** | Avoid including any actual password in the test log. |
| LG-SEC-ENUM | Login/recovery | Generic responses resist username enumeration | **Reported PASS** | Exact side-by-side response comparison should be attached. |
| LG-SEC-HEADERS | Frontend/backend setup | Security headers were implemented and tested during development | **Reported partial PASS** | Final deployed response/header sweep still needs evidence. |
| LG-SEC-LOGS | Admin monitoring and activity logs | Admin security dashboard, logged events, security analysis functionality | **Reported working** | Audit required event coverage, read-only behavior and append-only DB rights before sign-off. |

### 3.4 Functional system development — Files 109–130

| Test ID | File(s) / component | Reported test result | Scope and remaining evidence |
|---|---|---|---|
| LG-FUNC-109-115 | Inventory equipment view; student/instructor reservation page; reservation list and submissions | **Reported working; earlier UI issue fixed** | Save screenshots of create/list/approve and DB state transition for a demo test record. |
| LG-FUNC-116-117 | Equipment management routes and router registration | **Reported route checks PASS** | Verify role-based create/update in live DB and stock integrity. |
| LG-FUNC-118-123 | Role-specific frontend, admin users, equipment management, API registration | **Developer tests reported PASS** | Admin user list/role PATCH routes were exposed in OpenAPI; role restriction requires authorized/unauthorized response evidence. |
| LG-FUNC-124-128 | Equipment damage/repair history; reservation cancellation of pending/approved requests | **Developer tests reported PASS** | Save state-change screenshots and verify cancellation restrictions and audit entries. |
| LG-ADMIN-120-130 | `GET /api/admin/users` and `PATCH /api/admin/users/{user_id}/role`; later account-management changes | **Routes present; functionality reported working** | The API only assigns non-admin roles; do not describe it as a public admin-promotion endpoint. Verify CSRF/session/privilege checks. |
| LG-BUILD-LATER | Frontend Vite production build | **Observed PASS in supplied PowerShell output:** `2082 modules transformed`; `✓ built in 517ms` | This confirms the build at that checkpoint, **not** a fresh build after later Files 131–151. |

### 3.5 Uniform-settings and selectable-question changes — Files 131–148

| Test ID | File / change | Observed or reported result | Verification boundary |
|---|---|---|---|
| LG-POLICY-131-139 | Auth configuration, validation, user/login/recovery changes to implement instructor-wide values | **Developer reported all required settings PASS** | Configuration/functional acceptance reported; does not replace final adversarial/regression tests. |
| LG-QUESTION-140-143 | Registration service/schema and password recovery backend accept **three distinct Q1–Q8** | **Reported PASS** | Retains legacy Q7/Q2/Q4 inputs for compatibility. |
| LG-QUESTION-144-146 | Recovery panel, registration panel and registration API client updated for selectable questions | **Reported PASS** | Frontend integration progressed; needs live DB/OTP verification below. |
| LG-QUESTION-147-A | `backend/app/api/routes/registration.py` | **Observed PowerShell:** `Registration routes: 3`; `Selected questions supported: True`; `Legacy fields supported: True` | Import/field introspection only, not end-to-end execution. |
| LG-QUESTION-147-B | `backend/app/core/auth_config.py` | **Observed PowerShell:** `Security question count configured: True`; `Required security questions: 3` | Confirms field presence and loaded value. |
| LG-QUESTION-DB-1 | PostgreSQL `user_security_answers` CHECK constraint | **Observed screenshot (before fix):** `valid_question_code` allowed only Q7/Q2/Q4 | Identified database blocker to Q1–Q8 registration. |
| LG-QUESTION-DB-2 | PostgreSQL `valid_question_code` constraint altered to permit Q1–Q8 | **Developer reported DONE** | Post-change constraint result was not uploaded; keep a read-only proof before final submission. |
| LG-QUESTION-E2E | Registration with three chosen codes, Gmail registration OTP, and stored question rows | **Developer reported live PASS** | Exact output/sanitized screenshots should be attached; do not expose actual answers or OTPs. |
| LG-REC-148-FAIL | Recovery UI with **Q1** | **Observed screenshot:** 'Select one of the assigned security questions.' No recovery POST visible; repeated `GET /api/auth/me 401` while signed out | Root cause: frontend API client only allowed Q7/Q2/Q4. Those `/me` 401 responses were normal unauthenticated checks, **not** evidence of a failed recovery POST. |
| LG-REC-148-FIX | `frontend/src/services/passwordRecoveryApi.js` File 148 | **Locally mocked checks reported PASS; developer confirmed working live** | Accepts Q1–Q8, username 6–20 and password min 8; preserves CSRF/CAPTCHA/cookies. |
| LG-REC-148-E2E | Forgot Password → saved question → Gmail OTP → password reset → new login; old password rejected | **Developer explicitly confirmed completed, November 17, 2026** | **Reported live PASS**; archive sanitized browser/email/HTTP evidence without secrets. |

**Actual outcomes vs. derived assumptions:** The user's November 17 statement that all settings pass covers their local verification; it does not supply the exact run transcript for each timeout/IP edge case. **The November 18 account lockout evidence is more specific** and is documented below. PostgreSQL Q1–Q8 and full recovery were reported successful, while the pre-fix constraint screenshot and File 147 PowerShell outputs were directly observed.

### 3.6 Persistent account lockout and UI — Files 149–151 (November 18, 2026)

**Test environment:** Existing local verified test account; React/Vite login UI; FastAPI; PostgreSQL `labgear_db`; PostgreSQL Query Tool and browser screenshots shared in the development conversation. **No real password, OTP, CAPTCHA token, cookie or sensitive user identifier is included here.**

| Test ID | Component and action | Actual observed outcome | Result and limitation |
|---|---|---|---|
| **LG-LOCK-149-01** | `backend/app/services/login_service.py` (File 149); check failed-login counter after incorrect-password tests | PostgreSQL screenshot first showed **4** failures and `locked_until = NULL`; a later screenshot showed **9** failures, a future `locked_until`, and `lockout_status = LOCKED`. | **Observed database PASS** for persisted failure counts and active locked state. The earlier `NULL` does not disprove the 3-attempt lock; File 149 can clear an expired lock on the next attempt. |
| **LG-LOCK-149-02** | Read `activity_logs` events for the same test account | `login_account_lockout` records showed **3 attempts → 15 seconds**, **6 → 30 seconds**, **9 → 60 seconds**. An additional earlier **3 → 15** entry is historical. | **Observed PostgreSQL PASS** for all three specified thresholds and recorded durations. |
| **LG-LOCK-149-03** | Inspect backend response following invalid password and lack of authenticated session | Terminal screenshot showed `POST /api/auth/login → 401` and `GET /api/auth/me → 401` while signed out. | **Observed generic rejection**. The `/me` 401 is an expected unauthenticated session check; it does not prove exact remaining lockout timing. |
| **LG-LOCK-150-01** | `frontend/src/pages/auth/LoginPanel.jsx` (File 150); trigger lockout during login | Browser screenshot displayed **“Sign-in temporarily paused”**, a remaining `00:08` countdown, and a visually disabled Login button. | **Observed browser UI PASS** for countdown display and disabled Login presentation. UI countdown uses local rejected-response tracking and may diverge from server lock duration. |
| **LG-LOCK-150-02** | Attempt to select Forgot Password while the countdown is running | Developer explicitly confirmed **Forgot Password could not be clicked** during the visible countdown. | **Developer-confirmed UI PASS**; this is not proof that the password-recovery API itself rejects a locked account. |
| **LG-LOCK-151-FAIL** | Refresh the browser while a roughly 60-second countdown is active | Developer observed that the countdown **disappeared/reset on refresh** in File 150. | **Observed defect**, resolved by File 151. |
| **LG-LOCK-151-FIX** | `frontend/src/pages/auth/LoginPanel.jsx` (File 151); refresh browser and reopen Login in same tab | File 151 persists an absolute UI deadline in same-tab `sessionStorage`; developer replied **“it works now!”** after testing refresh. | **Reported live PASS** for same-tab persistence. No server-synchronized timer or cross-device behavior is claimed. |

**Evidence interpretation and security boundary:** The PostgreSQL `users.locked_until` timestamp and `login_account_lockout` records demonstrate **backend persistence**. The React countdown is a **user-interface aid**, not the access-control mechanism; clearing sessionStorage, closing the tab or switching devices may remove the displayed timer but must not remove the server lock. The generic `401` on account-specific failures helps avoid username enumeration. Neither the login screenshot nor the UI restriction proves that the **password-recovery endpoint** is blocked during lockout. The instructor specifies Forgot Password visibility after two failed logins, but does not explicitly require recovery to be disabled during lockout; revisit this additional UX choice before final sign-off.

**Evidence available in the conversation:** November 18 screenshots of `users.failed_login_attempts`/`locked_until`, an audit-log query with recorded `3/15`, `6/30`, `9/60` values, a live countdown/disabled Login interface, a post-refresh missing-countdown defect, and subsequent developer confirmation of the File 151 correction. **Evidence files have not been claimed saved to the repository.**

---

## 4. Instructor security requirements — updated evidence matrix

**Requirement source:** The original Security1 Student Handout's 13 required protections; apply the instructor's November 16 uniform settings rather than obsolete seed formulas. **“Reported PASS” means user-confirmed**, whereas **“Final evidence needed”** remains open even for implemented controls.

| No. | Protection | Current evidence | Final evidence/acceptance check |
|---:|---|---|---|
| 1 | SQL injection defense | SQLAlchemy parameterized services inspected; **review needed** | Try `' OR '1'='1` in supported test inputs and check rejection without SQL errors; audit custom SQL. |
| 2 | XSS defense | React safe text rendering used; **review needed** | Safely test `<script>alert(1)</script>` in logs/input and confirm no code executes. |
| 3 | CSRF defense | **Reported PASS** | Record actual HTTP 403 for missing/altered token, plus success with a legitimate token. |
| 4 | Username enumeration | **Reported PASS** | Compare unknown-user vs wrong-password/recovery responses without leaking account existence. |
| 5 | IP blocking | Earlier security tests **reported PASS**; new **10 attempts/10 min** configuration reported PASS. November 18 account lockout tests are **not** an IP-blocking verification. | Record current cross-account threshold, 10-minute block, and expiry behavior. |
| 6 | Session hardening | Password + OTP login, 15-minute setting **reported PASS**. November 18 database screenshots independently show server-enforced account lockout; the React countdown is not a session security mechanism. | Verify session cookie flags, login renewal, idle expiry, logout and browser Back/direct URL. |
| 7 | Password history | **Reported PASS** | Attach sanitized denial for current and previous two passwords. |
| 8 | Honeypot | **Reported PASS** | Submit populated hidden field and prove no pending account is stored. |
| 9 | Activity logging | **Observed PostgreSQL** `login_account_lockout` event rows at 3/6/9 failures with durations 15/30/60 seconds. Other event coverage remains **partially demonstrated**. | Inspect required events, IP/user agent, audit permissions and dashboard filters. |
| 10 | Error handling | Generic handlers in examined routes; **review needed** | Submit malformed requests; confirm no stack traces/SQL details/secret values in client response. |
| 11 | Secret protection | `.env` kept private by project convention; **full audit pending** | Audit tracked files, `.gitignore`, and Git history; do not print secrets. |
| 12 | Security headers | Middleware/header checks **reported** | Confirm `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` in final frontend/backend deployment. |
| 13 | AES-256 encryption at rest | AES-256-GCM implementation and local cryptographic tests; **DB proof needed** | Inspect stored contact ciphertext/nonce; verify authorization and denied retrieval by another user. |

**Additional rubric:** Instructor security criteria **S1–S11** remain traceable through `docs/SECURITY_REQUIREMENTS.md`. Security questionnaire selection, OTP, lockouts and role-based reservation actions are test obligations beyond this 13-protection list.

---

## 5. IT 107 end-to-end self-test register — updated

Use fictional test accounts with accessible email inboxes, an isolated local database and sanitized screenshots. **“Reported PASS” is not a substitute for preserved evidence.** The earlier version of this section marked every test NOT RUN; that is no longer accurate for the specifically confirmed live workflows.

| ID | Instructor-style test | Required secure outcome | Updated record / remaining verification |
|---|---|---|---|
| LG-E2E-01 | Inspect stored secrets and sensitive fields | Password, security answers, OTP, contact protected | Hashing/cryptography tests **reported PASS**; capture DB evidence. |
| LG-E2E-02 | Send invalid registration directly without JS | Backend rejects invalid inputs | Current schema checks present; final direct API negative test evidence needed. |
| LG-E2E-03 | Three failed logins then clear cookies | Server lockout remains | **Backend lock confirmed in PostgreSQL Nov 18**; clearing cookies/new browser and retry denial not explicitly demonstrated. |
| LG-E2E-04 | Reach 3/6/9 failure tiers | **15 / 30 / 60 sec** enforced | **Observed PostgreSQL PASS Nov 18:** `login_account_lockout` rows show **3→15, 6→30, 9→60**, and a future `locked_until` / `LOCKED`. Capture precise HTTP retry timing separately if required. |
| LG-E2E-05 | At lockout tier check alert email | Accurate PHT/IP/user-agent alert | Database lockout events observed at 3/6/9; **live alert inbox evidence still needed**. |
| LG-E2E-06 | Open protected URL before OTP completes | No protected session | OTP login working; bypass test evidence needed. |
| LG-E2E-07 | Open Change Password URL unauthenticated | Request denied | Final HTTP authorization check needed. |
| LG-E2E-08 | Three incorrect OTPs then correct OTP | Revoked code cannot be used | Specific negative-case evidence needed. |
| LG-E2E-09 | Use OTP after expiry | Reject after **5 minutes** | Setting **reported PASS**; time-based negative case evidence needed. |
| LG-E2E-10 | Issue replacement OTP; test old OTP | Previous OTP rejected | Specific revocation test evidence needed. |
| LG-E2E-11 | Resend too quickly / too often | **60-sec** cooldown, **3 resends/15 min** | Specific rate-limit evidence needed. |
| LG-E2E-12 | SQL injection probe | Authentication safe; no SQL disclosure | Not independently recorded. |
| LG-E2E-13 | XSS attempt in logs/input | No script execution | Not independently recorded. |
| LG-E2E-14 | Missing CAPTCHA on register/login/recovery | Server refuses | CAPTCHA service tests reported; negative live route cases need evidence. |
| LG-E2E-15 | Missing/altered CSRF token | Server rejects state-changing request | **Reported PASS**; retain response evidence. |
| LG-E2E-16 | Unknown username versus wrong password | Generic account-safe behavior | **Reported PASS**; attach comparison. |
| LG-E2E-17 | Reuse recent password | Reject last three passwords | **Reported PASS**; do not disclose passwords. |
| LG-E2E-18 | Wait beyond session inactivity timeout | Expire at **15 minutes** and warn before expiry | Setting **reported PASS**; browser/session test needed. |
| LG-E2E-19 | Non-admin visits admin API/dashboard | Permission denied and recorded | Backend role checks present; final live denial case needed. |
| LG-E2E-20 | Logout, browser Back, call protected endpoint | No protected content | Final live browser/API evidence needed. |
| LG-E2E-21 | Attempt browser access to CLI monitor | Script inaccessible | Final browser-access check needed. |
| LG-E2E-22 | Try editing/deleting audit events with app DB role | Read-only/append-only logs | Final permissions test needed. |
| LG-E2E-23 | Scan Git history for secrets | No real secrets tracked | Full repo/history audit pending. |
| LG-E2E-24 | Execute monitoring script on four attack patterns | Flags and deduplication correct | Earlier monitoring functionality reported; attach final CLI run. |
| LG-E2E-25 | Reservation create/approve/issue/return/damage | Correct role, DB and inventory transitions | Functional routes tested in development; capture one connected demo for each relevant action. |
| LG-E2E-26 | Register selecting Q1/Q5/Q8 (or any 3 distinct codes) | 3 hashed answers saved; Gmail OTP activates account | **Reported live PASS, Nov 17**; post-change constraint and DB row evidence recommended. |
| LG-E2E-27 | Recover with one saved question, OTP and new password | Recovery succeeds; new password logs in, old one rejected | **Reported live PASS, Nov 17** after File 148. |
| LG-E2E-28 | User picks duplicate or out-of-bank question | Backend rejects duplicate/Q9 and invalid answers | Local schema/client rejection checks; retain live API negative responses. |
| **LG-E2E-29** | Password failures for verified account; inspect DB | Counter increases and lock expiration persisted | **Observed DB PASS Nov 18**: counter **9**, future `locked_until`, `LOCKED`; earlier **4** with `NULL` after expiry was also observed. |
| **LG-E2E-30** | Query tier-by-tier lockout events | Record 3/15, 6/30, 9/60 in `activity_logs` | **Observed DB PASS Nov 18** for the required thresholds and durations. |
| **LG-E2E-31** | Trigger lock countdown; attempt Login and Forgot Password | Controls disabled during UI countdown | **Observed screenshot** countdown and Login disabled; **developer-confirmed PASS** Forgot Password unclickable. UI-only; recovery API gate not verified. |
| **LG-E2E-32** | Refresh while countdown active | Same-tab countdown retains remaining time | **File 150 observed FAIL**, **File 151 developer-reported PASS**. State saved in browser tab only; not authoritative after cross-browser/device attempts. |

**Correction retained for traceability:** Earlier tests referenced 24/48/96-second lockouts, 3-minute OTP expiry, 9-minute idle, 14-IP threshold and fixed Q7/Q2/Q4. These were *historical development parameters* and **must not be used for final acceptance**. File 150 originally lost its local countdown on refresh; File 151 resolved that particular same-tab issue according to the developer. Exact server-synchronized UI timing is still open.

---

## 6. Safe verification commands and observed outputs

Run these from the appropriate project terminal. These commands do not intentionally mutate the database. **Do not rerun live OTP sends unnecessarily** or print real credentials/codes.

**Backend schema/route inspection** (activated `.venv` from `LabGear/backend`):

```powershell
python verify_auth_security_schema.py
python verify_inventory_schema.py
python verify_reservation_schema.py
python -m app.models.registry
python -c "from app.api.routes.registration import PublicRegistrationRequest, router; print('Registration routes:', len(router.routes)); print('Selected questions supported:', 'security_questions' in PublicRegistrationRequest.model_fields); print('Legacy fields supported:', all(q in PublicRegistrationRequest.model_fields for q in ('security_answer_q7','security_answer_q2','security_answer_q4')))"
python -c "from app.core.auth_config import AuthSettings, load_auth_settings; print('Setting present:', 'security_questions_required' in AuthSettings.__dataclass_fields__); print('Required security questions:', load_auth_settings().security_questions_required)"
```

**Observed November 17 results** (actual user-supplied output):

```text
Registration routes: 3
Selected questions supported: True
Legacy fields supported: True
Security question count configured: True
Required security questions: 3
```

**PostgreSQL security question constraint** (pgAdmin Query Tool, read-only):

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_security_answers'::regclass
  AND conname = 'valid_question_code';
```

The observed **pre-fix** constraint allowed Q7/Q2/Q4 only. The developer reported executing the Q1–Q8 update; capture the *post-fix* definition as a final artifact.

**Observed November 18 account-lockout evidence queries** (read-only; replace `TEST_USERNAME` with a fictional test account when running locally; do not publish actual usernames):

```sql
SELECT username, failed_login_attempts, locked_until,
       CASE WHEN locked_until > NOW() THEN 'LOCKED' ELSE 'NOT LOCKED' END AS lockout_status
FROM public.users
WHERE LOWER(username) = LOWER('TEST_USERNAME');
```

```sql
SELECT created_at,
       details->>'failed_attempts' AS failed_attempts,
       details->>'duration_seconds' AS lockout_seconds
FROM public.activity_logs
WHERE event_type = 'login_account_lockout'
  AND user_id = (
      SELECT id_number FROM public.users
      WHERE LOWER(username) = LOWER('TEST_USERNAME')
  )
ORDER BY created_at DESC
LIMIT 10;
```

**Directly shared results:** Database screenshot showed **9 failed attempts** and `LOCKED` with a stored future timestamp; audit events included **3 / 15 s**, **6 / 30 s**, **9 / 60 s**, plus an older **3 / 15 s** event. These are read-only screenshot observations, not an automated test script or a reproduction in another environment.

**Frontend verification** (from `LabGear/frontend`):

```powershell
Get-Content -Raw .\src\services\passwordRecoveryApi.js | node --input-type=module --check
npm run build
```

The 2082-modules Vite build output belongs to an **earlier frontend checkpoint**. Run and archive a fresh build after **File 151** rather than mislabeling the older result as a current build. The developer confirmed the browser countdown refresh behavior; a fresh `npm run build` result after File 151 has not been shared.

**Runtime authentication check:** A signed-out `GET /api/auth/me` may correctly return **401 Unauthorized**. During password recovery, confirm a **POST `/api/auth/password-recovery`** appears after validation and CAPTCHA; the earlier client-side bug prevented that POST. Do not mistake the `/me` 401 entries for a recovery failure.

---

## 7. Evidence naming and screenshot checklist

Suggested evidence placement (only if you already maintain an evidence directory; do not create extra project files just for this document):

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

Suggested filename scheme: `LG-<ID>_YYYY-MM-DD_<short-topic>.png`. Example: `LG-QUESTION-DB-2026-11-17_constraint.png`. Example names are **not** claims that evidence files exist.

- Capture the actual command/action and result (status code or safe success/failure), not private secrets. For the lockout screenshots, preserve tier/duration values while obscuring the test username and any identifying user IDs.
- Mask OTP codes, security answers, passwords, recovery tokens, account IDs, personal addresses, recipient email addresses and cookie values.
- Keep at least one passing and one deliberately rejected scenario for each high-risk control when preparing final evidence.
- The **user-reported** test outcomes are useful development history, but attach sanitized screenshots/transcripts where the instructor expects proof.

---

## 8. Test-result record template

Copy this block for future tests. Never overwrite earlier failures or their fixes.

```markdown
### Test LG-<CATEGORY>-<NUMBER> — <objective>
- Date/time (PHT):
- Tester:
- Source file / commit:
- Test level: simulated / read-only database / live provider / end-to-end
- Preconditions (test-only; no secrets):
- Steps or command:
- Expected result:
- Actual result:
- Status: PASS / FAIL / BLOCKED / NOT RUN / REPORTED PASS
- Sanitized evidence file(s):
- Related instructor requirement:
- Defect and retest notes:
```

---

## 9. Remaining sign-off checklist (not a declaration of failure)

The software has progressed well beyond the November 6 documentation snapshot. The following are **evidence and delivery checks**, not assertions that the features are absent:

1. **Latest-state capture:** Attach a sanitized full registration → Gmail OTP → login → Q1–Q8 recovery → OTP → password reset → new login sequence (already **reported passed**).
2. **Mandatory security negative tests:** **Lockout tier records are directly evidenced (3/15, 6/30, 9/60 on Nov 18)**. Still verify/record IP threshold 10, exact lockout rejection timing after browser/cookie resets, OTP expiry/attempt limits/resend, session idle 15 minutes, XSS/SQL injection, CSRF, cookie protections and authorization denials.
3. **Database protections:** Capture Q1–Q8 CHECK definition, hashing/encryption evidence, contact decryption authorization and append-only logging permissions.
4. **Functional demonstration:** Capture an authorized equipment/reservation/approval/return/damage sequence with PostgreSQL state, and relevant admin monitoring/role checks.
5. **Submission readiness:** Fresh Vite build (after File 151)/backend startup, Git changes/.gitignore/full-history secret audit, safe SQL dump/test accounts, and instructor-required documents/commit record. The local countdown works after refresh in one tab but is not synchronized across browsers/devices; password-recovery endpoint access during lockout is unverified.

**Status as of November 18, 2026:** Core integrated authentication and selected-question recovery **developer-reported PASS**; the 3/6/9 account lockout database records and lockout durations are **directly evidenced**, with a refresh-persistent UI countdown **developer-confirmed working** after File 151. IP-blocking, cross-device timer synchronization, password-recovery API behavior during lockout, and the final independent security evidence/repository audit **remain open**. Do not equate absence of an attached screenshot with a failed implementation.

---

*Documentation basis: existing `docs/TEST_LOG.md` version 2.0 (Nov 17), updated `docs/SECURITY_REQUIREMENTS.md` version 2.1, the instructor's Nov 16 uniform-settings notice, Files 149–151, and November 18 shared pgAdmin/frontend/terminal screenshots and user test confirmations. Unverified behaviors remain explicitly labeled as such.*
