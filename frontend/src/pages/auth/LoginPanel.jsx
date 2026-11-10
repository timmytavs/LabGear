/**
 * LabGear Frontend File 97 — notify App.jsx when a verified session changes.
 * Destination: frontend/src/pages/auth/LoginPanel.jsx (REPLACE).
 *
 * Keeps the original LabGear auth classes and Forgot Password navigation.
 * Flow: username/password + Google reCAPTCHA -> Gmail OTP -> session check.
 * The authenticated session lives in a FastAPI HttpOnly cookie; this component
 * never reads or stores that cookie, passwords, or OTPs in browser storage.
 *
 * Preserves the existing verified login and optional onLoginSuccess callback.
 * After FastAPI confirms the session, notify File 96 App.jsx so it rechecks
 * GET /api/auth/me and routes by the server-confirmed role, not browser state.
 * Notify on logout as well. No credentials, OTPs, or roles are broadcast.
 *
 * Required: frontend/.env.local has VITE_LABGEAR_RECAPTCHA_SITE_KEY pointing
 * to the same reCAPTCHA v2 Checkbox registration as the backend secret.
 * Use http://localhost:5173 for React and http://localhost:8000 for FastAPI.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import {
  getCurrentUser,
  logout,
  startLogin,
  verifyLoginOtp,
} from "../../services/loginApi";

const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_LABGEAR_RECAPTCHA_SITE_KEY?.trim() || "";

// A single loader is shared across modal mounts and with the registration page.
// Google's script can finish loading before or after the React effect starts.
// In either case, wait for the actual grecaptcha.render API, not just onload.
let recaptchaScriptPromise = null;

function waitForRecaptcha(timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (window.grecaptcha && typeof window.grecaptcha.render === "function") {
        if (typeof window.grecaptcha.ready === "function") {
          window.grecaptcha.ready(() => resolve(window.grecaptcha));
        } else {
          resolve(window.grecaptcha);
        }
      } else if (Date.now() - started >= timeoutMs) {
        reject(new Error("Google reCAPTCHA did not become ready."));
      } else {
        window.setTimeout(check, 120);
      }
    };
    check();
  });
}

function loadRecaptcha() {
  if (!recaptchaScriptPromise) {
    recaptchaScriptPromise = (async () => {
      if (
        !window.grecaptcha ||
        typeof window.grecaptcha.render !== "function"
      ) {
        // Reuse the script already inserted by RegisterPanel when available.
        // Injecting Google reCAPTCHA twice is unreliable during modal changes.
        const existing = document.querySelector(
          'script[src*="google.com/recaptcha/api.js"]',
        );
        if (!existing) {
          const script = document.createElement("script");
          script.src =
            "https://www.google.com/recaptcha/api.js?render=explicit";
          script.async = true;
          script.defer = true;
          script.dataset.labgearLoginRecaptcha = "true";
          script.addEventListener(
            "error",
            () => {
              script.dataset.labgearLoadFailed = "true";
            },
            { once: true },
          );
          document.head.appendChild(script);
        }
      }
      return waitForRecaptcha();
    })().catch((error) => {
      recaptchaScriptPromise = null;
      // Only remove the script owned by this component after a failed load.
      const ourScript = document.querySelector(
        'script[data-labgear-login-recaptcha="true"]',
      );
      if (ourScript && !window.grecaptcha?.render) ourScript.remove();
      throw error;
    });
  }
  return recaptchaScriptPromise;
}

/** Keep the same login design; load CAPTCHA reliably even after registration. */
function LoginRecaptcha({ onToken }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const latestCallback = useRef(onToken);
  const [loadError, setLoadError] = useState("");
  const [reloadAttempt, setReloadAttempt] = useState(0);
  latestCallback.current = onToken;

  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return undefined;
    let active = true;
    setLoadError("");
    loadRecaptcha()
      .then((captcha) => {
        if (!active || !containerRef.current || widgetIdRef.current !== null) {
          return;
        }
        try {
          widgetIdRef.current = captcha.render(containerRef.current, {
            sitekey: RECAPTCHA_SITE_KEY,
            callback: (token) => latestCallback.current(token),
            "expired-callback": () => latestCallback.current(""),
            "error-callback": () => {
              latestCallback.current("");
              setLoadError(
                "CAPTCHA verification was interrupted. Please try again.",
              );
            },
          });
        } catch {
          if (active) {
            setLoadError(
              "Google CAPTCHA could not initialize. Retry the checkbox.",
            );
          }
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(
            "Google reCAPTCHA could not load. Check your connection, " +
              "browser extensions, or try again.",
          );
        }
      });
    return () => {
      active = false;
      latestCallback.current("");
    };
  }, [reloadAttempt]);

  if (!RECAPTCHA_SITE_KEY) {
    return (
      <p className="lg-auth-dev-note" role="alert">
        CAPTCHA site key is missing. Configure VITE_LABGEAR_RECAPTCHA_SITE_KEY
        in frontend/.env.local, then restart Vite.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} />
      {loadError && (
        <div>
          <p className="lg-auth-dev-note" role="alert">
            {loadError}
          </p>
          <button
            type="button"
            className="lg-auth-forgot-action"
            onClick={() => {
              // Retry only when no widget has been rendered yet. For a rendered
              // widget, Google's own checkbox can be solved again.
              if (widgetIdRef.current === null) {
                if (containerRef.current)
                  containerRef.current.replaceChildren();
                setReloadAttempt((count) => count + 1);
              } else if (window.grecaptcha?.reset) {
                window.grecaptcha.reset(widgetIdRef.current);
                latestCallback.current("");
                setLoadError("");
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

function readableLoginError(error) {
  const message = error?.message || "Login could not be completed.";
  const seconds = error?.retryAfterSeconds;
  if (error?.status === 429 && Number.isFinite(seconds) && seconds > 0) {
    return `${message} Try again in about ${seconds} seconds.`;
  }
  return message;
}

/** File 96 App.jsx listens for this and verifies the session with FastAPI. */
function notifyAppSessionChanged() {
  window.dispatchEvent(new Event("labgear:auth-changed"));
}

export default function LoginPanel({ onForgotPassword, onLoginSuccess }) {
  const [stage, setStage] = useState("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaInstance, setCaptchaInstance] = useState(0);
  const [pendingUserId, setPendingUserId] = useState("");
  const [otp, setOtp] = useState("");
  const [authenticatedUser, setAuthenticatedUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  function resetToCredentials() {
    if (busy) return;
    setStage("credentials");
    setPassword("");
    setOtp("");
    setPendingUserId("");
    setCaptchaToken("");
    setErrorMessage("");
    setInfoMessage("");
    setAuthenticatedUser(null);
  }

  async function submitCredentials(event) {
    event.preventDefault();
    if (busy) return;
    setErrorMessage("");
    setInfoMessage("");

    if (!/^[A-Za-z][A-Za-z0-9]{5,16}$/.test(username.trim())) {
      setErrorMessage("Enter your LabGear username (6–17 letters or digits).");
      return;
    }
    if (!password) {
      setErrorMessage("Enter your password.");
      return;
    }
    if (!captchaToken) {
      setErrorMessage("Complete the Google CAPTCHA checkbox first.");
      return;
    }

    setBusy(true);
    try {
      const pending = await startLogin({ username, password, captchaToken });
      // The password and CAPTCHA token are not needed after step one.
      setPassword("");
      setCaptchaToken("");
      setPendingUserId(pending.user_id);
      setOtp("");
      setStage("otp");
      setInfoMessage(
        "Check your email for the six-digit login code. It expires after 3 minutes.",
      );
    } catch (error) {
      setErrorMessage(readableLoginError(error));
      setCaptchaToken("");
      // Remount Google CAPTCHA so a fresh, one-time token can be obtained.
      setCaptchaInstance((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(event) {
    event.preventDefault();
    if (busy) return;
    setErrorMessage("");
    setInfoMessage("");

    if (!/^\d{6}$/.test(otp)) {
      setErrorMessage("Enter the six-digit code from your login email.");
      return;
    }

    setBusy(true);
    try {
      await verifyLoginOtp(pendingUserId, otp);
      setOtp("");
      setPendingUserId("");
      // Verify that the browser really sends its HttpOnly session cookie.
      try {
        const user = await getCurrentUser();
        setAuthenticatedUser(user);
        setStage("authenticated");
        setInfoMessage("Your login is verified and your session is active.");
        notifyAppSessionChanged();
        if (typeof onLoginSuccess === "function") onLoginSuccess(user);
      } catch (sessionError) {
        setStage("session-error");
        setErrorMessage(
          `The email code was accepted, but the browser session could not be confirmed. ` +
            `Use localhost for both React and FastAPI. ${readableLoginError(sessionError)}`,
        );
      }
    } catch (error) {
      if (error?.status === 401) {
        // FastAPI intentionally uses the same error for wrong, expired,
        // revoked, or challenge-cookie-missing OTPs; do not guess which one.
        setErrorMessage(
          "The login code was not accepted. Use the newest LOGIN code from Gmail " +
            "within 3 minutes. If this code is fresh, check that React and " +
            "FastAPI both use localhost and that your browser allows cookies. " +
            "Otherwise, start login again to request a new code.",
        );
      } else {
        setErrorMessage(readableLoginError(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function checkSessionAgain() {
    if (busy) return;
    setBusy(true);
    setErrorMessage("");
    try {
      const user = await getCurrentUser();
      setAuthenticatedUser(user);
      setStage("authenticated");
      setInfoMessage("Your login session is active.");
      notifyAppSessionChanged();
      if (typeof onLoginSuccess === "function") onLoginSuccess(user);
    } catch (error) {
      setErrorMessage(readableLoginError(error));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setErrorMessage("");
    try {
      await logout();
      notifyAppSessionChanged();
      setStage("credentials");
      setAuthenticatedUser(null);
      setUsername("");
      setPassword("");
      setCaptchaToken("");
      setOtp("");
      setPendingUserId("");
      setInfoMessage("You have signed out of LabGear.");
    } catch (error) {
      setErrorMessage(readableLoginError(error));
    } finally {
      setBusy(false);
    }
  }

  const credentialsVisible = stage === "credentials";

  return (
    <div className="lg-auth-panel">
      <div className="lg-auth-heading">
        <h2 id="landing-modal-title">
          {credentialsVisible
            ? "Welcome back"
            : stage === "otp"
              ? "Verify your login"
              : stage === "authenticated"
                ? "Signed in successfully"
                : "Check your session"}
        </h2>
        <p>
          {credentialsVisible
            ? "Sign in to your LabGear account."
            : stage === "otp"
              ? "Enter the code sent to your registered email address."
              : stage === "authenticated"
                ? "Your LabGear account is authenticated."
                : "The login email was verified, but your browser session needs checking."}
        </p>
      </div>

      {errorMessage && (
        <p className="lg-auth-dev-note" role="alert">
          {errorMessage}
        </p>
      )}
      {infoMessage && (
        <p className="lg-auth-dev-note" role="status">
          {infoMessage}
        </p>
      )}

      {credentialsVisible && (
        <form onSubmit={submitCredentials} noValidate>
          <div className="lg-form-group">
            <label className="lg-label" htmlFor="login-username">
              Username <span className="lg-required">*</span>
            </label>
            <div className="lg-auth-input-wrap">
              <UserRound size={19} />
              <input
                id="login-username"
                className="lg-input"
                type="text"
                placeholder="Enter your username"
                autoComplete="username"
                minLength={6}
                maxLength={17}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setErrorMessage("");
                }}
                disabled={busy}
              />
            </div>
          </div>

          <div className="lg-form-group">
            <label className="lg-label" htmlFor="login-password">
              Password <span className="lg-required">*</span>
            </label>
            <div className="lg-auth-input-wrap">
              <LockKeyhole size={19} />
              <input
                id="login-password"
                className="lg-input"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrorMessage("");
                }}
                disabled={busy}
              />
              <button
                type="button"
                className="lg-auth-eye"
                onClick={() => setShowPassword((previous) => !previous)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                disabled={busy}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </div>

          <div className="lg-auth-forgot">
            <button
              type="button"
              className="lg-auth-forgot-action"
              onClick={onForgotPassword}
              disabled={busy}
            >
              Forgot Password? Reset Here
            </button>
          </div>

          <div className="lg-auth-captcha">
            <ShieldCheck size={22} />
            <div>
              <strong>CAPTCHA Verification</strong>
              <p>Complete the Google checkbox to confirm this login.</p>
              <LoginRecaptcha
                key={captchaInstance}
                onToken={(token) => {
                  setCaptchaToken(token);
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="lg-button lg-button-primary lg-auth-submit"
            disabled={busy || !RECAPTCHA_SITE_KEY}
          >
            {busy ? "Checking credentials..." : "Log-in"}
          </button>
          <p className="lg-auth-dev-note">
            Secure login uses your password, CAPTCHA, and a one-time Gmail code.
          </p>
        </form>
      )}

      {stage === "otp" && (
        <form onSubmit={submitOtp} noValidate>
          <div className="lg-auth-captcha">
            <Mail size={22} />
            <div>
              <strong>Login Email Verification</strong>
              <p>
                Enter the latest six-digit LOGIN code from Gmail, not the
                registration verification code. It expires 3 minutes after
                issuance.
              </p>
            </div>
          </div>
          <div className="lg-form-group">
            <label className="lg-label" htmlFor="login-otp">
              Email verification code <span className="lg-required">*</span>
            </label>
            <div className="lg-auth-input-wrap">
              <LockKeyhole size={19} />
              <input
                id="login-otp"
                className="lg-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={otp}
                onChange={(event) => {
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setErrorMessage("");
                }}
                disabled={busy}
              />
            </div>
          </div>
          <button
            type="submit"
            className="lg-button lg-button-primary lg-auth-submit"
            disabled={busy || otp.length !== 6}
          >
            {busy ? "Verifying..." : "Verify Email and Sign In"}
          </button>
          <div className="lg-auth-forgot">
            <button
              type="button"
              className="lg-auth-forgot-action"
              onClick={resetToCredentials}
              disabled={busy}
            >
              <ArrowLeft size={16} /> Start login again / request a new code
            </button>
          </div>
          <p className="lg-auth-dev-note">
            To request a new code, start login again after the 60-second
            cooldown. Use a fresh CAPTCHA. If a new code is issued, older login
            codes stop working.
          </p>
        </form>
      )}

      {stage === "session-error" && (
        <div>
          <button
            type="button"
            className="lg-button lg-button-primary lg-auth-submit"
            onClick={checkSessionAgain}
            disabled={busy}
          >
            {busy ? "Checking session..." : "Check Session Again"}
          </button>
          <div className="lg-auth-forgot">
            <button
              type="button"
              className="lg-auth-forgot-action"
              onClick={resetToCredentials}
              disabled={busy}
            >
              <ArrowLeft size={16} /> Start login again
            </button>
          </div>
        </div>
      )}

      {stage === "authenticated" && authenticatedUser && (
        <div>
          <div className="lg-auth-captcha">
            <CheckCircle2 size={24} />
            <div>
              <strong>Session active</strong>
              <p>
                Signed in as {authenticatedUser.username} (
                {authenticatedUser.role}).
              </p>
            </div>
          </div>
          <p className="lg-auth-dev-note">
            Your session is stored securely on the server. If your dashboard
            does not open automatically, refresh the page to restore it.
          </p>
          <button
            type="button"
            className="lg-button lg-button-primary lg-auth-submit"
            onClick={signOut}
            disabled={busy}
          >
            {busy ? "Signing out..." : "Sign Out"}
          </button>
        </div>
      )}
    </div>
  );
}
