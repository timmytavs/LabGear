import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  ClipboardList,
  Clock3,
  Package,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import microscopeImage from "../assets/microscope.svg";
import arduinoImage from "../assets/arduino-kit.svg";
import routerImage from "../assets/network-router.svg";

import "../styles/equipment.css";

// Fictional data for frontend design testing only.
// Actual inventory will come from PostgreSQL.

const equipmentData = [
  {
    id: 1,
    code: "SCI-MIC-001",
    name: "Laboratory Microscope",
    category: "Science Laboratory",
    image: microscopeImage,
    total: 10,
    available: 6,
    location: "Science Laboratory - Room 101",
    description:
      "Optical microscope used for observing specimens in laboratory activities.",
  },
  {
    id: 2,
    code: "ELE-ARD-001",
    name: "Arduino Starter Kit",
    category: "Electronics Laboratory",
    image: arduinoImage,
    total: 7,
    available: 4,
    location: "Electronics Laboratory - Room 204",
    description:
      "Microcontroller development kit for electronics and programming activities.",
  },
  {
    id: 3,
    code: "NET-RTR-001",
    name: "Network Router",
    category: "Computer Laboratory",
    image: routerImage,
    total: 5,
    available: 0,
    location: "Networking Laboratory - Room 305",
    description:
      "Network routing equipment for practical networking exercises.",
  },
];

const categories = [
  "All Categories",
  "Science Laboratory",
  "Electronics Laboratory",
  "Computer Laboratory",
];

function localDateTimeNow() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    "-",
    pad(now.getMonth() + 1),
    "-",
    pad(now.getDate()),
    "T",
    pad(now.getHours()),
    ":",
    pad(now.getMinutes()),
  ].join("");
}

