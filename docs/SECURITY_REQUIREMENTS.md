# LabGear — Security Requirements and Implementation Tracker

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Information Assurance and Security 1  
**Academic year:** First Semester, A.Y. 2026–2027  
**Document:** `docs/SECURITY_REQUIREMENTS.md`  
**Version:** 2.0  
**Updated:** November 17, 2026  
**Overall status:** **Core authentication and selected-question recovery tested; final security evidence and submission audit remain open.**

> **Requirements basis:** The project's *Security1 Student Handout* as described in the original documentation, plus the instructor's November 16, 2026 uniform-settings notice. The handout distinguishes **13 mandatory protections** (Section 12) from **11 security rubric criteria, S1–S11** (Section 19.2).
>
> **Evidence rule:** **Reported PASS** records a developer's completed test; **observed output** records a console response or screenshot seen during development; **implemented / review needed** is not a test pass. Preserve screenshots and sanitized logs before making a final independent sign-off.

## 1. System and security scope

LabGear supports **Students, Instructors, Laboratory Technicians, and Administrators**. Students and instructors can self-register; technician and administrator privileges require controlled provisioning. Features include equipment management, reservation requests and cancellation, technician approval/issuance/returns, damage and repair records, administrative user management, and security monitoring.

**Implemented stack:** React/Vite frontend, FastAPI/Pydantic backend, SQLAlchemy, PostgreSQL (`labgear_db`), password and answer hashing using Argon2id, HMAC-SHA256 OTP digests, AES-256-GCM contact-number encryption, Google reCAPTCHA v2, and Gmail SMTP using a Google App Password over TLS/STARTTLS. Gmail SMTP is an **email transport**, not a dedicated OTP API; FastAPI generates and verifies codes.

**Integration state:** The developer reported successful browser-to-FastAPI-to-PostgreSQL registration, email OTP verification, login, password recovery with a user-selected question, recovery OTP, password reset, and login with the new password. Equipment, reservations, administrative routes, and security tests were also developed and exercised, with supporting details to be consolidated in `docs/TEST_LOG.md`.

## 2. Current instructor-wide security settings (supersede seed formulas)

On **November 16, 2026**, the instructor replaced Section 2.2's personal D1/D2/mod formulas with **uniform class-wide settings**. **Do not use the older 9/6 or 0/9 seed calculations as current policy.** Keep their history, if needed, only in `docs/PERSONAL_SEED_TABLE.md` with a superseded notice.

| Setting | Current requirement | Verification state |
|---|---|---|
| Username length | **6–20 characters** | Developer reported PASS |
| Minimum password length | **8 characters** | Developer reported PASS |
| Maximum length of each name field | **50 characters** | Developer reported PASS |
| Show Forgot Password link | After **2 failed login attempts** | Developer reported PASS |
| Account lockout thresholds | At **3, 6, and 9** failed logins | Developer reported PASS |
| Lockout durations | **15 / 30 / 60 seconds**, respectively | Developer reported PASS |
| Email OTP expiry | **5 minutes (300 seconds)** | Developer reported PASS |
| Inactivity/session timeout | **15 minutes (900 seconds)** | Developer reported PASS |
| Failed-login IP threshold | **10 attempts within 10 minutes** | Developer reported PASS for settings; recheck multi-account live enforcement |
| IP block duration | **10 minutes** | Developer reported PASS for settings; confirm live enforcement |
| Recovery questions | User selects **3 distinct questions from Q1–Q8** at registration | Registration/recovery flow reported PASS |

**Other handout rules retained in the original requirements:** Six-digit OTPs; three wrong OTP attempts invalidate a code; replacement OTP invalidates the previous code; resend cooldown **60 seconds**; no more than **3 resends in 15 minutes**. These specific edge cases still require clearly linked evidence, even when the normal OTP flow passes.

**Question handling:** Registration allows any three *different* codes Q1–Q8, records hashed answers, and password recovery accepts only a question/answer belonging to the identified account. The legacy fixed Q7/Q2/Q4 request format remains supported for compatibility. In November 2026, PostgreSQL's outdated `valid_question_code` constraint was identified as Q7/Q2/Q4-only; the developer reported completing the Q1–Q8 constraint update and registration test.

## 3. The 13 mandatory security protections — implementation and evidence

**Status terminology:** **Reported PASS** = developer confirmed a test; **partial / review needed** = relevant implementation exists but no complete test evidence is available here. The table does not claim every protection has passed an independent final audit.

