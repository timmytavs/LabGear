import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";

import "../../styles/admin-users.css";

// Fictional accounts for frontend testing only.
// These are not real PostgreSQL users.

const sampleUsers = [
  {
    id: "0000-0001",
    name: "Sample Administrator",
    username: "labadmin",
    email: "admin@example.test",
    role: "admin",
    department: "IT Services",
    status: "active",
    verified: true,
    createdAt: "2026-10-15",
    currentUser: true,
  },
  {
    id: "2026-0001",
    name: "Sample Student A",
    username: "studentdemo1",
    email: "student1@example.test",
    role: "student",
    department: "Information Technology",
    status: "active",
    verified: true,
    createdAt: "2026-10-20",
  },
  {
    id: "2026-0002",
    name: "Sample Instructor B",
    username: "instructordemo",
    email: "instructor@example.test",
    role: "instructor",
    department: "Computer Science",
    status: "active",
    verified: true,
    createdAt: "2026-10-21",
  },
  {
    id: "2026-0003",
    name: "Sample Technician C",
    username: "techdemo01",
    email: "technician@example.test",
    role: "technician",
    department: "Laboratory Services",
    status: "active",
    verified: true,
    createdAt: "2026-10-22",
  },
  {
    id: "2026-0004",
    name: "Sample Student D",
    username: "studentdemo2",
    email: "student2@example.test",
    role: "student",
    department: "Engineering",
    status: "active",
    verified: true,
    createdAt: "2026-10-23",
  },
  {
    id: "2026-0005",
    name: "Sample Technician E",
    username: "techdemo02",
    email: "technician2@example.test",
    role: "technician",
    department: "Laboratory Services",
    status: "inactive",
    verified: true,
    createdAt: "2026-10-24",
  },
];

const roleLabels = {
  student: "Student",
  instructor: "Instructor",
  technician: "Technician",
  admin: "Administrator",
};

