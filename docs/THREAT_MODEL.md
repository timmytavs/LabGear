# LabGear — Threat Model

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — System Security  
**Source:** *Security1 Student Handout*, Section 12 and Appendix B  
**Document version:** Draft for final review — 13 November 2026

## Purpose and scope

This threat model maps **each of the 13 required protections** to a relevant attack, the vulnerability it targets, LabGear's countermeasure, and the principal impact on **Confidentiality (C), Integrity (I), or Availability (A)**. The final column describes the evidence to attach or capture before submission.

**Evidence labels:** **Reported passed** = a successful test has been reported during development; **Review needed** = implementation may exist, but the complete handout-specific test or evidence has not yet been confirmed. Do not change a label to "Verified" without performing the stated check.

## Appendix B — Threat mapping

| # | Threat | Vulnerability | Countermeasure in LabGear | CIA | How tested / evidence for final submission | Evidence status |
|---|---|---|---|---|---|---|
| 1 | SQL injection through login or search input | Unsafe SQL string concatenation allows attacker-supplied text to change a query | SQLAlchemy parameterized queries and ORM filters | C, I | Attempt `' OR '1'='1` as a username; verify no login, data disclosure, or SQL traceback | Review needed |
| 2 | Cross-site scripting (XSS) through user input or audit log entries | Unsanitized text inserted into rendered HTML can execute scripts in another user's browser | React renders ordinary values as escaped text; avoid unsafe HTML rendering for untrusted fields | C, I | Submit `<script>alert(1)</script>` as a permitted test input and inspect the admin monitoring page; no alert should execute | Review needed |
| 3 | Cross-site request forgery (CSRF) | A third-party page could submit unauthorized state-changing requests using a user's cookies | Server-side CSRF verification on protected POST/PATCH requests, with session-bound token | I | Remove the CSRF header on a protected request; server rejects it | Reported passed |
| 4 | Username enumeration | Different authentication/recovery errors reveal which accounts exist | Generic messages for invalid username and password / recovery attempts | C | Compare responses to an unknown username and incorrect password for an existing username | Reported passed; confirm exact message parity |
| 5 | Brute-force attempts across accounts from one IP | Repeated guesses are not restricted by account-only rate limits | Server-side IP blocking and login lockout using configured thresholds | C, A | Attempt failed logins against multiple test accounts from one IP; confirm blocking is enforced after the configured threshold | Reported passed; record exact seeded threshold |
| 6 | Session theft, stale sessions, and unauthorized return to protected pages | Reusable session tokens or unprotected routes permit continued access | HttpOnly session cookies, server-side session checks, logout revocation, idle timeout and protected routes | C, I | Test idle expiry, logout then browser Back, and direct protected-URL access | Review needed for full checklist |
| 7 | Reuse of a previously compromised password | Changing a password to an old password leaves compromised credentials usable | Password-history hashes for current and preceding passwords | C | Attempt to reuse the current password and each disallowed prior password | Reported passed |
| 8 | Automated bot registration | Bots may fill form fields that ordinary users never see | Honeypot input validated by the backend | A, I | Fill the hidden registration field using browser tools; registration should be refused | Reported passed |
| 9 | Undetected unauthorized activity | Absent or mutable audit history impairs incident investigation | Activity logs for login, authentication, security, and reservation actions; admin-only monitoring | I, C | Confirm audit entries include event, timestamp, IP and user agent; verify no user-facing edit/delete action | Partially demonstrated; review all required event types |
| 10 | Information leakage through stack traces and backend errors | SQL exceptions or internal details may reach an unauthenticated browser | Structured error responses and generic server-error messages; server-side logging | C | Trigger invalid requests and confirm browser receives no SQL, Python traceback or credentials | Review needed |
| 11 | Exposure of application secrets through Git | Accidentally committed `.env`, SMTP password, API token or encryption key remains in repository history | `.gitignore` and environment-based secret configuration; do not embed secrets in source | C | Inspect tracked files and entire Git history for real secrets; do not print secret values in submitted evidence | Review needed — repository check not completed |
| 12 | Clickjacking and content-type confusion | Browser may frame a protected page or misinterpret responses | `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` security headers | C, I | Inspect successful and error HTTP responses in browser Network tab | Implemented in app middleware; final verification needed |
| 13 | Disclosure of sensitive data after database access | Plaintext sensitive fields could be read directly from database tables | Application-level encryption of a sensitive contact field with stored ciphertext and IV; restrict plaintext retrieval to authorized user | C | In PostgreSQL, confirm ciphertext is unreadable; verify AES-256 key length, distinct random IVs and authorized retrieval behavior | Review needed — verify algorithm and owner-only decryption |

## Notes for the final defense

- **Hashing versus encryption:** Passwords, security answers and OTPs must be stored as one-way hashes; a sensitive value that must later be displayed to its authorized owner requires reversible encryption. These are different protections.
- **Access control:** Student/Instructor, Technician and Admin workflows must be protected by backend role checks; hiding buttons in React is not sufficient.
- **Evidence:** Pair each row with the corresponding screenshot, command output, API response or test-log entry. Never include OTPs, passwords, recovery answers, session cookies or encryption keys in evidence.
- **Adaptation:** The handout's examples use PHP/MySQL names, while the instructor-approved LabGear stack is React, FastAPI and PostgreSQL. Document equivalent protections as implemented, not fictional PHP functions.
- **Academic integrity:** Only record tests that were actually performed. Replace this draft's evidence labels after the final review.

## Outstanding sign-off

**Prepared by:** _____________________  
**Reviewed on:** _____________________  
**Remaining test evidence:** _____________________
