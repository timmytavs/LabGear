# LabGear — User Guide

**System:** LabGear — School Laboratory Equipment Reservation System  
**Course:** IT 107 — Information Assurance and Security 1  
**Document:** `docs/USER_GUIDE.md`  
**Version:** 1.0 (development draft)  
**Last updated:** November 6, 2026  
**Status:** Interface walkthrough and intended workflows — **not a production user manual**

> **Read this first.** LabGear is still under development. The React frontend has role-based pages and preview interactions, while the complete browser-to-FastAPI authentication, equipment reservation, issue/return, and security-monitoring workflows are **not yet confirmed end-to-end**. The steps below describe how users are *intended* to use each feature once integration is complete. Where a page currently behaves as a preview, the guide says so. Do not use the application for real laboratory reservations or account management until the relevant workflows have been tested and approved.

---

## 1. About LabGear

LabGear is a role-based web application that organizes equipment browsing, reservation requests, laboratory technician approvals, equipment borrowing and returns, and security monitoring. It aims to provide a consistent record of who requested equipment, who approved it, and what happened to each physical unit.

### 1.1 Who uses the system?

| Role | Main purpose | Current implementation status |
|---|---|---|
| **Student** | Discover equipment, request reservations, check own requests and borrowed equipment | Frontend preview available; live reservation integration pending |
| **Instructor** | Request laboratory equipment for teaching, check requests and borrowed equipment | Frontend preview available; live reservation integration pending |
| **Laboratory Technician** | Review reservations, approve/reject requests, issue/receive equipment, manage inventory and damage reports | Frontend preview available; server-side workflow integration pending |
| **Administrator** | Review accounts and security events, monitor suspicious activity and account restrictions | Frontend preview available; server-side monitoring and administration pending |

**Role restrictions:** Student and Instructor are the only roles intended for public self-registration. Technician and Administrator accounts must be provisioned by an authorized process; an ordinary registrant cannot self-select a privileged role. Actual role authorization must be enforced by FastAPI on every protected endpoint, not only by the frontend.

### 1.2 Technology and access

- **Frontend:** React with Vite.
- **Backend:** FastAPI, Python, SQLAlchemy, and Pydantic.
- **Database:** PostgreSQL, database `labgear_db`.
- **Local development address:** Commonly `http://localhost:5173`; actual address depends on the Vite terminal output.
- **Backend address:** Commonly `http://127.0.0.1:8000`; confirm the running Uvicorn port.

These addresses are **development-only** and may not be accessible from another device. The currently working login/register screen is not evidence that accounts can be created or authenticated.

---

## 2. Getting started (development preview)

### 2.1 Open the frontend

1. Start the frontend using the project's normal Vite command from the `frontend` directory (typically `npm run dev`).
2. Open the local address displayed in the terminal, usually `http://localhost:5173`.
3. The landing page introduces LabGear's laboratory equipment reservation workflow.
4. Use **Get Started**, **Login**, or the relevant navigation controls to open the authentication interface.

**Status:** Landing page and authentication interface are frontend previews. API connectivity or a backend health indicator alone does not mean registration/login is functional.

### 2.2 Register an account — intended workflow

1. On the landing page, select **Get Started** or **Register**.
2. Select **Student** or **Instructor**. Other roles must not be available for self-registration.
3. Fill in the required identity, school/department, contact, and address fields shown by the actual form.
4. Provide an email address and choose a username and password that meet the registration rules.
5. Answer the three assigned security questions (**Q7, Q2, and Q4**). Remember the answers; do not share them.
6. Review the privacy notice and give consent if you agree.
7. Complete the CAPTCHA challenge and submit the form.
8. Once backend registration is available, LabGear should send a six-digit verification code to the email address supplied.
9. Enter the code before its expiration. Successful verification should activate the account.

**Status:** Registration forms, validation helpers, encryption, CAPTCHA service, and email-delivery testing have been prepared; **live account registration and database-backed OTP activation are not complete**. A preview may not save an account.

**Important policy:** The registration OTP policy currently configured is a **3-minute expiration**, **3 failed verification attempts**, and a **60-second resend cooldown**. These limits are not yet confirmed to be enforced end-to-end. The application must apply them on the server before release.

