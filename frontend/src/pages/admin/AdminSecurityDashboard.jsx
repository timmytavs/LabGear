/**
 * LabGear Frontend File 95 — admin security monitoring dashboard.
 * CREATE: frontend/src/pages/admin/AdminSecurityDashboard.jsx
 *
 * Reads the existing File 89 GET /api/admin/monitoring endpoint, mounted by
 * File 90. Access control is ALWAYS enforced by FastAPI; this component does
 * not grant roles or create admin accounts.
 *
 * No third-party chart library or additional CSS file is needed. Styles are
 * scoped to .lg-admin-monitor. React displays untrusted audit text safely.
 *
 * Include in the frontend router in a later one-file-at-a-time step.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Ban,
  CheckCircle2,
  Clock3,
  Filter,
  KeyRound,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";

const POLL_MS = 60_000;
const DEFAULT_API_URL = "http://localhost:8000";
const EMPTY_FILTERS = Object.freeze({
  date_from: "",
  date_to: "",
  event_type: "",
  username: "",
  ip_address: "",
});

function loopback(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function apiOrigin() {
  const configured =
    import.meta.env?.VITE_LABGEAR_API_BASE_URL?.trim() || DEFAULT_API_URL;
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("The LabGear API address is not configured correctly.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== "/")
  ) {
    throw new Error("The LabGear API URL must be a plain HTTP(S) origin.");
  }
  // localhost and 127.0.0.1 do not share authentication cookies.
  if (loopback(window.location.hostname) && loopback(url.hostname)) {
    url.hostname = window.location.hostname;
  }
  return url.origin;
}

function manilaDateTime(raw) {
  if (typeof raw !== "string" || !raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function hourLabel(raw) {
  if (typeof raw !== "string") return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(11, 16) || "—";
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    hour12: true,
  }).format(date);
}

function safeCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function plainText(value, limit = 140) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value.slice(0, limit);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return "[unavailable]";
  }
}

async function readMonitoring(filters, signal) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    const cleaned = String(value || "").trim();
    if (cleaned) query.set(key, cleaned);
  });
  const qs = query.toString();
  const address = `${apiOrigin()}/api/admin/monitoring${qs ? `?${qs}` : ""}`;
  let response;
  try {
    response = await fetch(address, {
      method: "GET",
      mode: "cors",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw Object.assign(
      new Error(
        "Cannot connect to LabGear FastAPI. Check that port 8000 is running.",
      ),
      { status: 0 },
    );
  }

  if (!response.ok) {
    const message =
      response.status === 401
        ? "Your session has expired. Sign in again using password and email OTP."
        : response.status === 403
          ? "Access denied. Security monitoring is restricted to administrators."
          : response.status === 422
            ? "One or more filters are invalid. Check the dates and IP address."
            : response.status >= 500
              ? "The security monitoring service is temporarily unavailable."
              : "Monitoring data could not be loaded.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  const payload = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !payload.summary
  ) {
    throw new Error("The monitoring service returned an unexpected response.");
  }
  return payload;
}

const STYLES = `
.lg-admin-monitor{min-height:100vh;background:#f4f7fc;color:#14243e;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.lg-admin-monitor *{box-sizing:border-box}
.lg-admin-monitor .lgadm-container{max-width:1440px;margin:auto;padding:29px clamp(16px,4vw,48px) 56px}
.lg-admin-monitor .lgadm-header{display:flex;gap:20px;align-items:center;justify-content:space-between;margin-bottom:23px;flex-wrap:wrap}
.lg-admin-monitor .lgadm-eyebrow{color:#416ad5;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-bottom:7px}
.lg-admin-monitor h1{font-size:clamp(24px,3vw,34px);line-height:1.2;margin:0 0 7px;font-weight:800;letter-spacing:-.03em}
.lg-admin-monitor .lgadm-subtitle{color:#62738d;font-size:14px;margin:0}
.lg-admin-monitor .lgadm-header-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.lg-admin-monitor button{font:inherit;cursor:pointer}
.lg-admin-monitor button:disabled{cursor:not-allowed;opacity:.55}
.lg-admin-monitor .lgadm-button{border:1px solid #d6e0f1;border-radius:10px;padding:10px 13px;background:white;color:#254269;display:inline-flex;gap:8px;align-items:center;font-weight:700;font-size:13px}
.lg-admin-monitor .lgadm-button-primary{background:#245ff2;border-color:#245ff2;color:white}
.lg-admin-monitor .lgadm-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:#69809e;margin:0 0 21px;flex-wrap:wrap}
.lg-admin-monitor .lgadm-dot{height:7px;width:7px;border-radius:50%;background:#22ad7c;display:inline-block}
.lg-admin-monitor .lgadm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:20px}
.lg-admin-monitor .lgadm-stat,.lg-admin-monitor .lgadm-panel{background:#fff;border:1px solid #e1e8f3;border-radius:16px;box-shadow:0 6px 20px rgba(30,65,125,.035)}
.lg-admin-monitor .lgadm-stat{padding:18px 19px;display:flex;justify-content:space-between;gap:10px;min-height:108px}
.lg-admin-monitor .lgadm-stat-value{font-size:28px;line-height:1.15;font-weight:800;margin:11px 0 0;color:#152947}
.lg-admin-monitor .lgadm-stat-label{font-size:12px;color:#667995;font-weight:650;line-height:1.4}
.lg-admin-monitor .lgadm-stat-icon{width:39px;height:39px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#eaf0ff;color:#3264dd;flex-shrink:0}
.lg-admin-monitor .lgadm-layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr);gap:18px;margin-bottom:18px}
.lg-admin-monitor .lgadm-panel{padding:20px;min-width:0;margin-bottom:18px}
.lg-admin-monitor .lgadm-layout .lgadm-panel{margin-bottom:0}
.lg-admin-monitor .lgadm-panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.lg-admin-monitor .lgadm-panel h2{font-size:16px;line-height:1.4;margin:0;font-weight:800}
.lg-admin-monitor .lgadm-panel p.lgadm-caption{font-size:12px;color:#71819a;margin:5px 0 0}
.lg-admin-monitor .lgadm-chart{height:215px;display:grid;grid-template-columns:repeat(24,minmax(0,1fr));align-items:end;gap:5px;border-bottom:1px solid #dce4ef;padding:18px 4px 0}
.lg-admin-monitor .lgadm-bar-wrap{min-width:0;height:100%;display:flex;align-items:end;justify-content:center;position:relative}
.lg-admin-monitor .lgadm-bar{width:100%;max-width:26px;background:linear-gradient(180deg,#3375ff,#2458d7);border-radius:5px 5px 0 0;min-height:2px}
.lg-admin-monitor .lgadm-chart-labels{display:flex;justify-content:space-between;color:#8997ab;font-size:11px;margin-top:10px}
.lg-admin-monitor .lgadm-empty{color:#7c8ba2;text-align:center;padding:28px 10px;font-size:13px}
.lg-admin-monitor .lgadm-rank{list-style:none;margin:0;padding:0}
.lg-admin-monitor .lgadm-rank li{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid #edf1f7;gap:12px;font-size:13px}
.lg-admin-monitor .lgadm-rank li:last-child{border-bottom:0}
.lg-admin-monitor .lgadm-rank code{font:600 12px ui-monospace,SFMono-Regular,Consolas,monospace;color:#324a69;word-break:break-all}
.lg-admin-monitor .lgadm-pill{display:inline-block;border-radius:999px;padding:5px 9px;background:#edf4ff;color:#315bb3;font-weight:750;font-size:11px;white-space:nowrap}
.lg-admin-monitor .lgadm-pill-danger{background:#fff0ee;color:#c45242}
.lg-admin-monitor .lgadm-pill-high{background:#ffeded;color:#c03a35}
.lg-admin-monitor .lgadm-pill-medium{background:#fff4de;color:#a57012}
.lg-admin-monitor .lgadm-pill-low{background:#e9f7f0;color:#168356}
.lg-admin-monitor .lgadm-form{display:grid;grid-template-columns:repeat(5,minmax(0,1fr)) auto;gap:10px;align-items:end}
.lg-admin-monitor .lgadm-field{min-width:0;display:flex;flex-direction:column;gap:6px}
.lg-admin-monitor .lgadm-field label{font-size:11px;font-weight:750;color:#516783}
.lg-admin-monitor .lgadm-field input{font:inherit;background:#fff;border:1px solid #d4deec;border-radius:9px;min-width:0;width:100%;height:40px;padding:0 10px;color:#233b5e;font-size:12px}
.lg-admin-monitor .lgadm-field input:focus{outline:2px solid #b7cbff;outline-offset:1px}
.lg-admin-monitor .lgadm-form-buttons{display:flex;gap:7px}
.lg-admin-monitor .lgadm-table-wrap{width:100%;overflow-x:auto}
.lg-admin-monitor table{width:100%;border-collapse:collapse;min-width:725px;font-size:12px}
.lg-admin-monitor th{text-align:left;background:#f7f9fd;color:#6d7f98;font-weight:800;padding:12px 11px;white-space:nowrap}
.lg-admin-monitor td{padding:12px 11px;border-bottom:1px solid #edf1f7;vertical-align:top;color:#334760;max-width:260px;overflow-wrap:anywhere}
.lg-admin-monitor tr:last-child td{border-bottom:0}
.lg-admin-monitor .lgadm-error{display:flex;gap:10px;align-items:flex-start;border-radius:12px;border:1px solid #f4c9c3;padding:15px 18px;background:#fff3f1;color:#9c3d34;margin-bottom:18px;font-size:14px}
.lg-admin-monitor .lgadm-gate{max-width:520px;margin:70px auto;background:#fff;border:1px solid #dce5f2;border-radius:19px;padding:35px;text-align:center}
.lg-admin-monitor .lgadm-gate h2{margin:12px 0;font-size:22px}
.lg-admin-monitor .lgadm-gate p{font-size:14px;color:#687b95;line-height:1.6}
.lg-admin-monitor .lgadm-gate-actions{display:flex;justify-content:center;margin-top:21px}
.lg-admin-monitor .lgadm-spinner{display:inline-block;height:14px;width:14px;border:2px solid #d7e5ff;border-top-color:#2760db;border-radius:50%;animation:lgadm-spin .8s linear infinite}
@keyframes lgadm-spin{to{transform:rotate(360deg)}}
@media(max-width:1100px){.lg-admin-monitor .lgadm-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.lg-admin-monitor .lgadm-form{grid-template-columns:repeat(3,minmax(0,1fr))}.lg-admin-monitor .lgadm-form-buttons{grid-column:span 3}}
@media(max-width:750px){.lg-admin-monitor .lgadm-layout{grid-template-columns:1fr}.lg-admin-monitor .lgadm-form{grid-template-columns:repeat(2,minmax(0,1fr))}.lg-admin-monitor .lgadm-form-buttons{grid-column:span 2}.lg-admin-monitor .lgadm-container{padding:20px 14px 40px}}
@media(max-width:420px){.lg-admin-monitor .lgadm-stats{grid-template-columns:1fr}.lg-admin-monitor .lgadm-form{grid-template-columns:1fr}.lg-admin-monitor .lgadm-form-buttons{grid-column:span 1}}
`;

function StatCard({ title, value, Icon }) {
  return (
    <div className="lgadm-stat">
      <div>
        <div className="lgadm-stat-label">{title}</div>
        <div className="lgadm-stat-value">
          {safeCount(value).toLocaleString("en-PH")}
        </div>
      </div>
      <div className="lgadm-stat-icon">
        <Icon size={20} aria-hidden="true" />
      </div>
    </div>
  );
}

export default function AdminSecurityDashboard({ onBackToLogin }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({ ...EMPTY_FILTERS });
  const [refreshNumber, setRefreshNumber] = useState(0);
  const [dashboard, setDashboard] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setStatus((current) => (current === "ready" ? "refreshing" : "loading"));
    setError("");
    readMonitoring(appliedFilters, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDashboard(result);
        setStatus("ready");
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure?.status === 401 || failure?.status === 403) {
          setDashboard(null);
          setStatus(failure.status === 401 ? "unauthenticated" : "forbidden");
        } else {
          setStatus("error");
        }
        setError(failure?.message || "Unable to load monitoring data.");
      });
    return () => controller.abort();
  }, [appliedFilters, refreshNumber]);

  const refresh = useCallback(() => setRefreshNumber((value) => value + 1), []);

  useEffect(() => {
    if (status !== "ready") return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh, status]);

  const graph = useMemo(() => {
    const records = Array.isArray(dashboard?.failed_logins_per_hour)
      ? dashboard.failed_logins_per_hour.slice(-24)
      : [];
    const highest = Math.max(
      1,
      ...records.map((item) => safeCount(item.failed_logins)),
    );
    return { records, highest };
  }, [dashboard]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    if (
      filters.date_from &&
      filters.date_to &&
      filters.date_from > filters.date_to
    ) {
      setError("The start date cannot be after the end date.");
      return;
    }
    setAppliedFilters({ ...filters });
    setRefreshNumber((value) => value + 1);
  }

  function clearFilters() {
    setFilters({ ...EMPTY_FILTERS });
    setAppliedFilters({ ...EMPTY_FILTERS });
    setRefreshNumber((value) => value + 1);
  }

  function backToLogin() {
    if (typeof onBackToLogin === "function") {
      onBackToLogin();
    } else {
      window.location.assign("/");
    }
  }

  const gated = status === "unauthenticated" || status === "forbidden";
  const summary = dashboard?.summary || {};
  const topIps = Array.isArray(dashboard?.top_ips) ? dashboard.top_ips : [];
  const flags = Array.isArray(dashboard?.flags) ? dashboard.flags : [];
  const events = Array.isArray(dashboard?.recent_events)
    ? dashboard.recent_events
    : [];

  return (
    <div className="lg-admin-monitor">
      <style>{STYLES}</style>
      {gated ? (
        <main className="lgadm-container">
          <div className="lgadm-gate" role="alert">
            {status === "forbidden" ? (
              <Ban size={38} color="#be5145" />
            ) : (
              <LockKeyhole size={38} color="#245ff2" />
            )}
            <h2>
              {status === "forbidden" ? "Access denied" : "Sign in required"}
            </h2>
            <p>{error}</p>
            <div className="lgadm-gate-actions">
              <button
                type="button"
                className="lgadm-button lgadm-button-primary"
                onClick={backToLogin}
              >
                <ArrowLeft size={16} /> Return to Login
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main className="lgadm-container">
          <header className="lgadm-header">
            <div>
              <div className="lgadm-eyebrow">LabGear · Administrator</div>
              <h1>Security Monitoring</h1>
              <p className="lgadm-subtitle">
                Read-only security overview and audit activity
              </p>
            </div>
            <div className="lgadm-header-actions">
              <button
                type="button"
                className="lgadm-button"
                onClick={backToLogin}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                type="button"
                className="lgadm-button lgadm-button-primary"
                onClick={refresh}
                disabled={status === "loading" || status === "refreshing"}
              >
                {status === "loading" || status === "refreshing" ? (
                  <span className="lgadm-spinner" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Refresh
              </button>
            </div>
          </header>

          <p className="lgadm-meta">
            <span className="lgadm-dot" />
            Auto-refresh every 60 seconds while visible
            <span>·</span>
            <Clock3 size={13} />
            Last updated: {manilaDateTime(dashboard?.generated_at)} PHT
            <span>·</span>
            {status === "refreshing" ? "Updating..." : "Read-only"}
          </p>

          {error && (
            <div className="lgadm-error" role="alert">
              <AlertTriangle size={19} /> <span>{error}</span>
            </div>
          )}
          {!dashboard ? (
            <div className="lgadm-panel lgadm-empty" role="status">
              {status === "loading"
                ? "Loading security monitoring data..."
                : "Monitoring data is unavailable. Use Refresh to retry."}
            </div>
          ) : (
            <>
              <section
                className="lgadm-stats"
                aria-label="Today's summary statistics"
              >
                <StatCard
                  title="Successful logins today"
                  value={summary.successful_logins}
                  Icon={CheckCircle2}
                />
                <StatCard
                  title="Failed logins today"
                  value={summary.failed_logins}
                  Icon={ShieldAlert}
                />
                <StatCard
                  title="Accounts locked now"
                  value={summary.accounts_locked_now}
                  Icon={LockKeyhole}
                />
                <StatCard
                  title="IPs blocked now"
                  value={summary.ips_blocked_now}
                  Icon={Ban}
                />
                <StatCard
                  title="OTPs issued today"
                  value={summary.otp_issued}
                  Icon={KeyRound}
                />
                <StatCard
                  title="OTP emails SMTP-accepted"
                  value={summary.otp_sent}
                  Icon={Mail}
                />
                <StatCard
                  title="Failed OTP attempts"
                  value={summary.otp_failed}
                  Icon={AlertTriangle}
                />
                <StatCard
                  title="Alert emails sent"
                  value={summary.alert_emails_sent}
                  Icon={ShieldCheck}
                />
              </section>

              <div className="lgadm-layout">
                <section
                  className="lgadm-panel"
                  aria-label="Failed logins per hour"
                >
                  <div className="lgadm-panel-header">
                    <div>
                      <h2>
                        <BarChart3
                          size={16}
                          style={{ verticalAlign: "-3px", marginRight: 7 }}
                        />
                        Failed Logins Per Hour
                      </h2>
                      <p className="lgadm-caption">
                        Last 24 hours · Philippine time
                      </p>
                    </div>
                    <span className="lgadm-pill">24-hour activity</span>
                  </div>
                  {graph.records.length ? (
                    <>
                      <div
                        className="lgadm-chart"
                        role="img"
                        aria-label={`Bar chart of failed logins for the last ${graph.records.length} hours`}
                      >
                        {graph.records.map((item, index) => {
                          const count = safeCount(item.failed_logins);
                          const percent = Math.max(
                            1,
                            (count / graph.highest) * 100,
                          );
                          return (
                            <div
                              key={`${item.hour}-${index}`}
                              className="lgadm-bar-wrap"
                              title={`${hourLabel(item.hour)} — ${count} failed logins`}
                            >
                              <div
                                className="lgadm-bar"
                                style={{
                                  height: `${percent}%`,
                                  opacity: count ? 1 : 0.18,
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="lgadm-chart-labels">
                        <span>{hourLabel(graph.records[0].hour)}</span>
                        <span>
                          {hourLabel(
                            graph.records[Math.floor(graph.records.length / 2)]
                              .hour,
                          )}
                        </span>
                        <span>
                          {hourLabel(
                            graph.records[graph.records.length - 1].hour,
                          )}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="lgadm-empty">No hourly data available.</div>
                  )}
                </section>

                <section
                  className="lgadm-panel"
                  aria-label="Top failed login IP addresses"
                >
                  <div className="lgadm-panel-header">
                    <div>
                      <h2>
                        <Users
                          size={16}
                          style={{ verticalAlign: "-3px", marginRight: 7 }}
                        />
                        Top Five IP Addresses
                      </h2>
                      <p className="lgadm-caption">
                        Highest failed-login counts · Last 24 hours
                      </p>
                    </div>
                  </div>
                  {topIps.length ? (
                    <ol className="lgadm-rank">
                      {topIps.map((item, index) => (
                        <li key={`${item.ip_address}-${index}`}>
                          <div>
                            <code>{plainText(item.ip_address, 45)}</code>
                            <div className="lgadm-caption">
                              {safeCount(item.distinct_usernames)} usernames
                            </div>
                          </div>
                          <div>
                            <span
                              className={
                                item.blocked_now
                                  ? "lgadm-pill lgadm-pill-danger"
                                  : "lgadm-pill"
                              }
                            >
                              {safeCount(item.failures)} failures
                              {item.blocked_now ? " · Blocked" : ""}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="lgadm-empty">
                      No failed-login IP addresses found.
                    </div>
                  )}
                </section>
              </div>

              <section className="lgadm-panel" aria-label="Security alerts">
                <div className="lgadm-panel-header">
                  <div>
                    <h2>
                      <ShieldAlert
                        size={16}
                        style={{ verticalAlign: "-3px", marginRight: 7 }}
                      />
                      Security Flags
                    </h2>
                    <p className="lgadm-caption">
                      Latest 50 findings from the monitoring script
                    </p>
                  </div>
                  <span className="lgadm-pill">{flags.length} findings</span>
                </div>
                {flags.length ? (
                  <div className="lgadm-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time (PHT)</th>
                          <th>Pattern</th>
                          <th>Target</th>
                          <th>Severity</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flags.map((flag, index) => (
                          <tr key={flag.id ?? index}>
                            <td>{manilaDateTime(flag.created_at)}</td>
                            <td>{plainText(flag.pattern_type, 50)}</td>
                            <td>{plainText(flag.target_value, 100)}</td>
                            <td>
                              <span
                                className={`lgadm-pill lgadm-pill-${String(flag.severity || "low").toLowerCase()}`}
                              >
                                {plainText(flag.severity, 12)}
                              </span>
                            </td>
                            <td>{plainText(flag.details, 170)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="lgadm-empty">
                    No security flags recorded yet. This is normal when no
                    detection rule has been triggered.
                  </div>
                )}
              </section>

              <section
                className="lgadm-panel"
                aria-label="Recent security activity"
              >
                <div className="lgadm-panel-header">
                  <div>
                    <h2>
                      <Activity
                        size={16}
                        style={{ verticalAlign: "-3px", marginRight: 7 }}
                      />
                      Activity Logs
                    </h2>
                    <p className="lgadm-caption">
                      Latest 50 events matching the selected filters
                    </p>
                  </div>
                  <span className="lgadm-pill">{events.length} events</span>
                </div>
                <form className="lgadm-form" onSubmit={applyFilters}>
                  {[
                    ["date_from", "From date", "date"],
                    ["date_to", "To date", "date"],
                    ["event_type", "Event type", "text"],
                    ["username", "Username", "text"],
                    ["ip_address", "IP address", "text"],
                  ].map(([name, label, type]) => (
                    <div key={name} className="lgadm-field">
                      <label htmlFor={`lgadm-${name}`}>{label}</label>
                      <input
                        id={`lgadm-${name}`}
                        type={type}
                        value={filters[name]}
                        maxLength={
                          name === "username"
                            ? 100
                            : name === "event_type"
                              ? 50
                              : 45
                        }
                        placeholder={type === "text" ? label : undefined}
                        onChange={(event) =>
                          updateFilter(name, event.target.value)
                        }
                      />
                    </div>
                  ))}
                  <div className="lgadm-form-buttons">
                    <button
                      className="lgadm-button lgadm-button-primary"
                      type="submit"
                    >
                      <Filter size={15} /> Apply
                    </button>
                    <button
                      className="lgadm-button"
                      type="button"
                      onClick={clearFilters}
                    >
                      Clear
                    </button>
                  </div>
                </form>
                <div className="lgadm-table-wrap" style={{ marginTop: 18 }}>
                  {events.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Time (PHT)</th>
                          <th>Event</th>
                          <th>Account</th>
                          <th>IP Address</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((event, index) => (
                          <tr key={event.id ?? index}>
                            <td>{manilaDateTime(event.created_at)}</td>
                            <td>{plainText(event.event_type, 60)}</td>
                            <td>
                              {plainText(
                                event.account_username ||
                                  event.username_typed ||
                                  event.user_id,
                                100,
                              )}
                            </td>
                            <td>{plainText(event.ip_address, 45)}</td>
                            <td>{plainText(event.details, 200)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="lgadm-empty">
                      No security events match the current filters.
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      )}
    </div>
  );
}
