/**
 * LabGear Frontend File 151 — refresh-persistent login countdown (preserves File 150).
 * Destination: frontend/src/pages/auth/LoginPanel.jsx (REPLACE).
 *
 * Keeps the original LabGear auth classes and Forgot Password navigation.
 * Flow: username/password + Google reCAPTCHA -> Gmail OTP -> session check.
 * The authenticated session lives in a Server HttpOnly cookie; this component
 * never reads or stores that cookie, passwords, or OTPs in browser storage.
 *
 * Preserves the existing verified login and optional onLoginSuccess callback.
 * After Server confirms the session, notify File 96 App.jsx so it rechecks
 * GET /api/auth/me and routes by the server-confirmed role, not browser state.
 * Notify on logout as well. No credentials, OTPs, or roles are broadcast.
 *
 * A browser-side cooldown provides immediate feedback at 3/6/9 rejected
 * login submissions, and honors any server Retry-After header. Because the
 * backend deliberately returns the same 401 for invalid credentials, CAPTCHA,
 * and account lockouts, local counts are UI-only and cannot prove server
 * lockout status. FastAPI/PostgreSQL enforce real account and IP lockouts.
 * A refresh or remount restores the UI-only counter and absolute deadline
 * from this tab's sessionStorage. No passwords, OTPs, CAPTCHA tokens, or
 * session cookies are stored. Do not treat this countdown as an authentication
 * control; PostgreSQL/FastAPI remain authoritative.
 *
 * Required: frontend/.env.local has VITE_LABGEAR_RECAPTCHA_SITE_KEY pointing
 * to the same reCAPTCHA v2 Checkbox registration as the backend secret.
 * Use http://localhost:5173 for React and http://localhost:8000 for Server.
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

// UI-only state, scoped to this browser tab. These values are NOT security
// credentials and do not determine whether the server accepts a login.
const LOGIN_UI_STORAGE_KEY = "labgear:login:cooldown:v1";
const MAX_SAVED_PAUSE_MS = 11 * 60 * 1000; // includes the 10-minute IP ban

function readSavedLoginUi() {
  const empty = { username: "", failedAttempts: 0, pauseUntil: 0 };
  if (typeof window === "undefined") return empty;
  try {
    const data = JSON.parse(
      window.sessionStorage.getItem(LOGIN_UI_STORAGE_KEY) || "null",
    );
    if (!data || data.version !== 1) return empty;
    const username =
      typeof data.username === "string" &&
      /^[A-Za-z][A-Za-z0-9]{5,19}$/.test(data.username)
        ? data.username
        : "";
    if (!username) return empty;
    const failedAttempts =
      Number.isSafeInteger(data.failedAttempts) &&
      data.failedAttempts >= 0 &&
      data.failedAttempts <= 1000
        ? data.failedAttempts
        : 0;
    const now = Date.now();
    const pauseUntil =
      Number.isFinite(data.pauseUntil) &&
      data.pauseUntil > now &&
      data.pauseUntil <= now + MAX_SAVED_PAUSE_MS
        ? data.pauseUntil
        : 0;
    return { username, failedAttempts, pauseUntil };
  } catch {
    return empty; // Browsers can disable sessionStorage.
  }
}

function saveLoginUi(username, failedAttempts, pauseUntil) {
  if (typeof window === "undefined") return;
  try {
    const normalized = username.trim();
    if (
      !/^[A-Za-z][A-Za-z0-9]{5,19}$/.test(normalized) ||
      (failedAttempts === 0 && pauseUntil <= Date.now())
    ) {
      window.sessionStorage.removeItem(LOGIN_UI_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      LOGIN_UI_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        username: normalized,
        failedAttempts,
        pauseUntil,
      }),
    );
  } catch {
    // Failure to save UI feedback must never affect backend authentication.
  }
}

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

/** File 96 App.jsx listens for this and verifies the session with Server. */
function notifyAppSessionChanged() {
  window.dispatchEvent(new Event("labgear:auth-changed"));
}

