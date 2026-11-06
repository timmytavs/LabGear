import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Eye,
  Search,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";

import "../../styles/technician-damage.css";

const severityOptions = ["minor", "moderate", "severe"];

const statusLabels = {
  unreported: "Awaiting Report",
  open: "Open",
  in_review: "In Review",
  resolved: "Resolved",
};

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TechnicianDamageReports({
  transactions = [],
  reports = [],
  setReports,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState(null);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("minor");
  const [nextStatus, setNextStatus] = useState("in_review");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Returned damaged units without a damage report.
  const unreported = useMemo(() => {
    return transactions.filter(
      (item) =>
        item.status === "returned" &&
        item.returnCondition === "damaged" &&
        !reports.some((report) => report.transactionId === item.id),
    );
  }, [transactions, reports]);

  // Combine awaiting-report items with submitted reports.
  const rows = useMemo(() => {
    const waitingRows = unreported.map((transaction) => ({
      key: `pending-${transaction.id}`,
      transaction,
      report: null,
      status: "unreported",
    }));

    const filedRows = reports
      .map((report) => {
        const transaction = transactions.find(
          (item) => item.id === report.transactionId,
        );

        if (!transaction) return null;

        return {
          key: `report-${report.id}`,
          transaction,
          report,
          status: report.resolutionStatus,
        };
      })
      .filter(Boolean);

    return [...waitingRows, ...filedRows];
  }, [unreported, reports, transactions]);

  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();

    return rows.filter((row) => {
      const matchesSearch = [
        row.transaction.equipment,
        row.transaction.assetTag,
        row.transaction.borrower,
        row.transaction.code,
        row.report?.code || "",
      ].some((value) => value.toLowerCase().includes(query));

      return matchesSearch && (filter === "all" || row.status === filter);
    });
  }, [rows, search, filter]);

  const selected = rows.find((row) => row.key === selectedKey);

  function openDetails(row) {
    setSelectedKey(row.key);
    setDescription("");
    setSeverity("minor");
    setNextStatus(row.status === "open" ? "in_review" : "resolved");
    setResolutionNotes("");
    setError("");
  }

  function closeDetails() {
    setSelectedKey(null);
    setError("");
  }

  function createReport(event) {
    event.preventDefault();

    if (!selected || selected.report) return;

    if (description.trim().length < 10) {
      setError("Damage description must contain at least 10 characters.");
      return;
    }

    if (!severityOptions.includes(severity)) {
      setError("Please select a valid severity level.");
      return;
    }

    const transaction = selected.transaction;

    const newReport = {
      id: `demo-${transaction.id}`,
      code: `LG-DMG-DEMO-${transaction.id}`,
      transactionId: transaction.id,
      description: description.trim(),
      severity,
      resolutionStatus: "open",
      reportedAt: new Date().toISOString(),
      resolvedAt: null,
      resolutionNotes: "",
    };

    setReports((previous) => {
      if (previous.some((report) => report.transactionId === transaction.id)) {
        return previous;
      }

      return [...previous, newReport];
    });

    setNotice(
      `Demo damage report created for ${transaction.assetTag}. ` +
        "No PostgreSQL record was changed.",
    );

    closeDetails();
  }

  function updateResolution(event) {
    event.preventDefault();

    if (!selected?.report) return;

    const currentStatus = selected.report.resolutionStatus;

    const allowed =
      (currentStatus === "open" &&
        ["in_review", "resolved"].includes(nextStatus)) ||
      (currentStatus === "in_review" && nextStatus === "resolved");

    if (!allowed) {
      setError("This resolution status change is not allowed.");
      return;
    }

    if (nextStatus === "resolved" && resolutionNotes.trim().length < 5) {
      setError("Please provide resolution notes of at least 5 characters.");
      return;
    }

    setReports((previous) =>
      previous.map((report) =>
        report.id === selected.report.id
          ? {
              ...report,
              resolutionStatus: nextStatus,
              resolutionNotes: resolutionNotes.trim(),
              resolvedAt:
                nextStatus === "resolved" ? new Date().toISOString() : null,
            }
          : report,
      ),
    );

    setNotice(`Report ${selected.report.code} updated in the local preview.`);

    closeDetails();
  }

  const count = (status) => rows.filter((row) => row.status === status).length;

  return (
    <section className="lgdm-page">
      <div className="lgdm-banner">
        <div>
          <span>LABORATORY TECHNICIAN</span>
          <h2>Equipment Damage Reports</h2>
          <p>Document damaged equipment and monitor its resolution progress.</p>
        </div>
        <Wrench size={34} />
      </div>

      <div className="lgdm-stats">
        <Stat label="Awaiting Report" value={count("unreported")} />
        <Stat label="Open Reports" value={count("open")} />
        <Stat label="In Review" value={count("in_review")} />
        <Stat label="Resolved" value={count("resolved")} />
      </div>

      <div className="lgdm-toolbar">
        <div className="lgdm-search">
          <Search size={19} />
          <input
            type="search"
            aria-label="Search damage reports"
            placeholder="Search equipment, borrower, or asset tag"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          aria-label="Filter damage reports"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="unreported">Awaiting Report</option>
          <option value="open">Open</option>
          <option value="in_review">In Review</option>
          <option value="resolved">Resolved</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setSearch("");
            setFilter("all");
          }}
        >
          Reset
        </button>
      </div>

      {notice && (
        <div className="lgdm-notice" role="status">
          <CheckCircle2 size={19} />
          <p>{notice}</p>
        </div>
      )}

      <div className="lgdm-section-heading">
        <h3>Damage Records</h3>
        <span>{filtered.length} records</span>
      </div>

      {filtered.length === 0 ? (
        <div className="lgdm-empty">
          <ClipboardList size={36} />
          <h3>No damage reports found</h3>
          <p>
            To create a sample report, open Returns and record an issued item
            with the condition Damaged.
          </p>
        </div>
      ) : (
        <div className="lgdm-table-wrap">
          <table className="lgdm-table">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Asset Tag</th>
                <th>Borrower</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((row) => (
                <tr key={row.key}>
                  <td>
                    <div className="lgdm-equipment">
                      <img src={row.transaction.image} alt="" />
                      <div>
                        <strong>{row.transaction.equipment}</strong>
                        <small>
                          {row.report?.code || row.transaction.code}
                        </small>
                      </div>
                    </div>
                  </td>

                  <td>{row.transaction.assetTag}</td>
                  <td>{row.transaction.borrower}</td>

                  <td>{row.report ? row.report.severity : "Not assigned"}</td>

                  <td>
                    <span className={`lgdm-status ${row.status}`}>
                      {statusLabels[row.status]}
                    </span>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="lgdm-view"
                      onClick={() => openDetails(row)}
                    >
                      <Eye size={16} />
                      {row.report ? "View" : "Create Report"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="lgdm-information">
        <ShieldAlert size={20} />
        <p>
          Frontend preview only. These reports exist in React memory and reset
          when the browser reloads. The real backend will verify technician
          permissions, prevent duplicate reports, and update equipment condition
          through PostgreSQL transactions.
        </p>
      </div>

      {selected && (
        <div
          className="lgdm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDetails();
            }
          }}
        >
          <div
            className="lgdm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lgdm-modal-title"
          >
            <button
              type="button"
              className="lgdm-close"
              onClick={closeDetails}
              aria-label="Close damage report"
            >
              <X size={20} />
            </button>

            <div className="lgdm-modal-heading">
              <AlertTriangle size={27} />
              <div>
                <h2 id="lgdm-modal-title">
                  {selected.report
                    ? "Damage Report Details"
                    : "Create Damage Report"}
                </h2>
                <p>
                  {selected.transaction.equipment} ·{" "}
                  {selected.transaction.assetTag}
                </p>
              </div>
            </div>

            <div className="lgdm-detail-list">
              <Detail label="Borrower" value={selected.transaction.borrower} />
              <Detail label="Reservation" value={selected.transaction.code} />
              <Detail
                label="Returned At"
                value={formatDate(selected.transaction.returnedAt)}
              />
              <Detail
                label="Return Condition"
                value={selected.transaction.returnCondition}
              />
            </div>

            {!selected.report ? (
              <form className="lgdm-form" onSubmit={createReport}>
                <label htmlFor="lgdm-description">Damage Description *</label>
                <textarea
                  id="lgdm-description"
                  rows={4}
                  placeholder="Describe the observed damage..."
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setError("");
                  }}
                  required
                />

                <label htmlFor="lgdm-severity">Damage Severity *</label>
                <select
                  id="lgdm-severity"
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value)}
                >
                  <option value="minor">Minor</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                </select>

                {error && (
                  <p className="lgdm-error" role="alert">
                    {error}
                  </p>
                )}

                <button type="submit" className="lgdm-primary">
                  Create Demo Report
                </button>
              </form>
            ) : (
              <>
                <div className="lgdm-detail-list">
                  <Detail label="Report Code" value={selected.report.code} />
                  <Detail label="Severity" value={selected.report.severity} />
                  <Detail
                    label="Description"
                    value={selected.report.description}
                  />
                  <Detail
                    label="Status"
                    value={statusLabels[selected.report.resolutionStatus]}
                  />
                  <Detail
                    label="Reported At"
                    value={formatDate(selected.report.reportedAt)}
                  />
                  <Detail
                    label="Resolution Notes"
                    value={selected.report.resolutionNotes || "—"}
                  />
                </div>

                {selected.report.resolutionStatus !== "resolved" && (
                  <form className="lgdm-form" onSubmit={updateResolution}>
                    <h3>Update Resolution</h3>

                    <label htmlFor="lgdm-resolution">New Status *</label>
                    <select
                      id="lgdm-resolution"
                      value={nextStatus}
                      onChange={(event) => {
                        setNextStatus(event.target.value);
                        setError("");
                      }}
                    >
                      {selected.report.resolutionStatus === "open" && (
                        <option value="in_review">In Review</option>
                      )}
                      <option value="resolved">Resolved</option>
                    </select>

                    <label htmlFor="lgdm-resolution-notes">
                      Resolution Notes
                      {nextStatus === "resolved" && " *"}
                    </label>
                    <textarea
                      id="lgdm-resolution-notes"
                      rows={3}
                      placeholder="Describe inspection or repair actions..."
                      value={resolutionNotes}
                      onChange={(event) => {
                        setResolutionNotes(event.target.value);
                        setError("");
                      }}
                    />

                    {error && (
                      <p className="lgdm-error" role="alert">
                        {error}
                      </p>
                    )}

                    <button type="submit" className="lgdm-primary">
                      Save Demo Status
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="lgdm-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="lgdm-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