function Detail({ label, value }) {
  return (
    <div className="lgum-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function AdminUserManagement() {
  const [users, setUsers] = useState(sampleUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = users.find((user) => user.id === selectedId);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch = [
        user.id,
        user.name,
        user.username,
        user.email,
      ].some((value) => value.toLowerCase().includes(keyword));

      return (
        matchesSearch &&
        (roleFilter === "all" || user.role === roleFilter) &&
        (statusFilter === "all" || user.status === statusFilter)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const activeCount = users.filter((user) => user.status === "active").length;

  const inactiveCount = users.length - activeCount;

  const verifiedCount = users.filter((user) => user.verified).length;

  const activeAdminCount = users.filter(
    (user) => user.role === "admin" && user.status === "active",
  ).length;

  function openUser(id) {
    setSelectedId(id);
    setConfirmAction(false);
    setNotice("");
  }

  function closeUser() {
    setSelectedId(null);
    setConfirmAction(false);
  }

  useEffect(() => {
    if (!selectedId) return;

    function onEscape(event) {
      if (event.key === "Escape") closeUser();
    }

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [selectedId]);

  const canUpdate =
    selected &&
    !selected.currentUser &&
    !(
      selected.role === "admin" &&
      selected.status === "active" &&
      activeAdminCount <= 1
    ) &&
    !(selected.status === "inactive" && !selected.verified);

  function applyStatusChange() {
    if (!selected || !confirmAction || !canUpdate) return;

    const nextStatus = selected.status === "active" ? "inactive" : "active";

    const username = selected.username;

    setUsers((previous) =>
      previous.map((user) =>
        user.id === selected.id ? { ...user, status: nextStatus } : user,
      ),
    );

    setNotice(
      `${username} was marked ${nextStatus} in the ` +
        "local UI preview. No database changes were made.",
    );

    closeUser();
  }

  return (
    <section className="lgum-page">
      <div className="lgum-banner">
        <div>
          <span>LABGEAR ADMINISTRATION</span>
          <h2>User Management</h2>
          <p>
            Review registered accounts, verification status, and account access.
          </p>
        </div>
        <Users size={34} />
      </div>

      <div className="lgum-stats">
        <div className="lgum-stat">
          <Users size={22} />
          <span>Total Users</span>
          <strong>{users.length}</strong>
        </div>

        <div className="lgum-stat">
          <CheckCircle2 size={22} />
          <span>Active Accounts</span>
          <strong>{activeCount}</strong>
        </div>

        <div className="lgum-stat">
          <AlertTriangle size={22} />
          <span>Inactive Accounts</span>
          <strong>{inactiveCount}</strong>
        </div>

        <div className="lgum-stat">
          <ShieldCheck size={22} />
          <span>Verified Emails</span>
          <strong>{verifiedCount}</strong>
        </div>
      </div>

      {notice && (
        <div className="lgum-notice" role="status">
          <CheckCircle2 size={20} />
          <p>{notice}</p>
        </div>
      )}

      <div className="lgum-toolbar">
        <div className="lgum-search">
          <Search size={19} />
          <input
            type="search"
            placeholder="Search name, username, ID, or email"
            aria-label="Search users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
        >
          <option value="all">All Roles</option>
          {Object.entries(roleLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by account status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setSearch("");
            setRoleFilter("all");
            setStatusFilter("all");
          }}
        >
          Reset
        </button>
      </div>

      <div className="lgum-section-heading">
        <h3>Registered Accounts</h3>
        <span>{filtered.length} records</span>
      </div>

      <div className="lgum-table-wrap">
        <table className="lgum-table">
          <thead>
            <tr>
              <th>User</th>
              <th>ID Number</th>
              <th>Role</th>
              <th>Email Verification</th>
              <th>Account Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="6" className="lgum-empty">
                  No accounts match the selected filters.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="lgum-user-cell">
                      <div className="lgum-avatar">
                        <UserRound size={19} />
                      </div>
                      <div>
                        <strong>{user.name}</strong>
                        <small>@{user.username}</small>
                      </div>
                    </div>
                  </td>

                  <td>{user.id}</td>
                  <td>{roleLabels[user.role]}</td>

                  <td>
                    <span
                      className={
                        user.verified ? "lgum-verified" : "lgum-unverified"
                      }
                    >
                      {user.verified ? "Verified" : "Unverified"}
                    </span>
                  </td>

                  <td>
                    <span className={`lgum-status ${user.status}`}>
                      {user.status}
                    </span>
                  </td>

                  <td>
                    <button
                      type="button"
                      className="lgum-view-button"
                      onClick={() => openUser(user.id)}
                    >
                      <Eye size={16} />
                      Manage
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="lgum-info">
        <ShieldCheck size={21} />
        <p>
          Development preview only. Account roles, status changes, and email
          verification shown here are fictional. Real admin access and account
          management must be validated by the FastAPI backend.
        </p>
      </div>

      {selected && (
        <div
          className="lgum-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeUser();
            }
          }}
        >
          <div
            className="lgum-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lgum-modal-title"
          >
            <button
              type="button"
              className="lgum-close"
              onClick={closeUser}
              aria-label="Close account details"
            >
              <X size={20} />
            </button>

            <div className="lgum-modal-heading">
              <div className="lgum-modal-avatar">
                <UserRound size={25} />
              </div>
              <div>
                <h2 id="lgum-modal-title">Account Details</h2>
                <p>{selected.name}</p>
              </div>
            </div>

            <div className="lgum-details">
              <Detail label="ID Number" value={selected.id} />
              <Detail label="Username" value={`@${selected.username}`} />
              <Detail label="Email" value={selected.email} />
              <Detail label="Role" value={roleLabels[selected.role]} />
              <Detail label="Department" value={selected.department} />
              <Detail
                label="Email Verified"
                value={selected.verified ? "Yes" : "No"}
              />
              <Detail label="Account Status" value={selected.status} />
              <Detail label="Registered On" value={selected.createdAt} />
            </div>

            {selected.currentUser ? (
              <div className="lgum-warning">
                <AlertTriangle size={19} />
                <p>
                  This is the simulated current administrator. You cannot
                  disable your own account here.
                </p>
              </div>
            ) : !canUpdate ? (
              <div className="lgum-warning">
                <AlertTriangle size={19} />
                <p>
                  This account cannot be changed in the current preview state.
                </p>
              </div>
            ) : !confirmAction ? (
              <div className="lgum-modal-actions">
                <button
                  type="button"
                  className={
                    selected.status === "active"
                      ? "lgum-danger-button"
                      : "lgum-primary-button"
                  }
                  onClick={() => setConfirmAction(true)}
                >
                  {selected.status === "active"
                    ? "Deactivate Account"
                    : "Activate Account"}
                </button>
              </div>
            ) : (
              <div className="lgum-confirm">
                <h3>
                  {selected.status === "active"
                    ? "Confirm Account Deactivation"
                    : "Confirm Account Activation"}
                </h3>

                <p>
                  {selected.status === "active"
                    ? "This would prevent the account from accessing LabGear once enforced by the backend."
                    : "This would permit the account to access LabGear, subject to authentication and verification."}
                </p>

                <div className="lgum-modal-actions">
                  <button
                    type="button"
                    className="lgum-cancel-button"
                    onClick={() => setConfirmAction(false)}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className={
                      selected.status === "active"
                        ? "lgum-danger-button"
                        : "lgum-primary-button"
                    }
                    onClick={applyStatusChange}
                  >
                    Confirm Demo Change
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
