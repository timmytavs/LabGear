import { useMemo, useState } from "react";
import {
  Activity,
  Ban,
  BarChart3,
  Clock3,
  KeyRound,
  LockKeyhole,
  Mail,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import "../../styles/admin-security.css";

// All records below are fictional security events.
// These are not actual account or database records.

const eventExamples = [
  ["LOGIN_FAILED", 5, "sampleuser", "192.0.2.45"],
  ["LOGIN_FAILED", 9, "sampleuser", "192.0.2.45"],
  ["LOGIN_FAILED", 13, "sampleuser", "192.0.2.45"],
  ["LOCKOUT_TIER_1", 14, "sampleuser", "192.0.2.45"],
  ["ALERT_EMAIL_SENT", 15, "sampleuser", "192.0.2.45"],
  ["OTP_SENT", 22, "instructor1", "198.51.100.18"],
  ["LOGIN_SUCCESS", 25, "instructor1", "198.51.100.18"],
  ["LOGIN_FAILED", 40, "student2", "203.0.113.12"],
  ["LOGIN_FAILED", 44, "student2", "203.0.113.12"],
  ["OTP_FAILED", 48, "student3", "203.0.113.28"],
  ["OTP_FAILED", 51, "student3", "203.0.113.28"],
  ["OTP_SENT", 55, "student3", "203.0.113.28"],
  ["REGISTERED", 75, "newstudent", "198.51.100.30"],
  ["ACCOUNT_VERIFIED", 82, "newstudent", "198.51.100.30"],
  ["LOGIN_FAILED", 115, "unknownuser", "203.0.113.14"],
  ["CAPTCHA_FAILED", 145, "unknownuser", "203.0.113.14"],
  ["CSRF_REJECTED", 180, "sampleuser", "192.0.2.45"],
  ["LOGIN_SUCCESS", 210, "technician1", "198.51.100.18"],
  ["LOGIN_FAILED", 270, "sampleuser", "192.0.2.45"],
  ["LOGIN_FAILED", 275, "sampleuser", "198.51.100.40"],
  ["LOGIN_FAILED", 280, "sampleuser", "203.0.113.12"],
  ["OTP_FAILED", 320, "student3", "203.0.113.28"],
  ["LOGIN_FAILED", 365, "student5", "203.0.113.14"],
  ["IP_BLOCKED", 370, "student5", "203.0.113.14"],
  ["LOGIN_FAILED", 430, "sampleuser", "192.0.2.45"],
  ["RESET_REQUESTED", 490, "student2", "203.0.113.12"],
  ["PASSWORD_CHANGED", 510, "student2", "203.0.113.12"],
  ["ALERT_EMAIL_SENT", 515, "student2", "203.0.113.12"],
  ["ADMIN_ACCESS_DENIED", 560, "student5", "203.0.113.14"],
  ["ADMIN_VIEWED_DASHBOARD", 610, "admin", "198.51.100.18"],
  ["LOGIN_FAILED", 740, "student6", "198.51.100.40"],
  ["LOGIN_FAILED", 930, "student6", "198.51.100.40"],
  ["OTP_SENT", 1020, "student6", "198.51.100.40"],
  ["LOGIN_SUCCESS", 1150, "student6", "198.51.100.40"],
  ["LOGIN_FAILED", 1300, "<script>alert(1)</script>", "203.0.113.14"],
  ["LOGIN_FAILED", 1550, "' OR '1'='1", "203.0.113.14"],
];

function buildDemoEvents() {
  const now = Date.now();

  return eventExamples.map((row, index) => ({
    id: index + 1,
    eventType: row[0],
    username: row[2],
    ip: row[3],
    createdAt: new Date(now - row[1] * 60000).toISOString(),
    userAgent: index % 2 === 0 ? "Chrome / Windows" : "Firefox / Windows",
    details: "Fictional security event for UI testing",
  }));
}

const demoFlags = [
  {
    id: 1,
    pattern: "IP over threshold",
    target: "192.0.2.45",
    severity: "HIGH",
    description: "Sample IP with repeated failed login attempts.",
  },
  {
    id: 2,
    pattern: "Account targeted",
    target: "sampleuser",
    severity: "MEDIUM",
    description: "Sample username targeted from multiple IP addresses.",
  },
  {
    id: 3,
    pattern: "OTP guessing",
    target: "student3",
    severity: "MEDIUM",
    description: "Illustrative repeated incorrect OTP entries.",
  },
  {
    id: 4,
    pattern: "Off-hours login",
    target: "technician1",
    severity: "LOW",
    description: "Illustrative login outside normal laboratory hours.",
  },
];

function phDate(dateValue) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(dateValue));

  const get = (type) => parts.find((part) => part.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function phDateTime(value) {
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventLabel(value) {
  return value.replaceAll("_", " ");
}

function StatCard({ icon: Icon, label, value, tone = "blue" }) {
  return (
    <div className="lgsec-stat">
      <div className={`lgsec-stat-icon ${tone}`}>
        <Icon size={20} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>Sample data</small>
    </div>
  );
}

export default function AdminSecurityMonitoring({ view = "security" }) {
  const events = useMemo(() => buildDemoEvents(), []);

  const [eventType, setEventType] = useState("all");
  const [username, setUsername] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const today = phDate(new Date());
  const last24Hours = Date.now() - 24 * 60 * 60 * 1000;

  const todayEvents = events.filter(
    (event) => phDate(event.createdAt) === today,
  );

  function countEvents(type) {
    return todayEvents.filter((event) => event.eventType === type).length;
  }

  const blockedIPs = ["203.0.113.14"];
  const lockedAccounts = ["sampleuser"];

  const stats = [
    {
      label: "Successful Logins",
      value: countEvents("LOGIN_SUCCESS"),
      icon: ShieldCheck,
      tone: "green",
    },
    {
      label: "Failed Logins",
      value: countEvents("LOGIN_FAILED"),
      icon: XCircle,
      tone: "red",
    },
    {
      label: "Accounts Locked Now",
      value: lockedAccounts.length,
      icon: LockKeyhole,
      tone: "orange",
    },
    {
      label: "IPs Blocked Now",
      value: blockedIPs.length,
      icon: Ban,
      tone: "red",
    },
    {
      label: "OTPs Sent",
      value: countEvents("OTP_SENT"),
      icon: KeyRound,
      tone: "blue",
    },
    {
      label: "Failed OTPs",
      value: countEvents("OTP_FAILED"),
      icon: ShieldAlert,
      tone: "orange",
    },
    {
      label: "Alert Emails Sent",
      value: countEvents("ALERT_EMAIL_SENT"),
      icon: Mail,
      tone: "blue",
    },
  ];

  // Generate one bar for every hour in the last 24 hours.
  const hourlyData = useMemo(() => {
    const hour = 60 * 60 * 1000;
    const end = Math.ceil(Date.now() / hour) * hour;

    return Array.from({ length: 24 }, (_, index) => {
      const start = end - (24 - index) * hour;
      const finish = start + hour;

      const count = events.filter((event) => {
        const time = new Date(event.createdAt).getTime();

        return (
          event.eventType === "LOGIN_FAILED" && time >= start && time < finish
        );
      }).length;

      return {
        label: new Date(start).toLocaleTimeString("en-PH", {
          timeZone: "Asia/Manila",
          hour: "2-digit",
          hour12: false,
        }),
        count,
      };
    });
  }, [events]);

  const maxHourlyCount = Math.max(1, ...hourlyData.map((entry) => entry.count));

  const topIPs = useMemo(() => {
    const counts = new Map();

    for (const event of events) {
      if (
        event.eventType !== "LOGIN_FAILED" ||
        new Date(event.createdAt).getTime() < last24Hours
      ) {
        continue;
      }

      counts.set(event.ip, (counts.get(event.ip) || 0) + 1);
    }

    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [events, last24Hours]);

  const eventTypes = [
    ...new Set(events.map((event) => event.eventType)),
  ].sort();

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => {
        const date = phDate(event.createdAt);

        return (
          (eventType === "all" || event.eventType === eventType) &&
          event.username
            .toLowerCase()
            .includes(username.trim().toLowerCase()) &&
          event.ip.includes(ipAddress.trim()) &&
          (!dateFrom || date >= dateFrom) &&
          (!dateTo || date <= dateTo)
        );
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
  }, [events, eventType, username, ipAddress, dateFrom, dateTo]);

  function resetFilters() {
    setEventType("all");
    setUsername("");
    setIpAddress("");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <section className="lgsec-page">
      <div className="lgsec-banner">
        <div>
          <span>LABGEAR SECURITY CENTER</span>
          <h2>{view === "logs" ? "Activity Logs" : "Security Monitoring"}</h2>
          <p>
            {view === "logs"
              ? "Review and filter recorded security activities."
              : "Monitor authentication activity, suspicious events, and security alerts."}
          </p>
        </div>

        {view === "logs" ? <Activity size={34} /> : <ShieldCheck size={34} />}
      </div>

      <div className="lgsec-demo-notice">
        <ShieldAlert size={19} />
        <p>
          <strong>Development preview:</strong> All security events, lockouts,
          IP blocks and flags are fictional. No real account activity is being
          monitored.
        </p>
      </div>

      {view === "security" && (
        <>
          <div className="lgsec-section-heading">
            <div>
              <h3>Today's Security Summary</h3>
              <p>Philippine time — {today}</p>
            </div>
          </div>

          <div className="lgsec-stat-grid">
            {stats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>

          <div className="lgsec-monitor-grid">
            <section className="lgsec-panel">
              <div className="lgsec-panel-heading">
                <div>
                  <h3>
                    <BarChart3 size={19} />
                    Failed Logins Per Hour
                  </h3>
                  <p>Last 24 hours · PHT</p>
                </div>
              </div>

              <div
                className="lgsec-chart"
                role="img"
                aria-label="24-hour bar chart of sample failed logins"
              >
                {hourlyData.map((item, index) => {
                  const level =
                    item.count === 0
                      ? 0
                      : Math.max(
                          1,
                          Math.round((item.count / maxHourlyCount) * 10),
                        );

                  return (
                    <div className="lgsec-chart-column" key={index}>
                      <div className="lgsec-chart-track">
                        <div
                          className={`lgsec-bar level-${level}`}
                          title={`${item.label}:00 — ${item.count} failures`}
                        />
                      </div>
                      <small>{index % 4 === 0 ? item.label : ""}</small>
                    </div>
                  );
                })}
              </div>

              <p className="lgsec-chart-footnote">
                Each column represents one hour. Bar heights reflect the
                fictional events currently loaded.
              </p>
            </section>

            <section className="lgsec-panel">
              <div className="lgsec-panel-heading">
                <div>
                  <h3>
                    <Ban size={19} />
                    Top IP Addresses
                  </h3>
                  <p>Most failed logins in 24 hours</p>
                </div>
              </div>

              <div className="lgsec-ip-list">
                {topIPs.map(([ip, failures], index) => (
                  <div className="lgsec-ip-row" key={ip}>
                    <div>
                      <span className="lgsec-rank">{index + 1}</span>
                      <div>
                        <strong>{ip}</strong>
                        <small>{failures} failed attempts</small>
                      </div>
                    </div>

                    <span
                      className={
                        blockedIPs.includes(ip)
                          ? "lgsec-ip-status blocked"
                          : "lgsec-ip-status"
                      }
                    >
                      {blockedIPs.includes(ip) ? "Blocked" : "Not Blocked"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="lgsec-panel lgsec-flags-panel">
            <div className="lgsec-panel-heading">
              <div>
                <h3>
                  <ShieldAlert size={20} />
                  Security Detection Flags
                </h3>
                <p>Four example patterns for the future monitoring script</p>
              </div>
            </div>

            <div className="lgsec-flags-grid">
              {demoFlags.map((flag) => (
                <div className="lgsec-flag" key={flag.id}>
                  <div className="lgsec-flag-top">
                    <strong>{flag.pattern}</strong>
                    <span
                      className={`lgsec-severity ${flag.severity.toLowerCase()}`}
                    >
                      {flag.severity}
                    </span>
                  </div>

                  <code>{flag.target}</code>
                  <p>{flag.description}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="lgsec-panel lgsec-events-panel">
        <div className="lgsec-panel-heading">
          <div>
            <h3>
              <Clock3 size={20} />
              {view === "logs"
                ? "Security Activity Log"
                : "Recent Security Events"}
            </h3>
            <p>Latest 50 matching records at most</p>
          </div>
          <span className="lgsec-count">{filteredEvents.length} shown</span>
        </div>

        <div className="lgsec-filters">
          <label>
            Event Type
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
            >
              <option value="all">All Events</option>
              {eventTypes.map((type) => (
                <option value={type} key={type}>
                  {eventLabel(type)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Username
            <div className="lgsec-filter-input">
              <Search size={15} />
              <input
                type="search"
                placeholder="Search username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </label>

          <label>
            IP Address
            <input
              type="search"
              placeholder="Search IP"
              value={ipAddress}
              onChange={(event) => setIpAddress(event.target.value)}
            />
          </label>

          <label>
            Date From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>

          <label>
            Date To
            <input
              type="date"
              min={dateFrom || undefined}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>

          <button type="button" onClick={resetFilters}>
            Reset Filters
          </button>
        </div>

        <div className="lgsec-table-wrap">
          <table className="lgsec-table">
            <thead>
              <tr>
                <th>Date / Time (PHT)</th>
                <th>Event Type</th>
                <th>Username</th>
                <th>IP Address</th>
                <th>Browser / Device</th>
              </tr>
            </thead>

            <tbody>
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan="5" className="lgsec-no-records">
                    No matching security events.
                  </td>
                </tr>
              ) : (
                filteredEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{phDateTime(event.createdAt)}</td>
                    <td>
                      <span className="lgsec-event-label">
                        {eventLabel(event.eventType)}
                      </span>
                    </td>
                    <td>{event.username}</td>
                    <td>{event.ip}</td>
                    <td>{event.userAgent}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="lgsec-readonly-note">
        <LockKeyhole size={19} />
        <p>
          Security records are displayed read-only. Editing, deleting, and
          clearing logs are not available. Actual permission checks and
          append-only log protection will be enforced by FastAPI and PostgreSQL.
        </p>
      </div>
    </section>
  );
}
