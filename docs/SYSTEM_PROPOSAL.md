# LabGear — System Proposal (Appendix A Draft)

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

> **NOT SIGNED:** This is an editable draft. The handout requires the actual approved/signed System Proposal. Do **not** fabricate an instructor signature or assume this draft replaces the signed original.

## Basic information
| Field | Proposal entry |
|---|---|
| System name | LabGear — School Laboratory Equipment Reservation System |
| Proposed by | [PROJECT OWNER / FULL NAME] |
| Program and section | [BSIT SECTION] |
| Instructor | [INSTRUCTOR'S NAME] |
| Approved date and instructor signature | [TO COMPLETE FROM REAL APPROVAL] |

## System problem
School laboratories lend shared physical equipment such as microscopes, microcontroller kits and networking devices. Without clear account verification, reservation records and item-level custody tracking, two users may request the same unit, borrowers may not know approval status, damaged equipment may remain in usable stock and administrators may lack visibility into suspicious access.

## Proposed solution
LabGear is a role-based web application for secure equipment discovery, reservation, approval, handover, return and condition monitoring. The account protection includes consent, email OTP, CAPTCHA, progressive lockout, session management and auditing. Students/instructors reserve, technicians fulfill bookings and manage inventory, and administrators monitor security and assign permitted user roles.

## Users
- Students and instructors who need to reserve laboratory equipment.
- Laboratory technicians responsible for physical handover, returns and inventory.
- Administrators responsible for security monitoring and account role assignment.

## Information stored
Profile/identity and authentication data; email address and contact information; system-specific department and class/section; reservation dates, equipment, purpose, status; individual asset tags; technician decisions; condition notes; security activity and flags. Passwords, security answers and OTPs are stored as hashes, not plaintext.

## At least four proposed system-specific registration fields
The following fields appear in the LabGear development context. **Confirm their exact required/optional status and validators against the currently installed registration schema before submitting.**

| Field | Kind | Example rule for approval | Required? / final validation |
|---|---|---|---|
| Department | Text / selection | Must identify a valid university department or academic unit | [VERIFY INSTALLED RULE] |
| Role | Dropdown | Public registration limited to `student` or `instructor`; technician assigned by admin | [VERIFY INSTALLED RULE] |
| Contact Number | Formatted number | Philippine number pattern; encrypted at rest if this is the chosen sensitive field | [VERIFY INSTALLED RULE] |
| Class / Section or Unit | Text | Meaningful class-section or laboratory unit identification | [VERIFY INSTALLED RULE] |

## Why an account needs protection
The system stores identifiable contact and institutional information, logs equipment custody and staff decisions, and allows actions that affect limited laboratory stock. Unauthorized account access could leak personal data, allocate or release units improperly, corrupt records, or hide misuse.

## Scope boundaries
This is a local development and demonstration application. Public internet hosting, mobile-app clients, payments, procurement, barcode hardware scanning and automated real-time damage diagnosis are not documented as delivered.

## Approval
Proponent signature: __________________________  Date: __________

Instructor approval/signature: __________________________  Date: __________

**Attach or replace with the instructor-signed Appendix A form; do not imitate approval.**
