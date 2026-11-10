/**
 * LabGear Frontend File 100 — password recovery signed public CSRF compatibility.
 * Destination: frontend/src/services/passwordRecoveryApi.js (REPLACE)
 *
 * Connects to Backend Files 84–86:
 *   GET  /api/auth/csrf (new public CSRF token for each POST)
 *   POST /api/auth/password-recovery
 *   POST /api/auth/password-recovery/resend-otp
 *   POST /api/auth/password-recovery/verify-otp
 *   POST /api/auth/password-recovery/reset
 *
 * The backend stores recovery-stage proof in HttpOnly, SameSite=Lax cookies.
 * Every request includes credentials so the browser can receive and return
 * those cookies. JavaScript never reads, stores, or sends the cookie values.
 *
 * Never store passwords, security answers, CAPTCHA tokens, OTPs, or recovery
 * tokens in localStorage, sessionStorage, URLs, or application state beyond
 * the active form interaction.
 *
 * Local development must use the same hostname on both ports:
 *   React:   http://localhost:5173
 *   FastAPI: http://localhost:8000
 *
 * Optional Vite environment variable:
 *   VITE_LABGEAR_API_BASE_URL=http://localhost:8000
 */

const DEFAULT_API_BASE_URL = "http://localhost:8000";

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9]{5,16}$/;
const ANSWER_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const OTP_PATTERN = /^[0-9]{6}$/;
const QUESTION_CODES = new Set(["Q7", "Q2", "Q4"]);
// Match the signed public-token format already accepted by registrationApi.js.
// The token is opaque to the browser: its signature is verified by FastAPI.
const PUBLIC_CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{100,1024}$/;
const PUBLIC_CSRF_MAX_TTL_SECONDS = 10 * 60;

export class PasswordRecoveryApiError extends Error {
  constructor(
    message,
    { status = 0, retryAfterSeconds = null, fields = [] } = {},
  ) {
    super(message);
    this.name = "PasswordRecoveryApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.fields = fields;
  }
}

function isLoopback(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

/**
 * Resolve the API URL at request time.
 *
 * Loopback hostnames are normalized to the React page hostname. This matters
 * because localhost and 127.0.0.1 are different cookie sites; recovery cookies
 * must be issued and returned using the same hostname.
 */
export function getPasswordRecoveryApiBaseUrl() {
  const configured = import.meta.env?.VITE_LABGEAR_API_BASE_URL?.trim();
  let url;

  try {
    url = new URL(configured || DEFAULT_API_BASE_URL);
  } catch {
    throw new PasswordRecoveryApiError(
      "Invalid VITE_LABGEAR_API_BASE_URL configuration.",
    );
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new PasswordRecoveryApiError(
      "Configure the API URL as a plain http(s) origin, without a path or credentials.",
    );
  }

  if (typeof window !== "undefined") {
    const browserHost = window.location.hostname;

    if (isLoopback(browserHost) && isLoopback(url.hostname)) {
      url.hostname = browserHost;
    } else if (browserHost !== url.hostname && isLoopback(url.hostname)) {
      throw new PasswordRecoveryApiError(
        "The recovery API uses a local-only address. Open React on localhost or 127.0.0.1.",
      );
    }
  }

  return url.origin;
}

function readableError(payload, responseStatus) {
  const detail = payload?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return { message: detail.trim(), fields: [] };
  }

  if (Array.isArray(detail)) {
    const fields = detail.slice(0, 5).map((item) => {
      const name = Array.isArray(item?.loc)
        ? String(item.loc[item.loc.length - 1] ?? "form")
        : "form";

      const message =
        typeof item?.msg === "string"
          ? item.msg.replace(/^Value error,\s*/i, "")
          : "Invalid value";

      // Never include item.input; it can contain answers, OTPs, or passwords.
      return { name, message };
    });

    return {
      message: fields.length
        ? fields.map(({ name, message }) => `${name}: ${message}`).join("; ")
        : "Check the submitted form and try again.",
      fields,
    };
  }

  return {
    message:
      responseStatus >= 500
        ? "LabGear is temporarily unavailable. Please try again."
        : "The password recovery request could not be completed.",
    fields: [],
  };
}

function retryAfterSeconds(response) {
  const value = response.headers.get("Retry-After");
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric);
  }

  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }

  return null;
}

async function requestJson(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  // File 100: obtain a fresh signed public CSRF token before EVERY recovery
  // POST. The existing GET /api/auth/csrf is implemented by login.py.
  // The recovery backend must enforce the same token on all four routes.
  if (method.toUpperCase() === "POST") {
    const csrf = await requestJson("/api/auth/csrf", {
      method: "GET",
      signal,
    });
    if (
      typeof csrf.csrf_token !== "string" ||
      !PUBLIC_CSRF_TOKEN_PATTERN.test(csrf.csrf_token) ||
      !Number.isInteger(csrf.expires_in) ||
      csrf.expires_in < 1 ||
      csrf.expires_in > PUBLIC_CSRF_MAX_TTL_SECONDS
    ) {
      throw new PasswordRecoveryApiError(
        "LabGear returned an invalid CSRF token. Refresh and try again.",
      );
    }
    headers["X-CSRF-Token"] = csrf.csrf_token;
  }

  let apiBaseUrl;
  let response;

  try {
    apiBaseUrl = getPasswordRecoveryApiBaseUrl();

    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      mode: "cors",
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof PasswordRecoveryApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new PasswordRecoveryApiError("The request was cancelled.");
    }

    throw new PasswordRecoveryApiError(
      `Cannot reach LabGear FastAPI. Confirm it is running at ${
        apiBaseUrl || DEFAULT_API_BASE_URL
      } and that React and FastAPI use the same hostname.`,
    );
  }

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Non-JSON server/proxy responses receive a safe generic message below.
  }

  if (!response.ok) {
    const { message, fields } = readableError(payload, response.status);

    throw new PasswordRecoveryApiError(message, {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response),
      fields,
    });
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new PasswordRecoveryApiError(
      "FastAPI returned an unexpected password recovery response.",
      { status: response.status },
    );
  }

  return payload;
}