export default function EquipmentCatalog({ role = "student" }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [availability, setAvailability] = useState("all");
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({
    quantity: 1,
    start: "",
    end: "",
    purpose: "",
  });
  const [formError, setFormError] = useState("");
  const [previewSaved, setPreviewSaved] = useState(false);

  const canPrepareReservation = role === "student" || role === "instructor";

  const filteredEquipment = useMemo(() => {
    return equipmentData.filter((item) => {
      const query = search.trim().toLowerCase();

      const matchesSearch =
        item.name.toLowerCase().includes(query) ||
        item.code.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query);

      const matchesCategory =
        category === "All Categories" || item.category === category;

      const matchesAvailability =
        availability === "all" ||
        (availability === "available" && item.available > 0) ||
        (availability === "unavailable" && item.available === 0);

      return matchesSearch && matchesCategory && matchesAvailability;
    });
  }, [search, category, availability]);

  const totalAvailable = equipmentData.reduce(
    (sum, item) => sum + item.available,
    0,
  );

  function openEquipment(item) {
    setSelected(item);
    setDraft({
      quantity: 1,
      start: "",
      end: "",
      purpose: "",
    });
    setFormError("");
    setPreviewSaved(false);
  }

  function closeEquipment() {
    setSelected(null);
    setFormError("");
    setPreviewSaved(false);
  }

  useEffect(() => {
    if (!selected) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setSelected(null);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selected]);

  function updateDraft(event) {
    const { name, value } = event.target;

    setDraft((previous) => ({
      ...previous,
      [name]: value,
    }));

    setFormError("");
    setPreviewSaved(false);
  }

  function previewReservation(event) {
    event.preventDefault();

    if (!selected || !canPrepareReservation) return;

    const quantity = Number(draft.quantity);
    const start = new Date(draft.start).getTime();
    const end = new Date(draft.end).getTime();

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > selected.available
    ) {
      setFormError("Please enter a valid equipment quantity.");
      return;
    }

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start <= Date.now() ||
      end <= start
    ) {
      setFormError(
        "Choose a future start date and an end date after the start.",
      );
      return;
    }

    if (!draft.purpose.trim()) {
      setFormError("Please enter your reservation purpose.");
      return;
    }

    setFormError("");
    setPreviewSaved(true);
  }

  function resetFilters() {
    setSearch("");
    setCategory("All Categories");
    setAvailability("all");
  }

  return (
    <div className="lgeq-page">
      <div className="lgeq-banner">
        <div>
          <h2>
            {role === "technician" ? "Inventory Catalog" : "Explore Equipment"}
          </h2>
          <p>
            {role === "technician"
              ? "Browse equipment records and sample inventory quantities."
              : "Find equipment and prepare laboratory reservation requests."}
          </p>
        </div>

        <div className="lgeq-banner-icon">
          <Package size={28} />
        </div>
      </div>

      <div className="lgeq-summary">
        <div>
          <span>Equipment Types</span>
          <strong>{equipmentData.length}</strong>
        </div>
        <div>
          <span>Available Units</span>
          <strong>{totalAvailable}</strong>
        </div>
        <div>
          <span>Unavailable Types</span>
          <strong>
            {equipmentData.filter((item) => item.available === 0).length}
          </strong>
        </div>
      </div>

      <div className="lgeq-filters">
        <div className="lgeq-search">
          <Search size={20} />
          <input
            type="search"
            placeholder="Search by equipment name, code, or category"
            aria-label="Search equipment"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="lgeq-filter-controls">
          <label>
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            Availability
            <select
              value={availability}
              onChange={(event) => setAvailability(event.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>

          <button className="lgeq-reset" onClick={resetFilters} type="button">
            <SlidersHorizontal size={16} />
            Reset
          </button>
        </div>
      </div>

      <div className="lgeq-results">
        <h3>Equipment List</h3>
        <span>{filteredEquipment.length} results</span>
      </div>

      {filteredEquipment.length > 0 ? (
        <div className="lgeq-grid">
          {filteredEquipment.map((item) => (
            <article className="lgeq-card" key={item.id}>
              <div className="lgeq-card-image">
                <img src={item.image} alt={item.name} />
                <span
                  className={
                    item.available > 0
                      ? "lgeq-status available"
                      : "lgeq-status unavailable"
                  }
                >
                  {item.available > 0 ? "Available" : "Unavailable"}
                </span>
              </div>

              <div className="lgeq-card-content">
                <span className="lgeq-category">{item.category}</span>

                <h3>{item.name}</h3>
                <p>{item.description}</p>

                <div className="lgeq-card-details">
                  <div>
                    <span>Equipment Code</span>
                    <strong>{item.code}</strong>
                  </div>
                  <div>
                    <span>Sample Stock</span>
                    <strong>
                      {item.available} / {item.total}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="lgeq-view-button"
                  onClick={() => openEquipment(item)}
                >
                  {canPrepareReservation
                    ? "View / Prepare Reservation"
                    : "View Equipment Details"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="lgeq-empty">
          <Search size={32} />
          <h3>No equipment found</h3>
          <p>Try changing your search or category filters.</p>
          <button type="button" onClick={resetFilters}>
            Clear Filters
          </button>
        </div>
      )}

      <div className="lgeq-preview-note">
        <ClipboardList size={19} />
        <p>
          This page uses fictional inventory data for UI development. Equipment
          availability and reservation requests are not connected to PostgreSQL
          yet.
        </p>
      </div>

      {selected && (
        <div
          className="lgeq-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEquipment();
            }
          }}
        >
          <div
            className="lgeq-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lgeq-dialog-title"
          >
            <button
              className="lgeq-modal-close"
              onClick={closeEquipment}
              type="button"
              aria-label="Close equipment details"
            >
              <X size={22} />
            </button>

            <img
              className="lgeq-modal-image"
              src={selected.image}
              alt={selected.name}
            />

            <h2 id="lgeq-dialog-title">{selected.name}</h2>
            <p className="lgeq-modal-description">{selected.description}</p>

            <div className="lgeq-modal-details">
              <p>
                <strong>Code:</strong> {selected.code}
              </p>
              <p>
                <strong>Category:</strong> {selected.category}
              </p>
              <p>
                <strong>Location:</strong> {selected.location}
              </p>
              <p>
                <strong>Sample availability:</strong> {selected.available} of{" "}
                {selected.total} units
              </p>
            </div>

            {canPrepareReservation && selected.available > 0 && (
              <form
                className="lgeq-reservation-form"
                onSubmit={previewReservation}
              >
                <h3>
                  <CalendarPlus size={20} />
                  Prepare Reservation
                </h3>

                <label htmlFor="lgeq-quantity">Quantity *</label>
                <input
                  id="lgeq-quantity"
                  type="number"
                  name="quantity"
                  min="1"
                  max={selected.available}
                  value={draft.quantity}
                  onChange={updateDraft}
                  required
                />

                <label htmlFor="lgeq-start">Reservation Start *</label>
                <input
                  id="lgeq-start"
                  type="datetime-local"
                  name="start"
                  min={localDateTimeNow()}
                  value={draft.start}
                  onChange={updateDraft}
                  required
                />

                <label htmlFor="lgeq-end">Reservation End *</label>
                <input
                  id="lgeq-end"
                  type="datetime-local"
                  name="end"
                  min={draft.start || localDateTimeNow()}
                  value={draft.end}
                  onChange={updateDraft}
                  required
                />

                <label htmlFor="lgeq-purpose">Reservation Purpose *</label>
                <textarea
                  id="lgeq-purpose"
                  name="purpose"
                  rows="3"
                  placeholder="Describe the laboratory activity"
                  value={draft.purpose}
                  onChange={updateDraft}
                  required
                />

                {formError && (
                  <p className="lgeq-form-error" role="alert">
                    {formError}
                  </p>
                )}

                {previewSaved && (
                  <div className="lgeq-draft-success" role="status">
                    Reservation preview prepared. No request was submitted or
                    saved.
                  </div>
                )}

                <button className="lgeq-submit" type="submit">
                  <Clock3 size={18} />
                  Preview Request
                </button>
              </form>
            )}

            {canPrepareReservation && selected.available === 0 && (
              <p className="lgeq-unavailable-message">
                No sample units are currently available for this equipment.
              </p>
            )}

            {!canPrepareReservation && (
              <p className="lgeq-unavailable-message">
                Inventory changes will be available after technician
                authentication and backend integration.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
