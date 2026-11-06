# LabGear — Security Requirements and Implementation Tracker

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Information Assurance and Security 1  
**Academic year:** First Semester, A.Y. 2026–2027  
**Document:** `docs/SECURITY_REQUIREMENTS.md`  
**Version:** 1.0  
**Updated:** November 6, 2026  
**Overall status:** **In development — not ready for an end-to-end security demonstration**

> **Source of requirements:** *Security1_Student_Handout.docx*, especially Sections 2, 4–14, 16 and 19. The handout defines **13 required protections** in Section 12 and groups them into **11 security rubric criteria (S1–S11)** in Section 19.2. These are different counts; do not confuse them.
>
> **Evidence rule:** “Code prepared,” “import test passed,” “simulation passed,” and “live end-to-end verified” are distinct states. No control is marked fully complete based solely on the existence of a helper function or frontend mockup.

## 1. System and security scope

LabGear provides role-based laboratory equipment reservations and inventory management for **Students, Instructors, Laboratory Technicians, and Administrators**. Public signup must create **Student** or **Instructor** accounts only. Privileged Technician and Administrator accounts require an authorized provisioning method outside public registration.

**Planned stack:** React/Vite frontend, FastAPI/Pydantic backend, SQLAlchemy, PostgreSQL (`labgear_db`), Argon2id password and security-answer hashing, HMAC-SHA256 OTP digests, AES-256-GCM contact-number encryption, Google reCAPTCHA v2, and Gmail SMTP over TLS.

**Current implementation boundary:** Backend schema/models, authentication utilities, configuration, CAPTCHA validation, registration preparation, and email transport have been developed. Full protected registration, login, password recovery, sessions, monitoring, and frontend-to-backend integration have **not** been demonstrated end to end.

## 2. Seeded requirements for LabGear

The project workflow uses **D1 = 9** and **D2 = 6**, consistent with the previously used lockouts, question set, and field lengths. These values should be checked against the **approved, signed student seed sheet** before final submission.

| Seeded requirement | Handout formula | LabGear working value |
|---|---|---|
| Username minimum | `6 + (D1 mod 3)` | **6 characters** |
| Username maximum | `16 + (D2 mod 5)` | **17 characters** |
| Password minimum | `8 + (D2 mod 4)` | **10 characters** |
| Name field maximum | `20 + D2` | **26 characters** |
| Failures before showing Forgot Password | `2 + (D1 mod 2)` | **3 failures** |
| Lockout after 3 failures | `15 + D1` | **24 seconds** |
| Lockout after 6 failures | `30 + 2 × D1` | **48 seconds** |
| Lockout after 9 failures | `60 + 4 × D1` | **96 seconds** |
| Email OTP expiration | `3 + (D2 mod 3)` | **3 minutes (180 seconds)** |
| Idle session timeout | `5 + (D1 mod 5)` | **9 minutes (540 seconds)** |
| IP block threshold in 10 minutes | `8 + D2` | **14 failed attempts** |
| Authentication question A | `Q[(D2 mod 8) + 1]` | **Q7 — Elementary school name** |
| Authentication question B | `Q[((D2 + 3) mod 8) + 1]` | **Q2 — Best friend in elementary school** |
| Authentication question C | `Q[((D2 + 5) mod 8) + 1]` | **Q4 — Mother's maiden first name** |

**Other fixed handout rules:** OTP has six digits, **three wrong OTP attempts** cancel the code, new OTPs revoke previous codes, resending waits **60 seconds** and is limited to **three resends within 15 minutes**. An IP exceeding the seeded threshold is blocked for **10 minutes**.

## 3. The 13 mandatory security protections — current status

**Legend:** **Prepared / partial** = relevant code or infrastructure exists, but live enforcement is incomplete or not verified. **Pending** = required end-to-end protection has not been established. **Reported configured** = user reported setup/tests; independent audit still needed.

