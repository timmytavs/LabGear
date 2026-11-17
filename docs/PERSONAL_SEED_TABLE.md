# LabGear — Personal Security Seed Table

**Project:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Information Assurance and Security 1  
**Document:** `docs/PERSONAL_SEED_TABLE.md`  
**Version:** 2.0  
**Updated:** November 17, 2026  
**Current requirements:** **Instructor's class-wide uniform settings, effective November 16, 2026.**  
**Implementation status:** Developer-reported **PASS** for the uniform settings on November 17, 2026; retain the actual settings-test evidence with `TEST_LOG.md`.

> **Change of authority:** The instructor's November 16, 2026 notice **replaced Section 2.2's student-number (D1/D2) seed formulas**. The values in Section 1 below are now the LabGear requirements. Historical calculations are retained in Section 3 **only to explain the change**, not as current acceptance criteria. This file does not include a full student number, passwords, OTPs, or security answers.

## 1. Current required settings — use these for implementation and grading

| Security parameter | Instructor-required setting | LabGear verification record |
|---|---|---|
| Minimum username length | **6 characters** | Reported PASS |
| Maximum username length | **20 characters** | Reported PASS |
| Minimum password length | **8 characters** | Reported PASS |
| Maximum length of **each** name field | **50 characters** | Reported PASS |
| Show Forgot Password link | **After 2 failed login attempts** | Reported PASS |
| Account lockout, tier 1 | **At 3 failed logins: 15 seconds** | Reported PASS |
| Account lockout, tier 2 | **At 6 failed logins: 30 seconds** | Reported PASS |
| Account lockout, tier 3 | **At 9 failed logins: 60 seconds** | Reported PASS |
| Email OTP expiration | **5 minutes (300 seconds)** | Reported PASS |
| Idle session timeout | **15 minutes (900 seconds)** | Reported PASS |
| IP blocking threshold | **10 failed attempts within 10 minutes**, across accounts from the same IP | Reported PASS |
| Security questions | User chooses **3 distinct questions** from **Q1–Q8** | Reported PASS; live registration/recovery completed |

**Status interpretation:** "Reported PASS" means the developer confirmed the relevant checks were completed; it does **not** claim that a fresh independent audit was run while preparing this document. The Q1–Q8 question count and backend registration-route compatibility also have specific shared PowerShell output from November 17, 2026. Refer to `TEST_LOG.md` for evidence detail.

### Other fixed security rules retained from the handout/project policy

These are **not student-number seed calculations** and should not be confused with the replacement notice:

| Additional rule | Required behavior | Evidence note |
|---|---|---|
| OTP format | 6 decimal digits | Implemented/tested in authentication flows; retain negative-case results |
| Wrong OTP limit | 3 incorrect attempts invalidate that code | Keep dedicated test evidence |
| OTP replacement | A newly issued OTP invalidates the previous code | Keep dedicated test evidence |
| OTP resend controls | Wait **60 seconds** between resends; at most **3 resends in 15 minutes** | Keep dedicated test evidence |
| IP block duration | **10 minutes** after the threshold is reached | Distinct from the 10-minute failure-counting window |
| Username format | Starts with a letter; letters and digits only | Retained from the documented handout rule |
| Password strength | Follow existing uppercase, lowercase, digit and special-character policy, in addition to minimum length 8 | Backend/frontend validation; do not document real passwords |
| Security-answer format | 2–50 characters; letters and single spaces | Stored as hashes, not plaintext |

## 2. Selected security questions (Q1–Q8)

The student/instructor chooses **any three different codes** at registration. The recovery screen offers the same bank but the backend verifies only a question actually stored for that account.

| Code | Question label |
|---|---|
| Q1 | What was the name of your first pet? |
| Q2 | Who was your best friend in elementary school? |
| Q3 | Who was your favorite teacher in high school? |
| Q4 | What is your mother's maiden first name? |
| Q5 | What street did you live on in Grade 1? |
| Q6 | What was the first song you learned by heart? |
| Q7 | What was the name of your elementary school? |
| Q8 | What dish did you cook for the first time? |

