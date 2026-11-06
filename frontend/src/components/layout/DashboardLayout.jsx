import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Package,
  PackageCheck,
  RotateCcw,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
  X,
} from "lucide-react";

import labgearMark from "../../assets/labgear-mark.svg";
import microscopeImage from "../../assets/microscope.svg";
import arduinoImage from "../../assets/arduino-kit.svg";
import routerImage from "../../assets/network-router.svg";
import EquipmentCatalog from "../../pages/EquipmentCatalog";
import ReservationRecords from "../../pages/ReservationRecords";
import TechnicianApprovals from "../../pages/technician/TechnicianApprovals";

import TechnicianTransactions, {
  sampleTransactions,
} from "../../pages/technician/TechnicianTransactions";
import TechnicianInventory from "../../pages/technician/TechnicianInventory";

import TechnicianDamageReports from "../../pages/technician/TechnicianDamageReports";
import AdminSecurityMonitoring from "../../pages/admin/AdminSecurityMonitoring";
import AdminUserManagement from "../../pages/admin/AdminUserManagement";

import "../../styles/dashboard.css";

const navigation = {
  student: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "equipment", label: "Equipment", icon: Package },
    { key: "reservations", label: "My Reservations", icon: CalendarDays },
    { key: "borrowed", label: "Borrowed Items", icon: PackageCheck },
    { key: "profile", label: "Profile", icon: UserRound },
  ],
  instructor: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "equipment", label: "Equipment", icon: Package },
    { key: "reservations", label: "My Reservations", icon: CalendarDays },
    { key: "borrowed", label: "Borrowed Items", icon: PackageCheck },
    { key: "profile", label: "Profile", icon: UserRound },
  ],
  technician: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "inventory", label: "Inventory", icon: Package },
    { key: "approvals", label: "Approvals", icon: ClipboardCheck },
    { key: "issuance", label: "Issuance", icon: PackageCheck },
    { key: "returns", label: "Returns", icon: RotateCcw },
    { key: "damage", label: "Damage Reports", icon: Wrench },
  ],
  admin: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "users", label: "User Management", icon: Users },
    { key: "security", label: "Security Monitoring", icon: ShieldCheck },
    { key: "logs", label: "Activity Logs", icon: Activity },
    { key: "settings", label: "Settings", icon: Settings },
  ],
};

const roleNames = {
  student: "Student",
  instructor: "Instructor",
  technician: "Laboratory Technician",
  admin: "Administrator",
};

const equipmentPreview = [
  {
    name: "Laboratory Microscope",
    category: "Science Laboratory",
    image: microscopeImage,
  },
  {
    name: "Arduino Starter Kit",
    category: "Electronics Laboratory",
    image: arduinoImage,
  },
  {
    name: "Network Router",
    category: "Computer Laboratory",
    image: routerImage,
  },
];

const roleStats = {
  student: [
    { label: "Available Equipment", value: "24", icon: Package },
    { label: "My Reservations", value: "03", icon: CalendarDays },
    { label: "Borrowed Items", value: "01", icon: PackageCheck },
  ],
  instructor: [
    { label: "Available Equipment", value: "24", icon: Package },
    { label: "My Reservations", value: "05", icon: CalendarDays },
    { label: "Borrowed Items", value: "02", icon: PackageCheck },
  ],
  technician: [
    { label: "Equipment Units", value: "120", icon: Package },
    { label: "Pending Approvals", value: "08", icon: ClipboardList },
    { label: "Issued Equipment", value: "16", icon: PackageCheck },
  ],
  admin: [
    { label: "Registered Users", value: "148", icon: Users },
    { label: "Security Events", value: "12", icon: Activity },
    { label: "System Modules", value: "04", icon: ShieldCheck },
  ],
};

