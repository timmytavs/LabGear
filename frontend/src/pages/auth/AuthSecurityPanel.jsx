import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";

import {
  PasswordRecoveryApiError as RecoveryApiError,
  startPasswordRecovery,
  resendPasswordRecoveryOtp,
  verifyPasswordRecoveryOtp,
  resetPassword,
} from "../../services/passwordRecoveryApi";

import "../../styles/auth-security.css";

const RECOVERY_STEPS = ["Account", "Question", "Email OTP", "Password"];
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9]{5,16}$/;
const ANSWER_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const OTP_PATTERN = /^\d{6}$/;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 64;
const RESEND_COOLDOWN_SECONDS = 60;

const RECOVERY_QUESTIONS = [
  {
    value: "Q7",
    label: "Q7: What was the name of your elementary school?",
  },
  {
    value: "Q2",
    label: "Q2: Who was your best friend in elementary school?",
  },
  {
    value: "Q4",
    label: "Q4: What is your mother's maiden first name?",
  },
];

const RECAPTCHA_SITE_KEY =
  import.meta.env?.VITE_LABGEAR_RECAPTCHA_SITE_KEY?.trim() || "";

const RECAPTCHA_SCRIPT_HOSTS = [
  "https://www.google.com/recaptcha/api.js",
  "https://www.recaptcha.net/recaptcha/api.js",
];

let captchaScriptPromise = null;
let captchaCallbackNumber = 0;

// ============================================================
// GOOGLE RECAPTCHA
// ============================================================

function recaptchaIsReady() {
  return (
    typeof window !== "undefined" &&
    typeof window.grecaptcha?.render === "function"
  );
}

function loadRecaptchaFromHost(url) {
  return new Promise((resolve, reject) => {
    if (recaptchaIsReady()) {
      resolve(window.grecaptcha);
      return;
    }

    const callbackName = `__labgearRecoveryCaptchaReady_${++captchaCallbackNumber}`;

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

    window[callbackName] = () => {
      if (recaptchaIsReady()) {
        finish();
      } else {
        finish(new Error("Google reCAPTCHA did not initialize correctly."));
      }
    };

    script.src = `${url}?onload=${callbackName}&render=explicit`;
    script.async = true;
    script.defer = true;
    script.dataset.labgearRecoveryRecaptcha = "true";

    script.onerror = () => {
      finish(
        new Error(`Could not load reCAPTCHA from ${new URL(url).hostname}.`),
      );
    };

    timeoutId = window.setTimeout(() => {
      if (recaptchaIsReady()) {
        finish();
      } else {
        finish(new Error("Google reCAPTCHA initialization timed out."));
      }
    }, 12000);

    document.head.appendChild(script);
  });
}