| # | Protection | Required outcome / acceptance check | Current LabGear evidence | Final evidence needed |
|---|---|---|---|---|
| **1** | **SQL injection** | Parameterize every query; `' OR '1'='1` must not bypass login or leak SQL errors. | SQLAlchemy ORM and bound queries used in examined services. **Partial / review needed.** | Audit dynamic SQL and test injection through login/search routes. |
| **2** | **Cross-site scripting (XSS)** | Untrusted input in React/admin logs must display as inert text, not executable HTML. | React escaping is used in normal rendering. **Partial / review needed.** | Test `<script>alert(1)</script>` safely; audit unsafe HTML rendering and links. |
| **3** | **CSRF** | State-changing endpoints reject missing/invalid tokens on the server. | **Reported PASS** in earlier LabGear security tests; registration/recovery clients request signed CSRF tokens. | Save status-code evidence for both valid and missing/invalid tokens across relevant routes. |
| **4** | **Username enumeration resistance** | Unknown username and wrong credentials must not reveal whether an account exists. | **Reported PASS** in earlier LabGear login/recovery tests. | Preserve matched messages and response-behavior evidence. |
| **5** | **IP blocking** | Count failed attempts across usernames; block at **10 failures/10 minutes** for **10 minutes**. | IP-blocking tests were reported PASS before the instructor change; current settings reported PASS. | Repeat live multi-account test using the new threshold, including block expiry. |
| **6** | **Session hardening** | Fresh authenticated session after password + OTP; HttpOnly/SameSite cookies; **15-minute** idle timeout; logout and Back cannot restore protected access. | Login OTP and authenticated flows reported working; idle setting reported PASS. **Full lifecycle review needed.** | Verify cookie properties, expiry, logout invalidation, Back/direct URL protections. |
| **7** | **Password history** | Hash current/recent passwords and reject reuse of the last three on change/reset. | **Reported PASS** for password-history security tests; recovery reset also completed. | Attach sanitized negative-case response for reused passwords. |
| **8** | **Registration honeypot** | Populated hidden field must be refused by backend without creating an account. | **Reported PASS** in prior LabGear security tests; registration gate rejects it. | Capture a negative end-to-end request and database outcome. |
| **9** | **Activity logging** | Record required security events with time/IP/user agent; log must be append-only and admin-monitored. | Activity logging and security dashboard developed; some event tests reported PASS. **Coverage review needed.** | Verify Section 13.4 event types, log immutability, and admin filters. |
| **10** | **Safe error handling** | No Python/SQL tracebacks, raw secrets or internal exceptions in browser responses. | Generic FastAPI errors implemented in inspected routes. **Negative-case review needed.** | Test malformed requests and server failures; inspect responses. |
| **11** | **Secrets protection** | Keep database, Gmail App Password, CAPTCHA, HMAC and AES secrets outside committed files and Git history. | Private `.env` and ignore controls reported configured. **Historical Git audit not evidenced.** | Check tracked files and history without printing secrets in shared evidence. |
| **12** | **Security headers** | `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` on applicable responses. | Header middleware is described in later development records. **Full deployment check needed.** | Inspect frontend and API success/error responses. |
| **13** | **AES-256 encryption at rest** | Sensitive contact field stored as AES-256-GCM ciphertext with fresh IV; only authorized access may decrypt it. | AES-256-GCM encryption service and in-memory tests available. **LabGear database/authorization proof needs review.** | Inspect stored ciphertext/nonce and test authorized vs. unauthorized retrieval. |

**Important distinction:** Completion of the uniform **settings** in Section 2 does **not automatically prove** all 13 attack-resistance and authorization tests above.

## 4. Security rubric (S1–S11) traceability

| Rubric | Instructor criterion | Relevant protection(s) | Current evidence assessment |
|---|---|---|---|
| **S1** | Hash passwords, security answers, OTPs | Hashing services / registration | Hashing implementation and user tests reported PASS; save DB evidence. |
| **S2** | Encrypt sensitive data with AES-256 | #13 | Cryptographic implementation available; DB/authorization evidence needed. |
| **S3** | Server-side validation even when JS is bypassed | Registration and recovery validation | Updated username, name, password, and Q1–Q8 validation reported PASS; add negative API tests. |
| **S4** | Account lockouts and IP blocking | #5 plus 3/6/9 tiers | New settings reported PASS; live threshold/expiry evidence should be filed. |
| **S5** | Protected OTP, change-password, dashboard and APIs | Sessions and role-based access | Functional login, OTP, recovery and role-specific APIs developed; direct-URL denial checks need recorded evidence. |
| **S6** | Prevent SQL injection and XSS | #1, #2 | Final attack-probe evidence pending. |
| **S7** | Server-verified CSRF and CAPTCHA | #3 and CAPTCHA | CSRF tests reported PASS; live CAPTCHA flows used; keep negative request evidence. |
| **S8** | Secure sessions / idle timeout | #6 | 15-minute configuration reported PASS; complete browser/session expiry evidence needed. |
| **S9** | Resist username enumeration | #4 | Reported PASS; capture comparison evidence. |
| **S10** | Secrets, safe errors, security headers | #10–#12 | Controls developed; Git-history and full HTTP-response audits pending. |
| **S11** | Append-only logs and read-only security dashboard | #9 and monitoring | Dashboard/logging implemented; final DB permissions and event-coverage checks pending. |