export default function LoginPanel({ onForgotPassword, onLoginSuccess }) {
  // Restore the absolute expiry; do NOT restart a fresh 15/30/60-second timer.
  const [restoredUi] = useState(readSavedLoginUi);
  const [stage, setStage] = useState("credentials");
  const [username, setUsername] = useState(restoredUi.username);
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
  const [failedAttempts, setFailedAttempts] = useState(
    restoredUi.failedAttempts,
  );
  const failedAttemptsRef = useRef(restoredUi.failedAttempts);
  const [loginPauseUntil, setLoginPauseUntil] = useState(restoredUi.pauseUntil);
  const [timerNow, setTimerNow] = useState(() => Date.now());

  const pauseSeconds = Math.max(
    0,
    Math.ceil((loginPauseUntil - timerNow) / 1000),
  );
  const loginPaused = pauseSeconds > 0;
  const formattedPause = `${String(Math.floor(pauseSeconds / 60)).padStart(2, "0")}:${String(pauseSeconds % 60).padStart(2, "0")}`;

  // Persist after each change. Refreshing the tab restores the same deadline,
  // not a new timer. The backend still enforces the actual lockout.
  useEffect(() => {
    saveLoginUi(username, failedAttempts, loginPauseUntil);
  }, [username, failedAttempts, loginPauseUntil]);

  useEffect(() => {
    if (!loginPauseUntil) return undefined;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setTimerNow(now);
      if (now >= loginPauseUntil) {
        setLoginPauseUntil(0);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [loginPauseUntil]);

  function beginInterfacePause(seconds) {
    const duration = Math.max(1, Math.ceil(seconds));
    const now = Date.now();
    setTimerNow(now);
    setLoginPauseUntil(now + duration * 1000);
  }

  function resetFailedAttemptDisplay() {
    failedAttemptsRef.current = 0;
    setFailedAttempts(0);
    setLoginPauseUntil(0);
    setTimerNow(Date.now());
  }

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
    if (busy || loginPaused) return;
    setErrorMessage("");
    setInfoMessage("");

    if (!/^[A-Za-z][A-Za-z0-9]{5,19}$/.test(username.trim())) {
      setErrorMessage("Enter your LabGear username (6–20 letters or digits).");
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
        "Check your email for the six-digit login code. It expires after 5 minutes.",
      );
    } catch (error) {
      if (
        error?.status === 429 &&
        Number.isFinite(error.retryAfterSeconds) &&
        error.retryAfterSeconds > 0
      ) {
        beginInterfacePause(error.retryAfterSeconds);
        setErrorMessage(
          "Sign-in temporarily unavailable. Retry when the countdown ends.",
        );
      } else if (error?.status === 401) {
        // This counts generic 401 responses only for UI feedback. A 401 can
        // include rejected CAPTCHA/account status, not only wrong passwords.
        // The backend remains authoritative for real failure counters.
        const count = Math.min(1000, failedAttemptsRef.current + 1);
        failedAttemptsRef.current = count;
        setFailedAttempts(count);
        if (count >= 3 && count % 3 === 0) {
          const seconds = count === 3 ? 15 : count === 6 ? 30 : 60;
          beginInterfacePause(seconds);
          setErrorMessage(
            "Sign-in temporarily paused in this browser after repeated rejected attempts.",
          );
        } else {
          setErrorMessage(readableLoginError(error));
        }
      } else {
        setErrorMessage(readableLoginError(error));
      }
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
        resetFailedAttemptDisplay();
        setInfoMessage("Your login is verified and your session is active.");
        notifyAppSessionChanged();
        if (typeof onLoginSuccess === "function") onLoginSuccess(user);
      } catch (sessionError) {
        setStage("session-error");
        setErrorMessage(
          `The email code was accepted, but the browser session could not be confirmed. ` +
            `Use localhost for both React and Server. ${readableLoginError(sessionError)}`,
        );
      }
    } catch (error) {
      if (error?.status === 401) {
        // Server intentionally uses the same error for wrong, expired,
        // revoked, or challenge-cookie-missing OTPs; do not guess which one.
        setErrorMessage(
          "The login code was not accepted. Use the newest LOGIN code from Gmail " +
            "within 5 minutes. If this code is fresh, check that React and " +
            "Server both use localhost and that your browser allows cookies. " +
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
      resetFailedAttemptDisplay();
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
      resetFailedAttemptDisplay();
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
                maxLength={20}
                value={username}
                onChange={(event) => {
                  const nextUsername = event.target.value;
                  // Local attempts belong to the username that triggered them;
                  // switching accounts must not inherit another UI countdown.
                  if (
                    failedAttemptsRef.current > 0 &&
                    nextUsername.trim().toLowerCase() !==
                      username.trim().toLowerCase()
                  ) {
                    resetFailedAttemptDisplay();
                  }
                  setUsername(nextUsername);
                  setErrorMessage("");
                }}
                disabled={busy || loginPaused}
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
                disabled={busy || loginPaused}
              />
              <button
                type="button"
                className="lg-auth-eye"
                onClick={() => setShowPassword((previous) => !previous)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                disabled={busy || loginPaused}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </div>

          {failedAttempts >= 2 && (
            <div className="lg-auth-forgot">
              <button
                type="button"
                className="lg-auth-forgot-action"
                onClick={onForgotPassword}
                disabled={busy || loginPaused}
                aria-disabled={busy || loginPaused}
              >
                Forgot Password? Reset Here
              </button>
            </div>
          )}

          {loginPaused && (
            <div
              role="status"
              aria-live="off"
              style={{
                padding: "14px 16px",
                marginBottom: 16,
                border: "1px solid #f3c2c2",
                borderRadius: 12,
                background: "#fff4f4",
                color: "#802b2b",
                textAlign: "center",
              }}
            >
              <strong>Sign-in temporarily paused</strong>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 750,
                  marginTop: 6,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formattedPause}
              </div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                Login and Forgot Password are disabled until this timer ends.
              </div>
            </div>
          )}

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
            disabled={busy || loginPaused || !RECAPTCHA_SITE_KEY}
          >
            {loginPaused
              ? `Login paused (${formattedPause})`
              : busy
                ? "Checking credentials..."
                : "Log-in"}
          </button>
          <p className="lg-auth-dev-note">
            Secure login uses your password, CAPTCHA, and a one-time Gmail code.
            Server-side security rules remain enforced even if this page is
            reloaded.
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
                registration verification code. It expires 5 minutes after
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