function loadRecaptchaScript() {
  if (recaptchaIsReady()) {
    return Promise.resolve(window.grecaptcha);
  }

  if (!captchaScriptPromise) {
    captchaScriptPromise = (async () => {
      for (const url of RECAPTCHA_SCRIPT_HOSTS) {
        try {
          return await loadRecaptchaFromHost(url);
        } catch {
          if (recaptchaIsReady()) {
            return window.grecaptcha;
          }
        }
      }

      throw new Error(
        "Google reCAPTCHA could not load. Check your internet connection and browser extensions.",
      );
    })().catch((error) => {
      captchaScriptPromise = null;
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

            callback: (token) => {
              onTokenRef.current(token);
            },

            "expired-callback": () => {
              onTokenRef.current("");
            },

            "error-callback": () => {
              onTokenRef.current("");

              if (mounted) {
                setLoadError(
                  "The CAPTCHA challenge could not connect. Retry the checkbox.",
                );
              }
            },
          });
        } catch {
          if (mounted) {
            setLoadError(
              "The CAPTCHA widget could not render. Confirm the public key is a reCAPTCHA v2 Checkbox key authorized for localhost.",
            );
          }
        }
      })
      .catch((error) => {
        if (mounted) setLoadError(error.message);
      });

    return () => {
      mounted = false;
    };
  }, [retryNumber]);

  useEffect(() => {
    if (resetSequence <= 0) return;

    onTokenRef.current("");

    if (widgetIdRef.current !== null && recaptchaIsReady()) {
      try {
        window.grecaptcha.reset(widgetIdRef.current);
      } catch {
        // A fresh widget will be created if Google removes the iframe.
      }
    }
  }, [resetSequence]);

  if (!RECAPTCHA_SITE_KEY) {
    return (
      <p className="lgas-error" role="alert">
        CAPTCHA site key is not configured. Set VITE_LABGEAR_RECAPTCHA_SITE_KEY
        in frontend/.env.local and restart Vite.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} aria-label="Google reCAPTCHA checkbox" />

      {loadError && (
        <div>
          <p className="lgas-error" role="alert">
            {loadError}
          </p>

          <button
            type="button"
            className="lgas-disabled-action"
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

// ============================================================
// OTP FIELD — EXISTING PREVIEW MODES
// ============================================================

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
        with at most 3 resends in 15 minutes.
      </p>

      <button type="button" className="lgas-disabled-action" disabled>
        Resend OTP — Backend Not Connected
      </button>
    </div>
  );
}

// ============================================================
// PASSWORD VALIDATION
// ============================================================

function passwordIsStrong(value) {
  return (
    value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function AuthSecurityPanel({
  mode = "recovery",
  onBackToLogin,
}) {
  const isRecovery = mode === "recovery";

  const [step, setStep] = useState(0);

  const [username, setUsername] = useState("");
  const [questionCode, setQuestionCode] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerConfirmation, setAnswerConfirmation] = useState("");

  const [otp, setOtp] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSequence, setCaptchaResetSequence] = useState(0);

  const [busy, setBusy] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);

  const [recoveryCompleted, setRecoveryCompleted] = useState(false);

  const [completionDetails, setCompletionDetails] = useState({
    notificationSent: false,
    sessionsInvalidated: false,
  });

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const heading = isRecovery
    ? "Forgot Password"
    : mode === "login-otp"
      ? "Login Verification"
      : "Verify Your Email";

  // Resend cooldown countdown.
  useEffect(() => {
    if (resendCountdown <= 0) return undefined;

    const timeoutId = window.setTimeout(() => {
      setResendCountdown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [resendCountdown]);

  function clearFeedback() {
    setError("");
    setMessage("");
  }

  function resetCaptcha() {
    setCaptchaToken("");
    setCaptchaResetSequence((current) => current + 1);
  }

  function goBack() {
    if (busy) return;

    clearFeedback();

    if (!isRecovery || step === 0 || step === 3) {
      onBackToLogin?.();
      return;
    }

    setStep((current) => Math.max(0, current - 1));

    if (step === 2) {
      setOtp("");
    }
  }

  // Existing login/registration OTP preview validation.
  function testOtpFormat(event) {
    event.preventDefault();
    clearFeedback();

    if (!OTP_PATTERN.test(otp)) {
      setError("Enter exactly six numeric digits.");
      return;
    }

    setMessage(
      "The six-digit input format is valid. No OTP was verified, and no account was authenticated.",
    );
  }

  // ----------------------------------------------------------
  // STEP 1 — ACCOUNT
  // ----------------------------------------------------------

  function handleAccountContinue() {
    clearFeedback();

    const value = username.trim();

    if (!USERNAME_PATTERN.test(value)) {
      setError(
        "Enter the username registered to your LabGear account (6–17 letters or digits, starting with a letter).",
      );
      return;
    }

    setUsername(value);
    setStep(1);
  }

  // ----------------------------------------------------------
  // STEP 2 — SECURITY QUESTION + CAPTCHA + SEND OTP
  // ----------------------------------------------------------

  async function handleStartRecovery() {
    if (busy) return;

    clearFeedback();

    const cleanAnswer = answer.trim();
    const cleanConfirmation = answerConfirmation.trim();

    if (
      !RECOVERY_QUESTIONS.some((question) => question.value === questionCode)
    ) {
      setError(
        "Select one of the security questions assigned to your account.",
      );
      return;
    }

    if (
      cleanAnswer.length < 2 ||
      cleanAnswer.length > 50 ||
      !ANSWER_PATTERN.test(cleanAnswer)
    ) {
      setError(
        "The security answer must contain 2–50 letters and single spaces only.",
      );
      return;
    }

    if (cleanAnswer !== cleanConfirmation) {
      setError("The security answers do not match.");
      return;
    }

    if (!RECAPTCHA_SITE_KEY || !captchaToken) {
      setError("Complete the Google reCAPTCHA checkbox before continuing.");
      return;
    }

    setBusy("start");

    try {
      // File 98 obtains a signed CSRF token before this POST.
      const result = await startPasswordRecovery({
        username: username.trim(),
        questionCode,
        answer: cleanAnswer,
        answerConfirmation: cleanConfirmation,
        captchaToken,
      });

      if (result.otpRequired !== true) {
        throw new RecoveryApiError(
          "FastAPI did not confirm the recovery OTP step.",
        );
      }

      setAnswer("");
      setAnswerConfirmation("");
      setOtp("");

      setResendCountdown(RESEND_COOLDOWN_SECONDS);

      setMessage(
        result.message ||
          "If the account and security answer are eligible, check the registered email for a verification code.",
      );

      setStep(2);
    } catch (requestError) {
      setError(
        requestError.message || "The recovery request could not be completed.",
      );
    } finally {
      // reCAPTCHA tokens are single-use, even after rejected requests.
      resetCaptcha();
      setBusy("");
    }
  }

  // ----------------------------------------------------------
  // RESEND EMAIL OTP
  // ----------------------------------------------------------

  async function handleResendOtp() {
    if (busy || resendCountdown > 0) return;

    clearFeedback();

    setBusy("resend");

    try {
      const result = await resendPasswordRecoveryOtp();

      setOtp("");

      setResendCountdown(RESEND_COOLDOWN_SECONDS);

      setMessage(
        result.message || "If eligible, a new verification code has been sent.",
      );
    } catch (requestError) {
      if (requestError.status === 429) {
        setResendCountdown(
          Math.max(
            RESEND_COOLDOWN_SECONDS,
            requestError.retryAfterSeconds || 0,
          ),
        );
      }

      setError(
        requestError.message || "A new verification code could not be sent.",
      );
    } finally {
      setBusy("");
    }
  }

  // ----------------------------------------------------------
  // STEP 3 — VERIFY EMAIL OTP
  // ----------------------------------------------------------

  async function handleVerifyRecoveryOtp() {
    if (busy) return;

    clearFeedback();

    if (!OTP_PATTERN.test(otp)) {
      setError("Enter the six-digit verification code from your email.");
      return;
    }

    setBusy("verify");

    try {
      const result = await verifyPasswordRecoveryOtp(otp);

      if (result.resetRequired !== true) {
        throw new RecoveryApiError(
          "FastAPI did not authorize the password-reset step.",
        );
      }

      setOtp("");
      setResendCountdown(0);

      setMessage(
        result.message ||
          "Email verification successful. You may now set a new password.",
      );

      setStep(3);
    } catch (requestError) {
      setError(
        requestError.message || "The verification code could not be verified.",
      );
    } finally {
      setBusy("");
    }
  }

  // ----------------------------------------------------------
  // STEP 4 — RESET PASSWORD
  // ----------------------------------------------------------

  async function handleResetPassword(event) {
    event.preventDefault();

    if (busy) return;

    clearFeedback();

    if (!passwordIsStrong(password)) {
      setError(
        "Use 10–64 characters with uppercase, lowercase, number, and special character.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setBusy("reset");

    try {
      const result = await resetPassword({
        newPassword: password,
        confirmPassword,
      });

      setCompletionDetails({
        notificationSent: result.notificationSent === true,
        sessionsInvalidated: result.sessionsInvalidated === true,
      });

      setRecoveryCompleted(true);

      setPassword("");
      setConfirmPassword("");
      setOtp("");
      setAnswer("");
      setAnswerConfirmation("");

      setMessage(
        result.message || "Your LabGear password has been reset successfully.",
      );
    } catch (requestError) {
      setError(requestError.message || "Your password could not be reset.");
    } finally {
      setBusy("");
    }
  }

  // ==========================================================
  // LOGIN OTP / REGISTRATION OTP PREVIEW MODES
  // Keep their existing authentication forms untouched.
  // ==========================================================

  if (!isRecovery) {
    return (
      <div className="lgas-panel">
        <div className="lgas-header">
          <div className="lgas-header-icon">
            <Mail size={25} />
          </div>

          <h2 id="landing-modal-title">{heading}</h2>

          <p>Preview the six-digit email verification screen.</p>
        </div>

        <div className="lgas-preview-warning">
          <ShieldCheck size={18} />

          <span>
            Development preview only. The live login and registration OTP flows
            are handled by their respective authentication forms.
          </span>
        </div>

        <form className="lgas-content" onSubmit={testOtpFormat} noValidate>
          <h3>
            {mode === "login-otp"
              ? "Confirm Login Code"
              : "Confirm Email Address"}
          </h3>

          <p>
            {mode === "login-otp"
              ? "Enter the six-digit code sent to the registered email after the password step."
              : "Enter the six-digit email verification code sent after registration."}
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
        </form>

        <button type="button" className="lgas-back" onClick={onBackToLogin}>
          <ArrowLeft size={17} />
          Back to Login
        </button>

        <p className="lgas-footer">LabGear Security · Email OTP verification</p>
      </div>
    );
  }

  // ==========================================================
  // PASSWORD RECOVERY
  // ==========================================================

  return (
    <div className="lgas-panel">
      <div className="lgas-header">
        <div className="lgas-header-icon">
          <LockKeyhole size={25} />
        </div>

        <h2 id="landing-modal-title">Forgot Password</h2>

        <p>Verify your account to securely create a new password.</p>
      </div>

      {!recoveryCompleted && (
        <div className="lgas-steps">
          {RECOVERY_STEPS.map((label, index) => (
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

      {recoveryCompleted ? (
        <div className="lgas-content">
          <div className="lgas-success" role="status">
            <CheckCircle2 size={20} />
            <span>
              {message || "Your password has been reset successfully."}
            </span>
          </div>

          {completionDetails.notificationSent && (
            <p className="lgas-hint">
              A password-change notification was sent to your registered email.
            </p>
          )}

          {completionDetails.sessionsInvalidated && (
            <p className="lgas-hint">
              Your other active LabGear sessions have been invalidated for your
              protection.
            </p>
          )}

          <button
            type="button"
            className="lgas-primary"
            onClick={onBackToLogin}
          >
            Return to Login
            <ArrowRight size={17} />
          </button>
        </div>
      ) : (
        <>
          {/* STEP 1: ACCOUNT */}

          {step === 0 && (
            <div className="lgas-content">
              <h3>Find Your Account</h3>

              <p>Enter the username registered to your LabGear account.</p>

              <div className="lgas-field">
                <label htmlFor="lgas-username">
                  Username
                  <span className="lgas-required">*</span>
                </label>

                <input
                  id="lgas-username"
                  type="text"
                  autoComplete="username"
                  maxLength={17}
                  value={username}
                  placeholder="Enter your username"
                  onChange={(event) => {
                    setUsername(event.target.value);
                    clearFeedback();
                  }}
                />
              </div>

              <p className="lgas-hint">
                Use the same username you entered during registration.
              </p>

              {error && (
                <p className="lgas-error" role="alert">
                  {error}
                </p>
              )}

              <button
                type="button"
                className="lgas-primary"
                onClick={handleAccountContinue}
              >
                Continue
                <ArrowRight size={17} />
              </button>
            </div>
          )}

          {/* STEP 2: SECURITY QUESTION */}

          {step === 1 && (
            <div className="lgas-content">
              <h3>Verify Your Security Question</h3>

              <p>
                Select one of the three security questions you answered during
                registration.
              </p>

              <div className="lgas-field">
                <label htmlFor="lgas-question">
                  Assigned Security Question
                  <span className="lgas-required">*</span>
                </label>

                <select
                  id="lgas-question"
                  value={questionCode}
                  onChange={(event) => {
                    setQuestionCode(event.target.value);
                    clearFeedback();
                  }}
                >
                  <option value="">Choose your security question</option>

                  {RECOVERY_QUESTIONS.map((question) => (
                    <option key={question.value} value={question.value}>
                      {question.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lgas-field">
                <label htmlFor="lgas-answer">
                  Your Answer
                  <span className="lgas-required">*</span>
                </label>

                <input
                  id="lgas-answer"
                  type="password"
                  autoComplete="off"
                  maxLength={50}
                  value={answer}
                  placeholder="Enter your original answer"
                  onChange={(event) => {
                    setAnswer(event.target.value);
                    clearFeedback();
                  }}
                />
              </div>

              <div className="lgas-field">
                <label htmlFor="lgas-answer-confirmation">
                  Re-enter Answer
                  <span className="lgas-required">*</span>
                </label>

                <input
                  id="lgas-answer-confirmation"
                  type="password"
                  autoComplete="off"
                  maxLength={50}
                  value={answerConfirmation}
                  placeholder="Re-enter the same answer"
                  onChange={(event) => {
                    setAnswerConfirmation(event.target.value);
                    clearFeedback();
                  }}
                />
              </div>

              <div className="lgas-field">
                <label>
                  Verify You're Human
                  <span className="lgas-required">*</span>
                </label>

                <RecaptchaCheckbox
                  onToken={(token) => setCaptchaToken(token)}
                  resetSequence={captchaResetSequence}
                />
              </div>

              {error && (
                <p className="lgas-error" role="alert">
                  {error}
                </p>
              )}

              <button
                type="button"
                className="lgas-primary"
                onClick={handleStartRecovery}
                disabled={Boolean(busy)}
              >
                {busy === "start" ? "Verifying..." : "Verify Answer & Send OTP"}

                {busy !== "start" && <ArrowRight size={17} />}
              </button>
            </div>
          )}

          {/* STEP 3: EMAIL OTP */}

          {step === 2 && (
            <div className="lgas-content">
              <h3>Email OTP Recovery</h3>

              <p>
                If the account and security answer are eligible, a six-digit
                code has been sent to the email address registered with LabGear.
              </p>

              <div className="lgas-field">
                <label htmlFor="lgas-recovery-otp">
                  Six-Digit OTP
                  <span className="lgas-required">*</span>
                </label>

                <input
                  id="lgas-recovery-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="lgas-otp-input"
                  value={otp}
                  maxLength={6}
                  placeholder="000000"
                  onChange={(event) => {
                    setOtp(event.target.value.replace(/\D/g, ""));
                    clearFeedback();
                  }}
                />
              </div>

              <div className="lgas-policy">
                <Clock3 size={16} />

                <span>
                  Code expires in 3 minutes. Maximum 3 incorrect attempts.
                </span>
              </div>

              <button
                type="button"
                className="lgas-disabled-action"
                onClick={handleResendOtp}
                disabled={Boolean(busy) || resendCountdown > 0}
              >
                {busy === "resend"
                  ? "Sending..."
                  : resendCountdown > 0
                    ? `Resend OTP in ${resendCountdown}s`
                    : "Resend OTP"}
              </button>

              {error && (
                <p className="lgas-error" role="alert">
                  {error}
                </p>
              )}

              {message && (
                <p className="lgas-hint" role="status">
                  {message}
                </p>
              )}

              <button
                type="button"
                className="lgas-primary"
                onClick={handleVerifyRecoveryOtp}
                disabled={Boolean(busy)}
              >
                {busy === "verify" ? "Verifying..." : "Verify OTP"}

                {busy !== "verify" && <ArrowRight size={17} />}
              </button>
            </div>
          )}

          {/* STEP 4: RESET PASSWORD */}

          {step === 3 && (
            <form
              className="lgas-content"
              onSubmit={handleResetPassword}
              noValidate
            >
              <h3>Create a New Password</h3>

              <p>
                The email code has been verified. Create a new password for your
                LabGear account.
              </p>

              <div className="lgas-field">
                <label htmlFor="lgas-password">
                  New Password
                  <span className="lgas-required">*</span>
                </label>

                <div className="lgas-password-wrap">
                  <input
                    id="lgas-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    placeholder="Enter your new password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      clearFeedback();
                    }}
                  />

                  <button
                    type="button"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="lgas-field">
                <label htmlFor="lgas-confirm">
                  Confirm New Password
                  <span className="lgas-required">*</span>
                </label>

                <div className="lgas-password-wrap">
                  <input
                    id="lgas-confirm"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    placeholder="Re-enter your new password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      clearFeedback();
                    }}
                  />

                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirmation"
                        : "Show confirmation"
                    }
                    onClick={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>

              <p className="lgas-hint">
                Use 10–64 characters with uppercase, lowercase, number, and
                special character. FastAPI also rejects reuse of your last three
                passwords.
              </p>

              {error && (
                <p className="lgas-error" role="alert">
                  {error}
                </p>
              )}

              {message && (
                <p className="lgas-hint" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                className="lgas-primary"
                disabled={Boolean(busy)}
              >
                {busy === "reset" ? "Updating Password..." : "Reset Password"}

                {busy !== "reset" && <ArrowRight size={17} />}
              </button>
            </form>
          )}
        </>
      )}

      {!recoveryCompleted && (
        <button
          type="button"
          className="lgas-back"
          onClick={goBack}
          disabled={Boolean(busy)}
        >
          <ArrowLeft size={17} />

          {step === 0 || step === 3 ? "Back to Login" : "Previous Step"}
        </button>
      )}

      <p className="lgas-footer">LabGear Security · Password recovery</p>
    </div>
  );
}
