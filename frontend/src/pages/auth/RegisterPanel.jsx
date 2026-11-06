import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  UserRound,
  MapPin,
  GraduationCap,
  LockKeyhole,
} from "lucide-react";

import "../../styles/register.css";
import PrivacyNotice from "./PrivacyNotice";

const initialData = {
  id_number: "",
  first_name: "",
  middle_name: "",
  family_name: "",
  extension_type: "",
  name_extension: "",
  birthdate: "",
  purok_street: "",
  barangay: "",
  municipality_city: "",
  province: "",
  country: "Philippines",
  zip_code: "",
  email: "",
  username: "",
  password: "",
  confirm_password: "",
  role: "",
  department: "",
  contact_number: "",
  class_section_or_unit: "",
  answer_q7: "",
  answer_q2: "",
  answer_q4: "",
  privacy_consent: false,
};

const departments = [
  "Information Technology",
  "Computer Science",
  "Engineering",
  "Biology",
  "Chemistry",
  "Physics",
  "Other",
];

function calculateAge(value) {
  if (!value) return "";

  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "";

  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();

  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) {
    age--;
  }

  return age;
}

function passwordStrength(value) {
  if (!value) return "";

  const checks = [
    value.length >= 10,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ];

  const score = checks.filter(Boolean).length;

  if (score <= 2) return "Weak";
  if (score <= 4) return "Medium";
  return "Strong";
}

function Field({
  label,
  name,
  value,
  onChange,
  required = false,
  optional = false,
  type = "text",
  placeholder = "",
  maxLength,
  readOnly = false,
  children,
  error,
}) {
  return (
    <div className="lg-register-field">
      <label htmlFor={`reg-${name}`}>
        {label}
        {required && <span className="lg-required"> *</span>}
        {optional && <span className="lg-register-optional"> optional</span>}
      </label>

      {children || (
        <input
          id={`reg-${name}`}
          name={name}
          type={type}
          className="lg-input"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          maxLength={maxLength}
          readOnly={readOnly}
          required={required}
        />
      )}

      {error && <p className="lg-register-error">{error}</p>}
    </div>
  );
}