### 2.3 Log in — intended workflow

1. Select **Login**.
2. Enter the registered username and password.
3. Complete any required CAPTCHA challenge.
4. Enter the login email OTP if requested.
5. After verification, the system should open the dashboard appropriate for the account's role.
6. Use **Logout** when finished, particularly on shared school computers.

**Status:** Login and OTP screens may currently show demonstration behavior. Server-verified passwords, login OTP, session management, and progressive lockouts remain to be connected and tested.

### 2.4 Forgot password — intended workflow

1. Open **Forgot Password** from the login interface.
2. Enter the requested account identifier.
3. Complete CAPTCHA and applicable security-question/email verification checks.
4. Follow the recovery instructions; the system must validate a time-limited, single-use recovery grant before accepting a replacement password.
5. Sign in with the new password after a confirmed reset.

**Status:** Recovery screens and schemas are preparatory. Password reset is **not yet verified as a working backend feature**.

---

## 3. Student guide

### 3.1 Main dashboard

The Student dashboard is intended to provide a personal overview of equipment reservations and current borrowing activity. Use its navigation controls to access the equipment catalog, reservation history, borrowed equipment, and profile/settings.

**Status:** Dashboard displays are preview data until connected to the authenticated user's real records.

### 3.2 Browse the equipment catalog

1. Select **Equipment Catalog** (or the equivalent catalog navigation item).
2. Browse equipment cards and read each item's description and availability information.
3. If available in the interface, use search or category filters to narrow the list.
4. Open the item you want to reserve and inspect its details.

**Expected finished behavior:** Availability should reflect PostgreSQL inventory and reservations, not a hardcoded card count.

### 3.3 Request equipment

1. Select an available equipment item.
2. Choose the requested quantity and intended reservation dates/times when prompted.
3. Review any usage rules and confirm the reservation request.
4. Check **Reservations** for its status, such as pending, approved, or rejected.
5. Follow laboratory technician instructions before collecting equipment.

**Status:** Reservation forms and lists are frontend previews. Do not treat a displayed approval or confirmation as a real laboratory authorization until the live backend workflow has been tested.

### 3.4 Check borrowed equipment and returns

1. Open **Borrowed** (or the corresponding borrowed-equipment area).
2. Review equipment you are currently responsible for, including return details when implemented.
3. Bring items back to the laboratory technician according to school policy.
4. Confirm that the return has been recorded after the technician receives and inspects the equipment.

**Expected finished behavior:** Students should be able to see only their own reservation and borrowing records.

---

## 4. Instructor guide

Instructors follow a similar equipment-request flow to Students but may request items for class activities.

### 4.1 Browse and request equipment

1. Log in with an Instructor account.
2. Open the **Equipment Catalog**.
3. Choose equipment and specify the required reservation details.
4. Submit the request for technician review.
5. Use **Reservations** to view the request's current status.

### 4.2 Manage borrowed items

1. Open **Borrowed** to review current equipment under the Instructor account.
2. Coordinate collection and returns with the laboratory technician.
3. Check that the system reflects the correct status once the return is processed.

**Status:** Instructor catalog/reservation/borrowed pages are frontend previews; their server-side account isolation and inventory transactions are still pending.

---

## 5. Laboratory Technician guide

Laboratory Technicians handle physical equipment and reservation decisions. Technician access must be provisioned by an authorized administrator or equivalent trusted process.

### 5.1 Review reservation requests

1. Log in using a Technician account.
2. Open the **Approvals** or reservations management section.
3. Review each request's equipment, quantity, requested period, and requester.
4. Check real unit availability and any reservation conflicts.
5. Approve or reject the request and provide a reason where the interface requires it.

**Expected finished behavior:** A decision must be recorded server-side along with the authorized technician and timestamp; the system must guard against double-booking and unauthorized approval.

### 5.2 Issue equipment

1. Find an approved reservation.
2. Identify the specific physical units being borrowed.
3. Confirm the borrower and record issuance.
4. Ensure that unit availability and reservation state are updated consistently.

