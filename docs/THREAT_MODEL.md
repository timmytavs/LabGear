# LabGear — Threat Model

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Information Assurance and Security 1  
**Document:** `docs/THREAT_MODEL.md`  
**Source:** *Security1 Student Handout*, Section 12 and Appendix B; instructor's uniform-settings notice dated November 16, 2026  
**Document version:** 2.0  
**Updated:** November 17, 2026  
**Overall status:** **Updated for the current implementation; final security evidence and submission sign-off remain open.**

## Purpose and scope

This threat model maps **each of the 13 required protections** to an attack, its underlying vulnerability, LabGear's countermeasure, its impact on **Confidentiality (C), Integrity (I), or Availability (A)**, and the security test or evidence required for submission. The handout's **13 protections** and its **11 rubric criteria (S1–S11)** are not the same count.

LabGear has a **React/Vite frontend**, a **FastAPI/Pydantic backend**, and a **PostgreSQL** database. The application supports **Student, Instructor, Laboratory Technician, and Administrator** roles. Its sensitive workflows include registration, login, Gmail-delivered email OTP, user-selected security questions, password recovery, equipment reservations, equipment issuance/return, damage/repair recording, and administrator monitoring.

**Evidence labels:**

- **Reported PASS:** The developer reported a successful test; retain the original sanitized screenshot or response before independent sign-off.
- **Implemented / review needed:** Relevant code or functionality exists, but complete attack-specific evidence has not been recorded.
- **Historical PASS; current-rule recheck needed:** An earlier test passed using settings that have since changed.
- **Evidence pending:** No complete verification is available in the current documentation. This is not a claim that the feature is absent.

## Appendix B — Threat mapping: 13 mandatory protections

