# LabGear — Documentation Package Index

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

## Files included
This directory contains **16 Markdown documentation files** and **no source-code replacements**. Use in the existing project's `docs/` folder. The source bundle separately includes a compiled Word copy for convenient reading, but the `.md` files are the editable versions for VS Code.

### Six existing-name technical references (reconstructed drafts)
1. `API_REFERENCE.md` — verified reservation/inventory/admin routes and provisional auth API list.
2. `DATABASE_DICTIONARY.md` — conceptual PostgreSQL tables/relationships and read-only verification queries.
3. `LabGear_PROJECT_OVERVIEW.md` — technology, roles, architecture and demonstrated feature scope.
4. `SECURITY_REQUIREMENTS.md` — 13 security protections and handout compliance gaps.
5. `TEST_LOG.md` — developer-reported completed functional checks and outstanding security self-tests.
6. `USER_GUIDE.md` — role-specific operating instructions for student, instructor, technician and admin.

**CAUTION:** Your existing six local docs were visible by filename in a screenshot but **not supplied as text/files**. These six are reconstructed drafts. Compare with the originals and merge; do not overwrite unique content blindly.

### Seven handout-required documents
7. `SYSTEM_PROPOSAL.md` — Appendix A draft; original **signed** proposal still required.
8. `PERSONAL_SEED_TABLE.md` — Section 2.2, reported digits D1=0 and D2=9; verify deployed settings.
9. `THREAT_MODEL.md` — Appendix B: 13 threats, vulnerabilities, controls, CIA and evidence.
10. `DESIGN_DECISIONS.md` — answers to each “YOUR CALL” prompt, with unverified implementation caveats.
11. `PRIVACY_NOTE_RA10173.md` — policy draft and field-by-field rationale.
12. `ERROR_MESSAGE_MAPPING.md` — exact handout mandatory messages plus fields requiring actual-code checks.
13. `DEVELOPMENT_JOURNAL.md` — Appendix C, authentic reported work and an unfilled weekly template.

### Three coordination/evidence guides
14. `SUBMISSION_CHECKLIST.md` — Section 16.2 deliverables, missing items and Git safety.
15. `DEMO_GUIDE.md` — Section 17's 20-minute defense structure and rehearsal.
16. `00_START_HERE.md` — this index and integration instructions.

## How to integrate
1. Extract the ZIP outside your working project first.
2. **Back up your existing `docs/` folder.**
3. Compare each same-named technical `.md` document to your current copy and merge selectively.
4. Copy only truly new documents into `docs/`, then review all `[VERIFY]` / `[TO COMPLETE]` fields before submission.
5. Add the real instructor-approved/signed proposal and the real SQL dump separately; those cannot be fabricated from source snippets.
6. Stage and commit genuine project changes only after confirming no credentials or sensitive records are included.

## Project completion distinction
- **Working core system:** user-reported success through File 128.
- **Handout compliance:** not fully verified. Especially check the Git four-week/30-commit rubric and D1=0,D2=9 configuration.
- **Documents:** complete **draft set** of 16; not a claim that every placeholder has been finalized.

## Primary references
- Caraga State University IT 107 *Security1 Student Handout*, especially Sections 2.2, 4–19 and Appendices A–C.
- Supplied LabGear source snapshots: reservation File 127, inventory File 125, admin File 120, FastAPI main File 121, frontend File 128.
- Developer-reported functional test outcomes through 13 November 2026.
