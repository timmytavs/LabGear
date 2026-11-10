/**
 * LabGear Frontend File 103 — preserve session CSRF across racing session checks.
 * Destination: frontend/src/services/loginApi.js (REPLACE)
 *
 * Implements requests for Backend File 79:
 *   GET  /api/auth/csrf               (short-lived public-form CSRF token)
 *   POST /api/auth/login              (username/password/reCAPTCHA + CSRF)
 *   POST /api/auth/login/verify-otp   (user ID + emailed code + CSRF)
 *   GET  /api/auth/me                 (validate existing session)
 *   POST /api/auth/logout             (session-bound CSRF + revoke cookie)
 *
 * A verified login session is identified ONLY by an HttpOnly cookie set by
 * FastAPI. JavaScript never reads or stores the session cookie.
 *
 * Public-form CSRF tokens are fetched immediately before each unauthenticated
 * login POST and are kept only in the request's local variable. They are not
 * persisted because they expire and are bound to the browser Origin.
 *
 * The authenticated session CSRF token returned after successful OTP
 * verification remains separate and is kept in memory/sessionStorage for
 * authenticated operations such as logout. GET /me must NEVER erase this
 * token on its own: an older 401 response can race with a new OTP login and
 * otherwise remove the valid token while leaving the session cookie active.
 * The token is discarded after a successful server-side logout.
 *
 * Never store passwords, CAPTCHA tokens, or email OTP codes here.
 *
 * Local development must use the SAME hostname on both ports:
 *   React:   http://localhost:5173
 *   FastAPI: http://localhost:8000
 * Vite: VITE_LABGEAR_API_BASE_URL=http://localhost:8000
 */

const DEFAULT_API_BASE_URL = "http://localhost:8000";
const CSRF_STORAGE_KEY = "labgear:login:csrf:v1";
const ID_PATTERN = /^\d{4}-\d{4}$/;
const OTP_PATTERN = /^\d{6}$/;
const PUBLIC_CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{100,1024}$/;
const PUBLIC_CSRF_MAX_TTL_SECONDS = 10 * 60;

let csrfInMemory = null;

export class LoginApiError extends Error {
  constructor(
    message,
    { status = 0, retryAfterSeconds = null, fields = [] } = {},
  ) {
    super(message);
    this.name = "LoginApiError";
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

export function getLoginApiBaseUrl() {
  const configured = import.meta.env?.VITE_LABGEAR_API_BASE_URL?.trim();
  let url;

  try {
    url = new URL(configured || DEFAULT_API_BASE_URL);
  } catch {
    throw new LoginApiError("Invalid VITE_LABGEAR_API_BASE_URL configuration.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new LoginApiError(
      "Configure the API URL as a plain http(s) origin, without a path or credentials.",
    );
  }

  if (typeof window !== "undefined") {
    const browserHost = window.location.hostname;

    if (isLoopback(browserHost) && isLoopback(url.hostname)) {
      url.hostname = browserHost;
    } else if (browserHost !== url.hostname && isLoopback(url.hostname)) {
      throw new LoginApiError(
        "The login API uses a local-only address. Open the React site on localhost or 127.0.0.1.",
      );
    }
  }

  return url.origin;
}

function storage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function setCsrfToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new LoginApiError("FastAPI returned an invalid CSRF token.");
  }

  csrfInMemory = value;

  try {
    storage()?.setItem(CSRF_STORAGE_KEY, value);
  } catch {
    // Private browsing may disable storage.
  }
}

export function getLoginCsrfToken() {
  if (csrfInMemory) return csrfInMemory;

  try {
    const value = storage()?.getItem(CSRF_STORAGE_KEY);

    if (typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)) {
      csrfInMemory = value;
      return value;
    }
  } catch {
    // No persistent tab storage available.
  }

  return null;
}

export function clearLoginCsrfToken() {
  csrfInMemory = null;

  try {
    storage()?.removeItem(CSRF_STORAGE_KEY);
  } catch {
    // No persistent tab storage available.
  }
}

