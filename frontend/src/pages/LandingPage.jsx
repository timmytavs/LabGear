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
} from "lucide-react";

import LoginPanel from "./auth/LoginPanel";
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

function LandingPage({ apiStatus }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [authModal, setAuthModal] = useState(null);

  useEffect(() => {
    if (!authModal) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event) {
      if (event.key === "Escape") {
        setAuthModal(null);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [authModal]);

  function openAuth(type) {
    setMenuOpen(false);
    setAuthModal(type);
  }

  return (
    <div className="landing-page">
      <style>{compactAuthModalStyles}</style>
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
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setAuthModal(null);
            }
          }}
        >
          <div
            className={
              authModal === "register"
                ? "landing-modal landing-modal-register landing-modal-compact-register"
                : authModal === "login"
                  ? "landing-modal landing-modal-compact-login"
                  : "landing-modal landing-modal-compact-security"
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="landing-modal-title"
          >
            <button
              type="button"
              className="landing-modal-close"
              onClick={() => setAuthModal(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>

            {authModal === "login" ? (
              <LoginPanel
                onForgotPassword={() => setAuthModal("recovery")}
                onPreviewLoginOtp={
                  import.meta.env.DEV
                    ? () => setAuthModal("login-otp")
                    : undefined
                }
              />
            ) : authModal === "register" ? (
              <RegisterPanel
                onPreviewEmailOtp={
                  import.meta.env.DEV
                    ? () => setAuthModal("registration-otp")
                    : undefined
                }
              />
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


// Compact authentication layout scoped to the landing page.
// Keeps the existing landing.css and frontend authentication components intact.
const compactAuthModalStyles = `
.landing-page .landing-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  overflow: hidden;
}

.landing-page .landing-modal-overlay .landing-modal {
  box-sizing: border-box;
  width: min(450px, calc(100vw - 24px));
  max-width: none;
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 25px 28px;
  border-radius: 16px;
  scrollbar-width: thin;
}

.landing-page .landing-modal-overlay .landing-modal-compact-register {
  width: min(760px, calc(100vw - 24px));
  padding: 22px 27px;
}

.landing-page .landing-modal .lg-auth-heading {
  margin-bottom: 18px;
}

.landing-page .landing-modal .lg-auth-heading h2 {
  font-size: 23px;
  margin-bottom: 5px;
}

.landing-page .landing-modal .lg-auth-panel .lg-form-group {
  margin-bottom: 13px;
}

.landing-page .landing-modal .lg-auth-panel .lg-label {
  font-size: 12px;
  margin-bottom: 6px;
}

.landing-page .landing-modal .lg-auth-panel .lg-input {
  min-height: 43px;
  font-size: 13px;
}

.landing-page .landing-modal .lg-auth-forgot {
  margin: 0 0 13px;
}

.landing-page .landing-modal .lg-auth-captcha {
  min-height: 0;
  padding: 12px;
  margin-bottom: 14px;
  gap: 10px;
}

.landing-page .landing-modal .lg-auth-captcha p {
  font-size: 11px;
  line-height: 1.5;
}

.landing-page .landing-modal .lg-auth-submit {
  min-height: 43px;
}

.landing-page .landing-modal .lg-auth-dev-note {
  font-size: 11px;
  line-height: 1.55;
  margin-top: 10px;
}

.landing-page .landing-modal .lg-auth-preview-link {
  margin: 10px auto 0;
  font-size: 11px;
  padding: 5px;
}

.landing-page .landing-modal .lg-register-heading {
  margin-bottom: 15px;
}

.landing-page .landing-modal .lg-register-heading-icon {
  width: 44px;
  height: 44px;
  margin-bottom: 9px;
}

.landing-page .landing-modal .lg-register-heading h2 {
  font-size: 22px;
}

.landing-page .landing-modal .lg-register-progress {
  margin: 16px 0 19px;
}

.landing-page .landing-modal .lg-register-section {
  padding: 16px;
  margin-bottom: 14px;
}

.landing-page .landing-modal .lg-register-section h3 {
  font-size: 14px;
  padding-bottom: 10px;
  margin-bottom: 13px;
}

.landing-page .landing-modal .lg-register-grid {
  gap: 8px 16px;
}

.landing-page .landing-modal .lg-register-field {
  gap: 5px;
  margin-bottom: 5px;
}

.landing-page .landing-modal .lg-register-field .lg-input {
  min-height: 41px;
  font-size: 12px;
}

.landing-page .landing-modal .lgas-header {
  margin-bottom: 13px;
}

.landing-page .landing-modal .lgas-content {
  gap: 11px;
  margin-top: 14px;
}

@media (max-width: 600px) {
  .landing-page .landing-modal-overlay .landing-modal {
    width: calc(100vw - 20px);
    max-height: calc(100dvh - 20px);
    padding: 20px 16px;
  }

  .landing-page .landing-modal .lg-register-grid {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
`;

export default LandingPage;