| # | Handout protection | Required behavior and acceptance test | LabGear status and current evidence | Next action |
|---|---|---|---|---|
| **1** | **SQL injection** | Use bound parameters/prepared statements for **every** query; test username payload `' OR '1'='1`. | **Prepared / partial.** SQLAlchemy ORM and parameterized queries appear in registration services; complete route and script audit not performed. | Audit all FastAPI services, dynamic filters and monitoring queries; run injection tests. |
| **2** | **Cross-site scripting (XSS)** | Escape untrusted text everywhere, including attacker-controlled usernames in admin log views; test `<script>alert(1)</script>`. | **Prepared / partial.** React rendering generally escapes text, but no live dashboard XSS penetration test or unsafe-render audit is documented. | Audit `dangerouslySetInnerHTML`, URLs, attributes, and dashboard output; run XSS tests. |
| **3** | **Cross-site request forgery (CSRF)** | A secret CSRF token is present on state-changing forms and validated on the **server**; removing it must cause rejection. | **Pending.** No verified CSRF issuance/validation service or protected forms. | Choose session/cookie design; implement server verification on state-changing operations and test rejection. |
| **4** | **Username enumeration resistance** | Login and Forgot Password behave indistinguishably for unknown username vs wrong credential. | **Pending.** Request schemas exist but live login/recovery handlers are not verified. | Implement generic messages and consistent response behavior; compare both cases. |
| **5** | **IP blocking** | Count failed attempts across **all usernames** from one IP in 10 minutes; at **14 failures**, block that IP for **10 minutes** server-side. | **Prepared / partial.** `ip_blocks` model exists; configuration includes threshold 14 and 10-minute window, but enforcement has not been demonstrated. | Implement transactional IP tracking and blocking, including proxy/IP trust rules; test across accounts. |
| **6** | **Session hardening** | Regenerate session identifier after login; HttpOnly and SameSite cookies; nine-minute inactivity timeout, warning one minute earlier; logout invalidates session; browser Back cannot reveal protected data. | **Pending.** Timeouts are configured but no verified complete session lifecycle or protected routes. | Implement secure session design, server-side idle enforcement, cookie policy and logout tests. |
| **7** | **Password history** | Store only hashes of the last three passwords; reject reuse on password change/reset. | **Prepared / partial.** `password_history` model and `password_was_used()` helper exist; complete reset/change services absent. | Enforce latest-three comparison within authorized reset/change transaction; test reuse. |
| **8** | **Registration honeypot** | Hidden registration field stays blank for real users; if populated, silently reject automated submission. | **Prepared / partial.** `RegistrationRequest.website` and registration gate reject nonempty input; public registration route not yet enabled/tested. | Integrate hidden field in real React request, verify server rejection and generic response. |
| **9** | **Activity logging** | Record all Section 13.4 events with Philippine-time interpretation, IP, user agent and contextual details; log is append-only. | **Prepared / partial.** `activity_logs` table/model exists; a pending-registration event is prepared; complete event coverage is missing. | Standardize event names and logging across auth/admin actions; enforce append-only DB rights. |
| **10** | **Error handling** | Users never see raw Python/SQL tracebacks; detailed errors go to protected server logs. | **Pending.** Some services use generic error messages, but centralized exception handling and disclosure tests have not been verified. | Install safe FastAPI exception handlers and protected logging; test malformed requests. |
| **11** | **Secret protection** | DB, SMTP, CAPTCHA and encryption secrets never appear in committed files or Git history; `.gitignore` excludes secrets. | **Reported configured / audit pending.** `.env` contains separate OTP/JWT/AES keys and CAPTCHA/SMTP credentials, with user-reported Git-ignore checks. Historical Git audit not performed here. | Audit `git ls-files`, full Git history, screenshots, and logs; provide safe example env file with placeholders. |
| **12** | **Security headers** | Every applicable page/response sends `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`. | **Pending.** No verified FastAPI/frontend-server header middleware test. | Implement and inspect browser Network response headers. |
| **13** | **Encryption at rest** | Encrypt at least one sensitive system field with AES-256 and random IV; only the authorized owner can decrypt it. | **Prepared / partial.** AES-256-GCM contact-number encryption and decryption tested in memory; persisted-data access authorization not yet verified. | Test encrypted database values, user-bound access checks, key safety, and authorized decryption. |

**Important:** Section 12 calls these the **13 protections**. Separately, Section 19.2 provides **11 scored security criteria**, not a different 11-protection list.

## 4. Security rubric (S1–S11) traceability

| Rubric | Handout criterion | Relevant protections | Current evidence state |
|---|---|---|---|
| **S1** | Passwords, answers and OTPs are hashed | Password/security-answer/OTP helpers | **Prepared; live database test pending** |
| **S2** | Sensitive system field encrypted at rest (AES-256) | #13 | **In-memory cryptographic tests passed; database authorization pending** |
| **S3** | Server-side validation works with JavaScript off | Input validation | **Pydantic schemas exist; full handout-rule audit and API test pending** |
| **S4** | Account lockout and IP blocking enforced server-side | #5 and login tiers | **Policy configured; enforcement pending** |
| **S5** | OTP, Change Password, dashboard and dashboard API are protected against direct-URL access | Sessions, RBAC, OTP lifecycle | **Pending** |
| **S6** | SQL injection and XSS fail, including dashboard log data | #1, #2 | **Testing pending** |
| **S7** | Server-side CSRF token and CAPTCHA checks | #3 and CAPTCHA | **CAPTCHA service simulated; CSRF pending; live browser integration pending** |
| **S8** | Session hardening and idle timeout | #6 | **Configuration only; enforcement pending** |
| **S9** | No username enumeration | #4 | **Pending** |
| **S10** | No secrets in Git; hidden errors; headers | #10, #11, #12 | **Secrets configured; Git history, errors and headers unverified** |
| **S11** | Logs append-only; dashboard read-only | #9 and monitoring | **Tables/UI mock prepared; real enforcement pending** |

