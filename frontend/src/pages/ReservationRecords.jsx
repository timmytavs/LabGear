import { useMemo, useState } from "react";
import {
  CalendarDays,
  ClipboardList,
  Clock3,
  PackageCheck,
  Search,
  X,
} from "lucide-react";

import microscopeImage from "../assets/microscope.svg";
import arduinoImage from "../assets/arduino-kit.svg";
import routerImage from "../assets/network-router.svg";

import "../styles/records.css";

// Fictional data for frontend preview only.
// No records are created or retrieved from PostgreSQL.

const reservations = [
  {
    code: "LG-RES-2026-001",
    name: "Laboratory Microscope",
    image: microscopeImage,
    status: "pending",
    quantity: 1,
    start: "2026-11-04",
    end: "2026-11-05",
    purpose: "Biology laboratory observation",
    remarks: "Waiting for technician review",
  },
  {
    code: "LG-RES-2026-002",
    name: "Arduino Starter Kit",
    image: arduinoImage,
    status: "approved",
    quantity: 2,
    start: "2026-11-06",
    end: "2026-11-07",
    purpose: "Electronics laboratory activity",
    remarks: "Reservation approved for issuance",
  },
  {
    code: "LG-RES-2026-003",
    name: "Network Router",
    image: routerImage,
    status: "rejected",
    quantity: 1,
    start: "2026-11-03",
    end: "2026-11-04",
    purpose: "Networking practical exercise",
    remarks: "Equipment unavailable for requested dates",
  },
  {
    code: "LG-RES-2026-004",
    name: "Laboratory Microscope",
    image: microscopeImage,
    status: "issued",
    quantity: 1,
    start: "2026-11-01",
    end: "2026-11-08",
    purpose: "Laboratory research activity",
    remarks: "Equipment released to borrower",
  },
];

const borrowedItems = [
  {
    code: "LG-ISS-2026-011",
    reservationCode: "LG-RES-2026-004",
    name: "Laboratory Microscope",
    image: microscopeImage,
    assetTag: "MIC-004",
    status: "issued",
    issuedAt: "2026-11-01",
    dueAt: "2026-11-08",
    returnedAt: null,
    condition: "Good",
  },
  {
    code: "LG-ISS-2026-012",
    reservationCode: "LG-RES-2026-000",
    name: "Arduino Starter Kit",
    image: arduinoImage,
    assetTag: "ARD-006",
    status: "returned",
    issuedAt: "2026-10-24",
    dueAt: "2026-10-28",
    returnedAt: "2026-10-27",
    condition: "Good",
  },
];

const statusLabels = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  issued: "Issued",
  returned: "Returned",
  completed: "Completed",
};