function requireMessageResponse(result, action) {
  if (typeof result.message !== "string" || !result.message.trim()) {
    throw new PasswordRecoveryApiError(
      `FastAPI returned an incomplete ${action} response.`,
    );
  }
  return result;
}

/**
 * Step 1: Verify username, one assigned security answer, and Google CAPTCHA.
 *
 * questionCode must be exactly Q7, Q2, or Q4.
 * The backend sets an HttpOnly recovery challenge cookie when eligible.
 * The response intentionally does not reveal whether the account exists.
 */
export async function startPasswordRecovery(
  { username, questionCode, answer, answerConfirmation, captchaToken },
  options = {},
) {
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username.trim())) {
    throw new PasswordRecoveryApiError(
      "Enter a valid username containing 6–17 letters or digits.",
    );
  }

  if (!QUESTION_CODES.has(questionCode)) {
    throw new PasswordRecoveryApiError(
      "Select one of the assigned security questions.",
    );
  }

  if (
    typeof answer !== "string" ||
    !ANSWER_PATTERN.test(answer.trim()) ||
    answer.trim().length < 2 ||
    answer.trim().length > 50
  ) {
    throw new PasswordRecoveryApiError(
      "Enter a security answer containing 2–50 letters and single spaces.",
    );
  }

  if (
    typeof answerConfirmation !== "string" ||
    !ANSWER_PATTERN.test(answerConfirmation.trim()) ||
    answer.trim() !== answerConfirmation.trim()
  ) {
    throw new PasswordRecoveryApiError(
      "The security answer confirmation does not match.",
    );
  }

  if (
    typeof captchaToken !== "string" ||
    !captchaToken.trim() ||
    captchaToken.length > 8192
  ) {
    throw new PasswordRecoveryApiError(
      "Complete the CAPTCHA verification before continuing.",
    );
  }

  const result = await requestJson("/api/auth/password-recovery", {
    method: "POST",
    body: {
      username: username.trim(),
      question_code: questionCode,
      answer: answer.trim(),
      answer_confirmation: answerConfirmation.trim(),
      captcha_token: captchaToken,
    },
    signal: options.signal,
  });

  requireMessageResponse(result, "password recovery");
  if (result.otp_required !== true) {
    throw new PasswordRecoveryApiError(
      "FastAPI returned an unexpected password recovery challenge.",
    );
  }

  return {
    message: result.message,
    otpRequired: true,
  };
}

/**
 * Step 2a: Request a replacement OTP.
 *
 * The browser automatically sends the HttpOnly recovery challenge cookie.
 * The backend enforces its cooldown and resend limit.
 */
export async function resendPasswordRecoveryOtp(options = {}) {
  const result = await requestJson("/api/auth/password-recovery/resend-otp", {
    method: "POST",
    signal: options.signal,
  });

  requireMessageResponse(result, "OTP resend");

  return {
    message: result.message,
    otpRequired: true,
  };
}

/**
 * Step 2b: Verify the six-digit email OTP.
 *
 * On success, FastAPI replaces the recovery challenge cookie with a
 * short-lived HttpOnly password-reset grant cookie.
 */
export async function verifyPasswordRecoveryOtp(otp, options = {}) {
  if (typeof otp !== "string" || !OTP_PATTERN.test(otp)) {
    throw new PasswordRecoveryApiError(
      "Enter the six-digit email verification code.",
    );
  }

  const result = await requestJson("/api/auth/password-recovery/verify-otp", {
    method: "POST",
    body: { otp },
    signal: options.signal,
  });

  requireMessageResponse(result, "OTP verification");
  if (result.reset_required !== true) {
    throw new PasswordRecoveryApiError(
      "FastAPI did not authorize the password reset step.",
    );
  }

  return {
    message: result.message,
    resetRequired: true,
  };
}

/**
 * Step 3: Submit the new password after successful OTP verification.
 *
 * The HttpOnly reset-grant cookie is sent automatically. The backend checks
 * password policy and the last-three-password reuse rule.
 */
export async function resetPassword(
  { newPassword, confirmPassword },
  options = {},
) {
  if (
    typeof newPassword !== "string" ||
    newPassword.length < 10 ||
    newPassword.length > 64 ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/[0-9]/.test(newPassword) ||
    !/[^A-Za-z0-9]/.test(newPassword)
  ) {
    throw new PasswordRecoveryApiError(
      "Password must contain 10–64 characters, including uppercase, lowercase, a number, and a special character.",
    );
  }

  if (typeof confirmPassword !== "string" || newPassword !== confirmPassword) {
    throw new PasswordRecoveryApiError("Passwords do not match.");
  }

  const result = await requestJson("/api/auth/password-recovery/reset", {
    method: "POST",
    body: {
      new_password: newPassword,
      confirm_password: confirmPassword,
    },
    signal: options.signal,
  });

  requireMessageResponse(result, "password reset");

  if (
    typeof result.notification_sent !== "boolean" ||
    typeof result.sessions_invalidated !== "boolean"
  ) {
    throw new PasswordRecoveryApiError(
      "FastAPI returned an incomplete password reset result.",
    );
  }

  return {
    message: result.message,
    notificationSent: result.notification_sent,
    sessionsInvalidated: result.sessions_invalidated,
  };
}
