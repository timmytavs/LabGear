# LabGear — Security Design Decisions (“Your Call”)

> **Document status:** Draft prepared 13 November 2026 from the instructor's *Security1 Student Handout*, available LabGear source files, and development test reports. Review against your **currently installed files** before submission. Do not interpret unverified items as passed.

## Scope
The supplied handout asks for a reasoned response to each section labeled **YOUR CALL**. The following answers describe LabGear's intended security approach. Where exact deployed implementation settings are not confirmed, the statement is explicitly marked for verification. These are not substitutes for understanding and explaining your own code.

### 1. Password hashing algorithm — Handout 4.4
**Decision:** Use **Argon2id** with a unique salt for passwords, via the backend's password-hashing library; do not use reversible encryption or plaintext storage for passwords. **Reasoning:** Hashing resists offline password recovery even if database records leak. Use library-managed security parameters and verify actual cost configuration in `app/core/auth_security.py` before the final defense. Do not promise a numeric cost value without checking source.

### 2. Weak / Medium / Strong password rules — Handout 4.9
**Decision:** Enforce the seeded minimum of **9** and maximum **64** characters, prohibit a Weak result, and show a strength indicator client-side. Strength should reward length and diversity of characters and penalize common/guessable patterns. **Reasoning:** Length provides resistance to guessing, while a meter improves user feedback. **To verify:** The installed exact thresholds and whether backend rejects every password classified Weak; document the actual algorithm, not this recommendation, after reviewing code.

### 3. Why security answers are hashed — Handout 5
**Decision:** Normalize and **hash** recovery answers rather than store them in text. **Reasoning:** Answers can be personally revealing and reusable across services, and their verification requires comparison, not plaintext retrieval. The available auth-security code normalizes case before hashing. Do not expose answers in logs or API responses.

### 4. Whether a failed CAPTCHA counts as a failed login — Handout 7
**Proposed decision:** Reject and audit CAPTCHA failure independently. Count it in IP-level abuse monitoring, but do **not** increment a legitimate user's password-failure count unless the backend verified that the attempt reached that account's password step. **Reasoning:** Attackers could otherwise lock out victims by repeatedly failing CAPTCHA against a known username. **To verify:** Document the actual deployed login limiter behavior and event names after reviewing `captcha_service.py` and login service.

### 5. Is disabling the browser Back button enough? — Handout 8.4
**Decision:** No. Browser navigation restrictions are a user-interface convenience only. **Actual protection:** Server-side session checks for every protected request, appropriate cache-control, logout/session revocation, idle expiry and backend role authorization. **Reasoning:** A user can always type a URL or call the API directly; access decisions must remain on the server.

### 6. How a verified recovery user reaches Change Password — Handout 10
**Decision:** The backend should issue a short-lived, single-use proof after the security-answer and recovery-OTP stages, binding the reset action to the verified account. **Reasoning:** A guessed URL, a username parameter, or client-only session flag is not sufficient proof. **To verify:** Confirm exact pending-reset challenge/session mechanism and expiry in the installed password-recovery service; do not assert a specific cookie or JWT mechanism without evidence.

### 7. Should the application DB account delete audit rows? — Handout 13.3
**Decision:** No ordinary application path should edit or delete logs; ideally grant the runtime DB role INSERT and permitted SELECT but not DELETE/UPDATE on `activity_logs`, and use a separate maintenance administrator for retention. **Reasoning:** Audit history loses investigative value if an attacker with application privileges can erase it. **To verify:** Check actual PostgreSQL grants; absence of an Edit button alone does not ensure append-only DB permissions.

### 8. How to run the monitoring script every 15 minutes — Handout 14.2
**Decision:** For Windows development, configure **Windows Task Scheduler** to run the project's real monitoring Python script (`scripts/monitor.py`, if that is the installed path) every 15 minutes under a least-privileged account and from the backend working directory. Configure working directory, virtualenv Python path and log output. **Reasoning:** Periodic scanning catches patterns without requiring the web app to execute administrative commands. **To verify:** Scheduler is a proposed deployment plan; don't claim it is already configured.

### 9. Can a browser JavaScript file be hidden? — Handout 15
**Decision:** No. Any JS file loaded by the browser can also be fetched directly. **Reasoning:** Client-side source and bundles are not a security boundary. Our actual protections live in FastAPI authentication, CSRF, authorization, validation and database permissions. Keep credentials and encryption keys on the server, not in React or Vite client bundles.

### 10. Hashing versus encryption — Handout 12.13
**Decision:** Use one-way **hashing** for passwords, OTPs and recovery answers; use authenticated **AES-256 encryption** for sensitive fields that must later be decrypted to their authorized owner (for example the encrypted contact field). **Reasoning:** Hashes deliberately cannot be reversed, but encryption allows restricted retrieval under a key. **To verify:** Inspect the deployed encryption code for real AES-256, fresh random IV/nonce, secure key storage, and owner-only API retrieval.

## Final reviewer sign-off
The student should rewrite any statements that differ from the installed code and be prepared to explain all ten decisions without reading a generated script.

Reviewed by: __________________  Date: __________________
