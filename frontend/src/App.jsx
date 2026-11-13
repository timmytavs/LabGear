/**
 * LabGear Frontend File 128 — reservation cancellation with preserved File 126 functionality.
 * REPLACE: frontend/src/App.jsx
 *
 * Preserves the existing landing page, authentication, admin monitoring,
 * existing student reservation workspace and development-only dashboard preview.
 * Reads the current account from FastAPI GET /api/auth/me; never trusts a
 * browser-stored role. The admin monitoring API independently enforces admin
 * permission and records dashboard access/denials.
 *
 * A later LandingPage/LoginPanel integration step will dispatch
 * "labgear:auth-changed" after the email OTP login completes, so the app
 * navigates immediately without requiring a page reload. This file also
 * refreshes the session after a browser focus/visibility change and on reload.
 *
 * Preserves File 111's working Quick Reservation form and My Reservations.
 * File 112's pending approval/rejection workflow remains unchanged.
 * File 118 adds technician-only inventory management using File 116 routes.
 * File 122 adds admin-only user listing and technician role assignment using File 120 routes.
 * File 124 connects per-unit damage/repair actions to the File 123
 * PATCH /api/technician/inventory/{equipment_id}/units/{unit_id}/condition endpoint.
 * File 126 adds a read-only paginated damage/repair audit view using File 125.
 * File 128 lets students and instructors cancel their own pending/approved
 * reservations via File 127. Existing frontend modules are preserved.
 * Existing auth, inventory actions, reservations, and admin screens are preserved.
 * Requires File 117 to mount the inventory API in FastAPI.
 * File 114 connects the existing File 113 technician backend endpoints:
 * GET /api/reservations/active, POST /api/reservations/{id}/issue and
 * POST /api/reservations/{id}/return. Only the technician workspace changes.
 * Authorization, CSRF, allocations, issue/return status and audit logs remain
 * enforced by FastAPI and committed to PostgreSQL.
 * Equipment catalog's existing preview-only modal remains unchanged.
 *
 * IMPORTANT: do not put admin self-registration into the public form.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import LandingPage from "./pages/LandingPage";
import DashboardPreview from "./components/layout/DashboardLayout";
import AdminSecurityDashboard from "./pages/admin/AdminSecurityDashboard";
import EquipmentCatalog from "./pages/EquipmentCatalog";
import {
  getCurrentUser,
  getLoginApiBaseUrl,
  getLoginCsrfToken,
  logout as logoutSession,
} from "./services/loginApi";

const ADMIN_PATH = "/admin/monitoring";
const TECHNICIAN_PATH = "/technician";
const USER_PATH = "/dashboard";
const HOME_PATH = "/home";
const SUPPORTED_ROLES = new Set([
  "admin",
  "technician",
  "lab_technician",
  "laboratory_technician",
  "student",
  "instructor",
]);

function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function roleDestination(role) {
  if (role === "admin") return ADMIN_PATH;
  if (
    ["technician", "lab_technician", "laboratory_technician"].includes(role)
  ) {
    return TECHNICIAN_PATH;
  }
  if (role === "student" || role === "instructor") return USER_PATH;
  return HOME_PATH;
}

function normalizeAccount(data) {
  const role =
    typeof data?.role === "string" ? data.role.trim().toLowerCase() : "";
  const username =
    typeof data?.username === "string" ? data.username.trim() : "";
  const userId = typeof data?.user_id === "string" ? data.user_id : "";
  const expiry =
    typeof data?.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
  if (
    !userId ||
    !username ||
    !SUPPORTED_ROLES.has(role) ||
    !Number.isFinite(expiry) ||
    expiry <= Date.now()
  ) {
    throw new Error("FastAPI returned an invalid authenticated account.");
  }
  return { userId, username, role, expiresAt: data.expires_at };
}

const boxStyle = {
  minHeight: "100vh",
  background: "#f4f7fc",
  color: "#14243e",
  fontFamily: "Inter, system-ui, sans-serif",
  padding: "clamp(24px, 5vw, 60px)",
};

const buttonStyle = {
  border: "1px solid #c8d7ef",
  borderRadius: 10,
  background: "#fff",
  color: "#21467b",
  padding: "10px 15px",
  font: "600 14px Inter, system-ui, sans-serif",
  cursor: "pointer",
};

function PageNotice({ title, detail, onBack, onRetry, busy }) {
  return (
    <main style={boxStyle}>
      <div
        style={{
          maxWidth: 590,
          margin: "65px auto",
          background: "white",
          padding: 30,
          border: "1px solid #dbe4f2",
          borderRadius: 16,
        }}
        role="status"
      >
        <h1 style={{ fontSize: 24, marginTop: 0 }}>{title}</h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>{detail}</p>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}
        >
          {onRetry && (
            <button
              type="button"
              style={buttonStyle}
              onClick={onRetry}
              disabled={busy}
            >
              Retry
            </button>
          )}
          {onBack && (
            <button type="button" style={buttonStyle} onClick={onBack}>
              Return to LabGear
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function WorkspaceHeader({ account, title, busy, onLogout, onHome }) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 14,
        alignItems: "center",
        background: "#fff",
        padding: "15px 24px",
        borderBottom: "1px solid #dbe4f2",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div>
        <strong style={{ color: "#245ff2" }}>LabGear</strong>
        <span style={{ marginLeft: 12, color: "#344763" }}>{title}</span>
        <div style={{ fontSize: 12, color: "#71819a" }}>
          {account.username} · {account.role.replaceAll("_", " ")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 9 }}>
        <button type="button" onClick={onHome} style={buttonStyle}>
          Home
        </button>
        <button
          type="button"
          onClick={onLogout}
          disabled={busy}
          style={buttonStyle}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}

// Only the browser holds the session-specific CSRF token. Authentication,
// reservation ownership, role checks and capacity are enforced by FastAPI.
async function reservationApi(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") {
    const csrfToken = getLoginCsrfToken();
    if (!csrfToken) {
      throw new Error(
        "Your reservation security token is missing. Sign in again.",
      );
    }
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = csrfToken;
  }
  let response;
  try {
    response = await fetch(`${getLoginApiBaseUrl()}${path}`, {
      method,
      mode: "cors",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(
      "Unable to connect to LabGear FastAPI. Check that the backend is running.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    let message = typeof detail === "string" ? detail.trim() : "";
    if (!message && Array.isArray(detail)) {
      message = detail
        .slice(0, 4)
        .map((item) => {
          const field = Array.isArray(item?.loc)
            ? String(item.loc[item.loc.length - 1] || "form").replaceAll(
                "_",
                " ",
              )
            : "form";
          const problem =
            typeof item?.msg === "string"
              ? item.msg.replace(/^Value error,\s*/i, "")
              : "Invalid value";
          return `${field}: ${problem}`;
        })
        .join("; ");
    }
    if (!message) {
      message =
        response.status === 401
          ? "Your session has expired. Sign in again."
          : response.status === 403
            ? "Reservation was denied. Your login security token may be invalid; sign in again."
            : response.status === 409
              ? "The requested units are unavailable for those dates. Choose different dates or fewer units."
              : response.status === 422
                ? "Check the dates, quantity and reservation details."
                : `LabGear request failed (HTTP ${response.status}).`;
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadEquipmentOptions(signal) {
  const first = await reservationApi("/api/equipment?page=1&page_size=50", {
    signal,
  });
  if (!Array.isArray(first?.items) || !Number.isInteger(first?.pages)) {
    throw new Error(
      "LabGear returned an unexpected equipment catalog response.",
    );
  }
  if (first.pages > 100) {
    throw new Error(
      "The catalog is too large to load into this reservation form.",
    );
  }
  const items = [...first.items];
  for (let page = 2; page <= first.pages; page += 1) {
    const data = await reservationApi(
      `/api/equipment?page=${page}&page_size=50`,
      { signal },
    );
    if (!Array.isArray(data?.items))
      throw new Error("An equipment page was invalid.");
    items.push(...data.items);
  }
  return items;
}

const reservationPanel = {
  background: "#fff",
  border: "1px solid #dbe4f2",
  borderRadius: 16,
  padding: "clamp(18px, 3vw, 28px)",
  boxShadow: "0 5px 20px rgba(29, 54, 89, 0.04)",
};
const formControl = {
  width: "100%",
  minHeight: 42,
  padding: "10px 12px",
  border: "1px solid #ccd8ea",
  borderRadius: 9,
  color: "#14243e",
  font: "inherit",
  background: "#fff",
  boxSizing: "border-box",
};
const labelControl = {
  display: "grid",
  gap: 7,
  fontWeight: 600,
  fontSize: 14,
  color: "#263f63",
};

// datetime-local expects local wall-clock time, not a UTC ISO string.
function toLocalDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Select a future demo-ready window; users can still change either field.
function freshReservationDraft() {
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
    9,
    0,
  );
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
    11,
    0,
  );
  return {
    equipment_id: "",
    quantity: "1",
    reservation_start: toLocalDateTimeValue(start),
    reservation_end: toLocalDateTimeValue(end),
    purpose: "",
  };
}

