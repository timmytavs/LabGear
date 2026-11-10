/**
 * LabGear Frontend File 78 — live Equipment Catalog + reservation submission.
 * Destination: frontend/src/pages/EquipmentCatalog.jsx (REPLACE)
 *
 * Preserves the existing lgeq-* layout and equipment.css. In the authenticated
 * workspace, equipment/category/stock data comes from FastAPI and PostgreSQL.
 * Students and instructors submit reservations through the File 77 API client.
 * Development-only ?preview=dashboard keeps fictional data isolated and never
 * submits a reservation to the backend.
 */

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
import { getLoginApiBaseUrl } from "../services/loginApi";
import { createReservation } from "../services/reservationApi";
import "../styles/equipment.css";

const PAGE_SIZE = 12;
const API_PAGE_SIZE = 50;
const MAX_API_PAGES = 100;

// Only for the existing explicit ?preview=dashboard design-preview page.
// These values are NEVER displayed as real authenticated stock records.
const DESIGN_PREVIEW_ITEMS = [
  {
    id: 1,
    equipment_code: "SCI-MIC-001",
    equipment_name: "Laboratory Microscope",
    category_id: 1,
    category_name: "Science Laboratory",
    description: "Optical microscope for laboratory observation.",
    total_units: 10,
    available_units: 6,
  },
  {
    id: 2,
    equipment_code: "ELE-ARD-001",
    equipment_name: "Arduino Starter Kit",
    category_id: 2,
    category_name: "Electronics Laboratory",
    description: "Microcontroller kit for programming activities.",
    total_units: 7,
    available_units: 4,
  },
  {
    id: 3,
    equipment_code: "NET-RTR-001",
    equipment_name: "Network Router",
    category_id: 3,
    category_name: "Computer Laboratory",
    description: "Network routing equipment for practical exercises.",
    total_units: 5,
    available_units: 0,
  },
];

const DESIGN_PREVIEW_CATEGORIES = [
  { id: 1, category_name: "Science Laboratory" },
  { id: 2, category_name: "Electronics Laboratory" },
  { id: 3, category_name: "Computer Laboratory" },
];

function localDateTimeNow() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function visualFor(item) {
  const name =
    `${item.equipment_name || ""} ${item.equipment_code || ""}`.toLowerCase();
  if (name.includes("microscop") || name.includes("-mic-"))
    return microscopeImage;
  if (name.includes("arduino") || name.includes("-ard-")) return arduinoImage;
  if (name.includes("router") || name.includes("-rtr-")) return routerImage;
  return null;
}

async function apiGet(path, signal) {
  const url = `${getLoginApiBaseUrl()}${path}`;
  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(
      "Unable to reach the LabGear Equipment API. Check FastAPI and your network.",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Your login session is no longer valid. Sign in again to view equipment.",
      );
    }

    if (response.status === 403) {
      throw new Error(
        "Your account is not authorized to view the equipment catalog.",
      );
    }

    throw new Error(
      `Equipment API returned HTTP ${response.status}. Check the FastAPI terminal for details.`,
    );
  }

  return response.json();
}

async function fetchAllEquipment(signal) {
  const first = await apiGet(
    `/api/equipment?page=1&page_size=${API_PAGE_SIZE}`,
    signal,
  );

  if (!first || !Array.isArray(first.items) || !Number.isInteger(first.pages)) {
    throw new Error(
      "The Equipment API returned an unexpected catalog response.",
    );
  }

  if (first.pages > MAX_API_PAGES) {
    throw new Error(
      "The catalog exceeds 5,000 equipment types. Server-side filtering is needed before displaying it.",
    );
  }

  const items = [...first.items];

  for (let start = 2; start <= first.pages; start += 5) {
    const pages = [];

    for (let page = start; page < start + 5 && page <= first.pages; page += 1) {
      pages.push(
        apiGet(
          `/api/equipment?page=${page}&page_size=${API_PAGE_SIZE}`,
          signal,
        ),
      );
    }

    const results = await Promise.all(pages);

    for (const result of results) {
      if (!result || !Array.isArray(result.items)) {
        throw new Error("An equipment page contained invalid data.");
      }

      items.push(...result.items);
    }
  }

  return items;
}

