/**
 * LabGear Frontend File 114 — technician approval, equipment issue and return workspace.
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

  const tabButton = (name, caption) => (
    <button
      type="button"
      onClick={() => {
        setView(name);
        setFeedback("");
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
                    minWidth: 680,
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
            Reservation Approvals
          </h1>
          <p style={{ color: "#60748e", lineHeight: 1.6, margin: 0 }}>
            Welcome, {account.username}. Review student and instructor requests,
            then approve or reject them. Approved requests allocate equipment
            units.
          </p>
        </div>

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
                        style={{ fontSize: 12, color: "#60748e", marginTop: 4 }}
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
                      {item.requester_name || item.requester_username || "—"}
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
                      {rejectionId === item.id ? "Cancel rejection" : "Reject"}
                    </button>
                  </div>
                  {rejectionId === item.id && (
                    <div style={{ marginTop: 15, display: "grid", gap: 10 }}>
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
                          busyId !== null || rejectionReason.trim().length < 5
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
                onClick={() => setPage((value) => Math.min(pages, value + 1))}
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
      </div>
    </main>
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
    // Mount even for non-admins so the backend enforces 401/403 and audits
    // authenticated access denials. Never trust client-side role checks here.
    return (
      <AdminSecurityDashboard
        onBackToLogin={() =>
          navigate(auth.status === "authenticated" ? HOME_PATH : "/")
        }
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