## 5. Authentication and privacy functionality beyond the 13 protections

These are also required by the handout and must not be overlooked just because they sit outside Section 12:

- **Registration (§4):** Approved system-specific fields plus core fields; all browser and server validation; ID in `xxxx-xxxx` format; duplicate ID/username/email refusal; age 18+ recalculated server-side; explicit RA 10173 privacy notice, unchecked consent checkbox and consent timestamp.
- **Username rule (§4.9):** 6–17 characters for this seed, **letters and digits only, starting with a letter**. A check of current `auth_schemas.py` found that underscores, periods, hyphens and numeric first characters are accepted; **correction needed**.
- **Name/address rules (§§4.5–4.7):** Title Case, no all-caps, no triple identical letters or double spaces, age and address patterns, and field-specific errors. Current input schemas enforce only part of this; **correction needed**.
- **Security answers (§5):** The Q7, Q2 and Q4 answers require **2–50 characters, letters and spaces only, no double spaces**, case-normalized before hashing. Current schemas accept 1–200 characters and do not enforce the complete character rule; **correction needed**.
- **Email OTP (§6):** Used for **registration, login and password reset**, six digits, hashed, purpose-bound, expires after three minutes, three wrong tries revoke it, single use, new issues revoke old ones, 60-second resend cooldown and three resends per 15 minutes. **Database-backed lifecycle still pending**.
- **CAPTCHA (§7):** Server verified on **Registration, Login and Forgot Password**. Registration verification code was prepared; live forms and the other two flows are pending.
- **Login (§8):** Password + CAPTCHA, then email OTP, then session creation; generic credential errors; progressive 24/48/96-second lockouts at 3/6/9 failures. Reset counter after successful full login.
- **Security alerts (§9):** Alert at each newly reached account lockout tier (once per tier), and after successful password change. Include failed count, Philippine time, IP, user-agent and reset guidance; do not expose attempted password or alert status to attackers.
- **Forgot / Change Password (§§10–11):** Security question selection and matching response, reset OTP, protected single-use reset authorization, password strength, and rejection of last three passwords.
- **Admin monitoring (§13):** Admin-only read-only dashboard plus protected JSON data endpoint, six types of summary counts, failed-logins-per-hour chart, top five IPs, security flags, and 50 recent events with filters; refresh every 60 seconds; log dashboard views and denied access.
- **Monitoring script (§14):** Check last 24h activity and flag (1) IP over threshold, (2) one username targeted by 3+ IPs, (3) 5+ failed OTPs in 10 minutes, and (4) successful login 00:00–05:00 Philippine time. Deduplicate same pattern + target + day. Must **not** be browser-accessible.

## 6. Important integration gaps identified during documentation

| Priority | Current project issue | Why it matters | Recommended development action |
|---|---|---|---|
| **High** | **Step 51 delivered but not yet user-confirmed** | The registration ORM previously used `purpose='registration'`, but LabGear's database expects `register`. | Complete and record Step 51's read-only checks before implementing verification. |
| **High** | **Pydantic OTP purpose mismatch** | `OTPVerifyRequest` / `OTPResendRequest` currently accept `registration`, `login`, `recovery` rather than DB values `register`, `login`, `reset`. | Align schemas with DB and email OTP HMAC contexts before exposing endpoints. |
| **High** | **Registration input validators do not fully match §4–5** | Tests may pass syntactically while accepting names/usernames/answers that violate the handout. | Update validators and negative tests before public registration. |
| **High** | **No complete OTP verification/resend transaction yet** | No proof of expiration, attempt lockout, replay resistance, account activation or resend throttling. | Implement with row-level locking and persistent database state. |
| **High** | **Registration delivery failure and rate-limiting lifecycle unresolved** | A pending user/OTP could exist even if email delivery fails; abuse/spam still needs controls. | Design explicit persisted send state, safe retries, rate limits and expiration handling. |
| **High** | **Activity event names differ from handout** | Earlier service prepares `registration_pending`; §13.4 expects `REGISTERED`, plus all other named events. | Standardize event vocabulary, audit actor/IP/user-agent collection. |
| **High** | **CSRF, real session hardening, user enumeration defense, headers and monitoring incomplete** | These remain mandatory protections and security rubric criteria. | Implement and penetration-test before demo. |
| **Medium** | **Email body handout wording and per-purpose templates** | §6.3 requires correct purpose, expiry and specific unauthorized-request guidance. | Review mail templates for registration, login and reset; verify content. |
| **Medium** | **Successful simulated tests are not live integration proof** | Unit tests do not establish browser-to-API-to-PostgreSQL security. | Capture end-to-end evidence and expected failure cases as features are completed. |