export function DashboardLayout({ role, activePage, onNavigate, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menu = navigation[role] || navigation.student;
  const current = menu.find((item) => item.key === activePage);

  function navigate(key) {
    onNavigate(key);
    setMobileOpen(false);
  }

  return (
    <div className="lgdash-root">
      <div className="lgdash-prospect">
        LabGear — School Laboratory Equipment Reservation System
      </div>

      <div className="lgdash-app">
        {mobileOpen && (
          <button
            className="lgdash-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={
            mobileOpen ? "lgdash-sidebar lgdash-sidebar-open" : "lgdash-sidebar"
          }
        >
          <div className="lgdash-brand">
            <img src={labgearMark} alt="" />
            <div>
              <strong>LabGear</strong>
              <small>Laboratory Management</small>
            </div>
          </div>

          <div className="lgdash-sidebar-label">WORKSPACE</div>

          <nav className="lgdash-navigation" aria-label="Dashboard navigation">
            {menu.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.key}
                  className={
                    activePage === item.key
                      ? "lgdash-nav-link active"
                      : "lgdash-nav-link"
                  }
                  aria-current={activePage === item.key ? "page" : undefined}
                  onClick={() => navigate(item.key)}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="lgdash-sidebar-bottom">
            <div className="lgdash-sidebar-help">
              <FlaskConical size={23} />
              <strong>LabGear Workspace</strong>
              <small>Equipment management made simpler.</small>
            </div>
            <a href="/" className="lgdash-home-link">
              Return to Landing Page
              <ArrowRight size={16} />
            </a>
          </div>
        </aside>

        <div className="lgdash-main-area">
          <header className="lgdash-topbar">
            <div className="lgdash-topbar-left">
              <button
                className="lgdash-mobile-menu"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={22} />
              </button>
              <div>
                <span className="lgdash-topbar-overline">
                  LABGEAR WORKSPACE
                </span>
                <strong>{current?.label || "Dashboard"}</strong>
              </div>
            </div>

            <div className="lgdash-topbar-right">
              <a href="/">Home</a>
              <div className="lgdash-preview-notice">Design Preview</div>
              <Bell size={19} aria-label="Notifications preview" />
              <div className="lgdash-avatar">
                <UserRound size={20} />
              </div>
            </div>
          </header>

          <main className="lgdash-content">{children}</main>

          <footer className="lgdash-footer">
            © 2026 LabGear. All rights reserved.
          </footer>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPreview() {
  const [role, setRole] = useState("student");
  const [activePage, setActivePage] = useState("dashboard");
  const [technicianTransactions, setTechnicianTransactions] = useState(() =>
    sampleTransactions.map((item) => ({ ...item })),
  );
  const [damageReports, setDamageReports] = useState([]);

  function changeRole(event) {
    setRole(event.target.value);
    setActivePage("dashboard");
  }

  const menu = navigation[role];
  const page = menu.find((item) => item.key === activePage);
  const isDashboard = activePage === "dashboard";

  return (
    <div className="lgdash-preview-shell">
      <div className="lgdash-developer-bar">
        <div>
          <strong>Frontend Design Preview</strong>
          <span>Fictional data · No authentication · No database changes</span>
        </div>

        <label>
          Preview role:
          <select value={role} onChange={changeRole}>
            {Object.entries(roleNames).map(([key, name]) => (
              <option value={key} key={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DashboardLayout
        role={role}
        activePage={activePage}
        onNavigate={setActivePage}
      >
        <div className="lgdash-welcome">
          <div>
            <span className="lgdash-eyebrow">{roleNames[role]} Workspace</span>
            <h1>{isDashboard ? "Welcome to LabGear" : page?.label}</h1>
            <p>
              {isDashboard
                ? "Manage laboratory equipment and reservations from one organized workspace."
                : `This is the planned ${page?.label} screen. Its functionality will be connected to FastAPI later.`}
            </p>
          </div>
          <span className="lgdash-demo-pill">SAMPLE DATA</span>
        </div>

        {activePage === "equipment" ? (
          <EquipmentCatalog role={role} />
        ) : role === "technician" && activePage === "inventory" ? (
          <TechnicianInventory />
        ) : activePage === "reservations" || activePage === "borrowed" ? (
          <ReservationRecords view={activePage} role={role} />
        ) : activePage === "approvals" && role === "technician" ? (
          <TechnicianApprovals />
        ) : role === "technician" &&
          (activePage === "issuance" || activePage === "returns") ? (
          <TechnicianTransactions
            view={activePage}
            transactions={technicianTransactions}
            setTransactions={setTechnicianTransactions}
          />
        ) : role === "technician" && activePage === "damage" ? (
          <TechnicianDamageReports
            transactions={technicianTransactions}
            reports={damageReports}
            setReports={setDamageReports}
          />
        ) : role === "admin" &&
          (activePage === "security" || activePage === "logs") ? (
          <AdminSecurityMonitoring view={activePage} />
        ) : role === "admin" && activePage === "users" ? (
          <AdminUserManagement />
        ) : isDashboard ? (
          <>
            <div className="lgdash-stats">
              {roleStats[role].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div className="lgdash-stat-card" key={stat.label}>
                    <div className="lgdash-stat-icon">
                      <Icon size={21} />
                    </div>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                    <small>Illustrative value only</small>
                  </div>
                );
              })}
            </div>

            <div className="lgdash-section-header">
              <div>
                <h2>Equipment Preview</h2>
                <p>Common laboratory equipment in LabGear.</p>
              </div>
              <button
                className="lgdash-outline-btn"
                onClick={() =>
                  setActivePage(
                    role === "admin"
                      ? "users"
                      : role === "technician"
                        ? "inventory"
                        : "equipment",
                  )
                }
              >
                Explore Workspace <ArrowRight size={16} />
              </button>
            </div>

            <div className="lgdash-equipment-grid">
              {equipmentPreview.map((item) => (
                <div className="lgdash-equipment-card" key={item.name}>
                  <div className="lgdash-equipment-image">
                    <img src={item.image} alt={item.name} />
                  </div>
                  <div className="lgdash-equipment-info">
                    <small>{item.category}</small>
                    <h3>{item.name}</h3>
                    <span className="lgdash-status-demo">Preview Item</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="lgdash-info-card">
              <div className="lgdash-info-icon">
                <ClipboardCheck size={23} />
              </div>
              <div>
                <h3>Reservation Management</h3>
                <p>
                  Equipment availability, reservation approvals, borrowing
                  records, and return inspections will appear here after backend
                  integration.
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="lgdash-empty-screen">
            <div className="lgdash-empty-icon">
              <Package size={32} />
            </div>
            <h2>{page?.label}</h2>
            <p>
              The interface for this module will be developed after we finish
              preparing the reusable dashboard layout. No live records are
              displayed.
            </p>
            <button
              className="lgdash-outline-btn"
              onClick={() => setActivePage("dashboard")}
            >
              Back to Dashboard
            </button>
          </div>
        )}
      </DashboardLayout>
    </div>
  );
}
