# LabGear — Development Journal (Appendix C)

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

> **Important:** Appendix C asks for **one page per week, in your own words**. This draft is a truthful summary of visible work, not a claim that missing Git commits or earlier weeks happened. Personalize the language and keep authentic dates/screenshots; do not invent past work or backdate records.

## Week / Dates: 6–13 November 2026 (supported by recorded local activity)
### What I built this week
I worked on integrating the LabGear React user interface and FastAPI reservation backend. Student reservations began reaching PostgreSQL and creating pending reference codes. Technician workflows were connected to approval, unit assignment, issuance and return, and the database recorded completed bookings. I added technician inventory management, equipment/unit creation and editing, and an administrator view for listing accounts and assigning laboratory technician roles. Later I added damaged equipment handling, restoration records and an audit history panel. I completed student/instructor cancellation of pending and approved reservations; the tests showed the cancelled state persisted and approved allocations were released.

### Where I got stuck
Some earlier reservation actions did not submit as expected. The equipment cards needed alignment changes. A return attempted to use a reservation status that was not allowed by the PostgreSQL status constraint. Account password-recovery OTP also previously failed due to a database query privilege issue. I needed to keep recent frontend fixes while updating full source files.

### How I solved it
I compared FastAPI payloads and PostgreSQL constraints, corrected the return state to `completed`, and preserved physical-unit allocation status separately. I updated the existing React screen instead of introducing unrelated components, checked builds after changes and tested each new workflow with a normal user or technician. The password-recovery flow was corrected by avoiding an unnecessary write-lock query, and later OTP tests succeeded.

### What I learned about security
Backend checks must control ownership, roles and request validity; hidden buttons alone do not enforce permissions. CSRF protection protects state-changing requests made through cookie sessions. A booking must update the reservation, allocations, inventory and activity log consistently. Hashing is for secrets that should never be recovered, while encryption is for sensitive data that may need authorized retrieval.

### Evidence links (fill in)
- Repository commits during week: [INSERT ACTUAL COMMIT IDS; do not invent]
- Functional screenshots/tests: [RELATIVE PATHS TO SANITIZED IMAGES]
- Bugs and changes: [TRACKED ISSUES / FILES]

---

## Earlier week entries
**Not reconstructed:** The current source materials do not establish verified earlier weeks. If you have actual Git history, screenshots, lab notebook or older chats proving work in prior weeks, write genuine entries with the correct dates. Do not create fictional weeks to satisfy the four-week Git rubric.

## Future week template — use only after completing actual work
### Week / dates: [ACTUAL DATE RANGE]
**What I built this week:** [AUTHENTIC CHANGES]

**Where I got stuck:** [ACTUAL PROBLEM]

**How I solved it:** [ACTUAL ACTIONS]

**What I learned about security:** [PERSONAL REFLECTION]

**Evidence:** [COMMIT IDS / SANITIZED SCREENSHOTS]
