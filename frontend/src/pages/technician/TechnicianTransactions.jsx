import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Eye,
  PackageCheck,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";

import microscopeImage from "../../assets/microscope.svg";
import arduinoImage from "../../assets/arduino-kit.svg";
import routerImage from "../../assets/network-router.svg";

import "../../styles/technician-transactions.css";

// Demo data only. Never used as real inventory.
export const sampleTransactions = [
  {
    id: 201,
    code: "LG-RES-DEMO-201",
    borrower: "Sample Student A",
    equipment: "Arduino Starter Kit",
    image: arduinoImage,
    assetTag: "ARD-006",
    status: "approved",
    scheduledEnd: "2026-11-12T17:00",
    issuedAt: null,
    dueAt: null,
    returnedAt: null,
    issueCondition: null,
    returnCondition: null,
    notes: "",
  },
  {
    id: 202,
    code: "LG-RES-DEMO-202",
    borrower: "Sample Instructor B",
    equipment: "Laboratory Microscope",
    image: microscopeImage,
    assetTag: "MIC-004",
    status: "approved",
    scheduledEnd: "2026-11-16T16:00",
    issuedAt: null,
    dueAt: null,
    returnedAt: null,
    issueCondition: null,
    returnCondition: null,
    notes: "",
  },
  {
    id: 203,
    code: "LG-RES-DEMO-203",
    borrower: "Sample Student C",
    equipment: "Network Router",
    image: routerImage,
    assetTag: "RTR-003",
    status: "issued",
    scheduledEnd: "2026-11-08T17:00",
    issuedAt: "2026-10-30T09:00:00+08:00",
    dueAt: "2026-11-08T17:00:00+08:00",
    returnedAt: null,
    issueCondition: "good",
    returnCondition: null,
    notes: "",
  },
  {
    id: 204,
    code: "LG-RES-DEMO-204",
    borrower: "Sample Student D",
    equipment: "Arduino Starter Kit",
    image: arduinoImage,
    assetTag: "ARD-009",
    status: "issued",
    scheduledEnd: "2026-11-04T16:00",
    issuedAt: "2026-10-31T10:00:00+08:00",
    dueAt: "2026-11-04T16:00:00+08:00",
    returnedAt: null,
    issueCondition: "good",
    returnCondition: null,
    notes: "",
  },
  {
    id: 205,
    code: "LG-RES-DEMO-205",
    borrower: "Sample Instructor E",
    equipment: "Laboratory Microscope",
    image: microscopeImage,
    assetTag: "MIC-008",
    status: "returned",
    scheduledEnd: "2026-10-31T17:00",
    issuedAt: "2026-10-28T09:00:00+08:00",
    dueAt: "2026-10-31T17:00:00+08:00",
    returnedAt: "2026-10-30T16:00:00+08:00",
    issueCondition: "good",
    returnCondition: "good",
    notes: "Returned in good condition.",
  },
];

