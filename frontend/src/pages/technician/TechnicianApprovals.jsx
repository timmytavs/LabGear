import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Eye,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";

import microscopeImage from "../../assets/microscope.svg";
import arduinoImage from "../../assets/arduino-kit.svg";
import routerImage from "../../assets/network-router.svg";

import "../../styles/technician-approvals.css";

// Fictional records for frontend testing only.

const sampleRequests = [
  {
    id: 1,
    code: "LG-RES-2026-101",
    requester: "Sample Student A",
    requesterType: "Student",
    equipment: "Arduino Starter Kit",
    image: arduinoImage,
    quantity: 2,
    start: "2026-11-10T08:00:00+08:00",
    end: "2026-11-10T17:00:00+08:00",
    purpose: "Microcontroller programming activity",
    status: "pending",
    remarks: "",
    reviewedAt: null,
  },
  {
    id: 2,
    code: "LG-RES-2026-102",
    requester: "Sample Instructor B",
    requesterType: "Instructor",
    equipment: "Laboratory Microscope",
    image: microscopeImage,
    quantity: 3,
    start: "2026-11-12T09:00:00+08:00",
    end: "2026-11-12T15:00:00+08:00",
    purpose: "Biology laboratory demonstration",
    status: "pending",
    remarks: "",
    reviewedAt: null,
  },
  {
    id: 3,
    code: "LG-RES-2026-103",
    requester: "Sample Student C",
    requesterType: "Student",
    equipment: "Network Router",
    image: routerImage,
    quantity: 1,
    start: "2026-11-15T10:00:00+08:00",
    end: "2026-11-15T16:00:00+08:00",
    purpose: "Networking practical examination",
    status: "pending",
    remarks: "",
    reviewedAt: null,
  },
  {
    id: 4,
    code: "LG-RES-2026-104",
    requester: "Sample Instructor D",
    requesterType: "Instructor",
    equipment: "Arduino Starter Kit",
    image: arduinoImage,
    quantity: 1,
    start: "2026-11-06T08:00:00+08:00",
    end: "2026-11-06T12:00:00+08:00",
    purpose: "Electronics class demonstration",
    status: "approved",
    remarks: "Approved for laboratory use.",
    reviewedAt: "2026-11-01T09:00:00+08:00",
  },
  {
    id: 5,
    code: "LG-RES-2026-105",
    requester: "Sample Student E",
    requesterType: "Student",
    equipment: "Laboratory Microscope",
    image: microscopeImage,
    quantity: 5,
    start: "2026-11-07T08:00:00+08:00",
    end: "2026-11-07T12:00:00+08:00",
    purpose: "Laboratory research",
    status: "rejected",
    remarks: "Requested equipment is unavailable.",
    reviewedAt: "2026-11-01T10:00:00+08:00",
  },
];

const statusLabels = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

