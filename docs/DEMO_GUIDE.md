# LabGear — Live Demonstration and Defense Guide

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

## Instructor handout format: 20-minute demonstration
| Segment | Time | What examiner evaluates |
|---|---:|---|
| Live system demonstration | 6 minutes | Registration, OTP, login, lockout, alert email, password recovery/change, monitoring script and admin dashboard |
| Explanation | 6 minutes | Student explains four selected code sections in their own words |
| Additional requirement | 8 minutes | Student implements a new instructor-chosen requirement in real time without AI |

The handout forbids AI and unrelated notes/tabs on screen during the demonstration. **Practice enough to explain and operate the project independently.**

## Six-minute demonstration rehearsal (proposed)
1. Show the LabGear identity and browser login/registration screens; submit one invalid registration field and show a specific error.
2. Complete registration with a controlled test email, OTP and privacy consent; avoid exposing code in public screenshots afterward.
3. Log in with password/CAPTCHA then separate OTP; demonstrate protected access and role routing.
4. Show server lockout and security alert behavior using a dedicated disposable test account (do not lock out a real user).
5. Show password recovery/challenge and password change, then the monitoring script in the terminal.
6. Log in as admin, open security dashboard, highlight summary cards, suspicious IPs and flags.

**Timing warning:** Email delivery and CAPTCHA may take longer than planned. Preflight SMTP, localhost servers and test inboxes before the demo. Do not bypass or disable real protections for speed.

## Four code explanations to rehearse
- **Authentication/OTP:** How the backend verifies OTP purpose, expiry, attempt count, single-use and no session before OTP completion.
- **Reservation locking:** How row locks/transaction atomicity and overlapping time windows prevent double booking.
- **CSRF/role checks:** Why server-side authorization and CSRF are essential even if React hides controls.
- **Security monitoring/audit:** Where events are recorded, how script patterns create flags and why logs should be append-only.
- **Encryption at rest:** Difference between Argon2-style password hashes and AES-256 with a random IV/nonce for reversible fields.

## Additional requirement practice
The instructor's new requirement is unknown in advance. Before demo, learn how to locate FastAPI routers, Pydantic schemas, React controls and PostgreSQL models; then implement a small safe change while preserving existing functionality. Never claim to know the instructor's task beforehand.

## Day-of readiness
- [ ] Backend virtual environment and PostgreSQL running; frontend Vite running.
- [ ] Gmail SMTP verification successful and three accessible test inboxes prepared.
- [ ] Admin and two normal users available; test account credentials kept privately, **not in repository**.
- [ ] Monitoring script run manually and produces sensible summary.
- [ ] Last successful Vite build and API OpenAPI paths checked.
- [ ] Sensitive personal data masked from screenshots.
- [ ] Signed proposal, seed table, audit evidence and other handout documents ready.
- [ ] Know which code files implement each security protection and why.