function StudentReservationWorkspace({ account, onSessionExpired }) {
  const [view, setView] = useState("catalog");
  const [equipment, setEquipment] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState(freshReservationDraft);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancellingId, setCancellingId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadingError("");
    Promise.all([
      loadEquipmentOptions(controller.signal),
      reservationApi("/api/reservations/my?page=1&page_size=50", {
        signal: controller.signal,
      }),
    ])
      .then(([catalog, reservations]) => {
        if (!active) return;
        if (!Array.isArray(reservations?.items)) {
          throw new Error("LabGear returned an unexpected reservation list.");
        }
        setEquipment(catalog);
        setHistory(reservations.items);
        setHistoryTotal(Number(reservations.total) || 0);
      })
      .catch((error) => {
        if (!active || error?.name === "AbortError") return;
        setLoadingError(
          error?.message || "Failed to load reservation information.",
        );
        if (error?.status === 401) onSessionExpired();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reload, onSessionExpired]);

  const selected = equipment.find(
    (item) => String(item.id) === draft.equipment_id,
  );
  const available = Number(selected?.available_units) || 0;
  const minimumStart = toLocalDateTimeValue(new Date(Date.now() + 60_000));
  const minimumEnd =
    draft.reservation_start > minimumStart
      ? draft.reservation_start
      : minimumStart;

  function changeReservationField(field, value) {
    setDraft((previous) => ({
      ...previous,
      [field]: value,
      ...(field === "equipment_id" ? { quantity: "1" } : {}),
    }));
    setFeedback("");
  }

  const dateText = (dateString) => {
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  };

  async function submitReservation(event) {
    event.preventDefault();
    if (submitting) return;
    setFeedback("");
    const quantity = Number(draft.quantity);
    const start = new Date(draft.reservation_start);
    const end = new Date(draft.reservation_end);
    if (!selected || available < 1) {
      setFeedback("Select equipment with available units.");
      return;
    }
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > Math.min(50, available)
    ) {
      setFeedback(
        "Enter a quantity between 1 and the available stock (maximum 50).",
      );
      return;
    }
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
      setFeedback(
        "Reservation start must be in the future. Choose a later date and time.",
      );
      return;
    }
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      setFeedback("Reservation end must be after the reservation start.");
      return;
    }
    if (draft.purpose.trim().length < 5 || draft.purpose.trim().length > 1000) {
      setFeedback("Describe the reservation purpose using 5–1000 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await reservationApi("/api/reservations", {
        method: "POST",
        body: {
          equipment_id: selected.id,
          quantity,
          purpose: draft.purpose.trim(),
          reservation_start: start.toISOString(),
          reservation_end: end.toISOString(),
        },
      });
      if (!created?.reservation_code || created?.status !== "pending") {
        throw new Error(
          "FastAPI did not confirm the pending reservation. Check My Reservations before retrying.",
        );
      }
      setDraft(freshReservationDraft());
      setFeedback(
        `Reservation ${created.reservation_code || ""} submitted. Status: ${created.status || "pending"}.`,
      );
      setView("history");
      setReload((value) => value + 1);
    } catch (error) {
      setFeedback(error?.message || "Could not submit your reservation.");
      if (error?.status === 401) onSessionExpired();
    } finally {
      setSubmitting(false);
    }
  }

  // File 128: only the booking owner can cancel; FastAPI rechecks owner,
  // role, status and CSRF inside one database transaction.
  function beginCancellation(item) {
    if (!item || !["pending", "approved"].includes(item.status)) return;
    if (cancellingId !== null) return;
    setCancelTarget(item);
    setCancelReason("");
    setCancelError("");
    setFeedback("");
  }

  async function confirmCancellation(event) {
    event.preventDefault();
    if (!cancelTarget || cancellingId !== null) return;
    const reservationId = Number(cancelTarget.id);
    if (!Number.isSafeInteger(reservationId) || reservationId <= 0) {
      setCancelError("Invalid reservation ID. Refresh your reservations.");
      return;
    }
    setCancellingId(reservationId);
    setCancelError("");
    setFeedback("");
    try {
      const result = await reservationApi(
        `/api/reservations/${encodeURIComponent(reservationId)}/cancel`,
        { method: "POST", body: { reason: cancelReason.trim() || null } },
      );
      if (
        result?.status !== "cancelled" ||
        Number(result?.reservation_id) !== reservationId
      ) {
        throw new Error(
          "The server returned an unexpected cancellation response. Refresh My Reservations before trying again.",
        );
      }
      // Update only after a verified FastAPI response, then re-read PostgreSQL.
      setHistory((previous) =>
        previous.map((entry) =>
          entry.id === reservationId
            ? { ...entry, status: "cancelled" }
            : entry,
        ),
      );
      setFeedback(
        `Reservation ${result.reservation_code} cancelled successfully.` +
          (result.released_units > 0
            ? ` ${result.released_units} allocation(s) released.`
            : ""),
      );
      setCancelTarget(null);
      setCancelReason("");
      setReload((value) => value + 1);
    } catch (error) {
      setCancelError(error?.message || "Could not cancel the reservation.");
      if (error?.status === 401) onSessionExpired();
      // The technician may have issued or changed this booking meanwhile.
      if (error?.status === 409) setReload((value) => value + 1);
    } finally {
      setCancellingId(null);
    }
  }

  const tabButton = (name, caption) => (
    <button
      type="button"
      onClick={() => {
        setView(name);
        setFeedback("");
        setCancelTarget(null);
        setCancelError("");
      }}
      aria-pressed={view === name}
      style={{
        ...buttonStyle,
        background: view === name ? "#245ff2" : "#fff",
        color: view === name ? "#fff" : "#21467b",
        borderColor: view === name ? "#245ff2" : "#c8d7ef",
      }}
    >
      {caption}
    </button>
  );

  return (
    <main style={{ ...boxStyle, minHeight: "calc(100vh - 75px)" }}>
      <div
        style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 22 }}
      >
        <div>
          <div
            style={{
              color: "#245ff2",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            LABGEAR · {account.role.toUpperCase()} WORKSPACE
          </div>
          <h1 style={{ margin: "8px 0", fontSize: "clamp(26px, 4vw, 36px)" }}>
            Laboratory Equipment Reservations
          </h1>
          <p style={{ color: "#60748e", lineHeight: 1.6, margin: 0 }}>
            Welcome, {account.username}. Browse inventory, request equipment and
            check the status of your requests.
          </p>
        </div>
        <nav
          aria-label="Reservation workspace sections"
          style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
        >
          {tabButton("catalog", "Equipment Catalog")}
          {tabButton("new", "Quick Reservation")}
          {tabButton("history", "My Reservations")}
          <button
            type="button"
            style={{ ...buttonStyle, marginLeft: "auto" }}
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh data"}
          </button>
        </nav>
        {loadingError && (
          <div role="alert" style={{ ...reservationPanel, color: "#a52d2d" }}>
            {loadingError}{" "}
            <button
              type="button"
              style={buttonStyle}
              onClick={() => setReload((v) => v + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {feedback && view !== "new" && (
          <div role="status" style={{ ...reservationPanel, color: "#166534" }}>
            {feedback}
          </div>
        )}
        {view === "catalog" && (
          <section aria-label="Live equipment catalog">
            <EquipmentCatalog role={account.role} />
            <p style={{ color: "#60748e", fontSize: 13, lineHeight: 1.6 }}>
              The catalog's existing “Preview Request” button does not save a
              reservation yet. Select <strong>Quick Reservation</strong> above
              to submit a real request to PostgreSQL.
            </p>
          </section>
        )}
        {view === "new" && (
          <section
            style={{ ...reservationPanel, maxWidth: 750 }}
            aria-label="New reservation form"
          >
            <h2 style={{ marginTop: 0 }}>Submit a Reservation</h2>
            <p style={{ color: "#60748e", lineHeight: 1.6 }}>
              Requests are saved in PostgreSQL as pending until a technician
              reviews them. Available stock is rechecked by the server for your
              selected dates.
            </p>
            {loading ? (
              <p>Loading equipment choices…</p>
            ) : (
              <form
                noValidate
                onSubmit={submitReservation}
                style={{ display: "grid", gap: 18 }}
              >
                <label style={labelControl}>
                  Equipment *
                  <select
                    style={formControl}
                    required
                    value={draft.equipment_id}
                    onChange={(e) =>
                      changeReservationField("equipment_id", e.target.value)
                    }
                  >
                    <option value="">Choose equipment</option>
                    {equipment
                      .filter((item) => Number(item.available_units) > 0)
                      .map((item) => (
                        <option key={item.id} value={String(item.id)}>
                          {item.equipment_name} ({item.equipment_code}) —{" "}
                          {item.available_units} available
                        </option>
                      ))}
                  </select>
                </label>
                {selected && (
                  <p style={{ margin: 0, color: "#60748e" }}>
                    Available now: <strong>{available}</strong> units.
                    Date-range capacity is checked when submitting.
                  </p>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                    gap: 16,
                  }}
                >
                  <label style={labelControl}>
                    Quantity *
                    <input
                      style={formControl}
                      type="number"
                      min="1"
                      max={Math.min(50, available || 50)}
                      required
                      value={draft.quantity}
                      onChange={(e) =>
                        changeReservationField("quantity", e.target.value)
                      }
                    />
                  </label>
                  <div aria-hidden="true" />
                  <label style={labelControl}>
                    Reservation Start *
                    <input
                      style={formControl}
                      type="datetime-local"
                      required
                      min={minimumStart}
                      value={draft.reservation_start}
                      onChange={(e) =>
                        changeReservationField(
                          "reservation_start",
                          e.target.value,
                        )
                      }
                    />
                  </label>
                  <label style={labelControl}>
                    Reservation End *
                    <input
                      style={formControl}
                      type="datetime-local"
                      required
                      min={minimumEnd}
                      value={draft.reservation_end}
                      onChange={(e) =>
                        changeReservationField(
                          "reservation_end",
                          e.target.value,
                        )
                      }
                    />
                  </label>
                </div>
                <label style={labelControl}>
                  Purpose *
                  <textarea
                    style={{
                      ...formControl,
                      minHeight: 110,
                      resize: "vertical",
                    }}
                    required
                    minLength={5}
                    maxLength={1000}
                    value={draft.purpose}
                    placeholder="Describe the laboratory experiment or class activity"
                    onChange={(e) =>
                      changeReservationField("purpose", e.target.value)
                    }
                  />
                </label>
                <p style={{ color: "#60748e", margin: 0, fontSize: 13 }}>
                  Dates use your device's local time. Start must be in the
                  future; the reservation is saved only after FastAPI confirms
                  it.
                </p>
                {equipment.length === 0 && (
                  <p style={{ color: "#9b1c1c" }}>
                    No reservable equipment loaded. Add active inventory or
                    retry the catalog connection.
                  </p>
                )}
                {feedback && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    style={{
                      background: "#fff1f2",
                      border: "1px solid #fecdd3",
                      color: "#9f1239",
                      borderRadius: 9,
                      padding: "12px 14px",
                      lineHeight: 1.5,
                    }}
                  >
                    {feedback}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submitting || equipment.length === 0}
                  style={{
                    ...buttonStyle,
                    background: "#245ff2",
                    color: "#fff",
                    borderColor: "#245ff2",
                    justifySelf: "start",
                    opacity: submitting ? 0.65 : 1,
                  }}
                >
                  {submitting ? "Submitting…" : "Submit Reservation"}
                </button>
              </form>
            )}
          </section>
        )}
        {view === "history" && (
          <section style={reservationPanel} aria-label="My reservation history">
            <h2 style={{ marginTop: 0 }}>My Reservations</h2>
            <p style={{ color: "#60748e" }}>
              Only your own requests are returned by FastAPI.
              {historyTotal > 50
                ? ` Showing 50 most recent of ${historyTotal} requests.`
                : ""}
            </p>
            {cancelTarget && (
              <form
                onSubmit={confirmCancellation}
                aria-label="Confirm reservation cancellation"
                style={{
                  border: "1px solid #f6c5c5",
                  background: "#fff8f7",
                  padding: 18,
                  borderRadius: 12,
                  marginBottom: 18,
                  display: "grid",
                  gap: 12,
                }}
              >
                <strong style={{ color: "#8b2525" }}>
                  Cancel reservation {cancelTarget.reservation_code}?
                </strong>
                <div
                  style={{ color: "#5e6472", fontSize: 14, lineHeight: 1.5 }}
                >
                  This will cancel your {cancelTarget.status} request for{" "}
                  {cancelTarget.equipment_name}.
                  {cancelTarget.status === "approved"
                    ? " Allocated units will be released when they are not needed by another active booking."
                    : ""}{" "}
                  This cannot be undone; you can make a new reservation later.
                </div>
                <label style={labelControl}>
                  Reason (optional, up to 500 characters)
                  <textarea
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    maxLength={500}
                    rows={3}
                    disabled={cancellingId !== null}
                    placeholder="Why are you cancelling this reservation?"
                    style={{ ...formControl, resize: "vertical" }}
                  />
                </label>
                {cancelError && (
                  <div role="alert" style={{ color: "#a52d2d", fontSize: 14 }}>
                    {cancelError}
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <button
                    type="submit"
                    disabled={cancellingId !== null || loading}
                    style={{
                      ...buttonStyle,
                      background: "#a72e2e",
                      borderColor: "#a72e2e",
                      color: "#fff",
                    }}
                  >
                    {cancellingId !== null
                      ? "Cancelling…"
                      : "Confirm Cancellation"}
                  </button>
                  <button
                    type="button"
                    disabled={cancellingId !== null}
                    onClick={() => {
                      setCancelTarget(null);
                      setCancelReason("");
                      setCancelError("");
                    }}
                    style={buttonStyle}
                  >
                    Keep Reservation
                  </button>
                </div>
              </form>
            )}
            {loading ? (
              <p>Loading your requests…</p>
            ) : history.length === 0 ? (
              <div style={{ color: "#60748e", padding: "18px 0" }}>
                No reservations yet. Select Quick Reservation to submit your
                first request.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 790,
                    fontSize: 14,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#f3f7fd", textAlign: "left" }}>
                      {[
                        "Reservation Code",
                        "Equipment",
                        "Qty",
                        "Start",
                        "End",
                        "Status",
                        "Action",
                      ].map((title) => (
                        <th
                          key={title}
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #dbe4f2",
                          }}
                        >
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={item.id}>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                            fontWeight: 600,
                          }}
                        >
                          {item.reservation_code}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {item.equipment_name}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {item.quantity}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {dateText(item.reservation_start)}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {dateText(item.reservation_end)}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                            textTransform: "capitalize",
                          }}
                        >
                          {String(item.status || "unknown").replaceAll(
                            "_",
                            " ",
                          )}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {["pending", "approved"].includes(item.status) ? (
                            <button
                              type="button"
                              disabled={cancellingId !== null || loading}
                              onClick={() => beginCancellation(item)}
                              aria-label={`Cancel reservation ${item.reservation_code}`}
                              style={{
                                ...buttonStyle,
                                color: "#9b2323",
                                borderColor: "#dbaaaa",
                                background: "#fff8f7",
                              }}
                            >
                              Cancel
                            </button>
                          ) : (
                            <span style={{ color: "#8490a0" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

// File 114: equipment handover and returns use the existing File 113 routes.
// Only backend responses can confirm an issuance or a return. Nothing is
// persisted locally and no inventory status is ever fabricated by the UI.
function TechnicianHandoverPanel({ refreshToken, onSessionExpired }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [issuingId, setIssuingId] = useState(null);
  const [returningId, setReturningId] = useState(null);
  const [condition, setCondition] = useState("good");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError("");
    reservationApi(`/api/reservations/active?page=${page}&page_size=10`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!active) return;
        if (
          !Array.isArray(data?.items) ||
          !Number.isInteger(data?.total) ||
          !Number.isInteger(data?.pages)
        ) {
          throw new Error(
            "LabGear returned an invalid equipment handover list.",
          );
        }
        setItems(data.items);
        setTotal(data.total);
        setPages(data.pages);
        if (page > 1 && page > Math.max(1, data.pages)) {
          setPage(Math.max(1, data.pages));
        }
      })
      .catch((error) => {
        if (!active || error?.name === "AbortError") return;
        const message =
          error?.status === 404
            ? "The handover API is not available yet. Confirm Backend File 113 is installed and FastAPI has restarted."
            : error?.message ||
              "Unable to load approved and issued reservations.";
        setLoadError(message);
        setItems([]);
        if (error?.status === 401) onSessionExpired();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, reload, refreshToken, onSessionExpired]);

  const refreshList = () => setReload((value) => value + 1);
  const showDate = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
  };

  function openIssue(id) {
    if (busyId !== null) return;
    setIssuingId(id);
    setReturningId(null);
    setNotice(null);
  }

  function openReturn(id) {
    if (busyId !== null) return;
    setReturningId(id);
    setIssuingId(null);
    setCondition("good");
    setRemarks("");
    setNotice(null);
  }

  async function issueEquipment(item) {
    if (busyId !== null || item.status !== "approved") return;
    setBusyId(item.id);
    setNotice(null);
    try {
      const result = await reservationApi(
        `/api/reservations/${encodeURIComponent(item.id)}/issue`,
        { method: "POST" },
      );
      if (result?.reservation_id !== item.id || result?.status !== "issued") {
        throw new Error(
          "FastAPI did not confirm issuance. Refresh before attempting it again.",
        );
      }
      const tags = Array.isArray(result.asset_tags)
        ? result.asset_tags.filter(Boolean)
        : [];
      setNotice({
        type: "success",
        message: `Issued ${result.reservation_code}: ${result.quantity} unit(s) handed over${tags.length ? ` (${tags.join(", ")})` : ""}.`,
      });
      setIssuingId(null);
      refreshList();
    } catch (error) {
      setNotice({
        type: "error",
        message: error?.message || "Could not record equipment issuance.",
      });
      if (error?.status === 401) onSessionExpired();
    } finally {
      setBusyId(null);
    }
  }

  async function recordReturn(item) {
    if (busyId !== null || item.status !== "issued") return;
    const note = remarks.trim();
    if (condition === "damaged" && (note.length < 5 || note.length > 1000)) {
      setNotice({
        type: "error",
        message: "Describe the equipment damage in 5–1000 characters.",
      });
      return;
    }
    setBusyId(item.id);
    setNotice(null);
    try {
      const result = await reservationApi(
        `/api/reservations/${encodeURIComponent(item.id)}/return`,
        {
          method: "POST",
          body: { condition, remarks: note || null },
        },
      );
      if (result?.reservation_id !== item.id || result?.status !== "returned") {
        throw new Error(
          "FastAPI did not confirm the return. Refresh before attempting it again.",
        );
      }
      setNotice({
        type: "success",
        message: `Return recorded for ${result.reservation_code}. ${result.quantity} unit(s) checked in as ${result.condition === "damaged" ? "damaged (not available)" : "good (available)"}.`,
      });
      setReturningId(null);
      setRemarks("");
      setCondition("good");
      // The returned reservation leaves the approved/issued queue.
      if (items.length === 1 && page > 1) setPage((value) => value - 1);
      else refreshList();
    } catch (error) {
      setNotice({
        type: "error",
        message: error?.message || "Could not record the equipment return.",
      });
      if (error?.status === 401) onSessionExpired();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      style={reservationPanel}
      aria-label="Equipment issuance and returns"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>
            Equipment Issuance & Returns
          </h2>
          <p style={{ color: "#60748e", fontSize: 13, margin: 0 }}>
            {loading
              ? "Loading equipment handovers…"
              : `${total} approved or issued reservation${total === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          style={buttonStyle}
          disabled={loading || busyId !== null}
          onClick={refreshList}
        >
          {loading ? "Refreshing…" : "Refresh handovers"}
        </button>
      </div>
      <p
        style={{
          color: "#64748b",
          fontSize: 13,
          lineHeight: 1.6,
          margin: "0 0 18px",
        }}
      >
        Approved requests are ready for physical handover. After the borrower
        returns all issued units, record their condition to update inventory
        availability.
      </p>

      {notice && (
        <div
          role={notice.type === "error" ? "alert" : "status"}
          style={{
            padding: 14,
            borderRadius: 10,
            marginBottom: 16,
            background: notice.type === "error" ? "#fff1f2" : "#ecfdf5",
            color: notice.type === "error" ? "#9f1239" : "#166534",
            border: `1px solid ${notice.type === "error" ? "#fecdd3" : "#a7f3d0"}`,
          }}
        >
          {notice.message}
        </div>
      )}
      {loadError && (
        <div
          role="alert"
          style={{
            padding: 14,
            borderRadius: 10,
            marginBottom: 16,
            background: "#fff1f2",
            color: "#9f1239",
          }}
        >
          {loadError}
        </div>
      )}

      {loading ? (
        <p style={{ color: "#64748b" }}>
          Retrieving equipment handovers from FastAPI…
        </p>
      ) : loadError ? (
        <button type="button" style={buttonStyle} onClick={refreshList}>
          Retry loading handovers
        </button>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: "34px 12px",
            textAlign: "center",
            color: "#60748e",
            background: "#f8fbff",
            borderRadius: 12,
          }}
        >
          No approved or issued reservations on this page.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {items.map((item) => (
            <article
              key={item.id}
              style={{
                padding: "18px 20px",
                border: "1px solid #dbe4f2",
                borderRadius: 12,
                background: "#fbfdff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <div>
                  <strong style={{ color: "#142d4e", fontSize: 16 }}>
                    {item.equipment_name}
                  </strong>
                  <div style={{ color: "#60748e", fontSize: 12, marginTop: 4 }}>
                    {item.reservation_code} · {item.equipment_code}
                  </div>
                </div>
                <span
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    background:
                      item.status === "issued" ? "#dbeafe" : "#dcfce7",
                    color: item.status === "issued" ? "#1d4ed8" : "#166534",
                  }}
                >
                  {item.status === "issued" ? "Issued" : "Approved"}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
                  gap: 13,
                  fontSize: 13,
                  color: "#344763",
                }}
              >
                <div>
                  <strong>Borrower:</strong>{" "}
                  {item.requester_name || item.requester_username || "—"}
                </div>
                <div>
                  <strong>Quantity:</strong> {item.quantity}
                </div>
                <div>
                  <strong>Start:</strong> {showDate(item.reservation_start)}
                </div>
                <div>
                  <strong>End:</strong> {showDate(item.reservation_end)}
                </div>
              </div>
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  borderRadius: 9,
                  background: "#f0f5fc",
                  color: "#334155",
                  fontSize: 13,
                  lineHeight: 1.6,
                  overflowWrap: "anywhere",
                }}
              >
                <strong>Purpose:</strong> {item.purpose}
              </div>

              {item.status === "approved" && (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    style={{
                      ...buttonStyle,
                      color: "white",
                      background: "#2563eb",
                      borderColor: "#2563eb",
                    }}
                    disabled={busyId !== null || loading}
                    onClick={() => {
                      issuingId === item.id
                        ? setIssuingId(null)
                        : openIssue(item.id);
                    }}
                  >
                    {issuingId === item.id
                      ? "Cancel handover"
                      : "Issue Equipment"}
                  </button>
                  {issuingId === item.id && (
                    <div
                      style={{
                        marginTop: 14,
                        padding: 16,
                        borderRadius: 10,
                        border: "1px solid #bfdbfe",
                        background: "#eff6ff",
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: "#1e3a8a",
                        }}
                      >
                        Confirm only after physically handing all{" "}
                        {item.quantity} unit(s) to the borrower. This will mark
                        the units as <strong>Issued</strong> in PostgreSQL.
                      </p>
                      <button
                        type="button"
                        style={{
                          ...buttonStyle,
                          justifySelf: "start",
                          color: "white",
                          background: "#2563eb",
                          borderColor: "#2563eb",
                        }}
                        disabled={busyId !== null}
                        onClick={() => issueEquipment(item)}
                      >
                        {busyId === item.id
                          ? "Recording issuance…"
                          : "Confirm Equipment Handover"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {item.status === "issued" && (
                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    style={{
                      ...buttonStyle,
                      color: "white",
                      background: "#2563eb",
                      borderColor: "#2563eb",
                    }}
                    disabled={busyId !== null || loading}
                    onClick={() => {
                      returningId === item.id
                        ? setReturningId(null)
                        : openReturn(item.id);
                    }}
                  >
                    {returningId === item.id
                      ? "Cancel return"
                      : "Record Return"}
                  </button>
                  {returningId === item.id && (
                    <div
                      style={{
                        marginTop: 14,
                        padding: 16,
                        borderRadius: 10,
                        border: "1px solid #bfdbfe",
                        background: "#eff6ff",
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <label
                        style={labelControl}
                        htmlFor={`lg-condition-${item.id}`}
                      >
                        Condition of all returned units
                        <select
                          id={`lg-condition-${item.id}`}
                          style={formControl}
                          value={condition}
                          disabled={busyId !== null}
                          onChange={(event) => {
                            setCondition(event.target.value);
                            setNotice(null);
                          }}
                        >
                          <option value="good">
                            Good — return to available inventory
                          </option>
                          <option value="damaged">
                            Damaged — mark all units damaged
                          </option>
                        </select>
                      </label>
                      <label
                        style={labelControl}
                        htmlFor={`lg-notes-${item.id}`}
                      >
                        {condition === "damaged"
                          ? "Damage description (required)"
                          : "Return notes (optional)"}
                        <textarea
                          id={`lg-notes-${item.id}`}
                          style={{
                            ...formControl,
                            minHeight: 85,
                            resize: "vertical",
                          }}
                          value={remarks}
                          maxLength={1000}
                          disabled={busyId !== null}
                          placeholder={
                            condition === "damaged"
                              ? "Describe the damage (at least 5 characters)"
                              : "Optional notes about the equipment return"
                          }
                          onChange={(event) => {
                            setRemarks(event.target.value);
                            setNotice(null);
                          }}
                        />
                      </label>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: "#475569",
                          lineHeight: 1.6,
                        }}
                      >
                        This records a return for all {item.quantity} unit(s)
                        assigned to this reservation.
                      </p>
                      <button
                        type="button"
                        style={{
                          ...buttonStyle,
                          justifySelf: "start",
                          background: "#2563eb",
                          borderColor: "#2563eb",
                          color: "white",
                        }}
                        disabled={
                          busyId !== null ||
                          (condition === "damaged" && remarks.trim().length < 5)
                        }
                        onClick={() => recordReturn(item)}
                      >
                        {busyId === item.id
                          ? "Recording return…"
                          : "Confirm Equipment Return"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {!loading && !loadError && pages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "center",
            marginTop: 20,
          }}
        >
          <button
            type="button"
            style={buttonStyle}
            disabled={page <= 1 || busyId !== null}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </button>
          <span style={{ color: "#64748b", fontSize: 13 }}>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            style={buttonStyle}
            disabled={page >= pages || busyId !== null}
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

// File 118: The technician inventory screen uses only live File 116 API data.
// Authentication, CSRF, audit logging and stock constraints remain in FastAPI.
const newEquipmentTemplate = {
  category_id: "",
  equipment_code: "",
  equipment_name: "",
  description: "",
  manufacturer: "",
  model_number: "",
  unit_count: "1",
  storage_location: "",
};
const inventoryMessageStyle = (isError) => ({
  padding: "13px 16px",
  borderRadius: 10,
  border: `1px solid ${isError ? "#fecdd3" : "#a7f3d0"}`,
  background: isError ? "#fff1f2" : "#ecfdf5",
  color: isError ? "#9f1239" : "#166534",
  lineHeight: 1.6,
});
const inventoryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))",
  gap: 16,
};

// File 126: read-only, technician-only damage and repair history.
// Mount per selected equipment (keyed by its ID) so filters and pagination do
// not leak from one equipment record to another. Backend owns audit details.
function TechnicianConditionHistory({
  equipment,
  units,
  refreshKey,
  onSessionExpired,
}) {
  const [expanded, setExpanded] = useState(false);
  const [unitFilter, setUnitFilter] = useState("");
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!expanded || !equipment?.id) return undefined;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setRecords([]);

    const params = new URLSearchParams({ page: String(page), page_size: "10" });
    if (unitFilter) params.set("unit_id", unitFilter);
    const url = `/api/technician/inventory/${encodeURIComponent(equipment.id)}/condition-history?${params.toString()}`;

    reservationApi(url, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        if (
          data?.equipment_id !== equipment.id ||
          !Array.isArray(data?.items) ||
          !Number.isInteger(data?.total) ||
          !Number.isInteger(data?.pages)
        ) {
          throw new Error(
            "FastAPI returned an unexpected condition history response.",
          );
        }
        setRecords(data.items);
        setTotal(data.total);
        setPages(data.pages);
        if (page > Math.max(1, data.pages)) setPage(Math.max(1, data.pages));
      })
      .catch((failure) => {
        if (!active || failure?.name === "AbortError") return;
        setError(
          failure?.status === 404
            ? "Damage and repair history API not found. Confirm File 125 is installed and restart FastAPI."
            : failure?.message ||
                "Could not retrieve equipment condition history.",
        );
        if (failure?.status === 401) onSessionExpired();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    expanded,
    equipment?.id,
    unitFilter,
    page,
    refresh,
    refreshKey,
    onSessionExpired,
  ]);

  return (
    <section
      aria-label="Equipment damage and repair history"
      style={{
        display: "grid",
        gap: 14,
        padding: 18,
        background: "#f8fbff",
        border: "1px solid #dbe4f2",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h4 style={{ margin: "0 0 5px" }}>Damage &amp; Repair History</h4>
          <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
            Read-only technician audit of previous unit condition changes.
          </p>
        </div>
        <button
          type="button"
          style={buttonStyle}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Hide History" : "View Damage & Repair History"}
        </button>
      </div>
      {expanded && (
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "end",
              gap: 12,
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <label style={{ ...labelControl, minWidth: "min(100%, 300px)" }}>
              Physical unit
              <select
                style={formControl}
                value={unitFilter}
                onChange={(event) => {
                  setUnitFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit.id} value={String(unit.id)}>
                    {unit.asset_tag}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              style={buttonStyle}
              disabled={loading}
              onClick={() => setRefresh((current) => current + 1)}
            >
              Refresh History
            </button>
          </div>
          {error && (
            <div role="alert" style={inventoryMessageStyle(true)}>
              {error}
            </div>
          )}
          {loading ? (
            <p style={{ color: "#64748b", margin: 0 }} role="status">
              Loading condition history…
            </p>
          ) : !error && records.length === 0 ? (
            <div
              style={{
                color: "#64748b",
                padding: 18,
                background: "white",
                borderRadius: 10,
                textAlign: "center",
              }}
            >
              {unitFilter
                ? "No damage or repair records for this unit."
                : "No damage or repair records for this equipment yet."}
            </div>
          ) : (
            !error && (
              <>
                <p style={{ margin: 0, color: "#60748e", fontSize: 13 }}>
                  {total} history event{total === 1 ? "" : "s"} · Newest first
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      minWidth: 900,
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr style={{ textAlign: "left", background: "#eaf2ff" }}>
                        {[
                          "Date / Time",
                          "Asset Tag",
                          "Action",
                          "Status Change",
                          "Technician",
                          "Notes",
                        ].map((heading) => (
                          <th
                            key={heading}
                            scope="col"
                            style={{
                              padding: 12,
                              borderBottom: "1px solid #cbd8e8",
                            }}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.event_id}>
                          <td
                            style={{
                              padding: 12,
                              borderBottom: "1px solid #e6edf6",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {record.changed_at &&
                            !Number.isNaN(Date.parse(record.changed_at))
                              ? new Date(record.changed_at).toLocaleString()
                              : "—"}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderBottom: "1px solid #e6edf6",
                              fontWeight: 600,
                            }}
                          >
                            {record.asset_tag ||
                              (record.equipment_unit_id
                                ? `Unit #${record.equipment_unit_id}`
                                : "—")}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderBottom: "1px solid #e6edf6",
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 600,
                                color:
                                  record.new_status === "damaged"
                                    ? "#b91c1c"
                                    : "#166534",
                              }}
                            >
                              {record.event_type ===
                              "equipment_unit_marked_damaged"
                                ? "Marked Damaged"
                                : record.event_type ===
                                    "equipment_unit_restored"
                                  ? "Restored to Available"
                                  : "Condition Updated"}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderBottom: "1px solid #e6edf6",
                              textTransform: "capitalize",
                            }}
                          >
                            {record.previous_status || "—"} →{" "}
                            {record.new_status || "—"}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderBottom: "1px solid #e6edf6",
                            }}
                          >
                            {record.technician_username ||
                              "Former / unknown technician"}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderBottom: "1px solid #e6edf6",
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                              maxWidth: 360,
                            }}
                          >
                            {record.notes || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pages > 1 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <button
                      type="button"
                      style={buttonStyle}
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      Previous
                    </button>
                    <span style={{ color: "#60748e", fontSize: 13 }}>
                      Page {page} / {pages}
                    </span>
                    <button
                      type="button"
                      style={buttonStyle}
                      disabled={page >= pages || loading}
                      onClick={() =>
                        setPage((value) => Math.min(pages, value + 1))
                      }
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}
    </section>
  );
}

function TechnicianInventoryPanel({ onSessionExpired }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryError, setCategoryError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState({ ...newEquipmentTemplate });
  const [selected, setSelected] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [units, setUnits] = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsError, setUnitsError] = useState("");
  const [unitsReload, setUnitsReload] = useState(0);
  const [unitDraft, setUnitDraft] = useState({
    quantity: "1",
    storage_location: "",
  });
  const [conditionTarget, setConditionTarget] = useState(null);
  const [conditionNotes, setConditionNotes] = useState("");
  const [conditionNotice, setConditionNotice] = useState(null);

  // Categories are served by the existing catalog; no new API is necessary.
  useEffect(() => {
    const controller = new AbortController();
    reservationApi("/api/equipment/categories", { signal: controller.signal })
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error("FastAPI returned invalid equipment categories.");
        }
        setCategories(data);
        setCategoryError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setCategoryError(
          error?.message || "Unable to load equipment categories.",
        );
        if (error?.status === 401) onSessionExpired();
      });
    return () => controller.abort();
  }, [onSessionExpired]);

  // Pagination is performed by PostgreSQL, so the total represents all records.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError("");
    reservationApi(`/api/technician/inventory?page=${page}&page_size=20`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!active) return;
        if (
          !Array.isArray(data?.items) ||
          !Number.isInteger(data?.total) ||
          !Number.isInteger(data?.pages)
        ) {
          throw new Error(
            "The technician inventory API returned invalid data.",
          );
        }
        setItems(data.items);
        setTotal(data.total);
        setPages(data.pages);
        if (page > 1 && page > Math.max(1, data.pages)) {
          setPage(Math.max(1, data.pages));
        }
        // Refresh the selected record if it is on the current page.
        setSelected((previous) => {
          if (!previous) return previous;
          return (
            data.items.find((record) => record.id === previous.id) || previous
          );
        });
      })
      .catch((error) => {
        if (!active || error?.name === "AbortError") return;
        setItems([]);
        setLoadError(
          error?.status === 404
            ? "Technician Inventory API not found. Complete File 117 and restart FastAPI."
            : error?.message || "Could not load inventory.",
        );
        if (error?.status === 401) onSessionExpired();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, reload, onSessionExpired]);

  useEffect(() => {
    if (!selected?.id) {
      setUnits([]);
      setUnitsError("");
      setUnitsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setUnitsLoading(true);
    setUnitsError("");
    reservationApi(
      `/api/technician/inventory/${encodeURIComponent(selected.id)}/units`,
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!active) return;
        if (!Array.isArray(data?.items)) {
          throw new Error("FastAPI returned invalid equipment units.");
        }
        setUnits(data.items);
      })
      .catch((error) => {
        if (!active || error?.name === "AbortError") return;
        setUnits([]);
        setUnitsError(error?.message || "Unable to load unit statuses.");
        if (error?.status === 401) onSessionExpired();
      })
      .finally(() => {
        if (active) setUnitsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selected?.id, unitsReload, onSessionExpired]);

  const visible = items.filter((item) =>
    `${item.equipment_name || ""} ${item.equipment_code || ""} ${item.category_name || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const allAvailableOnPage = items.reduce(
    (sum, item) => sum + Number(item.available_units || 0),
    0,
  );

  function selectEquipment(item) {
    if (busy) return;
    setConditionTarget(null);
    setConditionNotes("");
    setConditionNotice(null);
    if (selected?.id === item.id) {
      setSelected(null);
      setShowEdit(false);
      setUnits([]);
      return;
    }
    setSelected(item);
    setShowEdit(false);
    setUnitDraft({ quantity: "1", storage_location: "" });
    setEditDraft({
      category_id: String(item.category_id),
      equipment_name: item.equipment_name || "",
      description: item.description || "",
      manufacturer: item.manufacturer || "",
      model_number: item.model_number || "",
      is_active: Boolean(item.is_active),
    });
    setUnitsReload((value) => value + 1);
    setNotice(null);
  }

  function updateCreatedRecord(record) {
    setSelected(record);
    setConditionTarget(null);
    setConditionNotes("");
    setEditDraft({
      category_id: String(record.category_id),
      equipment_name: record.equipment_name || "",
      description: record.description || "",
      manufacturer: record.manufacturer || "",
      model_number: record.model_number || "",
      is_active: Boolean(record.is_active),
    });
    setItems((current) =>
      current.map((item) => (item.id === record.id ? record : item)),
    );
    setReload((value) => value + 1);
    setUnitsReload((value) => value + 1);
  }

  async function createEquipment(event) {
    event.preventDefault();
    if (busy) return;
    const quantity = Number(createDraft.unit_count);
    const category = Number(createDraft.category_id);
    const code = createDraft.equipment_code.trim().toUpperCase();
    if (
      !Number.isInteger(category) ||
      category <= 0 ||
      !/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(code) ||
      createDraft.equipment_name.trim().length < 3 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 50
    ) {
      setNotice({
        type: "error",
        text: "Select a category, enter a valid equipment code and name, and choose 1–50 units.",
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await reservationApi("/api/technician/inventory", {
        method: "POST",
        body: {
          category_id: category,
          equipment_code: code,
          equipment_name: createDraft.equipment_name.trim(),
          description: createDraft.description.trim() || null,
          manufacturer: createDraft.manufacturer.trim() || null,
          model_number: createDraft.model_number.trim() || null,
          unit_count: quantity,
          storage_location: createDraft.storage_location.trim() || null,
        },
      });
      if (!Number.isInteger(result?.equipment?.id)) {
        throw new Error(
          "FastAPI did not confirm equipment creation. Refresh inventory before retrying.",
        );
      }
      setCreateDraft({ ...newEquipmentTemplate });
      setShowCreate(false);
      setShowEdit(false);
      updateCreatedRecord(result.equipment);
      setNotice({
        type: "success",
        text: `${result.equipment.equipment_name} created with ${result.added_asset_tags?.length || 0} unit(s).`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error?.message || "Equipment was not created.",
      });
      if (error?.status === 401) onSessionExpired();
    } finally {
      setBusy(false);
    }
  }

  async function saveEquipment(event) {
    event.preventDefault();
    if (busy || !selected || !editDraft) return;
    const categoryId = Number(editDraft.category_id);
    if (
      !Number.isInteger(categoryId) ||
      categoryId <= 0 ||
      editDraft.equipment_name.trim().length < 3
    ) {
      setNotice({
        type: "error",
        text: "Select a category and enter an equipment name of at least 3 characters.",
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await reservationApi(
        `/api/technician/inventory/${encodeURIComponent(selected.id)}`,
        {
          method: "PATCH",
          body: {
            category_id: categoryId,
            equipment_name: editDraft.equipment_name.trim(),
            description: editDraft.description.trim() || null,
            manufacturer: editDraft.manufacturer.trim() || null,
            model_number: editDraft.model_number.trim() || null,
            is_active: editDraft.is_active,
          },
        },
      );
      if (result?.equipment?.id !== selected.id) {
        throw new Error(
          "FastAPI did not confirm the update. Refresh inventory before retrying.",
        );
      }
      updateCreatedRecord(result.equipment);
      setShowEdit(false);
      setNotice({
        type: "success",
        text: `Updated ${result.equipment.equipment_name}.`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error?.message || "Equipment was not updated.",
      });
      if (error?.status === 401) onSessionExpired();
    } finally {
      setBusy(false);
    }
  }

  async function addUnits(event) {
    event.preventDefault();
    if (busy || !selected) return;
    const quantity = Number(unitDraft.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      setNotice({ type: "error", text: "Enter a unit quantity from 1 to 50." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await reservationApi(
        `/api/technician/inventory/${encodeURIComponent(selected.id)}/units`,
        {
          method: "POST",
          body: {
            quantity,
            storage_location: unitDraft.storage_location.trim() || null,
          },
        },
      );
      if (
        result?.equipment?.id !== selected.id ||
        !Array.isArray(result.added_asset_tags) ||
        result.added_asset_tags.length !== quantity
      ) {
        throw new Error(
          "FastAPI did not confirm the added units. Refresh inventory before retrying.",
        );
      }
      updateCreatedRecord(result.equipment);
      setUnitDraft({ quantity: "1", storage_location: "" });
      setNotice({
        type: "success",
        text: `${quantity} unit(s) added: ${result.added_asset_tags.join(", ")}.`,
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error?.message || "Could not add equipment units.",
      });
      if (error?.status === 401) onSessionExpired();
    } finally {
      setBusy(false);
    }
  }

  // File 124: all decisions are enforced by FastAPI. Do not update unit stock
  // locally until the backend confirms its PostgreSQL transaction.
  async function saveUnitCondition(event) {
    event.preventDefault();
    if (busy || unitsLoading || !selected || !conditionTarget) return;
    const notes = conditionNotes.trim();
    if (notes.length < 5 || notes.length > 500) {
      setConditionNotice({
        type: "error",
        text: "Enter 5–500 characters describing the damage or completed repair.",
      });
      return;
    }
    if (conditionTarget.equipmentId !== selected.id) {
      setConditionNotice({
        type: "error",
        text: "The selected equipment changed. Reopen the correct physical unit.",
      });
      return;
    }
    const currentUnit = units.find(
      (unit) => unit.id === conditionTarget.unitId,
    );
    if (
      !currentUnit ||
      currentUnit.unit_status !== conditionTarget.previousStatus
    ) {
      setConditionNotice({
        type: "error",
        text: "This unit's status may have changed. Refresh Units and review it again.",
      });
      return;
    }

    setBusy(true);
    setConditionNotice(null);
    try {
      const result = await reservationApi(
        `/api/technician/inventory/${encodeURIComponent(selected.id)}/units/${encodeURIComponent(conditionTarget.unitId)}/condition`,
        {
          method: "PATCH",
          body: {
            condition: conditionTarget.nextStatus,
            notes,
          },
        },
      );
      if (
        result?.changed !== true ||
        result?.unit?.id !== conditionTarget.unitId ||
        result?.unit?.unit_status !== conditionTarget.nextStatus ||
        result?.equipment?.id !== selected.id
      ) {
        throw new Error(
          "FastAPI did not confirm the condition update. Refresh Units before retrying.",
        );
      }
      setConditionTarget(null);
      setConditionNotes("");
      setConditionNotice({
        type: "success",
        text: `${currentUnit.asset_tag}: ${
          result.message ||
          (conditionTarget.nextStatus === "damaged"
            ? "Marked damaged and excluded from available stock."
            : "Restored to available inventory.")
        }`,
      });
      setUnitsReload((value) => value + 1);
      setReload((value) => value + 1);
    } catch (error) {
      setConditionNotice({
        type: "error",
        text:
          error?.message || "Could not update this physical unit's condition.",
      });
      if (error?.status === 401) onSessionExpired();
      if (error?.status === 409) setUnitsReload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Technician inventory management"
      style={{ display: "grid", gap: 20 }}
    >
      <div style={{ ...reservationPanel, display: "grid", gap: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>
              Equipment Inventory Management
            </h2>
            <p style={{ margin: 0, color: "#60748e", fontSize: 13 }}>
              {loading
                ? "Loading inventory…"
                : `${total} equipment type${total === 1 ? "" : "s"} in PostgreSQL`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button
              type="button"
              style={buttonStyle}
              disabled={loading || busy}
              onClick={() => setReload((value) => value + 1)}
            >
              Refresh inventory
            </button>
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: "#245ff2",
                color: "white",
                borderColor: "#245ff2",
              }}
              disabled={busy}
              onClick={() => {
                setShowCreate((value) => !value);
                setNotice(null);
              }}
            >
              {showCreate ? "Close add form" : "+ Add Equipment"}
            </button>
          </div>
        </div>
        <p
          style={{ color: "#60748e", fontSize: 13, margin: 0, lineHeight: 1.6 }}
        >
          Register physical equipment, update catalog details, inspect each
          asset tag and add available units. Equipment codes remain unchanged
          after creation to keep references consistent.
        </p>
        {loadError && (
          <div role="alert" style={inventoryMessageStyle(true)}>
            {loadError}
          </div>
        )}
        {categoryError && (
          <div role="alert" style={inventoryMessageStyle(true)}>
            Categories: {categoryError}
          </div>
        )}
        {notice && (
          <div
            role={notice.type === "error" ? "alert" : "status"}
            style={inventoryMessageStyle(notice.type === "error")}
          >
            {notice.text}
          </div>
        )}
        <div style={inventoryGridStyle}>
          <div
            style={{
              padding: "13px 16px",
              background: "#f3f7fd",
              borderRadius: 11,
            }}
          >
            <div style={{ color: "#64748b", fontSize: 12 }}>
              Registered equipment types
            </div>
            <strong style={{ fontSize: 26, color: "#142d4e" }}>{total}</strong>
          </div>
          <div
            style={{
              padding: "13px 16px",
              background: "#f3f7fd",
              borderRadius: 11,
            }}
          >
            <div style={{ color: "#64748b", fontSize: 12 }}>
              Available units on this page
            </div>
            <strong style={{ fontSize: 26, color: "#142d4e" }}>
              {allAvailableOnPage}
            </strong>
          </div>
        </div>
        {showCreate && (
          <form
            onSubmit={createEquipment}
            style={{
              background: "#f8fbff",
              border: "1px solid #dbe4f2",
              padding: 20,
              borderRadius: 12,
              display: "grid",
              gap: 16,
            }}
          >
            <h3 style={{ margin: 0 }}>Register New Equipment</h3>
            <div style={inventoryGridStyle}>
              <label style={labelControl}>
                Category *
                <select
                  style={formControl}
                  required
                  value={createDraft.category_id}
                  onChange={(event) =>
                    setCreateDraft((d) => ({
                      ...d,
                      category_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.category_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelControl}>
                Equipment Code *
                <input
                  style={formControl}
                  required
                  maxLength={40}
                  minLength={3}
                  placeholder="SCI-MIC-002"
                  value={createDraft.equipment_code}
                  onChange={(event) =>
                    setCreateDraft((d) => ({
                      ...d,
                      equipment_code: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </label>
              <label style={labelControl}>
                Equipment Name *
                <input
                  style={formControl}
                  required
                  minLength={3}
                  maxLength={150}
                  placeholder="Digital Microscope"
                  value={createDraft.equipment_name}
                  onChange={(event) =>
                    setCreateDraft((d) => ({
                      ...d,
                      equipment_name: event.target.value,
                    }))
                  }
                />
              </label>
              <label style={labelControl}>
                Initial Units (1–50) *
                <input
                  style={formControl}
                  required
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={createDraft.unit_count}
                  onChange={(event) =>
                    setCreateDraft((d) => ({
                      ...d,
                      unit_count: event.target.value,
                    }))
                  }
                />
              </label>
              <label style={labelControl}>
                Manufacturer
                <input
                  style={formControl}
                  maxLength={150}
                  value={createDraft.manufacturer}
                  onChange={(event) =>
                    setCreateDraft((d) => ({
                      ...d,
                      manufacturer: event.target.value,
                    }))
                  }
                />
              </label>
              <label style={labelControl}>
                Model Number
                <input
                  style={formControl}
                  maxLength={100}
                  value={createDraft.model_number}
                  onChange={(event) =>
                    setCreateDraft((d) => ({
                      ...d,
                      model_number: event.target.value,
                    }))
                  }
                />
              </label>
              <label style={labelControl}>
                Storage Location
                <input
                  style={formControl}
                  maxLength={150}
                  placeholder="Science Lab - Cabinet 2"
                  value={createDraft.storage_location}
                  onChange={(event) =>
                    setCreateDraft((d) => ({
                      ...d,
                      storage_location: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label style={labelControl}>
              Description
              <textarea
                style={{ ...formControl, minHeight: 88, resize: "vertical" }}
                maxLength={2000}
                value={createDraft.description}
                onChange={(event) =>
                  setCreateDraft((d) => ({
                    ...d,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <button
              type="submit"
              disabled={busy || categories.length === 0}
              style={{
                ...buttonStyle,
                justifySelf: "start",
                background: "#245ff2",
                borderColor: "#245ff2",
                color: "#fff",
              }}
            >
              {busy ? "Saving equipment…" : "Save Equipment & Units"}
            </button>
          </form>
        )}
      </div>

      <div style={reservationPanel}>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0 }}>Equipment Records</h3>
          <input
            type="search"
            style={{ ...formControl, width: "min(100%, 350px)" }}
            placeholder="Filter this page by name or code"
            value={query}
            aria-label="Filter equipment on current page"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {loading ? (
          <p style={{ color: "#60748e" }}>Loading equipment records…</p>
        ) : loadError ? (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </button>
        ) : visible.length === 0 ? (
          <div
            style={{
              padding: 28,
              textAlign: "center",
              color: "#64748b",
              background: "#f8fbff",
              borderRadius: 10,
            }}
          >
            {items.length === 0
              ? "No equipment has been registered yet."
              : "No matching equipment on this page."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {visible.map((item) => (
              <article
                key={item.id}
                style={{
                  background: selected?.id === item.id ? "#eff6ff" : "#fbfdff",
                  border: "1px solid #dbe4f2",
                  borderRadius: 12,
                  padding: 17,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 16, color: "#142d4e" }}>
                      {item.equipment_name}
                    </strong>
                    <div
                      style={{ color: "#64748b", fontSize: 12, marginTop: 5 }}
                    >
                      {item.equipment_code} · {item.category_name}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      fontWeight: 700,
                      fontSize: 12,
                      background: item.is_active ? "#dcfce7" : "#fee2e2",
                      color: item.is_active ? "#166534" : "#991b1b",
                    }}
                  >
                    {item.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6 }}>
                  {item.description || "No description"}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 25,
                    flexWrap: "wrap",
                    fontSize: 13,
                    marginBottom: 14,
                    color: "#344763",
                  }}
                >
                  <span>
                    <strong>Available:</strong> {item.available_units}
                  </span>
                  <span>
                    <strong>Total units:</strong> {item.total_units}
                  </span>
                </div>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={busy}
                  onClick={() => selectEquipment(item)}
                >
                  {selected?.id === item.id
                    ? "Close Equipment Details"
                    : "Manage Equipment"}
                </button>
              </article>
            ))}
          </div>
        )}
        {!loading && !loadError && pages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 20,
            }}
          >
            <button
              type="button"
              style={buttonStyle}
              disabled={page <= 1 || busy}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <span style={{ color: "#64748b", fontSize: 13 }}>
              Page {page} / {pages}
            </span>
            <button
              type="button"
              style={buttonStyle}
              disabled={page >= pages || busy}
              onClick={() => setPage((value) => Math.min(pages, value + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {selected && (
        <div style={{ ...reservationPanel, display: "grid", gap: 17 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <h3 style={{ margin: "0 0 4px" }}>
                Manage: {selected.equipment_name}
              </h3>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {selected.equipment_code}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={buttonStyle}
                disabled={busy}
                onClick={() => {
                  setShowEdit((value) => !value);
                  setNotice(null);
                }}
              >
                {showEdit ? "Close Edit Form" : "Edit Equipment"}
              </button>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => setUnitsReload((value) => value + 1)}
                disabled={unitsLoading || busy}
              >
                Refresh Units
              </button>
            </div>
          </div>
          {showEdit && editDraft && (
            <form
              onSubmit={saveEquipment}
              style={{
                display: "grid",
                gap: 16,
                background: "#f8fbff",
                border: "1px solid #dbe4f2",
                borderRadius: 12,
                padding: 18,
              }}
            >
              <h4 style={{ margin: 0 }}>Update Equipment Details</h4>
              <div style={inventoryGridStyle}>
                <label style={labelControl}>
                  Category *
                  <select
                    style={formControl}
                    value={editDraft.category_id}
                    required
                    onChange={(event) =>
                      setEditDraft((d) => ({
                        ...d,
                        category_id: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={String(category.id)}>
                        {category.category_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelControl}>
                  Equipment Name *
                  <input
                    style={formControl}
                    value={editDraft.equipment_name}
                    minLength={3}
                    maxLength={150}
                    required
                    onChange={(event) =>
                      setEditDraft((d) => ({
                        ...d,
                        equipment_name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label style={labelControl}>
                  Manufacturer
                  <input
                    style={formControl}
                    value={editDraft.manufacturer}
                    maxLength={150}
                    onChange={(event) =>
                      setEditDraft((d) => ({
                        ...d,
                        manufacturer: event.target.value,
                      }))
                    }
                  />
                </label>
                <label style={labelControl}>
                  Model Number
                  <input
                    style={formControl}
                    value={editDraft.model_number}
                    maxLength={100}
                    onChange={(event) =>
                      setEditDraft((d) => ({
                        ...d,
                        model_number: event.target.value,
                      }))
                    }
                  />
                </label>
                <label style={{ ...labelControl, alignContent: "center" }}>
                  <span>Catalog Visibility</span>
                  <select
                    style={formControl}
                    value={editDraft.is_active ? "true" : "false"}
                    onChange={(event) =>
                      setEditDraft((d) => ({
                        ...d,
                        is_active: event.target.value === "true",
                      }))
                    }
                  >
                    <option value="true">Active — reservable</option>
                    <option value="false">
                      Inactive — hidden from student catalog
                    </option>
                  </select>
                </label>
              </div>
              <label style={labelControl}>
                Description
                <textarea
                  style={{ ...formControl, minHeight: 90, resize: "vertical" }}
                  maxLength={2000}
                  value={editDraft.description}
                  onChange={(event) =>
                    setEditDraft((d) => ({
                      ...d,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <p
                style={{
                  margin: 0,
                  color: "#64748b",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                FastAPI blocks deactivation when any active reservation still
                exists.
              </p>
              <button
                type="submit"
                disabled={busy || categories.length === 0}
                style={{
                  ...buttonStyle,
                  background: "#245ff2",
                  color: "white",
                  borderColor: "#245ff2",
                  justifySelf: "start",
                }}
              >
                {busy ? "Saving changes…" : "Save Changes"}
              </button>
            </form>
          )}
          <div style={{ display: "grid", gap: 10 }}>
            <h4 style={{ margin: 0 }}>Physical Units</h4>
            <p
              style={{
                color: "#64748b",
                fontSize: 13,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Flag an available unit as damaged, or restore a damaged unit after
              repair. Reserved and issued units must finish their handover
              before their condition can change.
            </p>
            {conditionNotice && (
              <div
                role={conditionNotice.type === "error" ? "alert" : "status"}
                style={inventoryMessageStyle(conditionNotice.type === "error")}
              >
                {conditionNotice.text}
              </div>
            )}
            {unitsLoading ? (
              <p style={{ color: "#64748b" }}>Loading asset tags…</p>
            ) : unitsError ? (
              <div role="alert" style={inventoryMessageStyle(true)}>
                {unitsError}
              </div>
            ) : units.length === 0 ? (
              <p style={{ color: "#64748b" }}>
                No units recorded for this equipment.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                    minWidth: 780,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: "left", background: "#f3f7fd" }}>
                      {[
                        "Asset Tag",
                        "Status",
                        "Storage Location",
                        "Serial Number",
                        "Condition Action",
                      ].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #dbe4f2",
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((unit) => (
                      <tr key={unit.id}>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                            fontWeight: 600,
                          }}
                        >
                          {unit.asset_tag}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                            textTransform: "capitalize",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              padding: "4px 9px",
                              borderRadius: 999,
                              background:
                                unit.unit_status === "damaged"
                                  ? "#fee2e2"
                                  : unit.unit_status === "available"
                                    ? "#dcfce7"
                                    : "#e6edf6",
                              color:
                                unit.unit_status === "damaged"
                                  ? "#991b1b"
                                  : unit.unit_status === "available"
                                    ? "#166534"
                                    : "#344763",
                              fontWeight: 600,
                            }}
                          >
                            {String(unit.unit_status).replaceAll("_", " ")}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {unit.storage_location || "—"}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {unit.serial_number || "—"}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {unit.unit_status === "available" ||
                          unit.unit_status === "damaged" ? (
                            <button
                              type="button"
                              disabled={busy || unitsLoading}
                              style={{
                                ...buttonStyle,
                                padding: "7px 11px",
                                whiteSpace: "nowrap",
                              }}
                              onClick={() => {
                                setConditionTarget({
                                  equipmentId: selected.id,
                                  unitId: unit.id,
                                  assetTag: unit.asset_tag,
                                  previousStatus: unit.unit_status,
                                  nextStatus:
                                    unit.unit_status === "available"
                                      ? "damaged"
                                      : "available",
                                });
                                setConditionNotes("");
                                setConditionNotice(null);
                              }}
                            >
                              {unit.unit_status === "available"
                                ? "Mark Damaged"
                                : "Restore to Available"}
                            </button>
                          ) : (
                            <span style={{ color: "#64748b", fontSize: 12 }}>
                              Complete handover first
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {conditionTarget && (
            <form
              onSubmit={saveUnitCondition}
              style={{
                display: "grid",
                gap: 13,
                padding: 18,
                border: "1px solid #bfdbfe",
                borderRadius: 12,
                background: "#eff6ff",
              }}
            >
              <h4 style={{ margin: 0 }}>
                {conditionTarget.nextStatus === "damaged"
                  ? "Report Damaged Unit"
                  : "Confirm Repair / Inspection"}
                {` — ${conditionTarget.assetTag}`}
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "#344763",
                }}
              >
                {conditionTarget.nextStatus === "damaged"
                  ? "This will remove this physical unit from available inventory. Explain the observed damage."
                  : "This will make the repaired or inspected unit available for new reservations. Describe the work or inspection completed."}
              </p>
              <label style={labelControl}>
                {conditionTarget.nextStatus === "damaged"
                  ? "Damage Notes (5–500 characters) *"
                  : "Repair / Inspection Notes (5–500 characters) *"}
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                  style={{ ...formControl, minHeight: 95, resize: "vertical" }}
                  placeholder={
                    conditionTarget.nextStatus === "damaged"
                      ? "Example: Sensor cable frayed; removed from circulation"
                      : "Example: Cable replaced and equipment tested successfully"
                  }
                  value={conditionNotes}
                  onChange={(event) => setConditionNotes(event.target.value)}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <button
                  type="submit"
                  disabled={
                    busy ||
                    unitsLoading ||
                    conditionNotes.trim().length < 5 ||
                    conditionNotes.trim().length > 500
                  }
                  style={{
                    ...buttonStyle,
                    background:
                      conditionTarget.nextStatus === "damaged"
                        ? "#b91c1c"
                        : "#245ff2",
                    borderColor:
                      conditionTarget.nextStatus === "damaged"
                        ? "#b91c1c"
                        : "#245ff2",
                    color: "white",
                  }}
                >
                  {busy
                    ? "Saving condition…"
                    : conditionTarget.nextStatus === "damaged"
                      ? "Confirm Damaged Unit"
                      : "Confirm Return to Available"}
                </button>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={busy}
                  onClick={() => {
                    setConditionTarget(null);
                    setConditionNotes("");
                    setConditionNotice(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <TechnicianConditionHistory
            key={selected.id}
            equipment={selected}
            units={units}
            refreshKey={unitsReload}
            onSessionExpired={onSessionExpired}
          />
          {selected.is_active && (
            <form
              onSubmit={addUnits}
              style={{
                display: "grid",
                gap: 14,
                padding: 18,
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 12,
              }}
            >
              <h4 style={{ margin: 0 }}>Add Physical Units</h4>
              <div style={inventoryGridStyle}>
                <label style={labelControl}>
                  Quantity (1–50) *
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    required
                    style={formControl}
                    value={unitDraft.quantity}
                    onChange={(event) =>
                      setUnitDraft((d) => ({
                        ...d,
                        quantity: event.target.value,
                      }))
                    }
                  />
                </label>
                <label style={labelControl}>
                  Storage Location
                  <input
                    style={formControl}
                    maxLength={150}
                    value={unitDraft.storage_location}
                    placeholder="Electronics Lab - Shelf A"
                    onChange={(event) =>
                      setUnitDraft((d) => ({
                        ...d,
                        storage_location: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={busy}
                style={{
                  ...buttonStyle,
                  justifySelf: "start",
                  color: "white",
                  background: "#245ff2",
                  borderColor: "#245ff2",
                }}
              >
                {busy ? "Adding units…" : "Add Units to Inventory"}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

// File 112: technician queue and decisions use the existing File 76 FastAPI routes.
// Authorization, CSRF, inventory allocations, and audit logs remain server-side.
function TechnicianReservationWorkspace({ account, onSessionExpired }) {
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejectionId, setRejectionId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [reload, setReload] = useState(0);
  const [activeRefresh, setActiveRefresh] = useState(0);
  const [technicianSection, setTechnicianSection] = useState("reservations");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadingError("");
    reservationApi(`/api/reservations/pending?page=${page}&page_size=10`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!active) return;
        if (
          !Array.isArray(result?.items) ||
          !Number.isInteger(result?.total) ||
          !Number.isInteger(result?.pages)
        ) {
          throw new Error(
            "LabGear returned an unexpected pending reservations response.",
          );
        }
        setRequests(result.items);
        setTotal(result.total);
        setPages(result.pages);
        if (page > 1 && result.pages > 0 && page > result.pages) {
          setPage(result.pages);
        }
      })
      .catch((error) => {
        if (!active || error?.name === "AbortError") return;
        setLoadingError(
          error?.message || "Could not load pending reservations.",
        );
        if (error?.status === 401) onSessionExpired();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, reload, onSessionExpired]);

  function beginRejection(id) {
    if (busyId !== null) return;
    setRejectionId(id);
    setRejectionReason("");
    setNotice(null);
  }

  async function decide(item, decision) {
    if (busyId !== null) return;
    const remarks = decision === "rejected" ? rejectionReason.trim() : null;
    if (
      decision === "rejected" &&
      (remarks.length < 5 || remarks.length > 1000)
    ) {
      setNotice({
        type: "error",
        message: "Enter a rejection reason containing 5–1000 characters.",
      });
      return;
    }

    setBusyId(item.id);
    setNotice(null);
    try {
      const result = await reservationApi(
        `/api/reservations/${encodeURIComponent(item.id)}/decision`,
        { method: "POST", body: { decision, remarks } },
      );
      if (result?.reservation_id !== item.id || result?.status !== decision) {
        throw new Error(
          "FastAPI did not confirm this decision. Refresh the queue before retrying.",
        );
      }

      const allocated = Array.isArray(result.allocated_units)
        ? result.allocated_units.map((unit) => unit.asset_tag).filter(Boolean)
        : [];
      setNotice({
        type: "success",
        message:
          decision === "approved"
            ? `Approved ${result.reservation_code}. ${allocated.length} unit(s) allocated${allocated.length ? `: ${allocated.join(", ")}` : ""}.`
            : `Rejected ${result.reservation_code}. The rejection reason has been recorded.`,
      });
      setRejectionId(null);
      setRejectionReason("");
      if (decision === "approved") setActiveRefresh((value) => value + 1);

      // Reload from PostgreSQL after a decision instead of inventing local status.
      if (requests.length === 1 && page > 1) setPage((value) => value - 1);
      else setReload((value) => value + 1);
    } catch (error) {
      setNotice({
        type: "error",
        message:
          error?.message || "The reservation decision could not be saved.",
      });
      if (error?.status === 401) onSessionExpired();
    } finally {
      setBusyId(null);
    }
  }

  const showDate = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
  };

  return (
    <main style={{ ...boxStyle, minHeight: "calc(100vh - 75px)" }}>
      <div
        style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 20 }}
      >
        <div>
          <div
            style={{
              color: "#245ff2",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: 1,
            }}
          >
            LABGEAR · LABORATORY TECHNICIAN WORKSPACE
          </div>
          <h1 style={{ margin: "8px 0", fontSize: "clamp(26px, 4vw, 36px)" }}>
            {technicianSection === "inventory"
              ? "Equipment Inventory"
              : "Reservation Approvals"}
          </h1>
          <p style={{ color: "#60748e", lineHeight: 1.6, margin: 0 }}>
            Welcome, {account.username}. Manage reservations, equipment
            handovers, returns and inventory using your verified technician
            account.
          </p>
        </div>

        <nav
          aria-label="Laboratory technician sections"
          style={{ display: "flex", flexWrap: "wrap", gap: 10 }}
        >
          <button
            type="button"
            aria-pressed={technicianSection === "reservations"}
            style={{
              ...buttonStyle,
              background:
                technicianSection === "reservations" ? "#245ff2" : "#fff",
              borderColor:
                technicianSection === "reservations" ? "#245ff2" : "#c8d7ef",
              color: technicianSection === "reservations" ? "#fff" : "#21467b",
            }}
            onClick={() => setTechnicianSection("reservations")}
          >
            Reservations & Handovers
          </button>
          <button
            type="button"
            aria-pressed={technicianSection === "inventory"}
            style={{
              ...buttonStyle,
              background:
                technicianSection === "inventory" ? "#245ff2" : "#fff",
              borderColor:
                technicianSection === "inventory" ? "#245ff2" : "#c8d7ef",
              color: technicianSection === "inventory" ? "#fff" : "#21467b",
            }}
            onClick={() => setTechnicianSection("inventory")}
          >
            Equipment Inventory
          </button>
        </nav>
        {technicianSection === "reservations" ? (
          <>
            <section
              style={reservationPanel}
              aria-label="Pending reservation requests"
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 14,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 18,
                }}
              >
                <div>
                  <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>
                    Pending Reservations
                  </h2>
                  <span style={{ color: "#60748e", fontSize: 13 }}>
                    {loading
                      ? "Loading pending requests…"
                      : `${total} pending request${total === 1 ? "" : "s"}`}
                  </span>
                </div>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={loading || busyId !== null}
                  onClick={() => {
                    setReload((value) => value + 1);
                    setActiveRefresh((value) => value + 1);
                  }}
                >
                  {loading ? "Refreshing…" : "Refresh requests"}
                </button>
              </div>

              {notice && (
                <div
                  role={notice.type === "error" ? "alert" : "status"}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    marginBottom: 16,
                    background: notice.type === "error" ? "#fff1f2" : "#ecfdf5",
                    color: notice.type === "error" ? "#9f1239" : "#166534",
                    border: `1px solid ${notice.type === "error" ? "#fecdd3" : "#a7f3d0"}`,
                  }}
                >
                  {notice.message}
                </div>
              )}

              {loadingError && (
                <div
                  role="alert"
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    marginBottom: 16,
                    background: "#fff1f2",
                    color: "#9f1239",
                  }}
                >
                  {loadingError}
                </div>
              )}

              {loading ? (
                <p style={{ color: "#64748b" }}>
                  Retrieving pending requests from FastAPI…
                </p>
              ) : loadingError ? (
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => setReload((value) => value + 1)}
                >
                  Retry loading requests
                </button>
              ) : requests.length === 0 ? (
                <div
                  style={{
                    padding: "34px 12px",
                    textAlign: "center",
                    color: "#60748e",
                    background: "#f8fbff",
                    borderRadius: 12,
                  }}
                >
                  No pending requests on this page.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {requests.map((item) => (
                    <article
                      key={item.id}
                      style={{
                        padding: "18px 20px",
                        border: "1px solid #dbe4f2",
                        borderRadius: 12,
                        background: "#fbfdff",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 10,
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: 16, color: "#142d4e" }}>
                            {item.equipment_name}
                          </strong>
                          <div
                            style={{
                              fontSize: 12,
                              color: "#60748e",
                              marginTop: 4,
                            }}
                          >
                            {item.reservation_code} · {item.equipment_code}
                          </div>
                        </div>
                        <span
                          style={{
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: "#fef3c7",
                            color: "#92400e",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          Pending
                        </span>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                          gap: 13,
                          fontSize: 13,
                          color: "#344763",
                        }}
                      >
                        <div>
                          <strong>Requested by:</strong>{" "}
                          {item.requester_name ||
                            item.requester_username ||
                            "—"}
                          {item.requester_username && (
                            <div style={{ color: "#64748b" }}>
                              @{item.requester_username}
                            </div>
                          )}
                        </div>
                        <div>
                          <strong>Quantity:</strong> {item.quantity}
                          <div style={{ color: "#64748b" }}>
                            Department: {item.requester_department || "—"}
                          </div>
                        </div>
                        <div>
                          <strong>Start:</strong>{" "}
                          {showDate(item.reservation_start)}
                        </div>
                        <div>
                          <strong>End:</strong> {showDate(item.reservation_end)}
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 12,
                          padding: "12px 14px",
                          borderRadius: 9,
                          background: "#f0f5fc",
                          color: "#334155",
                          fontSize: 13,
                          lineHeight: 1.6,
                          overflowWrap: "anywhere",
                        }}
                      >
                        <strong>Purpose:</strong> {item.purpose}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                          marginTop: 14,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => decide(item, "approved")}
                          disabled={busyId !== null}
                          style={{
                            ...buttonStyle,
                            color: "white",
                            background: "#2563eb",
                            borderColor: "#2563eb",
                            opacity: busyId !== null ? 0.65 : 1,
                          }}
                        >
                          {busyId === item.id ? "Saving decision…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            rejectionId === item.id
                              ? (setRejectionId(null), setRejectionReason(""))
                              : beginRejection(item.id)
                          }
                          disabled={busyId !== null}
                          style={{
                            ...buttonStyle,
                            color: "#b91c1c",
                            borderColor: "#fecaca",
                          }}
                        >
                          {rejectionId === item.id
                            ? "Cancel rejection"
                            : "Reject"}
                        </button>
                      </div>
                      {rejectionId === item.id && (
                        <div
                          style={{ marginTop: 15, display: "grid", gap: 10 }}
                        >
                          <label
                            htmlFor={`rejection-reason-${item.id}`}
                            style={labelControl}
                          >
                            Rejection reason (required, minimum 5 characters)
                            <textarea
                              id={`rejection-reason-${item.id}`}
                              style={{
                                ...formControl,
                                minHeight: 88,
                                resize: "vertical",
                              }}
                              value={rejectionReason}
                              maxLength={1000}
                              placeholder="Explain why this reservation cannot be approved"
                              onChange={(event) => {
                                setRejectionReason(event.target.value);
                                setNotice(null);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => decide(item, "rejected")}
                            disabled={
                              busyId !== null ||
                              rejectionReason.trim().length < 5
                            }
                            style={{
                              ...buttonStyle,
                              justifySelf: "start",
                              color: "white",
                              background: "#b91c1c",
                              borderColor: "#b91c1c",
                            }}
                          >
                            Confirm Rejection
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {!loading && !loadingError && pages > 1 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    marginTop: 20,
                  }}
                >
                  <button
                    type="button"
                    style={buttonStyle}
                    disabled={page <= 1 || busyId !== null}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    Previous
                  </button>
                  <span style={{ color: "#64748b", fontSize: 13 }}>
                    Page {page} of {pages}
                  </span>
                  <button
                    type="button"
                    style={buttonStyle}
                    disabled={page >= pages || busyId !== null}
                    onClick={() =>
                      setPage((value) => Math.min(pages, value + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
            <TechnicianHandoverPanel
              refreshToken={activeRefresh}
              onSessionExpired={onSessionExpired}
            />
          </>
        ) : (
          <TechnicianInventoryPanel onSessionExpired={onSessionExpired} />
        )}
      </div>
    </main>
  );
}

// File 122: user management lives in App.jsx so the existing admin monitoring
// component (and its charts, logs, alerts and styles) is never rewritten.
// FastAPI remains the only authority for sessions, CSRF, role assignments and logs.
const ADMIN_ASSIGNABLE_ROLES = ["student", "instructor", "technician"];

async function adminUsersApi(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") {
    const csrfToken = getLoginCsrfToken();
    if (!csrfToken) {
      const error = new Error(
        "The administrator security token is missing. Sign in again.",
      );
      error.status = 401;
      throw error;
    }
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = csrfToken;
  }
  let response;
  try {
    response = await fetch(`${getLoginApiBaseUrl()}${path}`, {
      method,
      credentials: "include",
      mode: "cors",
      cache: "no-store",
      redirect: "error",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(
      "Cannot connect to LabGear FastAPI. Check the backend server.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    const message =
      typeof detail === "string" && detail.trim()
        ? detail.trim()
        : response.status === 401
          ? "Your admin session expired. Sign in again."
          : response.status === 403
            ? "Access denied or CSRF check failed. Sign in as an administrator."
            : response.status === 404
              ? "Admin User Management API is unavailable. Check File 121."
              : response.status === 409
                ? "This account cannot be changed in its current state."
                : `User management request failed (HTTP ${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

function AdminUsersPanel({ onBack, onSessionExpired }) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [roleFilter, setRoleFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [desiredRoles, setDesiredRoles] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams({
      page: String(page),
      page_size: "20",
    });
    if (roleFilter) params.set("role", roleFilter);
    if (search) params.set("search", search);
    adminUsersApi(`/api/admin/users?${params}`, { signal: controller.signal })
      .then((data) => {
        if (!mounted) return;
        if (
          !Array.isArray(data?.items) ||
          !Number.isInteger(data?.total) ||
          !Number.isInteger(data?.pages)
        ) {
          throw new Error(
            "FastAPI returned an unexpected user-management response.",
          );
        }
        setUsers(data.items);
        setTotal(data.total);
        setPages(data.pages);
        setDesiredRoles({});
        if (page > 1 && data.pages > 0 && page > data.pages) {
          setPage(data.pages);
        }
      })
      .catch((error) => {
        if (!mounted || error?.name === "AbortError") return;
        setLoadError(error?.message || "Could not load registered accounts.");
        if (error?.status === 401) onSessionExpired();
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [page, roleFilter, search, reload, onSessionExpired]);

  function applySearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchText.trim());
    setConfirmation(null);
  }

  function prepareRoleChange(user) {
    const nextRole = desiredRoles[user.user_id] ?? user.role;
    if (
      saving ||
      nextRole === user.role ||
      !ADMIN_ASSIGNABLE_ROLES.includes(nextRole)
    )
      return;
    setNotice(null);
    setConfirmation({
      userId: user.user_id,
      username: user.username,
      oldRole: user.role,
      nextRole,
    });
  }

  async function submitRoleChange() {
    if (!confirmation || saving) return;
    const pending = confirmation;
    setSaving(true);
    setNotice(null);
    try {
      const result = await adminUsersApi(
        `/api/admin/users/${encodeURIComponent(pending.userId)}/role`,
        { method: "PATCH", body: { role: pending.nextRole } },
      );
      if (
        result?.user?.user_id !== pending.userId ||
        result?.user?.role !== pending.nextRole
      ) {
        throw new Error(
          "FastAPI did not confirm the role change. Refresh before retrying.",
        );
      }
      setNotice({
        type: "success",
        message: `${pending.username} is now ${pending.nextRole}. Existing sessions were revoked if the role changed.`,
      });
      setConfirmation(null);
      setReload((n) => n + 1);
    } catch (error) {
      setNotice({
        type: "error",
        message: error?.message || "Role change failed.",
      });
      if (error?.status === 401) onSessionExpired();
    } finally {
      setSaving(false);
    }
  }

  const showCreated = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
  };
  const fieldStyle = {
    padding: "10px 12px",
    border: "1px solid #c8d7ef",
    borderRadius: 9,
    background: "white",
    color: "#14243e",
    font: "inherit",
    maxWidth: "100%",
  };

  return (
    <main style={{ ...boxStyle, minHeight: "calc(100vh - 100px)" }}>
      <div
        style={{ maxWidth: 1260, margin: "0 auto", display: "grid", gap: 20 }}
      >
        <div>
          <div
            style={{
              color: "#245ff2",
              fontWeight: 700,
              letterSpacing: 1,
              fontSize: 13,
            }}
          >
            LABGEAR · ADMINISTRATION
          </div>
          <h1 style={{ margin: "10px 0", fontSize: "clamp(28px, 4vw, 38px)" }}>
            User Management
          </h1>
          <p style={{ margin: 0, color: "#60748e", lineHeight: 1.6 }}>
            View accounts and assign laboratory technician access to approved,
            email-verified users. Public registration remains restricted to
            students and instructors.
          </p>
        </div>

        <section style={reservationPanel} aria-label="Registered LabGear users">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 style={{ margin: "0 0 6px" }}>Registered Accounts</h2>
              <span style={{ color: "#60748e" }}>
                {loading
                  ? "Loading accounts…"
                  : `${total} matching account${total === 1 ? "" : "s"}`}
              </span>
            </div>
            <button
              type="button"
              style={buttonStyle}
              disabled={loading || saving}
              onClick={() => {
                setConfirmation(null);
                setReload((n) => n + 1);
              }}
            >
              Refresh Users
            </button>
          </div>

          <form
            onSubmit={applySearch}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "end",
              margin: "22px 0",
            }}
          >
            <label
              style={{
                display: "grid",
                gap: 6,
                flex: "1 1 220px",
                color: "#284466",
                fontWeight: 600,
              }}
            >
              Username
              <input
                style={fieldStyle}
                type="search"
                maxLength={50}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search usernames"
              />
            </label>
            <label
              style={{
                display: "grid",
                gap: 6,
                flex: "0 1 210px",
                color: "#284466",
                fontWeight: 600,
              }}
            >
              Role
              <select
                style={fieldStyle}
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value);
                  setPage(1);
                  setConfirmation(null);
                }}
              >
                <option value="">All roles</option>
                <option value="student">Student</option>
                <option value="instructor">Instructor</option>
                <option value="technician">Technician</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              type="submit"
              style={{ ...buttonStyle, color: "white", background: "#245ff2" }}
            >
              Search
            </button>
          </form>

          {notice && (
            <div
              role={notice.type === "error" ? "alert" : "status"}
              style={{
                padding: 14,
                borderRadius: 10,
                marginBottom: 16,
                color: notice.type === "error" ? "#9f1239" : "#166534",
                background: notice.type === "error" ? "#fff1f2" : "#ecfdf5",
                border: `1px solid ${notice.type === "error" ? "#fecdd3" : "#a7f3d0"}`,
              }}
            >
              {notice.message}
            </div>
          )}
          {loadError && (
            <p
              role="alert"
              style={{
                padding: 14,
                borderRadius: 10,
                background: "#fff1f2",
                color: "#9f1239",
              }}
            >
              {loadError}
            </p>
          )}

          {confirmation && (
            <div
              role="group"
              aria-label="Confirm role assignment"
              style={{
                border: "1px solid #93b8ff",
                background: "#eff6ff",
                borderRadius: 12,
                padding: 18,
                marginBottom: 18,
                display: "grid",
                gap: 12,
              }}
            >
              <strong>Confirm Role Change</strong>
              <div>
                Change <strong>{confirmation.username}</strong> from{" "}
                <strong>{confirmation.oldRole}</strong> to{" "}
                <strong>{confirmation.nextRole}</strong>? The account will be
                signed out of existing sessions and must sign in again. Verify
                staff eligibility before granting technician access.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={submitRoleChange}
                  style={{
                    ...buttonStyle,
                    background: "#245ff2",
                    color: "white",
                  }}
                >
                  {saving ? "Saving…" : "Confirm Role Change"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  style={buttonStyle}
                  onClick={() => setConfirmation(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p style={{ color: "#60748e" }}>
              Retrieving accounts from FastAPI…
            </p>
          ) : loadError ? null : users.length === 0 ? (
            <p
              style={{
                padding: 24,
                background: "#f3f7fd",
                borderRadius: 12,
                color: "#60748e",
              }}
            >
              No accounts match this filter.
            </p>
          ) : (
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 820,
                }}
              >
                <thead>
                  <tr>
                    {[
                      "Username / User ID",
                      "Current Role",
                      "Account",
                      "Email",
                      "Department",
                      "Created",
                      "Assign Role",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        style={{
                          padding: "13px 10px",
                          textAlign: "left",
                          background: "#f1f5fb",
                          borderBottom: "1px solid #dce7f4",
                          fontSize: 13,
                        }}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const changeable =
                      user.role !== "admin" &&
                      ADMIN_ASSIGNABLE_ROLES.includes(user.role) &&
                      user.account_status === "active" &&
                      user.is_email_verified === true;
                    const chosen = desiredRoles[user.user_id] ?? user.role;
                    return (
                      <tr key={user.user_id}>
                        <td
                          style={{
                            padding: "13px 10px",
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          <strong>{user.username}</strong>
                          <div style={{ fontSize: 12, color: "#71819a" }}>
                            {user.user_id}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "13px 10px",
                            borderBottom: "1px solid #e6edf6",
                            textTransform: "capitalize",
                          }}
                        >
                          {user.role}
                        </td>
                        <td
                          style={{
                            padding: "13px 10px",
                            borderBottom: "1px solid #e6edf6",
                            textTransform: "capitalize",
                          }}
                        >
                          {user.account_status}
                        </td>
                        <td
                          style={{
                            padding: "13px 10px",
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {user.is_email_verified ? "Verified" : "Unverified"}
                        </td>
                        <td
                          style={{
                            padding: "13px 10px",
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {user.department || "—"}
                        </td>
                        <td
                          style={{
                            padding: "13px 10px",
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {showCreated(user.created_at)}
                        </td>
                        <td
                          style={{
                            padding: "13px 10px",
                            borderBottom: "1px solid #e6edf6",
                          }}
                        >
                          {changeable ? (
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <select
                                aria-label={`New role for ${user.username}`}
                                value={chosen}
                                disabled={saving}
                                style={fieldStyle}
                                onChange={(event) => {
                                  setDesiredRoles((prev) => ({
                                    ...prev,
                                    [user.user_id]: event.target.value,
                                  }));
                                  setConfirmation(null);
                                }}
                              >
                                {ADMIN_ASSIGNABLE_ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {role.charAt(0).toUpperCase() +
                                      role.slice(1)}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                style={buttonStyle}
                                disabled={saving || chosen === user.role}
                                onClick={() => prepareRoleChange(user)}
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: "#71819a", fontSize: 13 }}>
                              {user.role === "admin"
                                ? "Protected"
                                : "Not eligible"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 20,
            }}
          >
            <span style={{ color: "#60748e", fontSize: 13 }}>
              Page {page} of {Math.max(1, pages)}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                style={buttonStyle}
                disabled={loading || page <= 1 || saving}
                onClick={() => {
                  setPage((p) => Math.max(1, p - 1));
                  setConfirmation(null);
                }}
              >
                Previous
              </button>
              <button
                type="button"
                style={buttonStyle}
                disabled={loading || page >= pages || saving}
                onClick={() => {
                  setPage((p) => p + 1);
                  setConfirmation(null);
                }}
              >
                Next
              </button>
            </div>
          </div>
        </section>
        <div>
          <button type="button" style={buttonStyle} onClick={onBack}>
            Back to Home
          </button>
        </div>
      </div>
    </main>
  );
}

function AdminWorkspace({ account, onBack, onSessionExpired }) {
  const [tab, setTab] = useState("monitoring");
  return (
    <>
      <nav
        aria-label="LabGear administrator sections"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "14px clamp(24px, 5vw, 60px)",
          background: "#f4f7fc",
          borderBottom: "1px solid #dbe4f2",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <strong style={{ color: "#14243e", marginRight: 10 }}>
          LabGear Administration
        </strong>
        <button
          type="button"
          style={{
            ...buttonStyle,
            ...(tab === "monitoring"
              ? { background: "#245ff2", color: "#fff" }
              : {}),
          }}
          aria-pressed={tab === "monitoring"}
          onClick={() => setTab("monitoring")}
        >
          Security Monitoring
        </button>
        <button
          type="button"
          style={{
            ...buttonStyle,
            ...(tab === "users"
              ? { background: "#245ff2", color: "#fff" }
              : {}),
          }}
          aria-pressed={tab === "users"}
          onClick={() => setTab("users")}
        >
          User Management
        </button>
        <span style={{ color: "#60748e", marginLeft: "auto", fontSize: 13 }}>
          {account.username} · Administrator
        </span>
      </nav>
      {tab === "monitoring" ? (
        <AdminSecurityDashboard onBackToLogin={onBack} />
      ) : (
        <AdminUsersPanel onBack={onBack} onSessionExpired={onSessionExpired} />
      )}
    </>
  );
}

function App() {
  const [apiStatus, setApiStatus] = useState("checking");
  const [route, setRoute] = useState(currentPath);
  const [auth, setAuth] = useState({ status: "checking", account: null });
  const [authError, setAuthError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const checkVersion = useRef(0);
  const autoRedirected = useRef(false);

  const navigate = useCallback((path, replace = false) => {
    if (currentPath() !== path) {
      if (replace) window.history.replaceState(null, "", path);
      else window.history.pushState(null, "", path);
    }
    setRoute(path);
    window.scrollTo(0, 0);
  }, []);

  const checkSession = useCallback(async () => {
    const version = ++checkVersion.current;
    try {
      const serverAccount = await getCurrentUser();
      const account = normalizeAccount(serverAccount);
      if (version !== checkVersion.current) return;
      setAuth({ status: "authenticated", account });
      setAuthError("");
    } catch (error) {
      if (version !== checkVersion.current) return;
      if (error?.status === 401) {
        setAuth({ status: "guest", account: null });
        setAuthError("");
      } else {
        setAuth({ status: "unavailable", account: null });
        setAuthError("Unable to verify the current session with FastAPI.");
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function checkBackend() {
      try {
        const response = await fetch(`${getLoginApiBaseUrl()}/`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Backend unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) {
          setApiStatus(data.status === "success" ? "online" : "offline");
        }
      } catch (error) {
        if (error?.name !== "AbortError" && !controller.signal.aborted) {
          setApiStatus("offline");
        }
      }
    }
    checkBackend();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    checkSession();
    const onPopState = () => {
      setRoute(currentPath());
      checkSession();
    };
    const onAuthChanged = () => {
      autoRedirected.current = false;
      checkSession();
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") checkSession();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkSession();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("labgear:auth-changed", onAuthChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      ++checkVersion.current;
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("labgear:auth-changed", onAuthChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkSession]);

  useEffect(() => {
    if (
      auth.status === "authenticated" &&
      route === "/" &&
      !autoRedirected.current
    ) {
      autoRedirected.current = true;
      navigate(roleDestination(auth.account.role), true);
    }
  }, [auth, navigate, route]);

  const signOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    setAuthError("");
    try {
      await logoutSession();
      ++checkVersion.current;
      setAuth({ status: "guest", account: null });
      autoRedirected.current = false;
      navigate("/");
    } catch (error) {
      setAuthError(error?.message || "Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }, [navigate, signingOut]);

  const isDevelopmentPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "dashboard";

  // Preserve the existing development-only dashboard preview.
  if (isDevelopmentPreview) return <DashboardPreview />;

  if (auth.status === "checking") {
    return (
      <PageNotice
        title="LabGear"
        detail="Checking your secure login session…"
      />
    );
  }

  if (auth.status === "unavailable" && route !== "/") {
    return (
      <PageNotice
        title="Session unavailable"
        detail={authError}
        onRetry={checkSession}
        onBack={() => navigate("/")}
      />
    );
  }

  if (route === ADMIN_PATH) {
    // Retain server-audited monitoring access denials for non-admin accounts.
    // Only verified admin sessions see the additional user-management tab.
    const back = () =>
      navigate(auth.status === "authenticated" ? HOME_PATH : "/");
    if (auth.status !== "authenticated" || auth.account?.role !== "admin") {
      return <AdminSecurityDashboard onBackToLogin={back} />;
    }
    return (
      <AdminWorkspace
        account={auth.account}
        onBack={back}
        onSessionExpired={checkSession}
      />
    );
  }

  if (auth.status !== "authenticated") {
    if (route !== "/") {
      return (
        <PageNotice
          title="Sign in required"
          detail="Use the normal LabGear login and email OTP verification first."
          onBack={() => navigate("/")}
        />
      );
    }
    return <LandingPage apiStatus={apiStatus} />;
  }

  const account = auth.account;
  const home = () => navigate(HOME_PATH);
  const header = (title) => (
    <WorkspaceHeader
      account={account}
      title={title}
      busy={signingOut}
      onLogout={signOut}
      onHome={home}
    />
  );

  if (
    route === USER_PATH &&
    (account.role === "student" || account.role === "instructor")
  ) {
    return (
      <>
        {header("Equipment Reservations")}
        {authError && (
          <p role="alert" style={{ margin: 20, color: "#ae3c35" }}>
            {authError}
          </p>
        )}
        <StudentReservationWorkspace
          account={account}
          onSessionExpired={checkSession}
        />
      </>
    );
  }

  if (
    route === TECHNICIAN_PATH &&
    ["technician", "lab_technician", "laboratory_technician"].includes(
      account.role,
    )
  ) {
    return (
      <>
        {header("Laboratory Technician")}
        {authError && (
          <p role="alert" style={{ margin: 20, color: "#ae3c35" }}>
            {authError}
          </p>
        )}
        <TechnicianReservationWorkspace
          account={account}
          onSessionExpired={checkSession}
        />
      </>
    );
  }

  // Authenticated home: no privileged data or actions are exposed here.
  return (
    <>
      {header("Workspace")}
      <main style={boxStyle}>
        <h1 style={{ marginTop: 0 }}>Welcome, {account.username}</h1>
        <p style={{ color: "#64748b" }}>
          Authenticated as {account.role.replaceAll("_", " ")}.
        </p>
        {authError && (
          <p role="alert" style={{ color: "#ae3c35" }}>
            {authError}
          </p>
        )}
        <button
          type="button"
          style={buttonStyle}
          onClick={() => navigate(roleDestination(account.role))}
        >
          Open {account.role === "admin" ? "Security Monitoring" : "Dashboard"}
        </button>
      </main>
    </>
  );
}

export default App;
