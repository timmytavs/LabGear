/**
 * LabGear Frontend File 145 — selectable security questions and uniform settings.
 * Destination: frontend/src/pages/auth/RegisterPanel.jsx (REPLACE).
 * Preserves the existing three-step registration, CAPTCHA and OTP flow.
 * Selected questions require the matching registrationApi.js request mapping.
 * Requires File 58: src/services/registrationApi.js.
 * Real reCAPTCHA v2 needs VITE_LABGEAR_RECAPTCHA_SITE_KEY in frontend/.env.local.
 */
import { useEffect, useRef, useState } from "react";
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
import {
  registerAccount,
  resendRegistrationOtp,
  verifyRegistrationOtp,
} from "../../services/registrationApi";

// This is Google's PUBLIC site key, never the server-side secret key.
// Add VITE_LABGEAR_RECAPTCHA_SITE_KEY to frontend/.env.local and restart Vite.
const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_LABGEAR_RECAPTCHA_SITE_KEY?.trim() || "";

// Use Google's documented explicit-render callback. A <script> onload event
// alone is NOT proof that grecaptcha.render() is ready to be called.
const RECAPTCHA_SCRIPT_HOSTS = [
  "https://www.google.com/recaptcha/api.js",
  "https://www.recaptcha.net/recaptcha/api.js",
];
let captchaScriptPromise;
let captchaCallbackNumber = 0;

function recaptchaIsReady() {
  return typeof window.grecaptcha?.render === "function";
}

function loadFromCaptchaHost(url) {
  return new Promise((resolve, reject) => {
    if (recaptchaIsReady()) {
      resolve(window.grecaptcha);
      return;
    }

    const callbackName = `__labgearCaptchaReady_${++captchaCallbackNumber}`;
    const script = document.createElement("script");
    let finished = false;
    let timeoutId;

    function finish(error) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeoutId);
      delete window[callbackName];
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve(window.grecaptcha);
      }
    }

    // Google invokes this only AFTER its v2 dependencies are initialized.
    window[callbackName] = () => {
      if (recaptchaIsReady()) {
        finish();
      } else {
        finish(
          new Error("reCAPTCHA API initialized without a render function."),
        );
      }
    };

    script.src = `${url}?onload=${callbackName}&render=explicit`;
    script.async = true;
    script.defer = true;
    script.dataset.labgearRecaptcha = "true";
    script.onerror = () => {
      finish(
        new Error(
          `Could not download reCAPTCHA from ${new URL(url).hostname}.`,
        ),
      );
    };
    timeoutId = window.setTimeout(() => {
      if (recaptchaIsReady()) {
        finish();
      } else {
        finish(
          new Error(
            `reCAPTCHA initialization timed out at ${new URL(url).hostname}.`,
          ),
        );
      }
    }, 12000);

    document.head.appendChild(script);
  });
}

function loadRecaptchaScript() {
  if (recaptchaIsReady()) return Promise.resolve(window.grecaptcha);
  if (!captchaScriptPromise) {
    captchaScriptPromise = (async () => {
      for (const url of RECAPTCHA_SCRIPT_HOSTS) {
        try {
          return await loadFromCaptchaHost(url);
        } catch {
          // Google recommends recaptcha.net if google.com is unavailable.
          if (recaptchaIsReady()) return window.grecaptcha;
        }
      }
      throw new Error(
        "Google reCAPTCHA could not load. Check your internet connection, " +
          "browser extensions, and DevTools Console/Network for blocked requests.",
      );
    })().catch((error) => {
      captchaScriptPromise = undefined; // A Retry can start a fresh request.
      throw error;
    });
  }
  return captchaScriptPromise;
}

