# LabGear — Final Submission Checklist and Gap Register

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

## Source
IT 107 *Security1 Student Handout*, Sections 16.2 (submission), 17 (demo), 18 (self-test), 19 (grading). **Core LabGear functionality is tested, but handout submission is not automatically complete.**

## Required package
| # | Deliverable | Current status | Action before hand-in |
|---|---|---|---|
| 1 | Git repository ≥30 descriptive commits over ≥4 weeks | **NOT MET**: 4 commits, 6–10 Nov 2026 | Continue legitimate work/check actual revised instructor guidance; no fake/backdated commits |
| 2 | SQL dump with required tables and ≥5 test records | **NOT PROVIDED** | Export sanitized PostgreSQL dump with pgAdmin/pg_dump; verify restorability |
| 3 | Instructor-approved signed System Proposal | **NOT VERIFIED** | Attach actual signature/approved form |
| 4 | Correct personal seed table | Draft calculated D1=0 D2=9 | Verify deployed configuration and any newer instructor instruction |
| 5 | Threat Model: 13 protections, CIA triad and test | Draft prepared | Fill real handout self-test evidence |
| 6 | Design Decisions: every 'Your call' | Draft prepared | Review against code and explain in own words |
| 7 | Privacy Note (RA 10173) | Template prepared | Fill actual contact/retention and legal review |
| 8 | Error Message Mapping for all core/system fields | Handout and example mapping prepared | Replace `[CONFIRM]` with exact current browser/server messages |
| 9 | Development Journal, one entry per week | Genuine 6–13 Nov evidence only | Personalize and add only real earlier/future entries |
| 10 | Test accounts: one admin + two normal users | Earlier admin and normal users used during tests | Recheck current active accounts/inboxes; avoid passwords in Git |

## Final security self-test (not yet complete)
Use Section 18 of the handout. Some protections were previously tested, but the entire checklist has not been signed off for this precise build. In particular, verify **SQL injection, XSS, no secrets in history, real AES-256 encryption, direct URL restrictions, timeout, and current seed values**.

## Git safety before push
- [ ] Review `.gitignore` for `.env`, virtual environments, `node_modules/`, database dumps/backups with personal data and secrets.
- [ ] Search tracked files/history for credentials or key material without printing secrets.
- [ ] Review the deletion of tracked `backend.zip` rather than automatically staging it.
- [ ] Review whether `backend/register_inventory.py` contains test-only operational code or credentials.
- [ ] Do not push real account passwords, OTPs, security answers, SMTP App Passwords, private keys or session cookies.
- [ ] Make only genuine, descriptive commits reflecting actual work.

## Documentation source warning
The six pre-existing filenames visible in the user's screenshot were **not uploaded**. This package contains refreshed **reconstructed drafts** with those names. Compare them to the six current files before replacing; preserve unique project details from the originals.

## Go / no-go decision
- **Core feature development:** COMPLETE based on developer-reported tests through File 128.
- **Documentation draft package:** PREPARED, needs review/approval and missing evidence.
- **Academic submission:** NOT YET CONFIRMED; signed proposal, SQL dump, Git timeline and rubric-specific self-tests require follow-up.

Student sign-off: _____________________   Date: _____________________