## 5. Authentication and privacy functions beyond the 13 protections

- **Registration (§4):** Student/instructor-only public signup; appropriate user fields, `xxxx-xxxx` ID, duplicates blocked, age 18+ checked server-side, explicit RA 10173 notice/consent, and consent timestamp. Live registration with email OTP was **reported successful**.
- **Username/name validation (§4):** Username **6–20** (start with a letter, letters/digits only); each name field maximum **50**; retain required title-case, spacing, age and address validation. Settings reported PASS; preserve negative validation outputs in the test log.
- **Security questions (§5):** Three distinct selected questions Q1–Q8; each answer **2–50 characters**, letters and single spaces, and hashed in storage. PostgreSQL Q1–Q8 compatibility and a full recovery scenario were **reported successful**. Never document real answers.
- **Email OTP (§6):** Six digits for **registration, login and reset**; purpose-bound and hashed; **5-minute** expiry, three wrong attempts invalidate, single use, previous OTP revoked on resend, **60-second** cooldown and **three resends in 15 minutes**. Normal live delivery/verification was reported successful; edge-case evidence should be filed separately.
- **CAPTCHA (§7):** Google reCAPTCHA v2, validated on the backend for registration, login and recovery. Client-side checkbox alone must never grant access.
- **Login (§8):** Password + CAPTCHA followed by email OTP and only then an authenticated session; generic failure messages; **3/6/9** lockout tiers for **15/30/60 seconds**; Forgot Password after **2** failures.
- **Security alerts (§9):** Send alerts on new lockout tiers and after successful password changes, without exposing secret values or account existence to attackers. Record date/time in Philippine time and relevant IP/user-agent data where required.
- **Forgot / Change Password (§§10–11):** Identify username, verify one of the account's saved Q1–Q8 questions, send and verify recovery email OTP, authorize password reset, enforce strength and last-three password history. **End-to-end recovery and subsequent login with the new password reported PASS on November 17, 2026** (File 148 fix).
- **Admin monitoring (§13):** Admin-only dashboard and protected JSON endpoints with summary counts, hourly failures, suspicious IPs, flags, recent events and filtering. Protect admin actions by server-side role checks, not just hidden frontend buttons.
- **Monitoring script (§14):** Inspect 24-hour activity for (1) one IP above the threshold, (2) username attacked by 3+ IPs, (3) 5+ OTP failures/10 min, and (4) login between 00:00–05:00 Philippine time; deduplicate flags by pattern + target + day. Must not be browser-accessible.

## 6. Resolved changes and remaining review items

| Area | Historical issue or change | Updated status |
|---|---|---|
| Student-number seeds | Earlier documents used conflicting D1/D2 values and obsolete limits. | **Superseded** by instructor's November 16 class-wide values. |
| Registration and OTP | Earlier draft described OTP purpose/activation as unfinished. | Full live registration + email OTP flow **reported PASS**; keep specific expiry/replay/resend negative tests in the log. |
| Security-question selection | Earlier fixed Q7/Q2/Q4 UI, schema, service and DB constraints. | Files **140–147** introduced Q1–Q8 compatibility; PostgreSQL constraint update **reported DONE**. |
| Password recovery client | `passwordRecoveryApi.js` still rejected Q1/Q8 client-side before an API call. | **File 148 corrected** question set, username max and password minimum; developer reported successful recovery and password reset. |
| Revised settings | Earlier code/docs cited 3-minute OTP, 9-minute idle, 14-IP threshold, and 24/48/96 lockouts. | Developer reports all instructor-wide settings now **PASS**. |
| Admin, equipment and reservations | Earlier draft treated these as mocks or unimplemented. | Backend routes/frontends were built and tested during later development; collate precise test IDs in `TEST_LOG.md`. |
| Security sign-off | Original document had only preparatory test evidence. | Still requires sanitized attack probes, session and authorization edge cases, Git-history audit, and final evidence organization. |

