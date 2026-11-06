import { ChevronDown, ShieldCheck } from "lucide-react";

export default function PrivacyNotice() {
  return (
    <details className="lgpn-container">
      <summary className="lgpn-summary">
        <ShieldCheck size={19} />
        <span>Read the LabGear Privacy Notice</span>
        <ChevronDown size={17} className="lgpn-chevron" />
      </summary>

      <div className="lgpn-content">
        <div className="lgpn-draft">
          Draft for system development. Institution details, contact
          information, retention periods, and processing arrangements must be
          finalized before live registration is enabled.
        </div>

        <h4>1. Purpose of This Notice</h4>
        <p>
          LabGear is a School Laboratory Equipment Reservation System intended
          to help students, instructors, and laboratory personnel manage
          equipment reservations, approvals, issuance, and returns.
        </p>

        <h4>2. Personal Information Collected</h4>
        <p>
          Registration includes an ID number, full name, birthdate, address,
          email, username, account role, department, contact number, and class
          section or assigned unit.
        </p>
        <p>
          Account security also involves passwords, security question answers,
          email verification, and security event records. Laboratory
          transactions may include reservation, borrowing, return, and damage
          details.
        </p>

        <h4>3. Purpose of Data Processing</h4>
        <ul>
          <li>Register and manage laboratory accounts.</li>
          <li>Authenticate and verify account access.</li>
          <li>Manage equipment reservations and approvals.</li>
          <li>Record equipment issuance and returns.</li>
          <li>Maintain equipment accountability.</li>
          <li>Detect and investigate suspicious activities.</li>
        </ul>

        <h4>4. Access to Information</h4>
        <p>
          Access is intended to be restricted according to the user's authorized
          role. Students and instructors will access their own records,
          laboratory technicians will manage equipment operations, and
          authorized administrators will manage accounts and security.
        </p>
        <p>
          External services used for email verification or system hosting must
          be disclosed in the finalized notice where applicable.
        </p>

        <h4>5. Security Measures</h4>
        <p>
          The system is being developed to use password and security-answer
          hashing, encryption of sensitive contact information, role-based
          authorization, account lockouts, and security activity logging.
        </p>
        <p>
          These protections must be implemented and tested in the backend before
          the system is deployed.
        </p>

        <h4>6. Data Retention</h4>
        <p>
          Account and laboratory transaction records will be retained according
          to the institution's approved retention and deletion policy. The
          specific periods and criteria have not yet been finalized.
        </p>

        <h4>7. Your Privacy Rights</h4>
        <p>
          Individuals may exercise applicable rights under RA 10173, including
          rights concerning information, access, correction, objection, and
          deletion when legally applicable.
        </p>

        <h4>8. Consent</h4>
        <p>
          By selecting the registration consent checkbox, you indicate that you
          have read this notice and agree to the described processing for
          account registration and system operation.
        </p>

        <h4>9. Contact Information</h4>
        <p>Institution / Data Controller: To be provided before deployment.</p>
        <p>
          Privacy Contact / Data Protection Officer: To be provided before
          deployment.
        </p>
      </div>
    </details>
  );
}