function readableError(payload, status) {
  const detail = payload?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return { message: detail, fields: [] };
  }

  if (Array.isArray(detail)) {
    const fields = detail.slice(0, 5).map((item) => ({
      name: Array.isArray(item?.loc)
        ? String(item.loc[item.loc.length - 1] ?? "form")
        : "form",
      message:
        typeof item?.msg === "string"
          ? item.msg.replace(/^Value error,\s*/i, "")
          : "Invalid value",
    }));

    return {
      message: fields.length
        ? fields.map(({ name, message }) => `${name}: ${message}`).join("; ")
        : "Check the submitted form and try again.",
      fields,
    };
  }

  return {
    message:
      status >= 500
        ? "LabGear is temporarily unavailable. Please try again."
        : "Request failed. Check your information and try again.",
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

async function requestJson(
  path,
  { method = "GET", body, csrfToken, signal } = {},
) {
  const headers = { Accept: "application/json" };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response;

  try {
    response = await fetch(`${getLoginApiBaseUrl()}${path}`, {
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
    if (error instanceof LoginApiError) throw error;

    if (error?.name === "AbortError") {
      throw new LoginApiError("The request was cancelled.");
    }

    throw new LoginApiError(
      `Cannot reach LabGear FastAPI. Check ${getLoginApiBaseUrl()} and confirm both sites use the same hostname.`,
    );
  }

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Non-JSON HTTP errors get a safe generic message.
  }

  if (!response.ok) {
    const { message, fields } = readableError(payload, response.status);

    throw new LoginApiError(message, {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response),
      fields,
    });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LoginApiError("FastAPI returned an unexpected response.", {
      status: response.status,
    });
  }

  return payload;
}

/**
 * Fetch a fresh short-lived token for a public login POST.
 * This is different from the authenticated session CSRF token.
 */
async function fetchPublicCsrfToken(options = {}) {
  const result = await requestJson("/api/auth/csrf", {
    signal: options.signal,
  });

  if (
    typeof result.csrf_token !== "string" ||
    !PUBLIC_CSRF_TOKEN_PATTERN.test(result.csrf_token) ||
    !Number.isInteger(result.expires_in) ||
    result.expires_in < 1 ||
    result.expires_in > PUBLIC_CSRF_MAX_TTL_SECONDS
  ) {
    throw new LoginApiError(
      "FastAPI returned an invalid public CSRF challenge.",
    );
  }

  return result.csrf_token;
}

/**
 * Step 1: password + CAPTCHA.
 * This is NOT a completed login.
 */
export async function startLogin(
  { username, password, captchaToken },
  options = {},
) {
  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    !password ||
    typeof captchaToken !== "string" ||
    !captchaToken.trim()
  ) {
    throw new LoginApiError(
      "Enter your username and password, then complete CAPTCHA.",
    );
  }

  const publicCsrfToken = await fetchPublicCsrfToken(options);

  const result = await requestJson("/api/auth/login", {
    method: "POST",
    csrfToken: publicCsrfToken,
    body: {
      username: username.trim(),
      password,
      captcha_token: captchaToken,
    },
    signal: options.signal,
  });

  if (!ID_PATTERN.test(result.user_id) || result.otp_required !== true) {
    throw new LoginApiError("FastAPI returned an unexpected login challenge.");
  }

  return result;
}

/** Step 2: complete emailed OTP; FastAPI sets HttpOnly session. */
export async function verifyLoginOtp(userId, otp, options = {}) {
  if (typeof userId !== "string" || !ID_PATTERN.test(userId)) {
    throw new LoginApiError("Invalid login challenge. Start login again.");
  }

  if (typeof otp !== "string" || !OTP_PATTERN.test(otp)) {
    throw new LoginApiError("Enter the six-digit email verification code.");
  }

  const publicCsrfToken = await fetchPublicCsrfToken(options);

  const result = await requestJson("/api/auth/login/verify-otp", {
    method: "POST",
    csrfToken: publicCsrfToken,
    body: { user_id: userId, otp },
    signal: options.signal,
  });

  if (
    !result.user?.user_id ||
    !result.user?.username ||
    !result.user?.role ||
    !result.csrf_token
  ) {
    throw new LoginApiError(
      "FastAPI returned an incomplete authenticated session.",
    );
  }

  setCsrfToken(result.csrf_token);

  return {
    message: result.message,
    user: result.user,
  };
}

/**
 * Validate the HttpOnly session cookie against FastAPI.
 *
 * Important: do NOT clear the session CSRF token after a 401 here. Several
 * screens request /me concurrently; a 401 that started before successful
 * login can arrive after verifyLoginOtp stored the new token. Removing the
 * token in that case makes logout fail with 403 even though /me later shows
 * 200. The token is never authorization by itself; the backend always
 * requires the matching live HttpOnly session cookie.
 */
export async function getCurrentUser(options = {}) {
  return requestJson("/api/auth/me", {
    signal: options.signal,
  });
}

/**
 * Revoke the server-side session with its matching authenticated CSRF token.
 * Do not send an unprotected logout request or accept a public-form token
 * here. Clear the local copy only once FastAPI confirms logout succeeded.
 */
export async function logout(options = {}) {
  const token = getLoginCsrfToken();
  if (!token) {
    throw new LoginApiError(
      "The logout security token is missing. Sign in again using your password and email OTP to renew it, then sign out.",
      { status: 403 },
    );
  }

  const result = await requestJson("/api/auth/logout", {
    method: "POST",
    csrfToken: token,
    signal: options.signal,
  });

  clearLoginCsrfToken();
  return result;
}
