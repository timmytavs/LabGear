# LabGear — Error Message Mapping (Handout P6)

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

## Purpose and evidence
Section 4.10 of the student handout requires **one mapping per validation rule** for all core and approved system fields, with the **exact displayed message**. The table distinguishes **exact handout-mandated text** from **candidate implementation text** not yet compared with current registration frontend/backend. **Do not claim the candidate messages are exact without checking `App.jsx` / registration schemas.**

## Handout exact messages
| Field / failed input | Rule | Exact required message in handout |
|---|---|---|
| First Name: `juan` | First letter uppercase | `First letter of your name must be capital.` |
| First Name: `JUAN` | Not all capitals | `Do not use all capital letters.` |
| First Name: `Ju4n` | No numbers | `Numbers are not allowed in First Name.` |
| First Name: `Juan!` | No punctuation | `Special characters are not allowed in First Name.` |
| First Name: `Juan  Carlo` (two spaces) | No double spaces | `Double space is not allowed.` |
| First Name: `Juaaan` | No 3 consecutive identical letters | `Three consecutive identical letters are not allowed.` |
| ID Number: `1234-567` | `xxxx-xxxx` | `ID Number must follow the format xxxx-xxxx.` |
| Email: `juan@` | Valid address | `Please enter a valid email address.` |
| Birthdate: age 17 | At least 18 | `You must be at least 18 years old to register.` |
| Privacy consent: unchecked | Must consent | `You must agree to the Privacy Notice to register.` |
| Password confirmation mismatch | Same value | `Passwords do not match.` |
| Duplicate ID Number | Unique ID | `This ID Number is already registered.` |
| Duplicate email | Unique email | `This email is already registered.` |
| Password history reuse | Reject recent three | `You cannot reuse a recent password.` |
| Password change mismatch | Must match | `Mismatch Password.` |

## All core field validation rules to map
**Status:** Handout rules verified; exact installed error text pending comparison.

| Field | Handout requirements | Expected / candidate message (if not specified verbatim) | Exact installed message checked? |
|---|---|---|---|
| ID Number | Required; 4 digits-hyphen-4 digits | Exact format message above | [ ] |
| First / Middle / Family Name / Extension | 2–29 chars; letters; Title Case; no all caps; no digits/symbols/double spaces/triple repeated letters | Adapt all name messages above for each field; optional fields validated if filled | [ ] |
| Name Extension 'Other' | Permit I, II, III, IV, IX, X input without changing dropdown stored choices | `[CONFIRM VALIDATION MESSAGE]` | [ ] |
| Birthdate / Age | Date not in future; at least 18; server recomputes age | Under-18 message exact above; future-date message `[CONFIRM]` | [ ] |
| Purok/Street | Required, letters/digits/spaces, 3–50, no double spaces | `[CONFIRM EXACT MESSAGE]` | [ ] |
| Barangay | Required, Title Case letters/spaces, 2–50 | `[CONFIRM EXACT MESSAGE]` | [ ] |
| Municipality/City | Required, Title Case letters/spaces, 2–50 | `[CONFIRM EXACT MESSAGE]` | [ ] |
| Province | Required, Title Case letters/spaces, 2–50 | `[CONFIRM EXACT MESSAGE]` | [ ] |
| Country | Required, Title Case letters/spaces | `[CONFIRM EXACT MESSAGE]` | [ ] |
| ZIP | Required, exactly four digits | `[CONFIRM EXACT MESSAGE]` | [ ] |
| Email | Required; valid, max100, no whitespace, lowercase, unique | `Please enter a valid email address.`; duplicate above | [ ] |
| Username | Begins letter; letters/digits; seeded 6–20; unique | Current frontend previously showed `Username must start with a letter and contain 6–17 letters or digits.` **Potential seed mismatch**; recheck code | [ ] |
| Password | 9–64; must not be Weak; strength meter | `[CONFIRM EXACT MESSAGE AND STRENGTH RULES]` | [ ] |
| Re-enter password | Exactly same as Password | `Passwords do not match.` | [ ] |
| Recovery answers Q2/Q5/Q7 | All required; letters/spaces; length 2–50; no double spaces | `[CONFIRM EXACT MESSAGE]` | [ ] |
| Privacy consent | Must be checked; record timestamp | Exact message above | [ ] |
| CAPTCHA | Must be server-validated | `[CONFIRM EXACT MESSAGE]` | [ ] |
| Honeypot | Hidden; reject bot submission | Response should not reveal screening logic | [ ] |

## Four proposed system-specific field mappings
**Must reconcile with signed Appendix A and backend schema; the following are candidate entries, not verified text.**

| Field | Intended validation | Actual API/frontend error message |
|---|---|---|
| Role | Public sign-up selects Student or Instructor; technician assigned later | `[COPY EXACT TEXT FROM CURRENT APPLICATION]` |
| Department | Required institutional unit or department | `[COPY EXACT TEXT FROM CURRENT APPLICATION]` |
| Contact Number | Required validated contact format | `[COPY EXACT TEXT FROM CURRENT APPLICATION]` |
| Class/Section or Unit | Appropriate class/section or laboratory unit | `[COPY EXACT TEXT FROM CURRENT APPLICATION]` |

## Source-verified reservation/inventory errors (separate from registration P6)
From supplied File 127 / File 125 implementations:

| Action | Failure | Backend/UI wording from supplied source |
|---|---|---|
| Reservation | Start is in past | `Reservation start must be in the future.` |
| Reservation | End not after start | `Reservation end must be after the start.` |
| Reservation | Insufficient overlapping availability | The requested quantity is not available for the selected date range |
| Cancellation | Status not pending/approved | `Only pending or approved (not issued) reservations can be cancelled.` |
| Reservation quantity | Not 1–50 | Validated by Pydantic; check actual returned field message |
| Technician inventory | Invalid equipment code | `Use 3–40 uppercase letters, numbers, or hyphens for the equipment code.` |

## Finalization checklist
- [ ] For **every** field, test missing input, wrong type/format, length limits, duplicates and wrong dropdown values.
- [ ] Capture client message **and** server response after bypassing client validation.
- [ ] Insert the exact current message, including punctuation, into this document.
- [ ] Mark browser vs server checks separately if wording differs.
- [ ] Resolve the 6–20 username requirement versus earlier 6–17 displayed implementation before sign-off.
