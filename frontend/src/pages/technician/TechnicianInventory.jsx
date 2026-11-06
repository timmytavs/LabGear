import { useMemo, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Eye,
  Package,
  Plus,
  Search,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";

import microscopeImage from "../../assets/microscope.svg";
import arduinoImage from "../../assets/arduino-kit.svg";
import routerImage from "../../assets/network-router.svg";
import placeholderImage from "../../assets/equipment-placeholder.svg";

import "../../styles/technician-inventory.css";

const categories = [
  "Science Laboratory",
  "Electronics Laboratory",
  "Computer Laboratory",
  "General Laboratory",
];

const initialEquipment = [
  {
    id: 1,
    code: "SCI-MIC-001",
    name: "Laboratory Microscope",
    category: "Science Laboratory",
    location: "Room 101",
    description: "Optical microscope for laboratory observations.",
    image: microscopeImage,
    units: [
      { tag: "MIC-001", status: "available" },
      { tag: "MIC-002", status: "available" },
      { tag: "MIC-003", status: "available" },
      { tag: "MIC-004", status: "available" },
    ],
  },
  {
    id: 2,
    code: "ELE-ARD-001",
    name: "Arduino Starter Kit",
    category: "Electronics Laboratory",
    location: "Room 204",
    description: "Microcontroller starter kit for programming.",
    image: arduinoImage,
    units: [
      { tag: "ARD-001", status: "available" },
      { tag: "ARD-002", status: "available" },
      { tag: "ARD-003", status: "issued" },
      { tag: "ARD-004", status: "maintenance" },
    ],
  },
  {
    id: 3,
    code: "NET-RTR-001",
    name: "Network Router",
    category: "Computer Laboratory",
    location: "Room 305",
    description: "Router used for networking laboratory exercises.",
    image: routerImage,
    units: [
      { tag: "RTR-001", status: "available" },
      { tag: "RTR-002", status: "reserved" },
      { tag: "RTR-003", status: "issued" },
      { tag: "RTR-004", status: "retired" },
    ],
  },
];

const emptyForm = {
  code: "",
  name: "",
  category: "Science Laboratory",
  location: "",
  description: "",
  quantity: "1",
};

const statusLabels = {
  available: "Available",
  reserved: "Reserved",
  issued: "Issued",
  maintenance: "Maintenance",
  damaged: "Damaged",
  retired: "Retired",
};

function countUnits(item, status) {
  return item.units.filter((unit) => unit.status === status).length;
}

function createUnits(code, quantity, existing = []) {
  const used = new Set(existing.map((unit) => unit.tag));
  const result = [];

  let number = 1;

  while (result.length < quantity) {
    const tag = `${code}-U${String(number).padStart(3, "0")}`;
    number++;

    if (!used.has(tag)) {
      result.push({ tag, status: "available" });
      used.add(tag);
    }
  }

  return result;
}

export default function TechnicianInventory() {
  const [equipment, setEquipment] = useState(initialEquipment);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = equipment.find((item) => item.id === selectedId);

  const units = equipment.flatMap((item) => item.units);

  const availableCount = units.filter(
    (unit) => unit.status === "available",
  ).length;

  const attentionCount = units.filter((unit) =>
    ["damaged", "maintenance"].includes(unit.status),
  ).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return equipment.filter((item) => {
      const matchesSearch = [
        item.code,
        item.name,
        item.category,
        item.location,
        ...item.units.map((unit) => unit.tag),
      ].some((value) => value.toLowerCase().includes(query));

      const matchesCategory = category === "all" || item.category === category;

      const matchesStatus =
        statusFilter === "all" ||
        item.units.some((unit) => unit.status === statusFilter);

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [equipment, search, category, statusFilter]);

  function openCreate() {
    setForm({ ...emptyForm });
    setEditor("create");
    setError("");
  }

  function openEdit(item) {
    setForm({
      code: item.code,
      name: item.name,
      category: item.category,
      location: item.location,
      description: item.description,
      quantity: String(item.units.length),
    });

    setEditor(item.id);
    setError("");
  }

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
  }

  function saveEquipment(event) {
    event.preventDefault();

    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    const location = form.location.trim();
    const description = form.description.trim();
    const quantity = Number(form.quantity);

    if (!/^[A-Z0-9-]{4,30}$/.test(code)) {
      setError("Equipment code must contain 4–30 letters, digits, or hyphens.");
      return;
    }

    if (!name || !location || !description) {
      setError("Complete all required equipment information.");
      return;
    }

    if (!categories.includes(form.category)) {
      setError("Select a valid equipment category.");
      return;
    }

    if (editor === "create") {
      if (equipment.some((item) => item.code.toUpperCase() === code)) {
        setError("This equipment code already exists.");
        return;
      }

      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20) {
        setError("Initial quantity must be between 0 and 20.");
        return;
      }

      const id = Math.max(0, ...equipment.map((item) => item.id)) + 1;

      setEquipment((previous) => [
        ...previous,
        {
          id,
          code,
          name,
          category: form.category,
          location,
          description,
          image: placeholderImage,
          units: createUnits(code, quantity),
        },
      ]);

      setSelectedId(id);
      setNotice(`${name} added to the local inventory preview.`);
    } else {
      setEquipment((previous) =>
        previous.map((item) =>
          item.id === editor
            ? {
                ...item,
                name,
                category: form.category,
                location,
                description,
              }
            : item,
        ),
      );

      setNotice("Equipment information updated in the preview.");
    }

    setEditor(null);
    setError("");
  }

  function addUnit(item) {
    setEquipment((previous) =>
      previous.map((record) =>
        record.id === item.id
          ? {
              ...record,
              units: [
                ...record.units,
                ...createUnits(record.code, 1, record.units),
              ],
            }
          : record,
      ),
    );

    setNotice(`One available unit was added to ${item.name} in the preview.`);
  }

  function updateUnitStatus(itemId, tag, nextStatus) {
    setEquipment((previous) =>
      previous.map((item) => {
        if (item.id !== itemId) return item;

        return {
          ...item,
          units: item.units.map((unit) => {
            if (unit.tag !== tag) return unit;

            const allowed =
              (unit.status === "available" &&
                ["maintenance", "retired"].includes(nextStatus)) ||
              (unit.status === "maintenance" &&
                ["available", "retired"].includes(nextStatus));

            return allowed ? { ...unit, status: nextStatus } : unit;
          }),
        };
      }),
    );

    setNotice(
      `Preview action recorded for ${tag}: ${statusLabels[nextStatus]}.`,
    );
  }

  return (
    <section className="lginv-page">
      <div className="lginv-banner">
        <div>
          <span>LABORATORY TECHNICIAN</span>
          <h2>Inventory Management</h2>
          <p>
            Organize equipment records and manage individual laboratory
            equipment units.
          </p>
        </div>
        <Package size={33} />
      </div>

      <div className="lginv-stats">
        <Stat label="Equipment Types" value={equipment.length} />
        <Stat label="Total Units" value={units.length} />
        <Stat label="Available Units" value={availableCount} />
        <Stat label="Needs Attention" value={attentionCount} />
      </div>

      <div className="lginv-toolbar">
        <div className="lginv-search">
          <Search size={18} />
          <input
            type="search"
            placeholder="Search equipment or asset tag"
            aria-label="Search inventory"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          aria-label="Filter equipment category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All Categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter equipment status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">All Statuses</option>
          {Object.entries(statusLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <button type="button" className="lginv-add-button" onClick={openCreate}>
          <Plus size={17} /> Add Equipment
        </button>
      </div>

      {notice && (
        <div className="lginv-notice" role="status">
          <CheckCircle2 size={19} />
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="lginv-heading">
        <h3>Equipment Records</h3>
        <span>{filtered.length} results</span>
      </div>

      {filtered.length === 0 ? (
        <div className="lginv-empty">
          No equipment matches the selected filters.
        </div>
      ) : (
        <div className="lginv-grid">
          {filtered.map((item) => (
            <article className="lginv-card" key={item.id}>
              <div className="lginv-image">
                <img src={item.image} alt={item.name} />
              </div>

              <div className="lginv-card-body">
                <small>{item.category}</small>
                <h3>{item.name}</h3>
                <p>
                  {item.code} · {item.location}
                </p>

                <div className="lginv-unit-summary">
                  <div>
                    <strong>{item.units.length}</strong>
                    <span>Total</span>
                  </div>
                  <div>
                    <strong>{countUnits(item, "available")}</strong>
                    <span>Available</span>
                  </div>
                  <div>
                    <strong>
                      {countUnits(item, "maintenance") +
                        countUnits(item, "damaged")}
                    </strong>
                    <span>Attention</span>
                  </div>
                </div>

                <button
                  className="lginv-details-button"
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                >
                  <Eye size={16} /> Manage Equipment
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="lginv-info">
        <ShieldAlert size={20} />
        <p>
          Inventory changes are simulated in React only. Issued and reserved
          units cannot be directly reassigned on this page. Real updates will
          require technician authorization, transaction checks, and audit
          logging in FastAPI.
        </p>
      </div>

      {selected && !editor && (
        <div
          className="lginv-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedId(null);
            }
          }}
        >
          <div
            className="lginv-modal lginv-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lginv-details-title"
          >
            <button
              className="lginv-close"
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close equipment details"
            >
              <X size={20} />
            </button>

            <div className="lginv-modal-heading">
              <img src={selected.image} alt="" />
              <div>
                <h2 id="lginv-details-title">{selected.name}</h2>
                <p>
                  {selected.code} · {selected.category}
                </p>
                <small>{selected.location}</small>
              </div>
            </div>

            <p className="lginv-description">{selected.description}</p>

            <div className="lginv-modal-actions">
              <button type="button" onClick={() => openEdit(selected)}>
                Edit Information
              </button>
              <button
                type="button"
                className="lginv-add-button"
                onClick={() => addUnit(selected)}
              >
                <Plus size={16} /> Add One Unit
              </button>
            </div>

            <h3>Physical Equipment Units</h3>

            <div className="lginv-units">
              {selected.units.length === 0 ? (
                <p>No units registered for this equipment.</p>
              ) : (
                selected.units.map((unit) => (
                  <div className="lginv-unit-row" key={unit.tag}>
                    <div>
                      <strong>{unit.tag}</strong>
                      <span className={`lginv-unit-status ${unit.status}`}>
                        {statusLabels[unit.status]}
                      </span>
                    </div>

                    <div className="lginv-unit-actions">
                      {unit.status === "available" && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              updateUnitStatus(
                                selected.id,
                                unit.tag,
                                "maintenance",
                              )
                            }
                          >
                            <Wrench size={14} /> Maintenance
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateUnitStatus(selected.id, unit.tag, "retired")
                            }
                          >
                            <Archive size={14} /> Retire
                          </button>
                        </>
                      )}

                      {unit.status === "maintenance" && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              updateUnitStatus(
                                selected.id,
                                unit.tag,
                                "available",
                              )
                            }
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateUnitStatus(selected.id, unit.tag, "retired")
                            }
                          >
                            Retire
                          </button>
                        </>
                      )}

                      {["reserved", "issued", "damaged", "retired"].includes(
                        unit.status,
                      ) && <small>Read-only status</small>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {editor !== null && (
        <div className="lginv-overlay">
          <form
            className="lginv-modal"
            onSubmit={saveEquipment}
            aria-labelledby="lginv-editor-title"
          >
            <h2 id="lginv-editor-title">
              {editor === "create" ? "Add Equipment" : "Edit Equipment"}
            </h2>

            <p className="lginv-description">
              Equipment catalog information for local preview.
            </p>

            <label>
              Equipment Code *
              <input
                name="code"
                value={form.code}
                onChange={updateForm}
                disabled={editor !== "create"}
                maxLength={30}
                required
              />
            </label>

            <label>
              Equipment Name *
              <input
                name="name"
                value={form.name}
                onChange={updateForm}
                maxLength={100}
                required
              />
            </label>

            <label>
              Category *
              <select
                name="category"
                value={form.category}
                onChange={updateForm}
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Laboratory Location *
              <input
                name="location"
                value={form.location}
                onChange={updateForm}
                maxLength={100}
                required
              />
            </label>

            <label>
              Description *
              <textarea
                name="description"
                value={form.description}
                onChange={updateForm}
                rows={3}
                maxLength={500}
                required
              />
            </label>

            {editor === "create" && (
              <label>
                Initial Number of Units *
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  max="20"
                  value={form.quantity}
                  onChange={updateForm}
                  required
                />
              </label>
            )}

            {error && (
              <p className="lginv-error" role="alert">
                {error}
              </p>
            )}

            <div className="lginv-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setEditor(null);
                  setError("");
                }}
              >
                Cancel
              </button>
              <button type="submit" className="lginv-add-button">
                {editor === "create"
                  ? "Add Demo Equipment"
                  : "Save Demo Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="lginv-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
