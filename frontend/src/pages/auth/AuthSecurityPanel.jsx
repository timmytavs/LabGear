import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";

import "../../styles/auth-security.css";

const recoverySteps = ["Account", "Question", "Email OTP", "Password"];

function OtpField({ value, onChange, error }) {
  return (
    <div className="lgas-field">
      <label htmlFor="lgas-otp">
        Six-Digit OTP <span className="lgas-required">*</span>
      </label>

      <input
        id="lgas-otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        className="lgas-otp-input"
        value={value}
        maxLength={6}
        placeholder="000000"
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
      />

      {error && (
        <p className="lgas-error" role="alert">
          {error}
        </p>
      )}

      <div className="lgas-policy">
        <Clock3 size={16} />
        <span>Expires in 3 minutes after issuance.</span>
      </div>

      <p className="lgas-hint">
        Maximum 3 incorrect attempts. Resending requires a 60-second cooldown,
        with at most 3 resends in 15 minutes. These limits will be enforced by
        FastAPI.
      </p>

      <button type="button" className="lgas-disabled-action" disabled>
        Resend OTP — Backend Not Connected
      </button>
    </div>
  );
}

export default function AuthSecurityPanel({
  mode = "recovery",
  onBackToLogin,
}) {
  const isRecovery = mode === "recovery";

  const [step, setStep] = useState(0);
  const [identifier, setIdentifier] = useState("");
  const [answer, setAnswer] = useState("");
  const [otp, setOtp] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const heading = isRecovery
    ? "Forgot Password"
    : mode === "login-otp"
      ? "Login Verification"
      : "Verify Your Email";

  function clearFeedback() {
    setError("");
    setMessage("");
  }

  function goBack() {
    clearFeedback();

    if (step > 0) {
      setStep((previous) => previous - 1);
    } else {
      onBackToLogin?.();
    }
  }

  function previewNext() {
    clearFeedback();

    if (step === 0 && !identifier.trim()) {
      setError("Please enter a sample username or email address.");
      return;
    }

    if (step === 1 && !answer.trim()) {
      setError("Enter a fictional answer to preview the next screen.");
      return;
    }

    if (step === 2 && !/^\d{6}$/.test(otp)) {
      setError("OTP format must contain exactly six digits.");
      return;
    }

    setStep((previous) => Math.min(previous + 1, 3));
  }

  function testOtpFormat(event) {
    event.preventDefault();
    clearFeedback();

    if (!/^\d{6}$/.test(otp)) {
      setError("Enter exactly six numeric digits.");
      return;
    }

    setMessage(
      "The six-digit input format is valid. No OTP was " +
        "verified, and no account was authenticated.",
    );
  }

  function testPasswordForm(event) {
    event.preventDefault();
    clearFeedback();

    const strongEnough =
      password.length >= 10 &&
      password.length <= 64 &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /\d/.test(password) &&
      /[^A-Za-z0-9]/.test(password);

    if (!strongEnough) {
      setError(
        "Use 10–64 characters with uppercase, lowercase, " +
          "number, and special character.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setPassword("");
    setConfirmPassword("");

    setMessage(
      "Local password form validation passed. No password " +
        "was changed. Current identity, OTP validity, and " +
        "password history were not verified.",
    );
  }

  return (
    <div className="lgas-panel">
      <div className="lgas-header">
        <div className="lgas-header-icon">
          {isRecovery ? <LockKeyhole size={25} /> : <Mail size={25} />}
        </div>

        <h2 id="landing-modal-title">{heading}</h2>

        <p>
          {isRecovery
            ? "Preview the account recovery process."
            : "Preview the six-digit email verification screen."}
        </p>
      </div>

      <div className="lgas-preview-warning">
        <ShieldCheck size={18} />
        <span>
          Development preview only. No verification email is sent and no
          identity is verified. Use fictional test information.
        </span>
      </div>

      {isRecovery && (
        <div className="lgas-steps">
          {recoverySteps.map((label, index) => (
            <div
              key={label}
              className={
                index === step
                  ? "lgas-step active"
                  : index < step
                    ? "lgas-step completed"
                    : "lgas-step"
              }
            >
              <span>{index + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>
      )}

      {isRecovery && step === 0 && (
        <div className="lgas-content">
          <h3>Find Your Account</h3>

          <p>
            Enter the username or registered email address for your fictional
            LabGear account.
          </p>

          <div className="lgas-field">
            <label htmlFor="lgas-identifier">
              Username or Email <span className="lgas-required">*</span>
            </label>

            <input
              id="lgas-identifier"
              type="text"
              value={identifier}
              autoComplete="off"
              placeholder="Enter username or email"
              onChange={(event) => {
                setIdentifier(event.target.value);
                clearFeedback();
              }}
            />
          </div>

          {error && (
            <p className="lgas-error" role="alert">
              {error}
            </p>
          )}

          <button type="button" className="lgas-primary" onClick={previewNext}>
            Preview Security Question
            <ArrowRight size={17} />
          </button>
        </div>
      )}

      {isRecovery && step === 1 && (
        <div className="lgas-content">
          <h3>Security Question</h3>

          <p>
            The real backend will select and verify an assigned account recovery
            question. This preview uses Q7 as an example.
          </p>

          <div className="lgas-question">
            <KeyRound size={19} />
            <strong>Q7: What was the name of your elementary school?</strong>
          </div>

          <div className="lgas-field">
            <label htmlFor="lgas-answer">
              Security Answer <span className="lgas-required">*</span>
            </label>

            <input
              id="lgas-answer"
              type="password"
              autoComplete="off"
              value={answer}
              placeholder="Use a fictional answer"
              onChange={(event) => {
                setAnswer(event.target.value);
                clearFeedback();
              }}
            />
          </div>

          <p className="lgas-hint">
            The preview checks only whether text was entered. It does not check
            whether an answer is correct.
          </p>

          {error && (
            <p className="lgas-error" role="alert">
              {error}
            </p>
          )}

          <button type="button" className="lgas-primary" onClick={previewNext}>
            Preview Email OTP
            <ArrowRight size={17} />
          </button>
        </div>
      )}

      {isRecovery && step === 2 && (
        <div className="lgas-content">
          <h3>Email OTP Recovery</h3>

          <p>
            After the security question is verified by the backend, a one-time
            code will be sent to the registered email address.
          </p>

          <OtpField
            value={otp}
            onChange={(value) => {
              setOtp(value);
              clearFeedback();
            }}
            error={error}
          />

          <button type="button" className="lgas-primary" onClick={previewNext}>
            Preview Password Reset
            <ArrowRight size={17} />
          </button>
        </div>
      )}

      {isRecovery && step === 3 && (
        <form className="lgas-content" onSubmit={testPasswordForm} noValidate>
          <h3>Create a New Password</h3>

          <p>
            The real reset form will become available only after server-side OTP
            verification.
          </p>

          <div className="lgas-field">
            <label htmlFor="lgas-password">
              New Password <span className="lgas-required">*</span>
            </label>

            <div className="lgas-password-wrap">
              <input
                id="lgas-password"
                type={showPassword ? "text" : "password"}
                autoComplete="off"
                placeholder="Enter a fictional password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFeedback();
                }}
              />

              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="lgas-field">
            <label htmlFor="lgas-confirm">
              Confirm New Password <span className="lgas-required">*</span>
            </label>

            <input
              id="lgas-confirm"
              type="password"
              autoComplete="off"
              placeholder="Re-enter fictional password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                clearFeedback();
              }}
            />
          </div>

          <p className="lgas-hint">
            Password history checks and all password updates must be performed
            by FastAPI.
          </p>

          {error && (
            <p className="lgas-error" role="alert">
              {error}
            </p>
          )}

          {message && (
            <div className="lgas-success" role="status">
              <CheckCircle2 size={19} />
              <span>{message}</span>
            </div>
          )}

          <button type="submit" className="lgas-primary">
            Test Password Form
          </button>
        </form>
      )}

      {!isRecovery && (
        <form className="lgas-content" onSubmit={testOtpFormat} noValidate>
          <h3>
            {mode === "login-otp"
              ? "Confirm Login Code"
              : "Confirm Email Address"}
          </h3>

          <p>
            {mode === "login-otp"
              ? "After username and password authentication, enter the OTP sent to the registered email."
              : "After registration, enter the email verification code sent by LabGear."}
          </p>

          <OtpField
            value={otp}
            onChange={(value) => {
              setOtp(value);
              clearFeedback();
            }}
            error={error}
          />

          {message && (
            <div className="lgas-success" role="status">
              <CheckCircle2 size={19} />
              <span>{message}</span>
            </div>
          )}

          <button type="submit" className="lgas-primary">
            Test OTP Input Format
          </button>

          <button type="button" className="lgas-disabled-action" disabled>
            Actual OTP Verification — Not Connected
          </button>
        </form>
      )}

      <button
        type="button"
        className="lgas-back"
        onClick={isRecovery ? goBack : onBackToLogin}
      >
        <ArrowLeft size={17} />
        {isRecovery && step > 0 ? "Previous Preview Screen" : "Back to Login"}
      </button>

      <p className="lgas-footer">
        LabGear Security · Backend verification required
      </p>
    </div>
  );
}