| # | Threat | Vulnerability | Countermeasure in LabGear | CIA | How tested / evidence for final submission | Evidence status |
|---|---|---|---|---|---|---|
| **1** | SQL injection through login, registration or search input | Unsafe SQL concatenation can alter queries, bypass authentication or disclose records | SQLAlchemy ORM and bound query parameters in the reviewed backend services; server-side validation | C, I | Attempt a non-destructive `' OR '1'='1` input in the test environment; confirm no unauthorized login or SQL traceback; inspect any dynamic SQL (`LG-E2E-12`) | **Implemented / review needed:** no complete query audit or final attack-probe transcript |
| **2** | Cross-site scripting (XSS) through usernames, form fields or security logs | Untrusted data inserted as HTML could run attacker scripts in another user's browser | React normally escapes interpolated text; avoid unsafe HTML rendering and validate or safely render untrusted values | C, I | Submit a harmless test string such as `<script>alert(1)</script>` in an authorized test input; inspect the admin logs and confirm no execution; audit unsafe HTML insertion (`LG-E2E-13`) | **Implemented / review needed:** final log-rendering/unsafe-HTML review pending |
| **3** | Cross-site request forgery (CSRF) against authenticated state-changing requests | Browser cookies may be sent with an unauthorized request initiated elsewhere | FastAPI validates CSRF tokens; registration and password-recovery clients obtain signed public CSRF tokens; authenticated requests use server-side CSRF verification | I | Compare valid requests with missing/altered CSRF headers on applicable POST/PATCH endpoints; confirm rejection (`LG-E2E-15`) | **Reported PASS** in earlier LabGear testing; retain status-code evidence across representative routes |
| **4** | Username enumeration during login or password recovery | Different messages or behavior reveal whether a username is registered | Generic authentication and recovery responses; backend does not rely on frontend-only masking | C | Compare an unknown account with a known account and wrong credentials/answer; confirm responses do not reveal existence (`LG-E2E-16`) | **Reported PASS**; preserve side-by-side response evidence and review consistency |
| **5** | Brute-force login attempts across multiple accounts from one IP | Account-only limits fail to stop distributed guessing from the same source address | Server-side login counters, progressive account lockouts, and cross-account IP failure tracking | C, A | Verify lockouts at **3/6/9** failed logins for **15/30/60 seconds**; **10 failed attempts within 10 minutes** from one IP trigger a **10-minute IP block**, including expiry (`LG-E2E-03/04`) | **Historical PASS; current-rule recheck needed:** revised settings were reported PASS, but save a timed multi-account test using threshold 10 |
| **6** | Stolen sessions, inactive sessions and access after logout | Missing server-side session expiry or protected-route checks can expose private workflows | HttpOnly/SameSite cookies, authenticated server-side sessions, role checks, logout invalidation and **15-minute idle timeout** | C, I | Confirm OTP must finish before access; inspect cookies, 15-minute inactivity expiry, logout, browser Back and direct protected URL/API denial (`LG-E2E-06/18/20`) | **Partially demonstrated:** OTP login works and current timeout setting reported PASS; complete lifecycle evidence pending |
| **7** | Reusing an old or compromised password | A reset may allow previously exposed credentials to remain valid | Hash password history; reject reuse of the current and two preceding passwords during change/reset | C | Attempt the current and last two passwords during reset/change using private test credentials; verify rejection (`LG-E2E-17`) | **Reported PASS** for password-history checks; full recovery/reset also reported working |
| **8** | Automated registration by bots | Bots can mass-create accounts or overwhelm email workflows | Backend-enforced hidden honeypot field, CAPTCHA verification, and registration validation | A, I | Populate the hidden registration field in an authorized test request and confirm it cannot create an account; test missing CAPTCHA separately (`LG-E2E-14`) | **Reported PASS** for honeypot rejection; keep a sanitized negative API/DB result |
| **9** | Undetected attacks or tampering with security records | Missing, incomplete or editable activity logs undermine investigations | Security activity logging, admin-only dashboard/filters and monitoring checks; intended append-only log policy | I, C | Confirm required event types, Philippine-time interpretation, IP/user-agent context, admin-only access and that app DB privileges cannot edit/delete log records (`LG-E2E-19/22/24`) | **Partially demonstrated:** dashboard and log functionality reported working; final coverage and database immutability checks pending |
| **10** | Sensitive information leakage through application errors | Raw SQL/Python tracebacks or internal settings shown in responses reveal implementation secrets | Safe FastAPI response handling and generic client-facing errors; diagnostic details remain in protected server logs | C | Cause validation errors and controlled backend failures; confirm HTTP/browser responses reveal no SQL, traceback, password or secret (`LG-E2E` negative-case evidence) | **Implemented / review needed:** response-error audit still needed |
| **11** | Disclosure of `.env`, Gmail App Password or cryptographic secrets through Git | Secrets included in source, screenshots or Git history may remain accessible indefinitely | Private environment settings, `.gitignore`, separate SMTP/OTP/HMAC/AES keys, and no secrets in documented evidence | C | Check tracked files and entire repository history using a safe secret-audit process; do not print secrets into screenshots (`LG-E2E-23`) | **Evidence pending:** private configuration reported, but full Git-history audit not confirmed |
| **12** | Clickjacking and content-type confusion | Pages can be framed or browser content sniffing can misinterpret responses | Security headers `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` in relevant frontend/API responses | C, I | Inspect both successful and error responses in browser Network or a safe HTTP header check | **Reported partial PASS:** middleware exists; final frontend/API deployment-wide sweep pending |
| **13** | Unauthorized disclosure of sensitive contact details from the database | A database leak reveals plaintext personal information without encryption or authorization | Application-level **AES-256-GCM** contact-number encryption with random nonce/IV, authenticated encryption and role/owner access restrictions | C | Inspect ciphertext and IV/nonce in PostgreSQL; verify 32-byte key, unique nonces, and rejection of unauthorized retrieval (`LG-E2E-01`) | **Cryptographic helper tests reported PASS; database and owner-only access evidence pending** |

## Current instructor settings affecting these threats

The instructor's **November 16, 2026** class-wide rules replaced the previous personal D1/D2 seed formulas. The developer reported checking the current settings on **November 17, 2026**. They are summarized here so threat tests use **current**, not historical, thresholds.