function RecaptchaCheckbox({ onToken, resetSequence }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const [loadError, setLoadError] = useState("");
  const [retryNumber, setRetryNumber] = useState(0);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return undefined;
    let mounted = true;
    setLoadError("");

    loadRecaptchaScript()
      .then((recaptcha) => {
        if (!mounted || !containerRef.current || widgetIdRef.current !== null) {
          return;
        }
        try {
          widgetIdRef.current = recaptcha.render(containerRef.current, {
            sitekey: RECAPTCHA_SITE_KEY,
            callback: (token) => onTokenRef.current(token),
            "expired-callback": () => onTokenRef.current(""),
            "error-callback": () => {
              onTokenRef.current("");
              if (mounted) {
                setLoadError(
                  "CAPTCHA challenge failed to connect. Check your connection " +
                    "and retry the checkbox.",
                );
              }
            },
          });
        } catch {
          if (mounted) {
            setLoadError(
              "The CAPTCHA widget could not render. Check that your public " +
                "site key is for reCAPTCHA v2 Checkbox and allows localhost.",
            );
          }
        }
      })
      .catch((error) => {
        if (mounted) setLoadError(error.message);
      });

    return () => {
      mounted = false;
      // The CAPTCHA iframe belongs to Google and is removed with the node.
    };
  }, [retryNumber]);

  useEffect(() => {
    if (resetSequence > 0 && widgetIdRef.current !== null) {
      try {
        window.grecaptcha?.reset(widgetIdRef.current);
      } catch {
        // If Google destroyed the iframe, it will reload next mount.
      }
      onTokenRef.current("");
    }
  }, [resetSequence]);

  if (!RECAPTCHA_SITE_KEY) {
    return (
      <p className="lg-register-error" role="alert">
        CAPTCHA site key is not configured. Set VITE_LABGEAR_RECAPTCHA_SITE_KEY
        in frontend/.env.local and restart the React server.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} aria-label="Google reCAPTCHA checkbox" />
      {loadError && (
        <div>
          <p className="lg-register-error" role="alert">
            {loadError}
          </p>
          <button
            type="button"
            className="lg-button lg-button-secondary"
            onClick={() => {
              setLoadError("");
              onTokenRef.current("");
              if (widgetIdRef.current !== null && recaptchaIsReady()) {
                try {
                  window.grecaptcha.reset(widgetIdRef.current);
                } catch {
                  setRetryNumber((value) => value + 1);
                }
              } else {
                setRetryNumber((value) => value + 1);
              }
            }}
          >
            Retry CAPTCHA
          </button>
        </div>
      )}
    </div>
  );
}

const SECURITY_QUESTIONS = [
  { value: "Q1", label: "Q1: What was the name of your first pet?" },
  { value: "Q2", label: "Q2: Who was your best friend in elementary school?" },
  { value: "Q3", label: "Q3: Who was your favorite teacher in high school?" },
  { value: "Q4", label: "Q4: What is your mother's maiden first name?" },
  { value: "Q5", label: "Q5: What street did you live on in Grade 1?" },
  { value: "Q6", label: "Q6: What was the first song you learned by heart?" },
  { value: "Q7", label: "Q7: What was the name of your elementary school?" },
  { value: "Q8", label: "Q8: What dish did you cook for the first time?" },
];