**Expected finished behavior:** Issuance must be performed in an authorized database transaction, with an auditable record of the handover.

### 5.3 Process returns and damage

1. Locate the matching issuance or borrowed record.
2. Inspect returned units and record the return.
3. If an item is damaged or missing, create a **Damage Report** according to laboratory procedures.
4. Confirm the affected unit's condition and availability are updated.

**Expected finished behavior:** Returns and damage must be tied to the correct equipment unit and recorded without deleting historical records.

### 5.4 Maintain inventory

1. Open the inventory section.
2. Review equipment categories, catalog entries, and individual units.
3. Use authorized management controls to update inventory details.
4. Review availability summaries before making decisions.

**Status:** Technician approvals, transactions, damage reporting, and inventory screens exist as frontend previews. Their live backend operations and role restrictions are not yet validated.

---

## 6. Administrator guide

Administrator accounts must be provisioned securely. They are not created through ordinary public registration.

### 6.1 Review account status

1. Log in using an Administrator account.
2. Open the user-management interface.
3. Review account identity, role, verification, and status information as permitted by school policy.
4. Use authorized account controls when they become available; avoid modifying records manually in PostgreSQL.

### 6.2 Monitor security activity

1. Open the security dashboard or activity-log area.
2. Review failed login events, account lockouts, OTP misuse, suspicious behavior, and security flags when those feeds are integrated.
3. Filter records and investigate unusual patterns without exposing credentials or recovery answers.
4. Review blocked IP addresses and account restrictions as permitted.
5. Follow the school's incident-handling procedure for confirmed threats.

**Status:** Administrator user-management and monitoring interfaces are frontend previews. Database models for logs, IP blocks, and security flags exist, but a fully operating administrative monitoring service has not been demonstrated.

**Privacy:** Administrators must not see plaintext passwords, OTPs, security-question answers, JWT signing keys, SMTP passwords, or contact-encryption keys.

---

## 7. Profile, settings, and logout

The frontend contains **Profile** and **Settings** areas. When backend integration is complete, users should be able to review permitted account details and manage supported settings without obtaining another person's information.

For any password change, the server should verify required credentials, enforce password strength and password history, and record the event appropriately. A real session must end when a user logs out, and the server must enforce the configured nine-minute inactivity timeout.

**Status:** The exact set of profile/settings actions and their end-to-end persistence are not yet verified. Treat any preview changes as demonstration-only.

---

## 8. Security and responsible use

- Use the official LabGear address provided by the school. Do not enter credentials into an unfamiliar site.
- Use a unique password and keep it private. Never share an email OTP or security-question answer.
- Complete CAPTCHA yourself; do not attempt to bypass it.
- Log out on shared devices, then close the browser window.
- Report unauthorized account access, incorrect equipment records, or suspicious activity to the authorized school administrator or laboratory technician.
- Do not upload real passwords, OTPs, SMTP app passwords, or `.env` contents in screenshots, tickets, or documentation.
- Account access, role permissions, lockouts, and session expiry must be enforced on the backend; frontend-only restrictions are not sufficient.

### Configured security policies still awaiting end-to-end verification

| Policy | LabGear development specification | Release condition |
|---|---|---|
| Registration OTP validity | 3 minutes | Enforced transactionally with UTC timestamps |
| OTP failed attempts | Maximum 3 | Atomic attempt counting and code invalidation |
| OTP resend cooldown | 60 seconds | Server-side resend tracking and limits |
| Login lockout tiers | 3, 6, 9 failed attempts; 24, 48, 96 seconds | Server-enforced with audit/alerts |
| IP abuse block | 14 failures within 10 minutes | Real IP-aware blocking and expiry |
| Idle session | 9 minutes | Server-enforced inactivity expiry |
| Privileged roles | Technician / Administrator | No public self-registration or privilege escalation |

These values are **not** evidence that controls are already active.

---

## 9. Troubleshooting (development environment)

