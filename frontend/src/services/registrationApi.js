/**
 * LabGear Frontend File 82 — registration client with public CSRF integration.
 * Destination: frontend/src/services/registrationApi.js (REPLACE)
 *
 * Connects to Backend File 81:
 *   GET  /api/auth/csrf
 *   POST /api/auth/register
 *   POST /api/auth/register/verify-otp
 *   POST /api/auth/register/resend-otp
 *
 * Every public registration POST first fetches a fresh, short-lived signed
 * CSRF token and sends it in the X-CSRF-Token header. The token is bound to
 * the browser Origin by the backend and is never stored in browser storage.
 *
 * Registration does not create an authenticated session. No password, OTP,
 * CAPTCHA token, or CSRF token is persisted by this module.
 *
 * Optional Vite environment variable:
 *   VITE_LABGEAR_API_BASE_URL=http://127.0.0.1:8000
 */

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const requestedApiBase = import.meta.env?.VITE_LABGEAR_API_BASE_URL;

export const LABGEAR_API_BASE_URL =
  typeof requestedApiBase === "string" && requestedApiBase.trim()
    ? requestedApiBase.trim().replace(/\/+$/, "")
    : DEFAULT_API_BASE_URL;

const PUBLIC_CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{100,1024}$/;
const PUBLIC_CSRF_MAX_TTL_SECONDS = 10 * 60;
const REGISTRATION_ID_PATTERN = /^\d{4}-\d{4}$/;
const OTP_PATTERN = /^\d{6}$/;

/** An actionable error suitable for displaying beside the React form. */
export class RegistrationApiError extends Error {
  constructor(message, { status = 0, fields = [] } = {}) {
    super(message);
    this.name = "RegistrationApiError";
    this.status = status;
    this.fields = fields;
  }
}

/** Read either Python snake_case or common React camelCase form field names. */
function readField(values, snakeName, ...alternateNames) {
  const camelName = snakeName.replace(/_([a-z])/g, (_, letter) =>
    letter.toUpperCase(),
  );

  for (const name of [snakeName, camelName, ...alternateNames]) {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name];
    }
  }

  return undefined;
}

/**
 * Construct exactly the fields accepted by PublicRegistrationRequest.
 * Unknown form/UI fields are NOT forwarded to the backend. This supports
 * snake_case and camelCase state names without changing the existing UI.
 *
 * captchaToken must be the real token returned by the reCAPTCHA checkbox.
 * NEVER use a test string or put the Google secret key in this frontend file.
 */
export function buildRegistrationPayload(values, captchaToken) {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new RegistrationApiError("Registration form values are missing.");
  }

  const captcha =
    captchaToken ?? readField(values, "captcha_token", "recaptchaToken");

  if (typeof captcha !== "string" || !captcha.trim()) {
    throw new RegistrationApiError(
      "Please complete the CAPTCHA verification before registering.",
    );
  }

  const role = readField(values, "role");
  const rawConsent = readField(values, "privacy_consent", "privacyAccepted");

  return {
    id_number: readField(values, "id_number", "idNumber"),
    first_name: readField(values, "first_name"),
    middle_name: readField(values, "middle_name") || null,
    family_name: readField(values, "family_name", "lastName"),
    name_extension: readField(values, "name_extension", "suffix") || null,
    extension_type: readField(values, "extension_type") || null,
    birthdate: readField(values, "birthdate", "birthDate"),
    purok_street: readField(values, "purok_street", "streetAddress"),
    barangay: readField(values, "barangay"),
    municipality_city: readField(values, "municipality_city", "city"),
    province: readField(values, "province"),
    country: readField(values, "country"),
    zip_code: readField(values, "zip_code", "postalCode"),
    email: readField(values, "email"),
    username: readField(values, "username"),
    password: readField(values, "password"),
    confirm_password: readField(values, "confirm_password"),
    role: typeof role === "string" ? role.toLowerCase() : role,
    department: readField(values, "department"),
    contact_number: readField(values, "contact_number", "phoneNumber"),
    class_section_or_unit: readField(
      values,
      "class_section_or_unit",
      "classSection",
    ),
    security_answer_q7: readField(
      values,
      "security_answer_q7",
      "answerQ7",
      "answer_q7",
    ),
    security_answer_q2: readField(
      values,
      "security_answer_q2",
      "answerQ2",
      "answer_q2",
    ),
    security_answer_q4: readField(
      values,
      "security_answer_q4",
      "answerQ4",
      "answer_q4",
    ),
    privacy_consent: rawConsent === true,
    captcha_token: captcha,
    website: readField(values, "website") ?? "",
  };
}