function displayQuantity(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

export default function EquipmentCatalog({ role = "student" }) {
  const isDesignPreview =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") === "dashboard";

  const [items, setItems] = useState(
    isDesignPreview ? DESIGN_PREVIEW_ITEMS : [],
  );

  const [categories, setCategories] = useState(
    isDesignPreview ? DESIGN_PREVIEW_CATEGORIES : [],
  );

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(!isDesignPreview);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const [draft, setDraft] = useState({
    quantity: 1,
    start: "",
    end: "",
    purpose: "",
  });

  const [formError, setFormError] = useState("");
  const [previewSaved, setPreviewSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [reloadCount, setReloadCount] = useState(0);

  const canPrepareReservation = role === "student" || role === "instructor";

  useEffect(() => {
    if (isDesignPreview) return undefined;

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError("");

    Promise.all([
      fetchAllEquipment(controller.signal),
      apiGet("/api/equipment/categories", controller.signal),
      apiGet("/api/equipment/stats", controller.signal),
    ])
      .then(([equipment, categoryList, totals]) => {
        if (!active) return;

        if (
          !Array.isArray(categoryList) ||
          !totals ||
          typeof totals !== "object"
        ) {
          throw new Error(
            "The Equipment API returned an unexpected summary response.",
          );
        }

        setItems(equipment);
        setCategories(categoryList);
        setStats(totals);
      })
      .catch((reason) => {
        if (active && reason?.name !== "AbortError") {
          setItems([]);
          setStats(null);
          setError(reason?.message || "Could not load the equipment catalog.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isDesignPreview, reloadCount]);

  const filteredEquipment = useMemo(() => {
    const query = search.trim().toLowerCase();

    return items.filter((item) => {
      const text =
        `${item.equipment_name ?? ""} ${item.equipment_code ?? ""} ${item.category_name ?? ""}`.toLowerCase();

      const available = displayQuantity(item.available_units);

      return (
        text.includes(query) &&
        (category === "all" || String(item.category_id) === category) &&
        (availability === "all" ||
          (availability === "available" && available > 0) ||
          (availability === "unavailable" && available === 0))
      );
    });
  }, [items, search, category, availability]);

  const pages = Math.max(1, Math.ceil(filteredEquipment.length / PAGE_SIZE));

  const currentPage = Math.min(page, pages);

  const visibleEquipment = filteredEquipment.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const totalAvailable = isDesignPreview
    ? items.reduce(
        (sum, item) => sum + displayQuantity(item.available_units),
        0,
      )
    : stats?.available_units;

  const totalTypes = isDesignPreview
    ? items.length
    : stats?.total_equipment_types;

  const unavailableTypes = isDesignPreview
    ? items.filter((item) => displayQuantity(item.available_units) === 0).length
    : stats &&
      Number(stats.total_equipment_types) -
        Number(stats.equipment_types_in_stock);

  function updateFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  function resetFilters() {
    setSearch("");
    setCategory("all");
    setAvailability("all");
    setPage(1);
  }

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
    setSubmissionResult(null);
    setIsSubmitting(false);
  }

  function closeEquipment() {
    if (isSubmitting) return;

    setSelected(null);
    setFormError("");
    setPreviewSaved(false);
    setSubmissionResult(null);
  }

  useEffect(() => {
    if (!selected) return undefined;

    const onEscape = (event) => {
      if (event.key === "Escape" && !isSubmitting) {
        closeEquipment();
      }
    };

    window.addEventListener("keydown", onEscape);

    return () => window.removeEventListener("keydown", onEscape);
  }, [selected, isSubmitting]);

  function updateDraft(event) {
    const { name, value } = event.target;

    setDraft((previous) => ({
      ...previous,
      [name]: value,
    }));

    setFormError("");
    setPreviewSaved(false);
    setSubmissionResult(null);
  }

  async function handleReservationSubmit(event) {
    event.preventDefault();

    if (
      !selected ||
      !canPrepareReservation ||
      isSubmitting ||
      submissionResult
    ) {
      return;
    }

    const quantity = Number(draft.quantity);
    const start = new Date(draft.start).getTime();
    const end = new Date(draft.end).getTime();
    const purpose = draft.purpose.trim();

    const registeredUnits = displayQuantity(selected.total_units);
    const maximumRequestQuantity = Math.min(50, registeredUnits);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > maximumRequestQuantity
    ) {
      setFormError(
        `Enter a quantity from 1 to ${maximumRequestQuantity} registered units. Final availability is checked for your selected dates.`,
      );
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

    if (purpose.length < 5 || purpose.length > 1000) {
      setFormError("Reservation purpose must contain 5 to 1000 characters.");
      return;
    }

    setFormError("");

    // Never submit fictional design-preview equipment IDs to PostgreSQL.
    if (isDesignPreview) {
      setPreviewSaved(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createReservation({
        equipmentId: selected.id,
        quantity,
        purpose,
        reservationStart: draft.start,
        reservationEnd: draft.end,
      });

      setSubmissionResult({
        reservationCode: result.reservation_code,
        status: result.status,
        message:
          result.message ||
          "Your reservation request is pending technician review.",
      });

      setPreviewSaved(false);

      // Refresh live inventory summaries after successful creation.
      setReloadCount((value) => value + 1);
    } catch (error) {
      setFormError(
        error?.message ||
          "The reservation could not be submitted. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="lgeq-page">
      <div className="lgeq-banner">
        <div>
          <h2>
            {role === "technician" ? "Inventory Catalog" : "Explore Equipment"}
          </h2>

          <p>
            {isDesignPreview
              ? "Browse sample equipment records and preview reservation requests."
              : "Explore the equipment records currently stored in LabGear."}
          </p>
        </div>

        <div className="lgeq-banner-icon">
          <Package size={28} />
        </div>
      </div>

      <div className="lgeq-summary">
        <div>
          <span>Equipment Types</span>
          <strong>{loading ? "…" : (totalTypes ?? "—")}</strong>
        </div>

        <div>
          <span>Available Units</span>
          <strong>{loading ? "…" : (totalAvailable ?? "—")}</strong>
        </div>

        <div>
          <span>Unavailable Types</span>
          <strong>{loading ? "…" : (unavailableTypes ?? "—")}</strong>
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
            onChange={(event) => updateFilter(setSearch, event.target.value)}
          />
        </div>

        <div className="lgeq-filter-controls">
          <label>
            Category
            <select
              value={category}
              onChange={(event) =>
                updateFilter(setCategory, event.target.value)
              }
            >
              <option value="all">All Categories</option>

              {categories.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.category_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Availability
            <select
              value={availability}
              onChange={(event) =>
                updateFilter(setAvailability, event.target.value)
              }
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

        <span>
          {loading
            ? "Loading equipment…"
            : `${filteredEquipment.length} results`}
        </span>
      </div>

      {error && (
        <div
          className="lgeq-preview-note"
          role="alert"
          style={{
            border: "1px solid #efc0c0",
            background: "#fff5f5",
            color: "#9b1c1c",
            marginBottom: 18,
          }}
        >
          <ClipboardList size={19} />

          <div>
            <p>{error}</p>

            <button
              type="button"
              className="lgeq-reset"
              style={{ marginTop: 10 }}
              onClick={() => setReloadCount((value) => value + 1)}
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="lgeq-empty" role="status">
          <Package size={32} />
          <h3>Loading equipment…</h3>
          <p>Retrieving inventory from LabGear.</p>
        </div>
      ) : !error && filteredEquipment.length > 0 ? (
        <>
          <div className="lgeq-grid">
            {visibleEquipment.map((item) => {
              const image = visualFor(item);
              const available = displayQuantity(item.available_units);

              return (
                <article className="lgeq-card" key={item.id}>
                  <div
                    className="lgeq-card-image"
                    style={{
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {image ? (
                      <img src={image} alt="Equipment illustration" />
                    ) : (
                      <Package
                        size={72}
                        color="#6b8bae"
                        aria-label="Equipment image unavailable"
                      />
                    )}

                    <span
                      className={
                        available > 0
                          ? "lgeq-status available"
                          : "lgeq-status unavailable"
                      }
                    >
                      {available > 0 ? "Available" : "Unavailable"}
                    </span>
                  </div>

                  <div className="lgeq-card-content">
                    <span className="lgeq-category">{item.category_name}</span>

                    <h3>{item.equipment_name}</h3>

                    <p>
                      {item.description || "No equipment description provided."}
                    </p>

                    <div className="lgeq-card-details">
                      <div>
                        <span>Equipment Code</span>
                        <strong>{item.equipment_code}</strong>
                      </div>

                      <div>
                        <span>Current Stock</span>
                        <strong>
                          {available} / {displayQuantity(item.total_units)}
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
              );
            })}
          </div>

          {pages > 1 && (
            <div
              className="lgeq-results"
              style={{
                justifyContent: "center",
                gap: 16,
                marginTop: 24,
                flexWrap: "wrap",
              }}
            >
              <button
                className="lgeq-reset"
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>

              <span>
                Page {currentPage} of {pages}
              </span>

              <button
                className="lgeq-reset"
                type="button"
                onClick={() => setPage((value) => Math.min(pages, value + 1))}
                disabled={currentPage === pages}
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : !error ? (
        <div className="lgeq-empty">
          <Search size={32} />

          <h3>
            {items.length === 0
              ? "No equipment records yet"
              : "No equipment found"}
          </h3>

          <p>
            {items.length === 0
              ? "The equipment database has no active catalog items yet."
              : "Try changing your search or category filters."}
          </p>

          {items.length > 0 && (
            <button type="button" onClick={resetFilters}>
              Clear Filters
            </button>
          )}
        </div>
      ) : null}

      <div className="lgeq-preview-note">
        <ClipboardList size={19} />

        <p>
          {isDesignPreview
            ? "Frontend design preview: fictional inventory records. No authentication or database changes."
            : "Inventory totals and current stock are read from PostgreSQL. Students and instructors can submit reservation requests for technician review; approved requests proceed to equipment allocation."}
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
              disabled={isSubmitting}
              aria-label="Close equipment details"
            >
              <X size={22} />
            </button>

            {visualFor(selected) ? (
              <img
                className="lgeq-modal-image"
                src={visualFor(selected)}
                alt="Equipment illustration"
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <Package size={88} color="#6b8bae" />
              </div>
            )}

            <h2 id="lgeq-dialog-title">{selected.equipment_name}</h2>

            <p className="lgeq-modal-description">
              {selected.description || "No equipment description provided."}
            </p>

            <div className="lgeq-modal-details">
              <p>
                <strong>Code:</strong> {selected.equipment_code}
              </p>

              <p>
                <strong>Category:</strong> {selected.category_name}
              </p>

              {selected.manufacturer && (
                <p>
                  <strong>Manufacturer:</strong> {selected.manufacturer}
                </p>
              )}

              {selected.model_number && (
                <p>
                  <strong>Model:</strong> {selected.model_number}
                </p>
              )}

              <p>
                <strong>Current stock:</strong>{" "}
                {displayQuantity(selected.available_units)} of{" "}
                {displayQuantity(selected.total_units)} units
              </p>

              <p>
                <strong>Reserved:</strong>{" "}
                {displayQuantity(selected.reserved_units)} units
              </p>

              <p>
                <strong>Issued:</strong>{" "}
                {displayQuantity(selected.issued_units)} units
              </p>
            </div>

            {canPrepareReservation &&
              displayQuantity(selected.total_units) > 0 && (
                <form
                  className="lgeq-reservation-form"
                  onSubmit={handleReservationSubmit}
                >
                  <h3>
                    <CalendarPlus size={20} />{" "}
                    {isDesignPreview
                      ? "Prepare Reservation"
                      : "Request Equipment"}
                  </h3>

                  <label htmlFor="lgeq-quantity">Quantity *</label>

                  <input
                    id="lgeq-quantity"
                    type="number"
                    name="quantity"
                    min="1"
                    max={Math.min(50, displayQuantity(selected.total_units))}
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
                    minLength={5}
                    maxLength={1000}
                    value={draft.purpose}
                    onChange={updateDraft}
                    required
                  />

                  {formError && (
                    <p className="lgeq-form-error" role="alert">
                      {formError}
                    </p>
                  )}

                  {previewSaved && isDesignPreview && (
                    <div className="lgeq-draft-success" role="status">
                      Reservation preview prepared. No request was submitted or
                      saved because this is fictional design-preview data.
                    </div>
                  )}

                  {submissionResult && (
                    <div className="lgeq-draft-success" role="status">
                      <strong>
                        Reservation request submitted successfully.
                      </strong>

                      <p>{submissionResult.message}</p>

                      {submissionResult.reservationCode && (
                        <p>
                          <strong>Reference:</strong>{" "}
                          {submissionResult.reservationCode}
                        </p>
                      )}

                      <p>
                        <strong>Status:</strong>{" "}
                        {(submissionResult.status || "pending").toUpperCase()}
                      </p>
                    </div>
                  )}

                  <button
                    className="lgeq-submit"
                    type="submit"
                    disabled={isSubmitting || Boolean(submissionResult)}
                  >
                    <Clock3 size={18} />

                    {isSubmitting
                      ? "Submitting..."
                      : submissionResult
                        ? "Reservation Submitted"
                        : isDesignPreview
                          ? "Preview Request"
                          : "Submit Reservation"}
                  </button>
                </form>
              )}

            {canPrepareReservation &&
              displayQuantity(selected.total_units) > 0 &&
              displayQuantity(selected.available_units) === 0 && (
                <p className="lgeq-unavailable-message">
                  No units are currently marked available. You may still request
                  a future date range; FastAPI will check existing reservations
                  and equipment capacity before accepting the request.
                </p>
              )}

            {canPrepareReservation &&
              displayQuantity(selected.total_units) === 0 && (
                <p className="lgeq-unavailable-message">
                  No equipment units are registered for this item yet.
                </p>
              )}

            {!canPrepareReservation && (
              <p className="lgeq-unavailable-message">
                Equipment viewing only. Inventory editing is not enabled in this
                catalog.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
