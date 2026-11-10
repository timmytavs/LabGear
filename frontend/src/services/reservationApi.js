/**
 * LabGear Frontend File 77 — reservation API client.
 *
 * Destination: frontend/src/services/reservationApi.js (CREATE)
 *
 * Reuses the existing File 65 login client:
 *   - getLoginApiBaseUrl()
 *   - getLoginCsrfToken()
 *   - LoginApiError
 *
 * Backend endpoints supplied by Backend File 76:
 *   POST /api/reservations
 *   GET  /api/reservations/my
 *   GET  /api/reservations/pending
 *   POST /api/reservations/{reservation_id}/decision
 */

import {
  getLoginApiBaseUrl,
  getLoginCsrfToken,
  LoginApiError,
} from "./loginApi";

const RESERVATIONS_PATH = "/api/reservations";
const CSRF_HEADER_NAME = "X-CSRF-Token";

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
        : "Check the submitted information and try again.",
      fields,
    };
  }

  return {
    message:
      status >= 500
        ? "LabGear is temporarily unavailable. Please try again."
        : status === 401
          ? "Your session has expired. Please sign in again."
          : "The reservation request could not be completed.",
    fields: [],
  };
}

async function requestJson(path, { method = "GET", body, signal } = {}) {
  const normalizedMethod = method.toUpperCase();
  const headers = { Accept: "application/json" };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod)) {
    const csrfToken = getLoginCsrfToken();

    if (!csrfToken) {
      throw new LoginApiError(
        "Your session security token is missing. Please sign in again.",
        { status: 401 },
      );
    }

    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  let response;

  try {
    response = await fetch(`${getLoginApiBaseUrl()}${path}`, {
      method: normalizedMethod,
      mode: "cors",
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof LoginApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new LoginApiError("The reservation request was cancelled.");
    }

    throw new LoginApiError(
      `Cannot reach LabGear FastAPI. Check ${getLoginApiBaseUrl()} and confirm both sites use the same hostname.`,
    );
  }

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Return a safe error if FastAPI did not return JSON.
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
    throw new LoginApiError(
      "FastAPI returned an unexpected reservation response.",
      { status: response.status },
    );
  }

  return payload;
}

function toIsoDateTime(value, fieldName) {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new LoginApiError(`${fieldName} is required.`);
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new LoginApiError(`${fieldName} is not a valid date and time.`);
  }

  return date.toISOString();
}

function validatePageOptions({ page = 1, pageSize = 10 } = {}) {
  const normalizedPage = Number(page);
  const normalizedPageSize = Number(pageSize);

  if (
    !Number.isInteger(normalizedPage) ||
    normalizedPage < 1 ||
    normalizedPage > 10000
  ) {
    throw new LoginApiError("Page must be between 1 and 10000.");
  }

  if (
    !Number.isInteger(normalizedPageSize) ||
    normalizedPageSize < 1 ||
    normalizedPageSize > 50
  ) {
    throw new LoginApiError("Page size must be between 1 and 50.");
  }

  return {
    page: normalizedPage,
    page_size: normalizedPageSize,
  };
}

/**
 * Submit a reservation request for the authenticated student or instructor.
 */
export async function createReservation(
  { equipmentId, quantity, purpose, reservationStart, reservationEnd },
  options = {},
) {
  const normalizedEquipmentId = Number(equipmentId);
  const normalizedQuantity = Number(quantity);
  const normalizedPurpose = typeof purpose === "string" ? purpose.trim() : "";

  if (
    !Number.isSafeInteger(normalizedEquipmentId) ||
    normalizedEquipmentId <= 0
  ) {
    throw new LoginApiError("Select a valid equipment item.");
  }

  if (
    !Number.isInteger(normalizedQuantity) ||
    normalizedQuantity < 1 ||
    normalizedQuantity > 50
  ) {
    throw new LoginApiError("Quantity must be between 1 and 50.");
  }

  if (normalizedPurpose.length < 5 || normalizedPurpose.length > 1000) {
    throw new LoginApiError(
      "Reservation purpose must contain 5 to 1000 characters.",
    );
  }

  const startIso = toIsoDateTime(reservationStart, "Reservation start");

  const endIso = toIsoDateTime(reservationEnd, "Reservation end");

  if (new Date(startIso).getTime() <= Date.now()) {
    throw new LoginApiError("Reservation start must be in the future.");
  }

  if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
    throw new LoginApiError(
      "Reservation end must be after the reservation start.",
    );
  }

  return requestJson(RESERVATIONS_PATH, {
    method: "POST",
    body: {
      equipment_id: normalizedEquipmentId,
      quantity: normalizedQuantity,
      purpose: normalizedPurpose,
      reservation_start: startIso,
      reservation_end: endIso,
    },
    signal: options.signal,
  });
}

/**
 * Retrieve only the authenticated user's own reservation records.
 */
export async function listMyReservations(pageOptions = {}, options = {}) {
  const pagination = validatePageOptions(pageOptions);

  const query = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.page_size),
  });

  return requestJson(`${RESERVATIONS_PATH}/my?${query.toString()}`, {
    signal: options.signal,
  });
}

/**
 * Retrieve pending requests.
 * FastAPI must enforce the laboratory-technician role.
 */
export async function listPendingReservations(pageOptions = {}, options = {}) {
  const pagination = validatePageOptions(pageOptions);

  const query = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.page_size),
  });

  return requestJson(`${RESERVATIONS_PATH}/pending?${query.toString()}`, {
    signal: options.signal,
  });
}

/**
 * Approve or reject a pending reservation.
 */
export async function decideReservation(
  reservationId,
  { decision, remarks = "" } = {},
  options = {},
) {
  const normalizedId = Number(reservationId);

  if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
    throw new LoginApiError("Select a valid reservation.");
  }

  if (decision !== "approved" && decision !== "rejected") {
    throw new LoginApiError("Choose approve or reject.");
  }

  const normalizedRemarks = typeof remarks === "string" ? remarks.trim() : "";

  if (decision === "rejected" && normalizedRemarks.length < 5) {
    throw new LoginApiError(
      "Provide a rejection reason containing at least 5 characters.",
    );
  }

  if (normalizedRemarks.length > 1000) {
    throw new LoginApiError("Remarks cannot exceed 1000 characters.");
  }

  return requestJson(`${RESERVATIONS_PATH}/${normalizedId}/decision`, {
    method: "POST",
    body: {
      decision,
      remarks: normalizedRemarks || null,
    },
    signal: options.signal,
  });
}