function formatDate(value) {
  if (!value) return "—";

  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TechnicianApprovals() {
  const [requests, setRequests] = useState(sampleRequests);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [selectedId, setSelectedId] = useState(null);
  const [decision, setDecision] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = requests.find((request) => request.id === selectedId);

  const filteredRequests = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return requests.filter((request) => {
      const matchesSearch = [
        request.code,
        request.requester,
        request.equipment,
      ].some((value) => value.toLowerCase().includes(keyword));

      const matchesStatus =
        statusFilter === "all" || request.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [requests, search, statusFilter]);

  const countStatus = (status) =>
    requests.filter((request) => request.status === status).length;

  function openRequest(id) {
    setSelectedId(id);
    setDecision(null);
    setRemarks("");
    setError("");
    setNotice("");
  }

  function closeRequest() {
    setSelectedId(null);
    setDecision(null);
    setRemarks("");
    setError("");
  }

  useEffect(() => {
    if (selectedId === null) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        closeRequest();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedId]);

  function chooseDecision(type) {
    setDecision(type);
    setRemarks("");
    setError("");
  }

  function confirmDecision() {
    if (!selected || selected.status !== "pending" || !decision) {
      return;
    }

    if (decision === "rejected" && remarks.trim().length < 5) {
      setError("Please provide a rejection reason of at least 5 characters.");
      return;
    }

    const updatedStatus = decision;
    const updatedRemarks = remarks.trim();

    setRequests((previous) =>
      previous.map((request) =>
        request.id === selected.id
          ? {
              ...request,
              status: updatedStatus,
              remarks: updatedRemarks,
              reviewedAt: new Date().toISOString(),
            }
          : request,
      ),
    );

    setNotice(
      `${selected.code} marked as ${updatedStatus} in the ` +
        "local UI preview. No database record was changed.",
    );

    closeRequest();
  }

  return (
    <div className="lgap-page">
      <div className="lgap-banner">
        <div>
          <span>LABORATORY TECHNICIAN</span>
          <h2>Reservation Approvals</h2>
          <p>
            Review laboratory equipment requests and manage approval decisions.
          </p>
        </div>

        <ClipboardCheck size={34} />
      </div>

      <div className="lgap-summary">
        <div className="lgap-summary-card">
          <Clock3 size={23} />
          <span>Pending Requests</span>
          <strong>{countStatus("pending")}</strong>
        </div>

        <div className="lgap-summary-card">
          <CheckCircle2 size={23} />
          <span>Approved Requests</span>
          <strong>{countStatus("approved")}</strong>
        </div>

        <div className="lgap-summary-card">
          <XCircle size={23} />
          <span>Rejected Requests</span>
          <strong>{countStatus("rejected")}</strong>
        </div>
      </div>

      <div className="lgap-toolbar">
        <div className="lgap-search">
          <Search size={19} />

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reservation, requester, or equipment"
            aria-label="Search approval requests"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter request status"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setSearch("");
            setStatusFilter("all");
          }}
        >
          Reset
        </button>
      </div>

      {notice && (
        <div className="lgap-notice" role="status">
          <CheckCircle2 size={20} />
          <p>{notice}</p>
        </div>
      )}

      <div className="lgap-section-heading">
        <h3>Reservation Requests</h3>
        <span>{filteredRequests.length} records</span>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="lgap-empty">
          <ClipboardCheck size={35} />
          <h3>No matching requests</h3>
          <p>Try another search or status filter.</p>
        </div>
      ) : (
        <div className="lgap-table-wrapper">
          <table className="lgap-table">
            <thead>
              <tr>
                <th>Reservation</th>
                <th>Requester</th>
                <th>Quantity</th>
                <th>Schedule</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredRequests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <div className="lgap-equipment">
                      <img src={request.image} alt="" />

                      <div>
                        <strong>{request.equipment}</strong>
                        <small>{request.code}</small>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div className="lgap-requester">
                      <strong>{request.requester}</strong>
                      <small>{request.requesterType}</small>
                    </div>
                  </td>

                  <td>{request.quantity}</td>

                  <td>
                    <span className="lgap-date">
                      {formatDate(request.start)}
                    </span>
                  </td>

                  <td>
                    <span className={`lgap-status ${request.status}`}>
                      {statusLabels[request.status]}
                    </span>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="lgap-view-button"
                      onClick={() => openRequest(request.id)}
                    >
                      <Eye size={16} />
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="lgap-information">
        <ShieldAlert size={20} />
        <p>
          This screen contains fictional requests. Approval and rejection
          actions update React state only and reset when the page is reloaded.
          Real technician permissions, availability checks, and database updates
          will be enforced by FastAPI.
        </p>
      </div>

      {selected && (
        <div
          className="lgap-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeRequest();
            }
          }}
        >
          <div
            className="lgap-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lgap-modal-title"
          >
            <button
              type="button"
              className="lgap-modal-close"
              onClick={closeRequest}
              aria-label="Close request details"
            >
              <X size={20} />
            </button>

            <div className="lgap-modal-heading">
              <img src={selected.image} alt="" />

              <div>
                <h2 id="lgap-modal-title">Reservation Review</h2>
                <p>{selected.code}</p>
                <span className={`lgap-status ${selected.status}`}>
                  {statusLabels[selected.status]}
                </span>
              </div>
            </div>

            <div className="lgap-details">
              <Detail label="Equipment" value={selected.equipment} />
              <Detail label="Requester" value={selected.requester} />
              <Detail label="Account Type" value={selected.requesterType} />
              <Detail label="Quantity" value={selected.quantity} />
              <Detail
                label="Reservation Start"
                value={formatDate(selected.start)}
              />
              <Detail
                label="Reservation End"
                value={formatDate(selected.end)}
              />
              <Detail label="Purpose" value={selected.purpose} />
              {selected.status !== "pending" && (
                <>
                  <Detail
                    label="Reviewed At"
                    value={formatDate(selected.reviewedAt)}
                  />
                  <Detail label="Remarks" value={selected.remarks || "None"} />
                </>
              )}
            </div>

            {selected.status === "pending" && (
              <div className="lgap-decision-section">
                <h3>Technician Decision</h3>

                <p>
                  This preview does not check actual inventory availability or
                  save decisions.
                </p>

                {!decision ? (
                  <div className="lgap-decision-actions">
                    <button
                      type="button"
                      className="lgap-approve-button"
                      onClick={() => chooseDecision("approved")}
                    >
                      <Check size={18} />
                      Approve
                    </button>

                    <button
                      type="button"
                      className="lgap-reject-button"
                      onClick={() => chooseDecision("rejected")}
                    >
                      <X size={18} />
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="lgap-decision-form">
                    <h4>
                      {decision === "approved"
                        ? "Confirm Approval"
                        : "Confirm Rejection"}
                    </h4>

                    <label htmlFor="lgap-remarks">
                      {decision === "approved"
                        ? "Remarks (optional)"
                        : "Rejection Reason *"}
                    </label>

                    <textarea
                      id="lgap-remarks"
                      rows="3"
                      value={remarks}
                      onChange={(event) => {
                        setRemarks(event.target.value);
                        setError("");
                      }}
                      placeholder={
                        decision === "approved"
                          ? "Additional technician notes..."
                          : "Explain why this request is rejected..."
                      }
                    />

                    {error && (
                      <p className="lgap-error" role="alert">
                        {error}
                      </p>
                    )}

                    <div className="lgap-decision-actions">
                      <button
                        type="button"
                        className="lgap-back-button"
                        onClick={() => {
                          setDecision(null);
                          setError("");
                        }}
                      >
                        Back
                      </button>

                      <button
                        type="button"
                        className={
                          decision === "approved"
                            ? "lgap-approve-button"
                            : "lgap-reject-button"
                        }
                        onClick={confirmDecision}
                      >
                        Confirm{" "}
                        {decision === "approved" ? "Approval" : "Rejection"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="lgap-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
