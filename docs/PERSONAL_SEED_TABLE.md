# LabGear — Personal Security Seed Table

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

## Source and digits
The user earlier clarified that the last two student-number digits for LabGear are **0 and 9**, so `D1 = 0` (second-to-last) and `D2 = 9` (last). This is a **reported personal input**, not a copied full student ID. Never include the full student number in a public repository unless necessary and consented to.

The calculations below follow **Section 2.2 of the Security1 Student Handout**.

| Parameter | Handout formula | Computation | Required value |
|---|---|---|---|
| Min username length | `6 + (D1 mod 3)` | `6 + (0 mod 3)` | **6** |
| Max username length | `16 + (D2 mod 5)` | `16 + 4` | **20** |
| Min password length | `8 + (D2 mod 4)` | `8 + 1` | **9** |
| Max length of each name field | `20 + D2` | `20 + 9` | **29** |
| Failed login attempts before Forgot link | `2 + (D1 mod 2)` | `2 + 0` | **2** |
| Lockout tier 1 | `15 + D1` | `15 + 0` | **15 seconds** |
| Lockout tier 2 | `30 + 2 × D1` | `30 + 0` | **30 seconds** |
| Lockout tier 3 | `60 + 4 × D1` | `60 + 0` | **60 seconds** |
| OTP expiry | `3 + (D2 mod 3)` | `3 + 0` | **3 minutes** |
| Idle timeout | `5 + (D1 mod 5)` | `5 + 0` | **5 minutes** |
| IP blocking threshold (10 min) | `8 + D2` | `8 + 9` | **17 failures** |
| Authentication question A | `Q[(D2 mod 8) + 1]` | `(9 mod 8)+1=2` | **Q2** |
| Authentication question B | `Q[((D2+3) mod 8)+1]` | `(12 mod 8)+1=5` | **Q5** |
| Authentication question C | `Q[((D2+5) mod 8)+1]` | `(14 mod 8)+1=7` | **Q7** |

### Question bank labels
- **Q2:** Who was your best friend in elementary school?
- **Q5:** What street did you live on in Grade 1?
- **Q7:** What was the name of your elementary school?

## Implementation-vs-requirement check
**Important unresolved issue:** Some earlier LabGear test outputs or code references included a **9-minute** idle timeout, an **IP threshold of 14**, and a username maximum of **17**. Those do not match the calculated final seed values above. They may be outdated development artifacts. Before submission, check current backend settings and registration validation and record actual values below; do **not** silently revise the handout table to fit the code.

| Parameter | Required | Installed setting checked on | Match? |
|---|---|---|---|
| Username 6–20 | 6–20 | [VERIFY] | [ ] |
| Password min 9 | 9 | [VERIFY] | [ ] |
| Idle timeout | 5 min | [VERIFY] | [ ] |
| IP threshold | 17 in 10 min | [VERIFY] | [ ] |
| OTP expiry | 3 min | [VERIFY] | [ ] |
| Lockout tiers | 15/30/60 s | [VERIFY] | [ ] |
| Security questions | Q2/Q5/Q7 | [VERIFY] | [ ] |

**Instructor changes:** If your instructor subsequently issued a revised uniform class-wide configuration, attach that official notice and mark its effective date. Do not alter the original personalized calculation without explaining the update.