const statusLabels = {
  approved: "Ready to Issue",
  issued: "Issued",
  returned: "Returned",
};

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TechnicianTransactions({
  view = "issuance",
  transactions,
  setTransactions,
}) {
  const isIssuance = view === "issuance";

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [issueDue, setIssueDue] = useState("");
  const [issueCondition, setIssueCondition] = useState("good");
  const [returnCondition, setReturnCondition] = useState("good");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = transactions.find((item) => item.id === selectedId);

  const displayRecords = useMemo(() => {
    return transactions.filter((item) => {
      const belongsToPage = isIssuance
        ? ["approved", "issued"].includes(item.status)
        : ["issued", "returned"].includes(item.status);

      const query = search.toLowerCase().trim();

      const matchesSearch = [
        item.code,
        item.borrower,
        item.equipment,
        item.assetTag,
      ].some((value) => value.toLowerCase().includes(query));

      const matchesFilter = filter === "all" || item.status === filter;

      return belongsToPage && matchesSearch && matchesFilter;
    });
  }, [transactions, isIssuance, search, filter]);

  const count = (status) =>
    transactions.filter((item) => item.status === status).length;

  useEffect(() => {
    setSearch("");
    setFilter("all");
    setNotice("");
    setSelectedId(null);
  }, [view]);

  useEffect(() => {
    if (selectedId === null) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setSelectedId(null);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedId]);

  function openDetails(item) {
    setSelectedId(item.id);
    setIssueDue(item.scheduledEnd || "");
    setIssueCondition("good");
    setReturnCondition("good");
    setNotes("");
    setError("");
  }

  function closeDetails() {
    setSelectedId(null);
    setError("");
  }

  function confirmAction(event) {
    event.preventDefault();

    if (!selected) return;

    if (isIssuance) {
      if (selected.status !== "approved") return;

      const due = new Date(issueDue);

      if (
        !issueDue ||
        Number.isNaN(due.getTime()) ||
        due.getTime() <= Date.now()
      ) {
        setError("Please select a valid future due date.");
        return;
      }

      setTransactions((previous) =>
        previous.map((item) =>
          item.id === selected.id && item.status === "approved"
            ? {
                ...item,
                status: "issued",
                issuedAt: new Date().toISOString(),
                dueAt: due.toISOString(),
                issueCondition,
                notes: notes.trim(),
              }
            : item,
        ),
      );

      setNotice(
        `${selected.equipment} (${selected.assetTag}) was marked ` +
          "as issued in the local preview. Open Returns to inspect it.",
      );
    } else {
      if (selected.status !== "issued") return;

      if (returnCondition !== "good" && notes.trim().length < 5) {
        setError(
          "Enter at least 5 characters describing the equipment condition.",
        );
        return;
      }

      setTransactions((previous) =>
        previous.map((item) =>
          item.id === selected.id && item.status === "issued"
            ? {
                ...item,
                status: "returned",
                returnedAt: new Date().toISOString(),
                returnCondition,
                notes: notes.trim(),
              }
            : item,
        ),
      );

      setNotice(
        `${selected.equipment} (${selected.assetTag}) was marked ` +
          "as returned in the local preview. No inventory was updated.",
      );
    }

    closeDetails();
  }

  return (
    <section className="lgtx-page">
      <div className="lgtx-banner">
        <div>
          <span>LABORATORY TECHNICIAN</span>
          <h2>{isIssuance ? "Equipment Issuance" : "Equipment Returns"}</h2>
          <p>
            {isIssuance
              ? "Release approved laboratory equipment and record borrowing details."
              : "Receive borrowed equipment and inspect its condition."}
          </p>
        </div>

        {isIssuance ? <PackageCheck size={34} /> : <RotateCcw size={34} />}
      </div>

      <div className="lgtx-stats">
        <Stat label="Ready to Issue" value={count("approved")} />
        <Stat label="Currently Issued" value={count("issued")} />
        <Stat label="Returned" value={count("returned")} />
      </div>

      <div className="lgtx-toolbar">
        <div className="lgtx-search">
          <Search size={19} />

          <input
            type="search"
            aria-label="Search equipment transactions"
            placeholder="Search equipment, borrower, or asset tag"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          aria-label="Filter transaction status"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All Statuses</option>

          {isIssuance ? (
            <>
              <option value="approved">Ready to Issue</option>
              <option value="issued">Issued</option>
            </>
          ) : (
            <>
              <option value="issued">Awaiting Return</option>
              <option value="returned">Returned</option>
            </>
          )}
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
        <div className="lgtx-notice" role="status">
          <CheckCircle2 size={19} />
          <p>{notice}</p>
        </div>
      )}

      <div className="lgtx-section-title">
        <h3>{isIssuance ? "Issuance Records" : "Return Records"}</h3>
        <span>{displayRecords.length} records</span>
      </div>

      {displayRecords.length === 0 ? (
        <div className="lgtx-empty">
          <ClipboardCheck size={34} />
          <h3>No matching equipment</h3>
          <p>Try changing your search or status filter.</p>
        </div>
      ) : (
        <div className="lgtx-table-wrap">
          <table className="lgtx-table">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Borrower</th>
                <th>Asset Tag</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {displayRecords.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="lgtx-equipment-cell">
                      <img src={item.image} alt="" />
                      <div>
                        <strong>{item.equipment}</strong>
                        <small>{item.code}</small>
                      </div>
                    </div>
                  </td>

                  <td>{item.borrower}</td>
                  <td>{item.assetTag}</td>
                  <td>{formatDate(item.dueAt || item.scheduledEnd)}</td>

                  <td>
                    <span className={`lgtx-status ${item.status}`}>
                      {statusLabels[item.status]}
                    </span>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="lgtx-view-button"
                      onClick={() => openDetails(item)}
                    >
                      <Eye size={16} />
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="lgtx-info">
        <ShieldAlert size={20} />
        <p>
          Development preview only. This uses separate fictional transactions
          and is not synchronized with the sample Approvals page or PostgreSQL.
          Real issuance and returns will require technician authentication and
          server-side validation.
        </p>
      </div>

      {selected && (
        <div
          className="lgtx-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDetails();
            }
          }}
        >
          <div
            className="lgtx-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lgtx-modal-title"
          >
            <button
              type="button"
              className="lgtx-close"
              onClick={closeDetails}
              aria-label="Close transaction details"
            >
              <X size={20} />
            </button>

            <div className="lgtx-modal-header">
              <img src={selected.image} alt="" />
              <div>
                <h2 id="lgtx-modal-title">{selected.equipment}</h2>
                <p>{selected.code}</p>
                <span className={`lgtx-status ${selected.status}`}>
                  {statusLabels[selected.status]}
                </span>
              </div>
            </div>

            <div className="lgtx-details">
              <Detail label="Borrower" value={selected.borrower} />
              <Detail label="Asset Tag" value={selected.assetTag} />
              <Detail label="Issued At" value={formatDate(selected.issuedAt)} />
              <Detail
                label="Due Date"
                value={formatDate(selected.dueAt || selected.scheduledEnd)}
              />
              <Detail
                label="Returned At"
                value={formatDate(selected.returnedAt)}
              />
              <Detail
                label="Condition on Issue"
                value={selected.issueCondition || "Not recorded"}
              />
              <Detail
                label="Condition on Return"
                value={selected.returnCondition || "Not inspected"}
              />
              {selected.notes && (
                <Detail label="Notes" value={selected.notes} />
              )}
            </div>

            {((isIssuance && selected.status === "approved") ||
              (!isIssuance && selected.status === "issued")) && (
              <form className="lgtx-action-form" onSubmit={confirmAction}>
                <h3>
                  {isIssuance ? (
                    <PackageCheck size={20} />
                  ) : (
                    <RotateCcw size={20} />
                  )}
                  {isIssuance ? "Issue Equipment" : "Record Equipment Return"}
                </h3>

                {isIssuance ? (
                  <>
                    <label htmlFor="lgtx-due">Equipment Due Date *</label>
                    <input
                      id="lgtx-due"
                      type="datetime-local"
                      value={issueDue}
                      onChange={(event) => {
                        setIssueDue(event.target.value);
                        setError("");
                      }}
                      required
                    />

                    <label htmlFor="lgtx-issue-condition">
                      Condition on Issue *
                    </label>
                    <select
                      id="lgtx-issue-condition"
                      value={issueCondition}
                      onChange={(event) =>
                        setIssueCondition(event.target.value)
                      }
                    >
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                      <option value="worn">Worn</option>
                    </select>
                  </>
                ) : (
                  <>
                    <label htmlFor="lgtx-return-condition">
                      Condition on Return *
                    </label>
                    <select
                      id="lgtx-return-condition"
                      value={returnCondition}
                      onChange={(event) => {
                        setReturnCondition(event.target.value);
                        setError("");
                      }}
                    >
                      <option value="good">Good</option>
                      <option value="damaged">Damaged</option>
                      <option value="needs_maintenance">
                        Needs Maintenance
                      </option>
                    </select>
                  </>
                )}

                <label htmlFor="lgtx-notes">
                  Notes {!isIssuance && returnCondition !== "good" && "*"}
                </label>
                <textarea
                  id="lgtx-notes"
                  rows={3}
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setError("");
                  }}
                  placeholder={
                    isIssuance
                      ? "Optional notes before releasing the item"
                      : "Describe the returned equipment condition"
                  }
                />

                {error && (
                  <p className="lgtx-error" role="alert">
                    {error}
                  </p>
                )}

                <button type="submit" className="lgtx-confirm">
                  {isIssuance ? "Confirm Demo Issuance" : "Confirm Demo Return"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="lgtx-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="lgtx-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