const SECURITY_ANSWER_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

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
  security_questions: [
    { question_code: "", answer: "" },
    { question_code: "", answer: "" },
    { question_code: "", answer: "" },
  ],
  privacy_consent: false,
  website: "", // Hidden honeypot: keep empty for genuine registrants.
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
    value.length >= 8,
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
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSequence, setCaptchaResetSequence] = useState(0);
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState(false);

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
    setStatusMessage("");
  }

  function updateSecurityQuestion(index, name, value) {
    setData((previous) => ({
      ...previous,
      security_questions: previous.security_questions.map((entry, current) =>
        current === index ? { ...entry, [name]: value } : entry,
      ),
    }));
    setErrors((previous) => ({
      ...previous,
      security_questions: "",
      [`question_${index}`]: "",
      [`answer_${index}`]: "",
    }));
    setStatusMessage("");
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
      if (!/^[0-9]{4}-[0-9]{4}$/.test(data.id_number)) {
        nextErrors.id_number = "ID number must use the format 0000-0000.";
      }
      if (data.extension_type === "Other" && !data.name_extension.trim()) {
        nextErrors.name_extension = "Please specify your name extension.";
      }

      for (const name of ["first_name", "family_name"]) {
        if (!data[name].trim()) {
          nextErrors[name] = "This field is required.";
        }
      }
      for (const name of [
        "first_name",
        "middle_name",
        "family_name",
        "name_extension",
      ]) {
        if (data[name].length > 50) {
          nextErrors[name] = "Name fields cannot exceed 50 characters.";
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

      if (!/^[A-Za-z][A-Za-z0-9]{5,19}$/.test(data.username)) {
        nextErrors.username =
          "Username must start with a letter and contain 6–20 letters or digits.";
      }

      if (data.password.length < 8 || data.password.length > 64) {
        nextErrors.password = "Password must contain 8–64 characters.";
      } else if (
        !/[a-z]/.test(data.password) ||
        !/[A-Z]/.test(data.password) ||
        !/[0-9]/.test(data.password) ||
        !/[^A-Za-z0-9]/.test(data.password)
      ) {
        nextErrors.password =
          "Include uppercase, lowercase, number, and special character.";
      }

      if (data.password !== data.confirm_password) {
        nextErrors.confirm_password = "Passwords do not match.";
      }

      const selectedCodes = data.security_questions.map(
        (item) => item.question_code,
      );
      if (
        data.security_questions.length !== 3 ||
        selectedCodes.some(
          (code) => !SECURITY_QUESTIONS.some((q) => q.value === code),
        )
      ) {
        nextErrors.security_questions =
          "Choose exactly three security questions from Q1–Q8.";
      } else if (new Set(selectedCodes).size !== 3) {
        nextErrors.security_questions =
          "Choose three different security questions.";
      }

      data.security_questions.forEach((item, index) => {
        const cleanAnswer = item.answer.trim();
        if (
          cleanAnswer.length < 2 ||
          cleanAnswer.length > 50 ||
          !SECURITY_ANSWER_PATTERN.test(cleanAnswer)
        ) {
          nextErrors[`answer_${index}`] =
            "Answer must be 2–50 letters and single spaces only.";
        }
      });

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
    if (busy) return;
    setErrors({});
    setStatusMessage("");
    setStep((previous) => Math.max(previous - 1, 1));
  }

  function resetCaptcha() {
    setCaptchaToken("");
    setCaptchaResetSequence((count) => count + 1);
  }

  function clearSecrets() {
    setData((previous) => ({
      ...previous,
      password: "",
      confirm_password: "",
      security_questions: previous.security_questions.map((entry) => ({
        ...entry,
        answer: "",
      })),
    }));
  }

  function applyApiError(error) {
    const fieldNames = {
      security_answer_q7: "security_questions",
      security_answer_q2: "security_questions",
      security_answer_q4: "security_questions",
      question_code: "security_questions",
      answer: "security_questions",
    };
    const fieldErrors = {};
    for (const entry of error.fields || []) {
      const name = fieldNames[entry.name] || entry.name;
      fieldErrors[name] = entry.message;
    }
    setErrors(fieldErrors);
    setStatusError(true);
    setStatusMessage(error.message || "Request failed. Try again.");
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (busy) return;
    if (step < 3) {
      nextStep();
      return;
    }
    if (!validateStep()) return;
    if (!RECAPTCHA_SITE_KEY || !captchaToken) {
      setErrors((previous) => ({
        ...previous,
        captcha: "Complete the Google reCAPTCHA checkbox first.",
      }));
      return;
    }

    setBusy("register");
    setStatusMessage("");
    try {
      // Send selected question codes and answers, never legacy Q7/Q2/Q4 fields.
      // The registrationApi.js mapper must forward security_questions unchanged.
      const payload = {
        ...data,
        security_questions: data.security_questions.map((item) => ({
          question_code: item.question_code,
          answer: item.answer.trim(),
        })),
      };
      const result = await registerAccount(payload, captchaToken);
      clearSecrets();
      setOtpCode("");
      setStatusMessage(
        result.message || "Check your email for a verification code.",
      );
      setStatusError(false);
      setStep(4);
    } catch (error) {
      // The API may have committed a pending account even when Gmail fails.
      // Route the user to Resend rather than encouraging duplicate registration.
      if (
        error.status === 503 &&
        error.message?.includes("Verification email could not be sent")
      ) {
        clearSecrets();
        setOtpCode("");
        setStep(4);
        setStatusError(true);
        setStatusMessage(
          "Your registration may be pending, but Gmail delivery failed. Use Resend after the cooldown.",
        );
      } else {
        applyApiError(error);
      }
    } finally {
      resetCaptcha(); // Google tokens are single-use, even on HTTP failure.
      setBusy("");
    }
  }

  async function handleVerify(event) {
    event.preventDefault();
    if (busy) return;
    if (!/^[0-9]{6}$/.test(otpCode)) {
      setStatusError(true);
      setStatusMessage("Enter the six-digit email verification code.");
      return;
    }
    setBusy("verify");
    setStatusMessage("");
    try {
      const result = await verifyRegistrationOtp(data.id_number, otpCode);
      setOtpCode("");
      setStatusError(false);
      setStatusMessage(result.message || "Email verified successfully.");
      setStep(5);
    } catch (error) {
      applyApiError(error);
    } finally {
      setBusy("");
    }
  }

  async function handleResend() {
    if (busy) return;
    if (!RECAPTCHA_SITE_KEY || !captchaToken) {
      setStatusError(true);
      setStatusMessage(
        "Complete a new CAPTCHA before requesting another code.",
      );
      return;
    }
    setBusy("resend");
    setStatusMessage("");
    try {
      const result = await resendRegistrationOtp(data.id_number, captchaToken);
      setStatusError(false);
      setStatusMessage(
        result.message || "If eligible, a new code has been sent.",
      );
    } catch (error) {
      applyApiError(error);
    } finally {
      resetCaptcha();
      setBusy("");
    }
  }

  return (
    <div className="lg-register-panel">
      <div className="lg-register-heading">
        <div className="lg-register-heading-icon">
          <UserRound size={25} />
        </div>

        <h2 id="landing-modal-title">Create Your Account</h2>
        <p>
          {step === 5
            ? "Your registration is verified."
            : "Join LabGear to manage laboratory reservations."}
        </p>
      </div>

      {step <= 3 && (
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
      )}

      {step <= 3 && (
        <form onSubmit={handleRegister} noValidate>
          {/* Bot-trap text input: visually hidden, not type=hidden or disabled.
            File 82 forwards data.website; FastAPI rejects any nonempty value.
            Do not clear, validate, or announce this field in the browser. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-10000px",
              top: "auto",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          >
            <label htmlFor="reg-website">Website (leave blank)</label>
            <input
              id="reg-website"
              name="website"
              type="text"
              value={data.website}
              onChange={update}
              autoComplete="off"
              tabIndex={-1}
            />
          </div>
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
                  maxLength: 50,
                })}

                {field("middle_name", "Middle Name", {
                  optional: true,
                  maxLength: 50,
                })}

                {field("family_name", "Family Name", {
                  required: true,
                  maxLength: 50,
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
                    maxLength: 50,
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
                    data.role === "instructor"
                      ? "Faculty Unit"
                      : "Class Section",
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
                    placeholder: "6–20 characters",
                    maxLength: 20,
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
                        {showPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
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
                  Choose three different security questions from the eight
                  options. You will need to answer one of your selected
                  questions if you reset your password. Answers must use 2–50
                  letters and single spaces.
                </p>

                {data.security_questions.map((item, index) => (
                  <div
                    className="lg-register-grid"
                    key={`security-question-${index}`}
                  >
                    <Field
                      label={`Security Question ${index + 1}`}
                      name={`question_${index}`}
                      required
                      error={errors[`question_${index}`]}
                    >
                      <select
                        id={`reg-question_${index}`}
                        name={`question_${index}`}
                        className="lg-input"
                        value={item.question_code}
                        onChange={(event) =>
                          updateSecurityQuestion(
                            index,
                            "question_code",
                            event.target.value,
                          )
                        }
                        required
                      >
                        <option value="">Select a security question</option>
                        {SECURITY_QUESTIONS.map((question) => (
                          <option
                            key={question.value}
                            value={question.value}
                            disabled={data.security_questions.some(
                              (other, otherIndex) =>
                                otherIndex !== index &&
                                other.question_code === question.value,
                            )}
                          >
                            {question.label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field
                      label={`Answer ${index + 1}`}
                      name={`answer_${index}`}
                      required
                      error={errors[`answer_${index}`]}
                    >
                      <input
                        id={`reg-answer_${index}`}
                        name={`answer_${index}`}
                        className="lg-input"
                        type="password"
                        autoComplete="off"
                        value={item.answer}
                        maxLength={50}
                        placeholder="Your answer"
                        onChange={(event) =>
                          updateSecurityQuestion(
                            index,
                            "answer",
                            event.target.value,
                          )
                        }
                        required
                      />
                    </Field>
                  </div>
                ))}
                {errors.security_questions && (
                  <p className="lg-register-error" role="alert">
                    {errors.security_questions}
                  </p>
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
                    I have read the Privacy Notice and agree to the collection
                    and processing of my personal data in accordance with the
                    Data Privacy Act of 2012 (RA 10173).
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

              <section className="lg-register-section">
                <h3>
                  <ShieldCheck size={20} /> Verify You're Human
                </h3>
                <RecaptchaCheckbox
                  onToken={setCaptchaToken}
                  resetSequence={captchaResetSequence}
                />
                {errors.captcha && (
                  <p className="lg-register-error" role="alert">
                    {errors.captcha}
                  </p>
                )}
              </section>
            </>
          )}

          {statusMessage && (
            <p
              className={
                statusError ? "lg-register-error" : "lg-register-description"
              }
              role={statusError ? "alert" : "status"}
            >
              {statusMessage}
            </p>
          )}

          <div className="lg-register-actions">
            {step > 1 && (
              <button
                type="button"
                className="lg-button lg-button-secondary"
                onClick={previousStep}
                disabled={Boolean(busy)}
              >
                <ArrowLeft size={17} /> Back
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                className="lg-button lg-button-primary"
                onClick={nextStep}
                disabled={Boolean(busy)}
              >
                Continue <ArrowRight size={17} />
              </button>
            ) : (
              <button
                type="submit"
                className="lg-button lg-button-primary"
                disabled={Boolean(busy) || !RECAPTCHA_SITE_KEY}
              >
                {busy === "register" ? "Creating Account..." : "Create Account"}
              </button>
            )}
          </div>

          {step === 3 && (
            <p className="lg-register-development-notice">
              Registration is connected to the local FastAPI backend. A valid
              Google reCAPTCHA checkbox and working Gmail configuration are
              required. Use only fictional accounts while testing.
            </p>
          )}
        </form>
      )}

      {step === 4 && (
        <div>
          <section className="lg-register-section">
            <h3>
              <ShieldCheck size={20} /> Verify Your Email
            </h3>
            <p className="lg-register-description">
              If your registration is eligible, check{" "}
              {data.email || "your email"}
              for a six-digit verification code. Codes expire after five
              minutes.
            </p>
            <p className="lg-register-description">
              Registration ID: <strong>{data.id_number}</strong>
            </p>
            <form onSubmit={handleVerify} noValidate>
              <Field
                label="Email Verification Code"
                name="otp"
                value={otpCode}
                onChange={(event) => {
                  setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setStatusMessage("");
                }}
                placeholder="6-digit code"
                maxLength={6}
                required
              />
              <div className="lg-register-actions">
                <button
                  type="submit"
                  className="lg-button lg-button-primary"
                  disabled={Boolean(busy) || otpCode.length !== 6}
                >
                  {busy === "verify" ? "Verifying..." : "Verify Email"}
                </button>
              </div>
            </form>
          </section>

          <section className="lg-register-section">
            <h3>
              <ShieldCheck size={20} /> Need Another Code?
            </h3>
            <p className="lg-register-description">
              Wait at least 60 seconds before requesting a replacement code.
              Complete a fresh CAPTCHA for each request.
            </p>
            <RecaptchaCheckbox
              onToken={setCaptchaToken}
              resetSequence={captchaResetSequence}
            />
            <div className="lg-register-actions">
              <button
                type="button"
                className="lg-button lg-button-secondary"
                onClick={handleResend}
                disabled={Boolean(busy) || !RECAPTCHA_SITE_KEY}
              >
                {busy === "resend" ? "Sending..." : "Resend Verification Code"}
              </button>
            </div>
          </section>
          {statusMessage && (
            <p
              className={
                statusError ? "lg-register-error" : "lg-register-description"
              }
              role={statusError ? "alert" : "status"}
            >
              {statusMessage}
            </p>
          )}
        </div>
      )}

      {step === 5 && (
        <section className="lg-register-section">
          <h3>
            <ShieldCheck size={20} /> Email Verified
          </h3>
          <p className="lg-register-description" role="status">
            {statusMessage || "Your email has been verified successfully."}
          </p>
          <p className="lg-register-description">
            Your registration is complete. Close this window and select Log-in.
            You can now sign in using your verified account.
          </p>
        </section>
      )}

      {step === 3 && onPreviewEmailOtp && (
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
