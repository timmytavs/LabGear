import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  Menu,
  PackageCheck,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
  LogOut,
  Package,
  Users,
  Activity,
  ClipboardList,
} from "lucide-react";

import LoginPanel from "./auth/LoginPanel";
import EquipmentCatalog from "./EquipmentCatalog";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { getCurrentUser, logout } from "../services/loginApi";
import "../styles/auth.css";

import labgearMark from "../assets/labgear-mark.svg";
import microscopeImage from "../assets/microscope.svg";
import arduinoImage from "../assets/arduino-kit.svg";
import routerImage from "../assets/network-router.svg";

import "../styles/landing.css";
import RegisterPanel from "./auth/RegisterPanel";
import AuthSecurityPanel from "./auth/AuthSecurityPanel";

const equipmentItems = [
  {
    name: "Laboratory Microscope",
    category: "Science Laboratory",
    image: microscopeImage,
    description: "Optical equipment for laboratory observation.",
  },
  {
    name: "Arduino Starter Kit",
    category: "Electronics Laboratory",
    image: arduinoImage,
    description: "Microcontroller equipment for student projects.",
  },
  {
    name: "Network Router",
    category: "Computer Laboratory",
    image: routerImage,
    description: "Networking equipment for practical activities.",
  },
];

const steps = [
  {
    icon: Search,
    title: "Browse Equipment",
    description: "Explore laboratory equipment and check availability.",
  },
  {
    icon: CalendarDays,
    title: "Request Reservation",
    description: "Choose equipment, quantity, and reservation dates.",
  },
  {
    icon: ClipboardCheck,
    title: "Technician Approval",
    description: "A laboratory technician reviews your request.",
  },
  {
    icon: RotateCcw,
    title: "Borrow and Return",
    description: "Equipment issuance and returns are recorded.",
  },
];

// Reuse the EXACT sidebar/topbar/dashboard components from the existing
// frontend/src/components/layout/DashboardLayout.jsx and dashboard.css.
// Do not use the fictional ?preview=dashboard entry point for real accounts.
// Any other modules are intentionally placeholders until FastAPI data APIs exist.
const authenticatedNavigation = {
  student: ["dashboard", "equipment", "reservations", "borrowed", "profile"],
  instructor: ["dashboard", "equipment", "reservations", "borrowed", "profile"],
  technician: [
    "dashboard",
    "inventory",
    "approvals",
    "issuance",
    "returns",
    "damage",
  ],
  admin: ["dashboard", "users", "security", "logs", "settings"],
};

const statsByRole = {
  student: [
    { label: "Available Equipment", icon: Package },
    { label: "My Reservations", icon: CalendarDays },
    { label: "Borrowed Items", icon: PackageCheck },
  ],
  instructor: [
    { label: "Available Equipment", icon: Package },
    { label: "My Reservations", icon: CalendarDays },
    { label: "Borrowed Items", icon: PackageCheck },
  ],
  technician: [
    { label: "Equipment Units", icon: Package },
    { label: "Pending Approvals", icon: ClipboardList },
    { label: "Issued Equipment", icon: PackageCheck },
  ],
  admin: [
    { label: "Registered Users", icon: Users },
    { label: "Security Events", icon: Activity },
    { label: "System Modules", icon: ShieldCheck },
  ],
};

const moduleNames = {
  equipment: "Equipment",
  reservations: "My Reservations",
  borrowed: "Borrowed Items",
  profile: "Profile",
  inventory: "Inventory",
  approvals: "Approvals",
  issuance: "Issuance",
  returns: "Returns",
  damage: "Damage Reports",
  users: "User Management",
  security: "Security Monitoring",
  logs: "Activity Logs",
  settings: "Settings",
};

const dashboardRoleNames = {
  student: "Student",
  instructor: "Instructor",
  technician: "Laboratory Technician",
  admin: "Administrator",
};