function formatDate(value) {
  if (!value) return "—";

  return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ReservationRecords({
  view = "reservations",
  role = "student",
}) {
  const isBorrowed = view === "borrowed";
  const records = isBorrowed ? borrowedItems : reservations;

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch =
        record.name.toLowerCase().includes(query) ||
        record.code.toLowerCase().includes(query) ||
        (record.assetTag || "").toLowerCase().includes(query);

      const matchesStatus = status === "all" || record.status === status;

      return matchesSearch && matchesStatus;
    });
  }, [records, search, status]);

  const pendingCount = records.filter(
    (item) => item.status === "pending",
  ).length;

  const approvedCount = records.filter(
    (item) => item.status === "approved",
  ).length;

  const issuedCount = records.filter((item) => item.status === "issued").length;

  function clearFilters() {
    setSearch("");
    setStatus("all");
  }

  return (
    <section className="lgrec-page">
      <div className="lgrec-heading">
        <div>
          <h2>{isBorrowed ? "Borrowed Items" : "My Reservations"}</h2>
          <p>
            {isBorrowed
              ? "Review issued equipment, return dates, and borrowing history."
              : "Monitor your laboratory reservation requests and approval statuses."}
          </p>
        </div>

        <div className="lgrec-heading-icon">
          {isBorrowed ? <PackageCheck size={25} /> : <CalendarDays size={25} />}
        </div>
      </div>

      <div className="lgrec-stats">
        <div className="lgrec-stat">
          <span>Total Records</span>
          <strong>{records.length}</strong>
        </div>

        <div className="lgrec-stat">
          <span>{isBorrowed ? "Currently Issued" : "Pending Approval"}</span>
          <strong>{isBorrowed ? issuedCount : pendingCount}</strong>
        </div>

        <div className="lgrec-stat">
          <span>{isBorrowed ? "Returned Items" : "Approved Requests"}</span>
          <strong>
            {isBorrowed
              ? records.filter((item) => item.status === "returned").length
              : approvedCount}
          </strong>
        </div>
      </div>

      <div className="lgrec-toolbar">
        <div className="lgrec-search">
          <Search size={19} />

          <input
            type="search"
            placeholder={
              isBorrowed
                ? "Search equipment, issuance, or asset tag"
                : "Search equipment or reservation code"
            }
            aria-label="Search records"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>

          {isBorrowed ? (
            <>
              <option value="issued">Issued</option>
              <option value="returned">Returned</option>
            </>
          ) : (
            <>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="issued">Issued</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </>
          )}
        </select>

        <button type="button" onClick={clearFilters}>
          Reset
        </button>
      </div>

      <div className="lgrec-list-header">
        <h3>{isBorrowed ? "Borrowing History" : "Reservation History"}</h3>
        <span>{filtered.length} records</span>
      </div>

      {filtered.length === 0 ? (
        <div className="lgrec-empty">
          <ClipboardList size={34} />
          <h3>No matching records</h3>
          <p>Try a different search or status filter.</p>
          <button type="button" onClick={clearFilters}>
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="lgrec-records">
          {filtered.map((record) => (
            <article className="lgrec-item" key={record.code}>
              <div className="lgrec-item-main">
                <div className="lgrec-thumbnail">
                  <img src={record.image} alt={record.name} />
                </div>

                <div className="lgrec-item-name">
                  <h4>{record.name}</h4>
                  <small>{record.code}</small>
                </div>
              </div>

              <div className="lgrec-item-date">
                <span>{isBorrowed ? "Due Date" : "Reservation Start"}</span>
                <strong>
                  {formatDate(isBorrowed ? record.dueAt : record.start)}
                </strong>
              </div>

              <span className={`lgrec-status lgrec-status-${record.status}`}>
                {statusLabels[record.status]}
              </span>

              <button
                type="button"
                className="lgrec-details-button"
                onClick={() => setSelected(record)}
              >
                View Details
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="lgrec-notice">
        <Clock3 size={20} />
        <p>
          This is a {role} dashboard preview using fictional records. No
          reservation or borrowing information has been retrieved from the
          database.
        </p>
      </div>

      {selected && (
        <div
          className="lgrec-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelected(null);
            }
          }}
        >
          <div
            className="lgrec-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lgrec-modal-title"
          >
            <button
              type="button"
              className="lgrec-modal-close"
              onClick={() => setSelected(null)}
              aria-label="Close details"
            >
              <X size={20} />
            </button>

            <div className="lgrec-modal-header">
              <img src={selected.image} alt="" />
              <div>
                <h2 id="lgrec-modal-title">{selected.name}</h2>
                <p>{selected.code}</p>
                <span
                  className={`lgrec-status lgrec-status-${selected.status}`}
                >
                  {statusLabels[selected.status]}
                </span>
              </div>
            </div>

            <div className="lgrec-details">
              {isBorrowed ? (
                <>
                  <Detail label="Asset Tag" value={selected.assetTag} />
                  <Detail
                    label="Reservation Code"
                    value={selected.reservationCode}
                  />
                  <Detail
                    label="Issued Date"
                    value={formatDate(selected.issuedAt)}
                  />
                  <Detail label="Due Date" value={formatDate(selected.dueAt)} />
                  <Detail
                    label="Returned Date"
                    value={formatDate(selected.returnedAt)}
                  />
                  <Detail label="Condition" value={selected.condition} />
                </>
              ) : (
                <>
                  <Detail label="Quantity" value={selected.quantity} />
                  <Detail
                    label="Start Date"
                    value={formatDate(selected.start)}
                  />
                  <Detail label="End Date" value={formatDate(selected.end)} />
                  <Detail label="Purpose" value={selected.purpose} />
                  <Detail label="Technician Remarks" value={selected.remarks} />
                </>
              )}
            </div>

            <button
              type="button"
              className="lgrec-close-button"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }) {
  return (
    <div className="lgrec-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