## 7. Verification evidence register

Do **not** save passwords, OTP values, security answers, SMTP App Passwords, private keys, session cookies or full private `.env` values in screenshots or documents.

| Evidence ID | Minimum verification | Updated status / action |
|---|---|---|
| **E01** | PostgreSQL schema and ORM registry | Earlier read-only schema checks **reported PASS**. |
| **E02** | Hashed password, question answers, OTP digest | Helper tests **reported PASS**; retain sanitized DB proof. |
| **E03** | AES-GCM encryption/decryption, DB ciphertext and access | In-memory checks **reported PASS**; LabGear live access checks pending evidence. |
| **E04** | CAPTCHA valid/invalid/hostname/outage | Earlier simulated tests **reported PASS**; archive live/negative checks. |
| **E05** | Gmail SMTP connection/authentication | **Reported live PASS**. |
| **E06** | Registration email OTP delivered and accepted | **Reported live PASS** during later integrated registration. |
| **E07** | OTP single-use, expiry at 5 min, three failures and revocation | Normal flow PASS reported; **negative cases need recorded evidence**. |
| **E08** | Resend: 60-sec delay, 3/15-min limit, old OTP invalid | **Retest/document specific edge cases**. |
| **E09** | Password + OTP login; inaccessible protected page before OTP | Login **reported PASS**; direct-URL bypass checks need attachment. |
| **E10** | 3/6/9 lockouts and IP 10 failures/10 min | Policy **reported PASS**; document fresh multi-user enforcement and expiry. |
| **E11** | CSRF rejection, XSS and SQLi probes | CSRF **reported PASS**; XSS/SQLi final probes need evidence. |
| **E12** | Cookies, 15-min idle, logout and browser Back | Configuration **reported PASS**; final browser/session evidence needed. |
| **E13** | Password-history refusal; email alerts | Password history and alert workflows **reported PASS**; retain negative-case proof. |
| **E14** | Admin-only dashboard, log immutability | Features implemented; complete authz/DB evidence needed. |
| **E15** | Four-pattern CLI monitoring and deduplication | Monitoring developed; attach final run output. |
| **E16** | Secret Git audit, safe errors, frontend/backend headers | **Final repository and HTTP-response review needed**. |
| **E17** | Registration with chosen Q1–Q8, DB records and Gmail OTP | **Reported live PASS, Nov 17, 2026**. |
| **E18** | Forgot Password, selected question, OTP, reset, new login | **Reported live PASS, Nov 17, 2026**; File 148 resolved client validation. |

**Read-only checks already used:** `python -m app.models.registry`, `python verify_auth_security_schema.py`, `python verify_inventory_schema.py`, and `python verify_reservation_schema.py` from the backend environment. Relevant newer validation included examining the `user_security_answers` constraint and checking `load_auth_settings().security_questions_required == 3` (confirmed output). Do not rerun email-sending tests casually or expose inbox codes.

## 8. IT 107 submission documents and checkpoints

The original handout summary in this file lists additional deliverables: approved **System Proposal**; original seed table with an explanation that it has been **superseded** by uniform rules; **Threat Model** (13 protections); **Design Decisions**; RA 10173 **Privacy Note**; **Error Message Mapping**; weekly **Development Journal**; at least **30 Git commits over four weeks**; SQL dump with at least **five test records**; and test accounts with accessible inboxes. These are **handout-listed deliverables**, even if the current documentation-editing scope covers only four existing Markdown files. Verify the current instructor's submission instructions before excluding any item.

**Checkpoint focus:** approved project/setup → registration/consent/OTP/CAPTCHA → login/recovery/alerts/logs → all 13 protections, admin monitoring, CLI script, demonstrable functional reservation workflows. A final completion claim requires captured evidence, not merely a configuration check or DONE message.

## 9. Maintenance and approval

- **Maintained by:** LabGear development team.
- **Source hierarchy:** Current instructor notice > obsolete seed formulas; current application and database evidence > older draft statuses; user-reported test outcomes should remain explicitly labeled.
- **Documentation sequence:** Update this file first, then `docs/TEST_LOG.md`, `docs/PERSONAL_SEED_TABLE.md`, and `docs/THREAT_MODEL.md`, one existing file at a time.
- **Final review:** Confirm the deployed settings and APIs, archive sanitized test evidence, verify Git history and required submission artifacts, then mark the final rubric complete.

---

**Confidentiality note:** No real email addresses, account identifiers, passwords, OTPs, answers, private session tokens or encryption keys should be included in this document.