function AuthenticatedDashboard({ user, onSignOut, signingOut, error }) {
  const [activePage, setActivePage] = useState("dashboard");
  // The API returns a trusted role. Normalize its DB name to the original
  // dashboard's "technician" navigation key, without offering role switching.
  const role =
    user.role === "lab_technician" || user.role === "laboratory_technician"
      ? "technician"
      : user.role;
  const supported = Object.prototype.hasOwnProperty.call(
    authenticatedNavigation,
    role,
  );

  if (!supported) {
    return (
      <main style={{ padding: 40 }} role="alert">
        Your account role is not supported by this workspace.
        <button type="button" onClick={onSignOut} disabled={signingOut}>
          Sign out
        </button>
      </main>
    );
  }

  const isDashboard = activePage === "dashboard";
  const activeName = moduleNames[activePage] || "Dashboard";

  return (
    <div className="labgear-authenticated-workspace">
      <style>{`
        /* Scoped to authenticated mode. The developer preview stays unchanged. */
        .labgear-authenticated-workspace .lgdash-topbar-right > a,
        .labgear-authenticated-workspace .lgdash-preview-notice,
        .labgear-authenticated-workspace .lgdash-home-link { display: none; }
        .labgear-authenticated-workspace .lgdash-live-signout { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
        .labgear-authenticated-workspace .lgdash-live-signout:disabled { opacity: .6; cursor: wait; }
        .labgear-authenticated-workspace .lgdash-live-error { color: #af2934; margin: 10px 0 18px; }
      `}</style>
      <DashboardLayout
        role={role}
        activePage={activePage}
        onNavigate={(page) => {
          if (authenticatedNavigation[role].includes(page)) setActivePage(page);
        }}
      >
        <div className="lgdash-welcome">
          <div>
            <span className="lgdash-eyebrow">
              {dashboardRoleNames[role]} Workspace
            </span>
            <h1>{isDashboard ? "Welcome to LabGear" : activeName}</h1>
            <p>
              {isDashboard
                ? `Signed in as ${user.username}. Manage laboratory equipment and reservations from one organized workspace.`
                : activePage === "equipment"
                  ? "Browse the current equipment catalog from PostgreSQL. Reservation requests will be connected in a later step."
                  : `${activeName} is not connected to live FastAPI data yet.`}
            </p>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span className="lgdash-demo-pill">VERIFIED ACCOUNT</span>
            <button
              type="button"
              className="lgdash-outline-btn lgdash-live-signout"
              onClick={onSignOut}
              disabled={signingOut}
            >
              <LogOut size={16} />
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>

        {error && (
          <p className="lgdash-live-error" role="alert">
            {error}
          </p>
        )}

        {isDashboard ? (
          <>
            {/* Preserve the original three-card dashboard geometry, but do not
                present preview counts as real database statistics. */}
            <div className="lgdash-stats">
              {statsByRole[role].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div className="lgdash-stat-card" key={stat.label}>
                    <div className="lgdash-stat-icon">
                      <Icon size={21} />
                    </div>
                    <span>{stat.label}</span>
                    <strong>—</strong>
                    <small>Live data coming after API integration</small>
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
              {equipmentItems.map((item) => (
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
        ) : activePage === "equipment" &&
          (role === "student" || role === "instructor") ? (
          <EquipmentCatalog role={role} />
        ) : (
          <div className="lgdash-empty-screen">
            <div className="lgdash-empty-icon">
              <Package size={32} />
            </div>
            <h2>{activeName}</h2>
            <p>
              This module is still being connected to FastAPI and PostgreSQL. No
              fictional preview records are displayed as your real records.
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

function LandingPage({ apiStatus }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [authModal, setAuthModal] = useState(null);
  const [authenticatedUser, setAuthenticatedUser] = useState(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  // Only FastAPI may establish authentication. Frontend state is a display
  // of /api/auth/me, never a replacement for the HttpOnly session cookie.
  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then((user) => {
        if (mounted) setAuthenticatedUser(user);
      })
      .catch(() => {
        if (mounted) setAuthenticatedUser(null);
      })
      .finally(() => {
        if (mounted) setSessionChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function handleLoginSuccess(user) {
    // Called only after LoginPanel completes OTP and confirms /api/auth/me.
    setAuthenticatedUser(user);
    setAuthModal(null);
    setMenuOpen(false);
    setSessionChecking(false);
    setDashboardError("");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  async function handleDashboardSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setDashboardError("");
    try {
      await logout();
      setAuthenticatedUser(null);
      setAuthModal(null);
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch (error) {
      setDashboardError(
        error?.message || "Could not sign out. Please try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  useEffect(() => {
    if (!authModal) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setAuthModal(null);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [authModal]);

  function openAuth(type) {
    setMenuOpen(false);
    setAuthModal(type);
  }

  if (sessionChecking) {
    return (
      <div
        className="landing-page"
        style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
      >
        <p role="status">Checking your LabGear session...</p>
      </div>
    );
  }

  if (authenticatedUser) {
    return (
      <AuthenticatedDashboard
        user={authenticatedUser}
        onSignOut={handleDashboardSignOut}
        signingOut={signingOut}
        error={dashboardError}
      />
    );
  }

  return (
    <div className="landing-page">
      <div className="landing-prospect-name">
        LabGear — School Laboratory Equipment Reservation System
      </div>

      <header className="landing-header">
        <div className="landing-nav-container">
          <a
            href="#home"
            className="landing-brand"
            onClick={() => setMenuOpen(false)}
          >
            <img src={labgearMark} alt="" />
            <span>LabGear</span>
          </a>

          <nav className={menuOpen ? "landing-nav open" : "landing-nav"}>
            <a href="#home" onClick={() => setMenuOpen(false)}>
              Home
            </a>
            <a href="#equipment" onClick={() => setMenuOpen(false)}>
              Equipment
            </a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
              How It Works
            </a>

            <div className="landing-mobile-actions">
              <button onClick={() => openAuth("register")}>Register</button>
              <button onClick={() => openAuth("login")}>Log-in</button>
            </div>
          </nav>

          <div className="landing-auth-actions">
            <button className="landing-login" onClick={() => openAuth("login")}>
              Log-in
            </button>
            <button
              className="landing-register"
              onClick={() => openAuth("register")}
            >
              Register <ArrowRight size={17} />
            </button>
          </div>

          <button
            className="landing-menu-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      <main>
        <section id="home" className="landing-hero">
          <div className="landing-hero-content">
            <div className="landing-eyebrow">
              <FlaskConical size={16} />
              Smarter Laboratory Management
            </div>

            <h1>
              Laboratory equipment,
              <span> easier to reserve.</span>
            </h1>

            <p>
              LabGear simplifies laboratory equipment reservations, approvals,
              borrowing, and returns for students, instructors, and laboratory
              technicians.
            </p>

            <div className="landing-hero-actions">
              <button
                className="landing-primary-button"
                onClick={() => openAuth("register")}
              >
                Get Started <ArrowRight size={18} />
              </button>

              <a href="#how-it-works" className="landing-outline-button">
                How It Works
              </a>
            </div>

            <div className="landing-hero-benefits">
              <span>
                <CheckCircle2 size={17} /> Organized requests
              </span>
              <span>
                <CheckCircle2 size={17} /> Equipment tracking
              </span>
              <span>
                <CheckCircle2 size={17} /> Secure accounts
              </span>
            </div>
          </div>

          <div className="landing-hero-visual">
            <div className="landing-showcase">
              <div className="landing-showcase-top">
                <span className="landing-showcase-label">
                  EQUIPMENT PREVIEW
                </span>
                <span className="landing-showcase-indicator">LabGear</span>
              </div>

              <div className="landing-showcase-image">
                <img
                  src={microscopeImage}
                  alt="Laboratory microscope illustration"
                />
              </div>

              <div className="landing-showcase-bottom">
                <div>
                  <strong>Laboratory Microscope</strong>
                  <span>Science Laboratory</span>
                </div>
                <span className="landing-preview-tag">Preview</span>
              </div>
            </div>

            <div className="landing-floating-card landing-floating-top">
              <span className="landing-floating-icon">
                <ShieldCheck size={21} />
              </span>
              <div>
                <strong>Secure Reservations</strong>
                <small>Verified account access</small>
              </div>
            </div>

            <div className="landing-floating-card landing-floating-bottom">
              <span className="landing-floating-icon green">
                <PackageCheck size={21} />
              </span>
              <div>
                <strong>Inventory Tracking</strong>
                <small>Issue and return records</small>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-feature-strip">
          <div>
            <CalendarDays size={24} />
            <span>Online Reservations</span>
          </div>
          <div>
            <ClipboardCheck size={24} />
            <span>Approval Management</span>
          </div>
          <div>
            <PackageCheck size={24} />
            <span>Equipment Inventory</span>
          </div>
          <div>
            <ShieldCheck size={24} />
            <span>Secure Access</span>
          </div>
        </section>

        <section id="equipment" className="landing-section">
          <div className="landing-section-heading">
            <div>
              <span className="landing-section-tag">EQUIPMENT CATALOG</span>
              <h2>Explore Laboratory Equipment</h2>
              <p>
                Discover the equipment that can be managed and reserved through
                LabGear.
              </p>
            </div>
          </div>

          <div className="landing-equipment-grid">
            {equipmentItems.map((item) => (
              <article className="landing-equipment-card" key={item.name}>
                <div className="landing-equipment-image">
                  <img src={item.image} alt={item.name} />
                </div>

                <div className="landing-equipment-content">
                  <span>{item.category}</span>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>

                  <button onClick={() => openAuth("login")}>
                    Reserve Equipment <ArrowRight size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>

          <p className="landing-demo-note">
            Equipment illustrations are previews. Actual inventory and
            availability will be retrieved from PostgreSQL.
          </p>
        </section>

        <section id="how-it-works" className="landing-section landing-process">
          <div className="landing-centered-heading">
            <span className="landing-section-tag">SIMPLE PROCESS</span>
            <h2>How LabGear Works</h2>
            <p>
              A straightforward workflow from equipment selection to return
              inspection.
            </p>
          </div>

          <div className="landing-steps">
            {steps.map((step, index) => {
              const Icon = step.icon;

              return (
                <div className="landing-step" key={step.title}>
                  <div className="landing-step-icon">
                    <Icon size={27} />
                  </div>
                  <span className="landing-step-number">
                    STEP {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="landing-cta-section">
          <div className="landing-cta-content">
            <div>
              <h2>Make laboratory reservations simpler.</h2>
              <p>
                A centralized platform for equipment access, accountability, and
                organized laboratory operations.
              </p>
            </div>

            <button onClick={() => openAuth("register")}>
              Create an Account <ArrowRight size={18} />
            </button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <img src={labgearMark} alt="" />
            <strong>LabGear</strong>
          </div>

          <p>© 2026 LabGear. All rights reserved.</p>

          <div className="landing-api-status">
            <span
              className={
                apiStatus === "online"
                  ? "landing-status-dot online"
                  : "landing-status-dot"
              }
            />
            {apiStatus === "online"
              ? "Backend connected"
              : apiStatus === "checking"
                ? "Checking backend"
                : "Backend unavailable"}
          </div>
        </div>
      </footer>

      {authModal && (
        <div
          className="landing-modal-overlay"
          style={{
            // Keep dialogs inside the viewport instead of centering an
            // oversized form above the top edge of the screen.
            alignItems: "flex-start",
            justifyContent: "center",
            overflowY: "auto",
            padding: "clamp(12px, 3vh, 28px) 16px",
            boxSizing: "border-box",
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setAuthModal(null);
            }
          }}
        >
          <div
            className={
              authModal === "register"
                ? "landing-modal landing-modal-register"
                : "landing-modal"
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="landing-modal-title"
            style={{
              // Preserve existing CSS-based colors, widths, typography,
              // fields and layout; only constrain vertical scrolling.
              position: "relative",
              boxSizing: "border-box",
              maxWidth: "100%",
              maxHeight: "calc(100dvh - 48px)",
              overflowY: "auto",
              flexShrink: 0,
              margin: "0 auto",
            }}
          >
            <button
              className="landing-modal-close"
              onClick={() => setAuthModal(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>

            {authModal === "login" ? (
              <LoginPanel
                onForgotPassword={() => setAuthModal("recovery")}
                onLoginSuccess={handleLoginSuccess}
              />
            ) : authModal === "register" ? (
              <RegisterPanel />
            ) : (
              <AuthSecurityPanel
                mode={authModal}
                onBackToLogin={() => setAuthModal("login")}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LandingPage;