**Implementation notes (November 17, 2026):** Files 140–147 extended registration/service/schema/UI support to Q1–Q8. The existing PostgreSQL `valid_question_code` constraint was updated from the old Q7/Q2/Q4 set to Q1–Q8 (developer reported DONE). File 148 corrected `frontend/src/services/passwordRecoveryApi.js`, which had still rejected new question codes before sending a recovery request. The developer then confirmed completing registration, email OTP, password recovery, password reset and login using the updated flow.

## 3. Historical Section 2.2 personalized calculation — SUPERSEDED

Before the instructor's class-wide revision, the LabGear seed document recorded the last two **reported** student-number digits as `D1 = 0` (second-to-last digit) and `D2 = 9` (last digit). These digits are retained here solely to explain why older code and screenshots show different numbers. **Do not use any value in this historical table for current grading or configuration.**

| Parameter | Original handout formula | Historical calculation | Historical result — NOT CURRENT |
|---|---|---|---|
| Minimum username length | `6 + (D1 mod 3)` | `6 + (0 mod 3)` | 6 |
| Maximum username length | `16 + (D2 mod 5)` | `16 + 4` | 20 |
| Minimum password length | `8 + (D2 mod 4)` | `8 + 1` | 9 |
| Maximum length of each name field | `20 + D2` | `20 + 9` | 29 |
| Failures before Forgot Password link | `2 + (D1 mod 2)` | `2 + 0` | 2 |
| First lockout duration | `15 + D1` | `15 + 0` | 15 seconds |
| Second lockout duration | `30 + 2 × D1` | `30 + 0` | 30 seconds |
| Third lockout duration | `60 + 4 × D1` | `60 + 0` | 60 seconds |
| OTP expiration | `3 + (D2 mod 3)` | `3 + 0` | 3 minutes |
| Idle timeout | `5 + (D1 mod 5)` | `5 + 0` | 5 minutes |
| IP failure threshold in 10 minutes | `8 + D2` | `8 + 9` | 17 failures |
| Question A | `Q[(D2 mod 8) + 1]` | `(9 mod 8) + 1` | Q2 |
| Question B | `Q[((D2 + 3) mod 8) + 1]` | `(12 mod 8) + 1` | Q5 |
| Question C | `Q[((D2 + 5) mod 8) + 1]` | `(14 mod 8) + 1` | Q7 |

Older LabGear drafts also used different D1/D2 inputs, producing values such as 17-character maximum usernames, 10-character minimum passwords, 24/48/96-second lockouts, nine-minute idle timeout, or a 14-failure IP threshold. **Those values are obsolete too.** Do not combine values from different historical drafts.

## 4. Implementation and submission cross-check

| Evidence area | Reported outcome | Where to record or verify |
|---|---|---|
| Current uniform configuration | **PASS — developer report, November 17, 2026** | `backend/app/core/auth_config.py` and `docs/TEST_LOG.md` |
| Configured number of security questions | **3 — directly observed PowerShell output** | `load_auth_settings().security_questions_required` |
| Registration route compatibility | **3 routes; new and legacy question formats supported — directly observed PowerShell output** | `app.api.routes.registration` |
| PostgreSQL Q1–Q8 constraint | **Updated — developer report** | `user_security_answers.valid_question_code` constraint query |
| Registration + Gmail OTP + recovery + password reset | **Reported live PASS — developer report** | Screenshots/commands in `docs/TEST_LOG.md` |
| Security edge cases and final submission checks | **Preserve individual evidence; do not infer PASS from a setting alone** | `docs/TEST_LOG.md`, `docs/SECURITY_REQUIREMENTS.md` |

**For submission:** Place the **current table in Section 1** on the appropriate documentation page. Retain this revision history if the instructor needs to understand why early commits or test screenshots show seed-based values. Keep the original November 16 announcement or a screenshot of it with the project's private submission evidence; do not claim that screenshot is attached unless it has actually been saved.
