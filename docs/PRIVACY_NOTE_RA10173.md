# LabGear — Privacy Notice and RA 10173 Data-Handling Rationale

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

> **Publication warning:** This is a proposed privacy notice and data inventory. Do not publish it as a final binding policy until the institution approves the actual contact point, lawful basis, retention period, access procedures and hosting arrangements. This is not legal advice.

## 1. Privacy notice (editable template)
**LabGear — School Laboratory Equipment Reservation System** collects the personal information you enter when registering, requesting laboratory equipment or contacting laboratory staff. This information is used to identify account owners, verify email addresses, enforce account security, process reservations, track equipment custody and support investigation of security incidents.

We use account verification, access controls, hashed credentials and verification codes, encrypted designated sensitive fields, controlled database access, audit logging and secure session checks to protect information. Only authorized personnel should access records necessary for their assigned roles.

Personal data is used only for the declared academic/laboratory purposes and is retained for **[INSERT REAL APPROVED RETENTION PERIOD AND DELETION PROCESS]**. The current prototype's local development storage and backup retention must be explained accurately before deployment.

For access, correction, deletion or privacy questions, contact **[INSERT OFFICIAL LABGEAR/INSTITUTION PRIVACY CONTACT AND EMAIL]**. This notice is prepared with reference to the Philippine **Data Privacy Act of 2012 (Republic Act No. 10173)** and applicable institutional policy.

Registration consent text suggested by the handout: “I have read the Privacy Notice and agree to the collection and processing of my personal data in accordance with the Data Privacy Act of 2012 (RA 10173).” Consent must be unchecked by default, and its timestamp recorded when accepted.

## 2. Data inventory and purpose
| Data category / field | Personal / potentially sensitive? | Why needed | Protection / access |
|---|---|---|---|
| ID Number | Personal identifier | Unique university/system account reference | Restrict visibility and queries |
| First, middle, family name; extension | Personal information | Account identification and technician handover checks | Authorized account/admin views |
| Birthdate / calculated age | Personal information | Handout's age validation and registration eligibility | Limit to registration/authorized personnel |
| Address fields (purok/street, barangay, city, province, country, ZIP) | Personal information | Handout's required identity/contact details | Least privilege; avoid public display |
| Email | Personal contact | Registration/login/reset OTP and security alerts | Restrict to authentication services; normalize |
| Phone/contact number | Personal contact | Contact/coordination; potentially encrypted at rest | Verify encrypted field and authorized access |
| Department, role, class/section/unit | Institutional profile | Role control, asset assignment and laboratory identification | Server-side authorization |
| Password hash | Secret credential derivative | Authenticate users without plaintext passwords | One-way hashing; never disclose |
| Security-answer hash | Secret credential derivative | Password recovery verification | Hash and limit attempts |
| OTP hashes, purpose, expiry, attempts | Security event data | Account verification | Hash; expiry; one-use/revocation |
| Reservation purpose/dates/status | May identify schedules and academic activity | Booking and management | Owner/technician access; audit |
| Security logs: IP, browser, timestamps, failure events | Personal/online identifier | Abuse detection, accountability and incident response | Admin-only monitoring, limited retention |
| Privacy consent timestamp | Compliance record | Evidence user accepted notice | Audit and restrict edits |

## 3. Privacy measures
- Collect only fields genuinely necessary for the approved system and handout; review optional fields for data minimization.
- Do not reveal exact user existence in password recovery responses.
- Do not expose private contact info, password hashes, security answers, OTP values, session tokens, SMTP secrets or encryption keys in public endpoints or Git history.
- Grant staff access according to duties: student/instructor own records; technician operational reservations/inventory; admin security monitoring.
- Keep sanitized test evidence only; avoid real student identities in submitted screenshots and SQL dumps.
- Document incident handling and retention when the project goes beyond a localhost classroom prototype.

## 4. To complete before submission
- [ ] Verify **exact personal fields** against current registration schema and database.
- [ ] Enter approved privacy officer / project contact details.
- [ ] Enter actual record retention, deletion, backups and incident response details.
- [ ] Confirm the privacy notice is linked from registration and the checkbox is unchecked by default.
- [ ] Confirm consent timestamp is actually stored and can be audited.
- [ ] Confirm data subject request procedure with instructor/institution.