## 7. Tests and evidence to collect

Do not save actual passwords, OTPs, secret keys, raw reset tokens or private `.env` values in screenshots or documentation.

| Evidence ID | Minimum verification | Current documented status |
|---|---|---|
| **E01** | Read-only PostgreSQL schema and ORM registry checks | **User-reported PASS** for previous backend schema steps. |
| **E02** | Argon2id password, hashed security answers and HMAC OTP tests | **User-reported PASS** in security helper/registration tests. |
| **E03** | AES-GCM contact-number encryption/decryption | **User-reported PASS, in memory**. |
| **E04** | CAPTCHA success/invalid/hostname/outage tests | **User-reported simulated PASS**; live browser flow unverified. |
| **E05** | Gmail SMTP encrypted connection and login | **User-reported PASS**. |
| **E06** | Real registration OTP email arrives in inbox | **User-reported PASS** at Step 50; not a live account OTP. |
| **E07** | Registration OTP accepts once, rejects wrong/expired/revoked and activates only after valid OTP | **Pending**. |
| **E08** | Resend limited to 3/15min with 60-second cooldown; old code revoked | **Pending**. |
| **E09** | Successful login requires both password and OTP; direct URL/endpoint bypass fails | **Pending**. |
| **E10** | Lockout at 3/6/9 failures; cross-account IP block after 14/10min | **Pending**. |
| **E11** | CSRF missing/invalid token rejected and XSS/SQLi probes fail | **Pending**. |
| **E12** | Secure cookies, 9-minute idle timeout, logout and browser Back test | **Pending**. |
| **E13** | Last-three password reuse refused; security alert email delivered | **Pending**. |
| **E14** | Admin-only read-only dashboard, protected API, append-only events | **Pending**. |
| **E15** | Monitoring script's four patterns, deduplication, non-web accessibility | **Pending**. |
| **E16** | Git history, `.gitignore`, safe error responses, security headers | **Pending full audit**. |

### Local read-only verification commands already used

From `C:\Users\Administrator\Documents\LabGear\backend` in its activated virtual environment:

```powershell
python -m app.models.registry
python verify_auth_security_schema.py
python verify_inventory_schema.py
python verify_reservation_schema.py
python test_registration_email_delivery.py
```

The email test defaults to **DRY RUN**; do **not** use `--send` casually. Never run a registration or reset test against real personal accounts without explicit approval.

## 8. Required IT 107 submission documents and checkpoints

The handout additionally requires: approved **System Proposal**, **seed table on the first documentation page**, **Threat Model** (one row per protection), **Design Decisions** addressing each “Your call,” **Privacy Note** under RA 10173, **Error Message Mapping**, **Development Journal** (weekly), Git history with **at least 30 commits over at least four weeks**, an SQL dump with **at least five test records**, and test accounts with accessible inboxes.

Checkpoint expectations are cumulative: (1) approved proposal/seed/Git/test email; (2) registration, consent, OTP, CAPTCHA; (3) full login/recovery/alerts/logs; (4) **13 protections**, dashboard, and monitoring script. **No checkpoint is claimed complete by this document.**

## 9. Maintenance and approval

- **Owner:** LabGear development team.
- **Status updates:** Change *Pending* to *Prepared / partial* when code/tests exist; change to *Verified end to end* **only after** a recorded live verification with evidence.
- **Documentation sources:** Instructor handout; LabGear project overview; delivered backend source snapshots; user-reported test outputs. Confirm actual Windows files before signing off any deliverable.
- **Next step:** Continue documentation with `docs/DATABASE_DICTIONARY.md` after reviewing this file; later resume backend at **Step 51 verification**, followed by the database-backed OTP service.

---

**Confidentiality note:** This document intentionally contains no email addresses, passwords, personal IDs, OTPs, private tokens or encryption keys.