/** Convert FastAPI errors to a short, non-sensitive message. */
function readErrorMessage(body, responseStatus) {
  const detail = body?.detail;

  if (Array.isArray(detail) && detail.length) {
    const fields = detail.slice(0, 5).map((entry) => {
      const name = Array.isArray(entry?.loc)
        ? String(entry.loc[entry.loc.length - 1] ?? "form")
        : "form";

      const message =
        typeof entry?.msg === "string"
          ? entry.msg.replace(/^Value error,\s*/i, "")
          : "Invalid value";

      // Never include entry.input; it may contain passwords or OTPs.
      return { name, message };
    });

    return {
      message: fields
        .map(({ name, message }) => `${name}: ${message}`)
        .join("; "),
      fields,
    };
  }

  if (typeof detail === "string" && detail.trim()) {
    return { message: detail.trim(), fields: [] };
  }

  return {
    message:
      responseStatus >= 500
        ? "LabGear encountered a server error. Please try again later."
        : "The request could not be completed. Please review the form.",
    fields: [],
  };
}

/**
 * Shared JSON request helper.
 *
 * Public registration uses no authenticated cookies. The signed CSRF token
 * is sent explicitly in a request header and verified by Backend File 81.
 */
async function requestJson(
  path,
  { method = "GET", body, csrfToken, signal } = {},
) {
  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  let response;

  try {
    response = await fetch(`${LABGEAR_API_BASE_URL}${path}`, {
      method,
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new RegistrationApiError("The request was cancelled.");
    }

    throw new RegistrationApiError(
      `Cannot reach the LabGear backend. Confirm FastAPI is running at ${LABGEAR_API_BASE_URL}.`,
    );
  }

  let result = null;

  try {
    result = await response.json();
  } catch {
    // Handle non-JSON proxy/server responses with a safe generic message.
  }

  if (!response.ok) {
    const { message, fields } = readErrorMessage(result, response.status);

    throw new RegistrationApiError(message, {
      status: response.status,
      fields,
    });
  }

  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new RegistrationApiError(
      "The backend returned an unexpected response. Please check FastAPI logs.",
      { status: response.status },
    );
  }

  return result;
}

/**
 * Fetch a new signed token for one public registration POST.
 *
 * The token is intentionally not saved in localStorage or sessionStorage.
 * Fetching a fresh token before each POST keeps the client simple and avoids
 * accidentally reusing an expired or wrong-origin token.
 */
async function fetchPublicCsrfToken({ signal } = {}) {
  const result = await requestJson("/api/auth/csrf", { signal });

  if (
    typeof result.csrf_token !== "string" ||
    !PUBLIC_CSRF_TOKEN_PATTERN.test(result.csrf_token) ||
    !Number.isInteger(result.expires_in) ||
    result.expires_in < 1 ||
    result.expires_in > PUBLIC_CSRF_MAX_TTL_SECONDS
  ) {
    throw new RegistrationApiError(
      "The backend returned an invalid public CSRF challenge.",
    );
  }

  return result.csrf_token;
}

/**
 * POST /api/auth/register.
 * The account remains inactive/pending until email OTP verification.
 */
export async function registerAccount(formValues, captchaToken, options = {}) {
  const payload = buildRegistrationPayload(formValues, captchaToken);
  const csrfToken = await fetchPublicCsrfToken(options);

  return requestJson("/api/auth/register", {
    method: "POST",
    body: payload,
    csrfToken,
    signal: options.signal,
  });
}

/** POST /api/auth/register/verify-otp. */
export async function verifyRegistrationOtp(userId, otp, options = {}) {
  if (typeof userId !== "string" || !REGISTRATION_ID_PATTERN.test(userId)) {
    throw new RegistrationApiError(
      "Enter a valid registration ID (YYYY-NNNN).",
    );
  }

  if (typeof otp !== "string" || !OTP_PATTERN.test(otp)) {
    throw new RegistrationApiError("Enter the six-digit verification code.");
  }

  const csrfToken = await fetchPublicCsrfToken(options);

  return requestJson("/api/auth/register/verify-otp", {
    method: "POST",
    body: { user_id: userId, otp },
    csrfToken,
    signal: options.signal,
  });
}

/**
 * POST /api/auth/register/resend-otp.
 * A fresh CAPTCHA token and a fresh public CSRF token are both required.
 */
export async function resendRegistrationOtp(
  userId,
  captchaToken,
  options = {},
) {
  if (typeof userId !== "string" || !REGISTRATION_ID_PATTERN.test(userId)) {
    throw new RegistrationApiError(
      "Enter a valid registration ID (YYYY-NNNN).",
    );
  }

  if (typeof captchaToken !== "string" || !captchaToken.trim()) {
    throw new RegistrationApiError(
      "Complete a new CAPTCHA verification before requesting another code.",
    );
  }

  const csrfToken = await fetchPublicCsrfToken(options);

  return requestJson("/api/auth/register/resend-otp", {
    method: "POST",
    body: {
      user_id: userId,
      captcha_token: captchaToken,
    },
    csrfToken,
    signal: options.signal,
  });
}