| Symptom | Likely reason | Safe next action |
|---|---|---|
| Frontend won't open | Vite dev server not started or port differs | Check `npm run dev` output inside `frontend` |
| Backend indicator says unavailable | Uvicorn stopped, wrong URL/port, or connection issue | Check backend terminal and documented health/root endpoint |
| Login or registration does not save data | Frontend is still preview-only; API not wired | Do not assume credentials exist; await backend integration |
| Verification email does not arrive | Gmail settings, inbox filtering, SMTP availability, or integration pending | Check Inbox/Spam and backend logs **without exposing the OTP** |
| CAPTCHA does not load | No site key, unsupported host, or network issue | Check localhost registration and actual browser integration |
| Equipment status seems incorrect | Demo records or backend data not yet connected | Do not rely on preview counts for physical equipment |
| Permission problem | Wrong account role or missing server authorization | Report to developer/admin; do not attempt to bypass permissions |
| Unclear database state | Pending integration or stale test data | Use read-only verification before any manual database changes |

**Developers:** Keep a separate record of the exact error, reproduction steps, and expected behavior. Do not capture passwords, tokens, OTPs, app secrets, or complete environment files.

---

## 10. Recommended screenshots for the final user manual

Capture these only after the corresponding interface is ready. Save images under a dedicated documentation evidence folder (for example, `docs/screenshots/`) and update this guide with image links later.

| Suggested screenshot name | Screen to capture | Current evidence state |
|---|---|---|
| `01_landing.png` | Landing page | Screenshot not embedded in this document |
| `02_register.png` | Student/Instructor registration form | Screenshot not embedded |
| `03_login.png` | Login interface | Screenshot not embedded |
| `04_student_catalog.png` | Student equipment catalog | Screenshot not embedded |
| `05_student_reservations.png` | Student reservations | Screenshot not embedded |
| `06_instructor_dashboard.png` | Instructor view | Screenshot not embedded |
| `07_technician_approvals.png` | Technician request approvals | Screenshot not embedded |
| `08_technician_returns.png` | Equipment return workflow | Screenshot not embedded |
| `09_admin_security.png` | Administrator monitoring | Screenshot not embedded |
| `10_profile_settings.png` | Profile and Settings | Screenshot not embedded |

**Screenshot safety:** Use fake student identities and demo inventory wherever practical. Blur any real email addresses, identifying information, or account data. Never include verification codes or security secrets.

---

## 11. Current development status and handoff

| Area | State at November 6, 2026 |
|---|---|
| React landing and role-specific pages | Built as frontend previews; user has reported progress through Frontend Step 18 |
| PostgreSQL schema and SQLAlchemy mappings | Schema checks for 16 tables and one view reported passing |
| Password hashing, security-answer hashing, contact encryption | Helpers and in-memory tests reported passing |
| Google reCAPTCHA verification service | Mocked server verification tests reported passing; full browser exchange pending |
| Gmail SMTP / test email | Live Gmail authentication and receipt of test OTP reported passing |
| Registration and OTP activation | Step 51 compatibility correction **pending confirmation**; database-backed OTP verification not yet implemented |
| Login, recovery, sessions and lockouts | Not yet fully integrated/tested |
| Equipment reservation/issuance/return APIs | Not yet fully integrated/tested |
| Admin monitoring APIs | Not yet fully integrated/tested |

**Next developer work after documentation:** Verify Backend Step 51 (`registration_service.py` OTP purpose compatibility) before implementing Step 52, registration OTP verification and account activation. The request schema's OTP purpose values must also be reconciled before enabling public routes.

### Related documents

- [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) — system architecture, user roles, and development status.
- [`SECURITY_REQUIREMENTS.md`](SECURITY_REQUIREMENTS.md) — instructor security checklist and implementation evidence.
- [`DATABASE_DICTIONARY.md`](DATABASE_DICTIONARY.md) — PostgreSQL tables, columns, and relationships.
- [`API_REFERENCE.md`](API_REFERENCE.md) — intended and confirmed API contracts.
- [`TEST_LOG.md`](TEST_LOG.md) — reported verification results and outstanding end-to-end tests.

---

**Maintenance rule:** Update this guide only when the corresponding screen or backend flow is verified. Replace the "preview" warnings with real instructions and screenshots *after* successful end-to-end tests. Do not mark a feature complete based on an import test or a simulated response alone.
