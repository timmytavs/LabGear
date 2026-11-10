/**
 * LabGear Frontend File 108 — connected student/instructor reservation workspace.
 * REPLACE: frontend/src/App.jsx
 *
 * Preserves the existing landing page, authentication, admin monitoring,
 * technician workspace and explicit development-only dashboard preview.
 * Reads the current account from FastAPI GET /api/auth/me; never trusts a
 * browser-stored role. The admin monitoring API independently enforces admin
 * permission and records dashboard access/denials.
 *
 * A later LandingPage/LoginPanel integration step will dispatch
 * "labgear:auth-changed" after the email OTP login completes, so the app
 * navigates immediately without requiring a page reload. This file also
 * refreshes the session after a browser focus/visibility change and on reload.
 *
 * File 108: users may browse the live catalog, submit real reservations via
 * POST /api/reservations, and view their own reservations from PostgreSQL.
 * The existing catalog modal remains preview-only; use Quick Reservation for
 * a real submission. Server-side session/CSRF/role/stock rules stay in FastAPI.
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
    const message =
      typeof detail === "string" && detail.trim()
        ? detail
        : response.status === 401
          ? "Your session has expired. Sign in again."
          : response.status === 403
            ? "This action was not authorized. Sign in again if necessary."
            : response.status === 422
              ? "Check the dates, quantity and reservation details."
              : `LabGear request failed (HTTP ${response.status}).`;
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
  const [draft, setDraft] = useState({
    equipment_id: "",
    quantity: "1",
    reservation_start: "",
    reservation_end: "",
    purpose: "",
  });

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
  const dateText = (dateString) => {
    const date = new Date(dateString);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  };

  async function submitReservation(event) {
    event.preventDefault();
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
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start.getTime() <= Date.now() ||
      end.getTime() <= start.getTime()
    ) {
      setFeedback(
        "Choose a future start time and an end time after the start.",
      );
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
      setDraft({
        equipment_id: "",
        quantity: "1",
        reservation_start: "",
        reservation_end: "",
        purpose: "",
      });
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
        {feedback && (
          <div role="status" style={{ ...reservationPanel, color: "#21467b" }}>
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
                      setDraft((d) => ({
                        ...d,
                        equipment_id: e.target.value,
                        quantity: "1",
                      }))
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
                        setDraft((d) => ({ ...d, quantity: e.target.value }))
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
                      value={draft.reservation_start}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          reservation_start: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label style={labelControl}>
                    Reservation End *
                    <input
                      style={formControl}
                      type="datetime-local"
                      required
                      value={draft.reservation_end}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          reservation_end: e.target.value,
                        }))
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
                      setDraft((d) => ({ ...d, purpose: e.target.value }))
                    }
                  />
                </label>
                {equipment.length === 0 && (
                  <p style={{ color: "#9b1c1c" }}>
                    No reservable equipment loaded. Add active inventory or
                    retry the catalog connection.
                  </p>
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
        <main style={boxStyle}>
          <h1 style={{ marginTop: 0 }}>Technician Workspace</h1>
          <p>Welcome, {account.username}.</p>
          <p style={{ maxWidth: 660, color: "#64748b", lineHeight: 1.6 }}>
            Your staff session is verified. Equipment approval, issuance, and
            return management will be connected in the next backend/frontend
            steps.
          </p>
          {authError && (
            <p role="alert" style={{ color: "#ae3c35" }}>
              {authError}
            </p>
          )}
        </main>
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