| Setting | Current required value | Threat relevance |
|---|---|---|
| Username | **6–20 characters** | Consistent registration, login and recovery validation |
| Minimum password | **8 characters** plus existing complexity validation | Weak/reused password resistance |
| Name fields | **50 characters maximum each** | Input validation / malformed-data resistance |
| Forgot Password visibility | **After 2 failed logins** | Recovery usability without revealing accounts |
| Account lockout tiers | At **3, 6, 9** failures: **15, 30, 60 seconds** | Threat #5 |
| OTP expiration | **5 minutes** | OTP replay / interception window |
| Idle session timeout | **15 minutes** | Threat #6 |
| IP failure threshold and block | **10 failures/10 minutes**, **10-minute block** | Threat #5 |
| Security questions | User selects **3 distinct questions from Q1–Q8** | Account-recovery assurance |

The documented OTP lifecycle also requires **six-digit codes**, three incorrect entries invalidating a code, revocation of old codes when replaced, a **60-second resend cooldown**, and at most **three resends in 15 minutes**. Save separate negative-case results for expiry, invalid attempts, replay and rate limiting; normal OTP delivery alone does not prove those limits.

## Related authentication and authorization considerations

1. **Security-question answers:** LabGear stores hashes of users' answers. During registration, users select three distinct questions from **Q1–Q8**; recovery must verify an answer to a question assigned to the account. The PostgreSQL constraint was updated from the old Q7/Q2/Q4-only bank. The developer reported successful registration, recovery, email OTP, password reset and login after the **File 148** API-client fix on **November 17, 2026**. Never store raw answers in this document.
2. **Gmail OTP transport:** FastAPI generates and verifies the email codes. **Gmail SMTP with a Google App Password** delivers them; it is not a dedicated third-party OTP API. Use TLS/STARTTLS and preserve the backend's purpose-bound, hashed OTP verification.
3. **Role-based access control:** Student/Instructor, Technician and Administrator capabilities must be checked in FastAPI, not simply hidden in React. Public registration allows only Student and Instructor. In the current user-management API, an admin can assign non-admin roles; it is **not** a public admin-promotion endpoint. Bootstrap or emergency admin changes made directly in PostgreSQL should be limited to trusted maintainers and separately documented because they bypass normal application audit and session controls.
4. **Password hashing versus reversible encryption:** Passwords, answers and OTPs are verified using one-way hashes/digests. Contact numbers that the system needs to recover for authorized display are encrypted using authenticated AES-256-GCM. Encryption must be paired with access control; ciphertext alone does not restrict who can request decryption.
5. **Client-side validation is not a security boundary:** React validation improves feedback, but backend schemas, authentication, CAPTCHA, CSRF, rate limits and database constraints must still reject invalid or unauthorized requests directly.

## Evidence and remaining review before final defense

Use the test identifiers and factual statuses in **`docs/TEST_LOG.md`** and the corresponding implementation tracker **`docs/SECURITY_REQUIREMENTS.md`**. The November 17 recovery end-to-end test is **developer-reported PASS**, while the complete final attack-specific evidence listed below is not all recorded.

**Prioritize these outstanding evidence gaps:** SQL injection and XSS probes; current-rule IP block/expiry; session idle/logout and direct URL denial; audit-log append-only database rights and event coverage; secrets in the full Git history; error-response and security-header sweeps; and database-level AES-256 contact encryption plus unauthorized-access denial. Record actual outcomes rather than inferring a PASS from a setting, model definition or prior mock test.

**Evidence hygiene:** Do not include passwords, OTPs, security-question answers, Gmail App Passwords, `.env` contents, private keys, full session cookies or personal information in repository screenshots, logs or Markdown. Use test accounts and sanitized results.

## Outstanding sign-off

**Prepared by:** _____________________  
**Reviewed on:** _____________________  
**Final evidence folder / references:** _____________________  
**Remaining checks and reviewer comments:** _____________________

> **Documentation basis:** Original `docs/THREAT_MODEL.md` (November 13, 2026), updated `docs/SECURITY_REQUIREMENTS.md`, `docs/TEST_LOG.md`, `docs/PERSONAL_SEED_TABLE.md`, the instructor's November 16 uniform settings, and the developer's reported LabGear tests through File 148. This document does not substitute for a fresh penetration test or audit of the live installation.