export default function RegisterPanel({ onPreviewEmailOtp }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState(initialData);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);

  const age = calculateAge(data.birthdate);
  const strength = passwordStrength(data.password);

  function update(event) {
    const { name, value, type, checked } = event.target;

    setData((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));

    setErrors((previous) => ({
      ...previous,
      [name]: "",
    }));
  }

  function field(name, label, options = {}) {
    return (
      <Field
        name={name}
        label={label}
        value={data[name]}
        onChange={update}
        {...options}
        error={errors[name]}
      />
    );
  }

  function validateStep() {
    const nextErrors = {};

    if (step === 1) {
      if (data.extension_type === "Other" && !data.name_extension.trim()) {
        nextErrors.name_extension = "Please specify your name extension.";
      }

      for (const name of ["first_name", "family_name"]) {
        if (!data[name].trim()) {
          nextErrors[name] = "This field is required.";
        }
      }

      if (!data.birthdate || age < 18 || age > 120) {
        nextErrors.birthdate = "You must be at least 18 years old to register.";
      }

      if (data.birthdate && age < 0) {
        nextErrors.birthdate = "Birthdate cannot be in the future.";
      }
    }

    if (step === 2) {
      const required = [
        "purok_street",
        "barangay",
        "municipality_city",
        "province",
        "country",
        "role",
        "department",
        "class_section_or_unit",
      ];

      for (const name of required) {
        if (!data[name].trim()) {
          nextErrors[name] = "This field is required.";
        }
      }

      if (!/^\d{4}$/.test(data.zip_code)) {
        nextErrors.zip_code = "ZIP Code must contain exactly 4 digits.";
      }

      if (!/^09\d{9}$/.test(data.contact_number)) {
        nextErrors.contact_number =
          "Contact number must start with 09 and contain 11 digits.";
      }
    }

    if (step === 3) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        nextErrors.email = "Please enter a valid email address.";
      }

      if (!/^[A-Za-z][A-Za-z0-9]{5,16}$/.test(data.username)) {
        nextErrors.username =
          "Username must start with a letter and contain 6–17 letters or digits.";
      }

      if (data.password.length < 10 || data.password.length > 64) {
        nextErrors.password = "Password must contain 10–64 characters.";
      } else if (strength === "Weak") {
        nextErrors.password = "Weak passwords cannot be submitted.";
      }

      if (data.password !== data.confirm_password) {
        nextErrors.confirm_password = "Passwords do not match.";
      }

      for (const name of ["answer_q7", "answer_q2", "answer_q4"]) {
        if (
          !/^[A-Za-z ]{2,50}$/.test(data[name]) ||
          data[name].includes("  ")
        ) {
          nextErrors[name] =
            "Answer must contain 2–50 letters or spaces, with no double spaces.";
        }
      }

      if (!data.privacy_consent) {
        nextErrors.privacy_consent =
          "You must agree to the Privacy Notice to register.";
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function nextStep() {
    if (validateStep()) {
      setStep((previous) => Math.min(previous + 1, 3));
    }
  }

  function previousStep() {
    setErrors({});
    setStep((previous) => Math.max(previous - 1, 1));
  }

  return (
    <div className="lg-register-panel">
      <div className="lg-register-heading">
        <div className="lg-register-heading-icon">
          <UserRound size={25} />
        </div>

        <h2 id="landing-modal-title">Create Your Account</h2>
        <p>Join LabGear to manage laboratory reservations.</p>
      </div>

      <div className="lg-register-progress">
        {[1, 2, 3].map((number) => (
          <div
            key={number}
            className={
              step === number
                ? "lg-register-progress-step active"
                : step > number
                  ? "lg-register-progress-step completed"
                  : "lg-register-progress-step"
            }
          >
            <span>{number}</span>
            <small>
              {number === 1
                ? "Personal"
                : number === 2
                  ? "Laboratory"
                  : "Security"}
            </small>
          </div>
        ))}
      </div>

      <form onSubmit={(event) => event.preventDefault()} noValidate>
        {step === 1 && (
          <section className="lg-register-section">
            <h3>
              <UserRound size={20} /> Personal Information
            </h3>

            <div className="lg-register-grid">
              {field("id_number", "ID Number", {
                required: true,
                placeholder: "xxxx-xxxx",
                maxLength: 9,
              })}

              {field("birthdate", "Birthdate", {
                required: true,
                type: "date",
              })}

              {field("first_name", "First Name", {
                required: true,
                maxLength: 26,
              })}

              {field("middle_name", "Middle Name", {
                optional: true,
                maxLength: 26,
              })}

              {field("family_name", "Family Name", {
                required: true,
                maxLength: 26,
              })}

              <Field
                label="Age"
                name="age"
                value={age >= 0 ? age : ""}
                readOnly
                placeholder="Calculated automatically"
              />

              <Field label="Name Extension" name="extension_type" optional>
                <select
                  className="lg-input"
                  id="reg-extension_type"
                  name="extension_type"
                  value={data.extension_type}
                  onChange={update}
                >
                  <option value="">None</option>
                  <option value="Jr.">Jr.</option>
                  <option value="Sr.">Sr.</option>
                  <option value="Other">Other</option>
                </select>
              </Field>

              {data.extension_type === "Other" &&
                field("name_extension", "Specify Extension", {
                  required: true,
                  placeholder: "I, II, III, IV, IX, X",
                })}
            </div>
          </section>
        )}

        {step === 2 && (
          <>
            <section className="lg-register-section">
              <h3>
                <MapPin size={20} /> Address Information
              </h3>

              <div className="lg-register-grid">
                {field("purok_street", "Purok / Street", {
                  required: true,
                  placeholder: "Purok or street",
                })}

                {field("barangay", "Barangay", {
                  required: true,
                })}

                {field("municipality_city", "Municipality / City", {
                  required: true,
                })}

                {field("province", "Province", {
                  required: true,
                })}

                {field("country", "Country", {
                  required: true,
                })}

                {field("zip_code", "ZIP Code", {
                  required: true,
                  maxLength: 4,
                })}
              </div>
            </section>

            <section className="lg-register-section">
              <h3>
                <GraduationCap size={20} /> Laboratory Information
              </h3>

              <div className="lg-register-grid">
                <Field
                  label="Account Type"
                  name="role"
                  required
                  error={errors.role}
                >
                  <select
                    className="lg-input"
                    id="reg-role"
                    name="role"
                    value={data.role}
                    onChange={update}
                  >
                    <option value="">Select account type</option>
                    <option value="student">Student</option>
                    <option value="instructor">Instructor</option>
                  </select>
                </Field>

                <Field
                  label="Department"
                  name="department"
                  required
                  error={errors.department}
                >
                  <select
                    className="lg-input"
                    id="reg-department"
                    name="department"
                    value={data.department}
                    onChange={update}
                  >
                    <option value="">Select department</option>
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </Field>

                {field("contact_number", "Contact Number", {
                  required: true,
                  placeholder: "09XXXXXXXXX",
                  maxLength: 11,
                })}

                {field(
                  "class_section_or_unit",
                  data.role === "instructor" ? "Faculty Unit" : "Class Section",
                  {
                    required: true,
                    placeholder:
                      data.role === "instructor"
                        ? "Faculty unit"
                        : "e.g. BSIT 3A2",
                  },
                )}
              </div>
            </section>
          </>
        )}

        {step === 3 && (
          <>
            <section className="lg-register-section">
              <h3>
                <LockKeyhole size={20} /> Account Credentials
              </h3>

              <div className="lg-register-grid">
                {field("email", "Email Address", {
                  required: true,
                  type: "email",
                  placeholder: "example@email.com",
                })}

                {field("username", "Username", {
                  required: true,
                  placeholder: "6–17 characters",
                  maxLength: 17,
                })}
              </div>

              <div className="lg-register-grid">
                <div className="lg-register-field">
                  <label htmlFor="reg-password">
                    Password <span className="lg-required">*</span>
                  </label>

                  <div className="lg-register-password">
                    <input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      name="password"
                      className="lg-input"
                      value={data.password}
                      onChange={update}
                      autoComplete="new-password"
                      placeholder="Create password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>

                  {data.password && (
                    <div className="lg-register-strength">
                      <div
                        className={`lg-register-strength-bar ${strength.toLowerCase()}`}
                      />
                      <span>{strength}</span>
                    </div>
                  )}

                  {errors.password && (
                    <p className="lg-register-error">{errors.password}</p>
                  )}
                </div>

                {field("confirm_password", "Re-enter Password", {
                  required: true,
                  type: "password",
                  placeholder: "Confirm password",
                })}
              </div>
            </section>

            <section className="lg-register-section">
              <h3>
                <ShieldCheck size={20} /> Authentication Questions
              </h3>

              <p className="lg-register-description">
                These three questions are required by your assigned security
                seed.
              </p>

              {field(
                "answer_q7",
                "Q7: What was the name of your elementary school?",
                { required: true, type: "password" },
              )}

              {field(
                "answer_q2",
                "Q2: Who was your best friend in elementary school?",
                { required: true, type: "password" },
              )}

              {field(
                "answer_q4",
                "Q4: What is your mother's maiden first name?",
                { required: true, type: "password" },
              )}
            </section>

            <section className="lg-register-section">
              <h3>Privacy Consent</h3>
              <PrivacyNotice />

              <div className="lg-register-consent">
                <input
                  type="checkbox"
                  id="reg-privacy"
                  name="privacy_consent"
                  checked={data.privacy_consent}
                  onChange={update}
                />
                <label htmlFor="reg-privacy">
                  I have read the Privacy Notice and agree to the collection and
                  processing of my personal data in accordance with the Data
                  Privacy Act of 2012 (RA 10173).
                </label>
              </div>

              {/* <p className="lg-register-description">
                The complete Privacy Notice will be added before live
                registration is enabled.
              </p> */}

              {errors.privacy_consent && (
                <p className="lg-register-error">{errors.privacy_consent}</p>
              )}
            </section>
          </>
        )}

        <div className="lg-register-actions">
          {step > 1 && (
            <button
              type="button"
              className="lg-button lg-button-secondary"
              onClick={previousStep}
            >
              <ArrowLeft size={17} /> Back
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              className="lg-button lg-button-primary"
              onClick={nextStep}
            >
              Continue <ArrowRight size={17} />
            </button>
          ) : (
            <button
              type="submit"
              className="lg-button lg-button-primary"
              disabled
              title="Registration backend is not implemented yet"
            >
              Create Account
            </button>
          )}
        </div>

        {step === 3 && (
          <p className="lg-register-development-notice">
            UI preview only. Registration, username availability, CAPTCHA,
            server-side validation, and email OTP are not connected yet. Use
            fictional test information only.
          </p>
        )}
      </form>
      {onPreviewEmailOtp && (
        <button
          type="button"
          className="lg-auth-preview-link"
          onClick={onPreviewEmailOtp}
        >
          Preview Registration Email Verification
        </button>
      )}
    </div>
  );
}
