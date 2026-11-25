import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import L from "leaflet";
import * as turf from "@turf/turf";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Tooltip,
  GeoJSON,
  useMap,
  useMapEvents,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

/* =========================
   DATA SOURCES (RAW GitHub)
========================= */
const DATA_URL =
  `${process.env.PUBLIC_URL}/data/Data.csv`;

const ADM2_GEOJSON_URL =
  `${process.env.PUBLIC_URL}/data/geoBoundaries-AFG-ADM2_simplified.geojson`;

/* =========================
   MAP SETTINGS
========================= */
const BADAKHSHAN_CENTER = [36.7, 70.8];
const DEFAULT_ZOOM = 8;

const AFG_BOUNDS = {
  minLat: 29.0,
  maxLat: 39.7,
  minLon: 60.0,
  maxLon: 75.2,
};

/* =========================
   UTILITIES
========================= */
const cleanHeader = (h) =>
  String(h || "")
    .replace(/^\uFEFF/, "")
    .trim();

const toNumber = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").replace(/\s+/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const fmtInt = (v) => {
  const n = toNumber(v);
  if (n === null) return null;
  try {
    return new Intl.NumberFormat("en-CA").format(Math.round(n));
  } catch {
    return String(Math.round(n));
  }
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function findColumnByHints(columns, hints) {
  for (const h of hints) {
    const re = h instanceof RegExp ? h : new RegExp(h, "i");
    const found = columns.find((c) => re.test(c));
    if (found) return found;
  }
  return null;
}

function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function getDistrictNameFromFeature(f) {
  const p = f?.properties || {};
  return (
    p.shapeName ||
    p.shapeName_en ||
    p.ADM2_NAME ||
    p.ADM2_EN ||
    p.NAME_2 ||
    p.district ||
    p.DISTRICT ||
    ""
  );
}

function getFeatureId(f, fallbackIndex = 0) {
  const p = f?.properties || {};
  return (
    p.shapeID ||
    p.shapeISO ||
    p.shapeName ||
    p.ADM2_PCODE ||
    p.PCODE ||
    String(fallbackIndex)
  );
}

/* =========================
   ICONS (SVG)
========================= */
const TYPE_STYLE = {
  BHC: { fill: "#1f77b4" },
  SHC: { fill: "#ff7f0e" },
  CHC: { fill: "#2ca02c" },
  "CHC+": { fill: "#d62728" },
  DH: { fill: "#9467bd" },
  PH: { fill: "#8c564b" },
  Other: { fill: "#7f7f7f" },
  Unknown: { fill: "#111111" },
};

function svgForType(type) {
  const stroke = "#111";
  const fill = (TYPE_STYLE[type] || TYPE_STYLE.Unknown).fill;

  switch (type) {
    case "BHC":
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "CHC":
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="6" width="16" height="16" rx="1" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "CHC+":
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,4 24,14 14,24 4,14" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "DH":
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,3 17,10 24.5,10 18.5,14.5 21,23 14,18.5 7,23 9.5,14.5 3.5,10 11,10"
          fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>
      </svg>`;
    case "SHC":
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,5 25,24 3,24" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "PH":
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,4 22,9 22,19 14,24 6,19 6,9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "Other":
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5h4v7h7v4h-7v7h-4v-7H5v-4h7z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
      </svg>`;
    default:
      return `<svg width="26" height="26" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
  }
}

function makeDivIcon(type) {
  return L.divIcon({
    className: "hf-div-icon",
    html: `<div style="transform: translate(-13px,-13px);">${svgForType(
      type
    )}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/* =========================
   BUFFERS
========================= */
function bufferRadiusMeters(villages) {
  const v = toNumber(villages);
  if (v === null || v <= 0) return 800;
  const r = 800 + 260 * Math.sqrt(v);
  return clamp(r, 800, 15000);
}

/* =========================
   MAP HELPERS
========================= */
function MapZoomWatcher({ onZoom }) {
  useMapEvents({
    zoomend: (e) => onZoom(e.target.getZoom()),
  });
  const map = useMap();
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  return null;
}

function MapLockAndFit({ provinceGeo, fallbackCenter, fallbackZoom }) {
  const map = useMap();

  useEffect(() => {
    if (provinceGeo) {
      const layer = L.geoJSON(provinceGeo);
      const b = layer.getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [40, 40] });
        map.setMaxBounds(b.pad(0.35));
        map.options.maxBoundsViscosity = 0.6;
        map.setMinZoom(7);
        map.setMaxZoom(18);
        return;
      }
    }

    map.setView(fallbackCenter, fallbackZoom);
    map.setMinZoom(6);
    map.setMaxZoom(18);
  }, [provinceGeo, fallbackCenter, fallbackZoom, map]);

  return null;
}

/* =========================
   UI PRIMITIVES
========================= */
function IconButton({ onClick, title, children, active = false }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        border: active ? "1px solid rgba(17,17,17,0.35)" : "1px solid rgba(0,0,0,0.18)",
        background: active ? "rgba(0,0,0,0.06)" : "white",
        borderRadius: 12,
        padding: "10px 12px",
        cursor: "pointer",
        fontFamily: "Arial",
        fontWeight: 900,
        fontSize: 12,
        boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {children}
    </button>
  );
}

function Pill({ children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "rgba(255,255,255,0.92)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        fontFamily: "Arial",
        fontSize: 12,
        fontWeight: 900,
      }}
    >
      {children}
    </span>
  );
}

function Chip({ label, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      title="Remove filter"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.18)",
        background: "white",
        cursor: "pointer",
        fontFamily: "Arial",
        fontSize: 12,
        fontWeight: 900,
        boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
      }}
    >
      <span>{label}</span>
      <span style={{ opacity: 0.7 }}>×</span>
    </button>
  );
}

function Accordion({ title, open, onToggle, children }) {
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 14,
        overflow: "hidden",
        background: "white",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 12px",
          border: "none",
          background: "rgba(0,0,0,0.03)",
          cursor: "pointer",
          fontFamily: "Arial",
          fontWeight: 900,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>{title}</span>
        <span style={{ opacity: 0.75 }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  );
}

/* =========================
   NEW UX: TOP APP BAR
========================= */
function TopBar({
  rowsCount,
  facilitiesCount,
  showingCount,
  outliersExcluded,
  activeChips,
  onRemoveChip,
  onClearAll,
  onResetView,
  controlsOpen,
  setControlsOpen,
  legendOpen,
  setLegendOpen,
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        right: 10,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.94)",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 18,
            padding: "10px 14px",
            boxShadow: "0 2px 18px rgba(0,0,0,0.12)",
            minWidth: 420,
          }}
        >
          <div
            style={{
              fontFamily: "Arial",
              fontWeight: 900,
              fontSize: 16,
              lineHeight: 1.2,
            }}
          >
            Badakhshan Health Facilities Coverage Map
          </div>
          <div
            style={{
              fontFamily: "Arial",
              fontWeight: 700,
              fontSize: 12,
              color: "#444",
              marginTop: 2,
            }}
          >
            Clustering • District analytics • Buffers • Search & filters
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <Pill>Rows: {rowsCount}</Pill>
            <Pill>Facilities: {facilitiesCount}</Pill>
            <Pill>Showing: {showingCount}</Pill>
            {outliersExcluded > 0 ? <Pill>Outliers excluded: {outliersExcluded}</Pill> : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <IconButton onClick={onResetView} title="Reset view">
            ⟳ Reset view
          </IconButton>

          <IconButton onClick={onClearAll} title="Clear search and filters">
            ✕ Clear all
          </IconButton>

          <IconButton
            onClick={() => setLegendOpen((s) => !s)}
            title="Toggle legend"
            active={legendOpen}
          >
            🧭 Legend
          </IconButton>

          <IconButton
            onClick={() => setControlsOpen((s) => !s)}
            title="Toggle controls"
            active={controlsOpen}
          >
            ☰ Controls
          </IconButton>
        </div>
      </div>

      {/* Active filter chips row */}
      {activeChips.length > 0 && (
        <div style={{ pointerEvents: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {activeChips.map((c) => (
            <Chip key={c.key} label={c.label} onRemove={() => onRemoveChip(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================
   NEW UX: CONTROL DRAWER
========================= */
function ControlDrawer({
  open,
  onClose,
  zoom,
  search,
  setSearch,
  results,
  onSelectResult,
  basemap,
  setBasemap,
  showBuffers,
  setShowBuffers,
  showBufferLabels,
  setShowBufferLabels,
  showFacilityLabels,
  setShowFacilityLabels,
  showDistrictLabels,
  setShowDistrictLabels,
  types,
  selectedTypes,
  setSelectedTypes,
  selectedDistrictSummary,
  onClearDistrict,
}) {
  const [secSearch, setSecSearch] = useState(false);
  const [secMap, setSecMap] = useState(false);
  const [secLayers, setSecLayers] = useState(false);
  const [secTypes, setSecTypes] = useState(false);
  const [secDistrict, setSecDistrict] = useState(false);


  useEffect(() => {
    if (selectedDistrictSummary) setSecDistrict(true);
  }, [selectedDistrictSummary]);

  if (!open) return null;

  const toggleType = (t) => {
    const next = new Set(selectedTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setSelectedTypes(next);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 90,
        right: 10,
        bottom: 10,
        width: 420,
        zIndex: 10001,
        background: "rgba(255,255,255,0.97)",
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 18,
        boxShadow: "0 2px 22px rgba(0,0,0,0.16)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Drawer header */}
      <div
        style={{
          padding: 12,
          borderBottom: "1px solid rgba(0,0,0,0.10)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          fontFamily: "Arial",
        }}
      >
        <div>
          <div style={{ fontWeight: 900, fontSize: 14 }}>Controls</div>
          <div style={{ fontSize: 12, color: "#555", fontWeight: 800, marginTop: 2 }}>
            Smart display • Zoom: <b>{zoom}</b>
          </div>
        </div>
        <IconButton onClick={onClose} title="Close controls">
          Hide
        </IconButton>
      </div>

        {/* Drawer body */}
     {/* Drawer body */}
        <div
          onWheel={(e) => e.stopPropagation()}
          style={{
            padding: 12,
            overflowY: "auto",
            overflowX: "hidden",
            flex: 1,
            minHeight: 0,
        
            // ✅ IMPORTANT: use flex, not grid
            display: "flex",
            flexDirection: "column",
            gap: 10,
        
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
        >
      <Accordion
  title="Search & jump"
  open={secSearch}
  onToggle={() => setSecSearch((s) => !s)}
>
  <div style={{ display: "grid", gap: 8 }}>
    <div style={{ fontFamily: "Arial", fontSize: 12, color: "#555", fontWeight: 800 }}>
      Search facility name, district, HF code, or type.
    </div>

    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Type to search..."
      style={{
        width: "100%",
        boxSizing: "border-box",
        height: 42,
        padding: "0 12px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.22)",
        background: "white",
        outline: "none",
        fontFamily: "Arial",
        fontWeight: 800,
        fontSize: 13,
      }}
    />
  </div>

  {search.trim() && results.length > 0 && (
    <div
      style={{
        marginTop: 10,
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {results.map((r) => (
        <button
          key={r._id}
          type="button"
          onClick={() => onSelectResult(r)}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            border: "none",
            background: "white",
            cursor: "pointer",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            fontFamily: "Arial",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 13 }}>{r._name}</div>
          <div style={{ fontSize: 12, color: "#555", fontWeight: 800 }}>
            {r._type} • {r._district || "—"} • {r._hfCode || "—"}
          </div>
        </button>
      ))}
    </div>
  )}
</Accordion>


        <Accordion title="Map" open={secMap} onToggle={() => setSecMap((s) => !s)}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontFamily: "Arial", fontWeight: 900, fontSize: 12 }}>
              Basemap
            </div>
            <select
              value={basemap}
              onChange={(e) => setBasemap(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(0,0,0,0.22)",
                fontFamily: "Arial",
                fontWeight: 800,
              }}
            >
              <option value="carto">Carto Light (recommended)</option>
              <option value="osm">OpenStreetMap</option>
              <option value="satellite">Satellite (Esri)</option>
            </select>
          </div>
        </Accordion>

        <Accordion
  title="Labels & buffers"
  open={secLayers}
  onToggle={() => setSecLayers((s) => !s)}
>
  {/* ✅ Scroll only inside this section */}
  <div
    onWheel={(e) => e.stopPropagation()}
    style={{
      maxHeight: 200,          // ✅ adjust (180–260 is nice)
      overflowY: "auto",
      overflowX: "hidden",
      paddingRight: 6,
    }}
  >
    <div style={{ display: "grid", gap: 10 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={showDistrictLabels}
          onChange={(e) => setShowDistrictLabels(e.target.checked)}
        />
        <span style={{ fontFamily: "Arial", fontWeight: 900, fontSize: 13 }}>
          District labels (zoom ≥ 8)
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={showFacilityLabels}
          onChange={(e) => setShowFacilityLabels(e.target.checked)}
        />
        <span style={{ fontFamily: "Arial", fontWeight: 900, fontSize: 13 }}>
          Facility labels (zoom ≥ 10)
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={showBuffers}
          onChange={(e) => setShowBuffers(e.target.checked)}
        />
        <span style={{ fontFamily: "Arial", fontWeight: 900, fontSize: 13 }}>
          Buffers (auto show zoom ≥ 9)
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={showBufferLabels}
          onChange={(e) => setShowBufferLabels(e.target.checked)}
        />
        <span style={{ fontFamily: "Arial", fontWeight: 900, fontSize: 13 }}>
          Buffer labels (villages, zoom ≥ 9)
        </span>
      </label>

      <div style={{ fontFamily: "Arial", fontSize: 12, color: "#555", fontWeight: 800 }}>
        Tip: if your map gets heavy, keep buffers off while zoomed out.
      </div>
    </div>
  </div>
</Accordion>


        <Accordion
          title="Facility types"
          open={secTypes}
          onToggle={() => setSecTypes((s) => !s)}
        >
          {/* ✅ Scroll area only for this section */}
          <div
            onWheel={(e) => e.stopPropagation()} // ✅ prevents Leaflet stealing scroll
            style={{
              maxHeight: 260,          // ✅ adjust (220–320 is usually good)
              overflowY: "auto",
              overflowX: "hidden",
              paddingRight: 6,         // ✅ space for scrollbar
            }}
          >
            {/* ✅ Sticky action buttons */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                background: "white",
                paddingBottom: 10,
                marginBottom: 10,
                borderBottom: "1px solid rgba(0,0,0,0.08)",
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <IconButton
                onClick={() => setSelectedTypes(new Set(types))}
                title="Select all facility types"
              >
                Select all
              </IconButton>
              <IconButton onClick={() => setSelectedTypes(new Set())} title="Clear all types">
                Clear
              </IconButton>
            </div>
        
            {/* ✅ Scrollable list */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {types.map((t) => {
                const active = selectedTypes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: active
                        ? "1px solid rgba(0,0,0,0.35)"
                        : "1px solid rgba(0,0,0,0.15)",
                      background: active ? "rgba(0,0,0,0.06)" : "white",
                      cursor: "pointer",
                      fontFamily: "Arial",
                      fontWeight: 900,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span dangerouslySetInnerHTML={{ __html: svgForType(t) }} />
                      {t}
                    </span>
                    <span style={{ opacity: 0.75 }}>{active ? "On" : "Off"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Accordion>


       <Accordion
          title="District summary"
          open={secDistrict}
          onToggle={() => setSecDistrict((s) => !s)}
        >
          {/* ✅ Scroll only inside this section */}
          <div
            onWheel={(e) => e.stopPropagation()}
            style={{
              maxHeight: 220,          // ✅ adjust if you want more/less
              overflowY: "auto",
              overflowX: "hidden",
              paddingRight: 6,
            }}
          >
            {selectedDistrictSummary ? (
              <div
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(0,0,0,0.03)",
                  fontFamily: "Arial",
                }}
              >
                {/* ✅ Sticky header inside the summary */}
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    background: "rgba(0,0,0,0.03)",
                    paddingBottom: 8,
                    marginBottom: 8,
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>{selectedDistrictSummary.name}</div>
                  <IconButton onClick={onClearDistrict} title="Clear selected district">
                    Clear
                  </IconButton>
                </div>
        
                <div style={{ marginTop: 6, fontSize: 12, color: "#333", fontWeight: 800 }}>
                  Facilities: <b>{selectedDistrictSummary.facilityCount}</b> • Villages sum:{" "}
                  <b>{selectedDistrictSummary.villagesSum}</b>
                </div>
        
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>By type</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {Object.entries(selectedDistrictSummary.byType).map(([k, v]) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontWeight: 800,
                        }}
                      >
                        <span>{k}</span>
                        <span style={{ fontWeight: 900 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: "Arial", fontSize: 12, color: "#555", fontWeight: 800 }}>
                Click a blue district polygon on the map to see totals and breakdown.
              </div>
            )}
          </div>
</Accordion>

      </div>
    </div>
  );
}

/* =========================
   NEW UX: LEGEND PANEL
========================= */
function LegendPanel({
  open,
  onClose,
  types,
  typeCounts,
  selectedTypes,
  onToggleType,
}) {
  if (!open) return null;

  const preferred = ["BHC", "SHC", "CHC", "CHC+", "DH", "PH", "Other", "Unknown"];
  const order = preferred.filter((t) => types.includes(t));

  return (
    <div
      style={{
  position: "absolute",
  left: 10,
  bottom: 10,

  width: "clamp(240px, 30vw, 360px)",   // ✅ responsive width (shrinks on laptop)
  maxWidth: "calc(100vw - 20px)",       // ✅ never overflow the screen
  maxHeight: "calc(100vh - 120px)",     // ✅ fit under top bar
  display: "flex",
  flexDirection: "column",

  zIndex: 10001,
  background: "rgba(255,255,255,0.97)",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 18,
  boxShadow: "0 2px 22px rgba(0,0,0,0.16)",
  overflow: "hidden",
  fontFamily: "Arial",
}}

    >
      <div
        style={{
          padding: 12,
          borderBottom: "1px solid rgba(0,0,0,0.10)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div>
          <div style={{ fontWeight: 900, fontSize: 14 }}>Legend</div>
          <div style={{ fontSize: 12, color: "#555", fontWeight: 800, marginTop: 2 }}>
            Click items to filter.
          </div>
        </div>
        <IconButton onClick={onClose} title="Close legend">
          Hide
        </IconButton>
      </div>

     <div
          onWheel={(e) => e.stopPropagation()}
          style={{
            padding: 12,
            overflowY: "auto",   // ✅ scroll INSIDE legend content
            overflowX: "hidden",
            flex: 1,             // ✅ use remaining height under header
            minHeight: 0,        // ✅ important for flex scrolling
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 10 }}>
            Facility type (symbol + count)
          </div>


        <div style={{ display: "grid", gap: 8 }}>
          {order.map((t) => {
            const active = selectedTypes.has(t);
            const count = typeCounts[t] || 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleType(t)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: active
                    ? "1px solid rgba(0,0,0,0.35)"
                    : "1px solid rgba(0,0,0,0.14)",
                  background: active ? "rgba(0,0,0,0.06)" : "white",
                  cursor: "pointer",
                  fontFamily: "Arial",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <span dangerouslySetInnerHTML={{ __html: svgForType(t) }} />
                  <span style={{ fontWeight: 900 }}>{t}</span>
                </span>
                <span style={{ fontWeight: 900, color: "#111" }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid rgba(0,0,0,0.10)", paddingTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Boundaries</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 28, height: 6, background: "red" }} />
            <div style={{ fontWeight: 800, fontSize: 12 }}>Province boundary</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 6, background: "blue" }} />
            <div style={{ fontWeight: 800, fontSize: 12 }}>District boundary</div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#555", fontWeight: 800 }}>
            Buffers: radius scales with villages covered (sqrt scaling, capped).
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   MAIN APP
========================= */
export default function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Boundaries
  const [districtsGeo, setDistrictsGeo] = useState(null);
  const [provinceGeo, setProvinceGeo] = useState(null);

  // Selected district summary
  const [selectedDistrictId, setSelectedDistrictId] = useState(null);
  const [selectedDistrictSummary, setSelectedDistrictSummary] = useState(null);

  // UI
  const [search, setSearch] = useState("");
  const [basemap, setBasemap] = useState("carto");
  const [showBuffers, setShowBuffers] = useState(true);
  const [showBufferLabels, setShowBufferLabels] = useState(true);
  const [showFacilityLabels, setShowFacilityLabels] = useState(false);
  const [showDistrictLabels, setShowDistrictLabels] = useState(true);

  // New UX layout toggles
  const [controlsOpen, setControlsOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);

  // Zoom
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Marker refs for search -> open popup
  const markerRefs = useRef(new Map());
  const mapRef = useRef(null);

  // Responsive: auto-close panels on small screens
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w < 980) {
        setControlsOpen(false);
        setLegendOpen(false);
      } else {
        setControlsOpen(true);
        setLegendOpen(true);
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* Load CSV */
  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => r.text())
      .then((text) => {
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: cleanHeader,
          complete: (res) => {
            setRows(res.data || []);
            setLoading(false);
          },
        });
      })
      .catch((e) => {
        console.error("CSV load error:", e);
        setLoading(false);
      });
  }, []);

  /* Detect columns */
  const meta = useMemo(() => {
    const cols = Object.keys(rows[0] || {});
    return {
      latCol: findColumnByHints(cols, [/^latitude$/i, /latitude/i, /^lat$/i]),
      lonCol: findColumnByHints(cols, [
        /^longitude$/i,
        /longitude/i,
        /^lon$/i,
        /^lng$/i,
      ]),
      typeCol: findColumnByHints(cols, [
        /health facility type/i,
        /facility type/i,
        /^type$/i,
      ]),
      nameCol: findColumnByHints(cols, [
        /health facility name/i,
        /facility name/i,
        /^name$/i,
        /hf name/i,
      ]),
      districtCol: findColumnByHints(cols, [/district/i]),
      hfCodeCol: findColumnByHints(cols, [/hf code/i, /facility code/i, /code/i]),
      villagesCol: findColumnByHints(cols, [/villag/i, /cover.*vill/i, /no.*vill/i]),
      targetPopCol: findColumnByHints(cols, [
      /^target\s*population$/i,
      /target\s*pop/i,
      /targetpop/i,
      /population\s*target/i,
      /target.*pop/i, // safer fallback
    ]),



    };
  }, [rows]);

  /* Parse points + exclude outliers */
  const { pointsAfghanistan, excludedOutliers } = useMemo(() => {
    if (!rows.length) return { pointsAfghanistan: [], excludedOutliers: 0 };

    const {
      latCol,
      lonCol,
      typeCol,
      nameCol,
      districtCol,
      hfCodeCol,
      villagesCol,
      targetPopCol,
    } = meta;


    let id = 0;
    let excluded = 0;

    const KNOWN = ["BHC", "CHC", "CHC+", "DH", "SHC", "PH", "OTHER", "UNKNOWN"];

    const pts = rows
      .map((r) => {
        const lat = toNumber(r[latCol]);
        const lon = toNumber(r[lonCol]);
        if (lat === null || lon === null) return null;

        const ok =
          lat >= AFG_BOUNDS.minLat &&
          lat <= AFG_BOUNDS.maxLat &&
          lon >= AFG_BOUNDS.minLon &&
          lon <= AFG_BOUNDS.maxLon;

        if (!ok) {
          excluded++;
          return null;
        }

        const raw = String(r[typeCol] ?? "")
          .trim()
          .toUpperCase()
          .replace(/\s+/g, "");
        let t = raw || "UNKNOWN";
        if (!KNOWN.includes(t)) t = "UNKNOWN";
        if (t === "OTHER") t = "Other";
        if (t === "UNKNOWN") t = "Unknown";

        const name = (r[nameCol] ?? "Facility").toString().trim();
        const district = districtCol ? String(r[districtCol] ?? "").trim() : "";
        const hfCode = hfCodeCol ? String(r[hfCodeCol] ?? "").trim() : "";
        const villages = villagesCol ? r[villagesCol] : null;
        const targetPop = targetPopCol ? r[targetPopCol] : null;
        return {
          ...r,
          _id: ++id,
          lat,
          lon,
          _type: t,
          _name: name,
          _district: district,
          _hfCode: hfCode,
          _villages: villages,
          _targetPop: targetPop,

        };
      })
      .filter(Boolean);

    return { pointsAfghanistan: pts, excludedOutliers: excluded };
  }, [rows, meta]);

  /* =========================
     GeoJSON FIX (Badakhshan)
     - select correct district polygons using points
  ========================= */
  useEffect(() => {
    if (!pointsAfghanistan.length) return;

    (async () => {
      try {
        const r = await fetch(ADM2_GEOJSON_URL);
        const adm2 = await r.json();
        const features = adm2?.features || [];
        if (!features.length) return;

        const index = new Map();
        features.forEach((f, i) => {
          const nm = normName(f?.properties?.shapeName);
          if (!index.has(nm)) index.set(nm, []);
          index.get(nm).push(i);
        });

        const DISTRICT_MAP = {
          Arghanjowa: ["Arghanj Khaw"],
          Argo: ["Argo"],
          Baharak: ["Baharak"],
          Darayem: ["Darayim"],
          "Darwaz-e-Bala (Mahemay)": ["Darwazbala"],
          "Darwaz-e-Payen (Nusai)": ["Darwaz"],
          Eshkashem: ["Ishkashiem"],
          Fayzabad: ["Fayzabad"],
          Jurm: ["Jurm"],
          "Keran-o-Menjan": ["Kuran Wa Munjan"],
          Keshm: ["Kishim"],
          Khaash: ["Khash"],
          Khowahan: ["Khwahan"],
          Kofab: ["Kuf Ab"],
          Kohestan: ["Kohistan"],
          Raghestan: ["Raghistan"],
          "Shahr-e-Buzorg": ["Shahri Buzurg"],
          Shekay: ["Shaki"],
          Shighnan: ["Shighnan"],
          Shohada: ["Shahada"],
          Tagab: ["Tagab (Kishmi Bala)"],
          Tashkan: ["Tashkan"],
          Wakhan: ["Wakhan"],
          Wordooj: ["Warduj"],
          Yaawan: ["Yawan"],
          "Yaftal Sofla": ["Yaftal Sufla"],
          "Yamgan (Geerwan)": ["Yamgan (Girwan)"],
          Zebak: ["Zebak"],
        };

        const grouped = new Map();
        for (const p of pointsAfghanistan) {
          const d = p._district || "";
          if (!d) continue;
          if (!grouped.has(d)) grouped.set(d, []);
          grouped.get(d).push(p);
        }

        const selectedFeatureIndexes = new Set();

        for (const [district, pts] of grouped.entries()) {
          const candidates = DISTRICT_MAP[district] || [district];
          const candidateIndexes = [];

          for (const nm of candidates) {
            const hits = index.get(normName(nm)) || [];
            candidateIndexes.push(...hits);
          }
          if (!candidateIndexes.length) continue;

          const score = new Map();
          candidateIndexes.forEach((i) => score.set(i, 0));

          for (const p of pts) {
            const pt = turf.point([p.lon, p.lat]);

            let matched = null;
            for (const fi of candidateIndexes) {
              try {
                if (turf.booleanPointInPolygon(pt, features[fi])) {
                  matched = fi;
                  break;
                }
              } catch {
                // ignore
              }
            }

            if (matched === null) {
              let best = candidateIndexes[0];
              let bestD = Infinity;
              for (const fi of candidateIndexes) {
                try {
                  const c = turf.centroid(features[fi]);
                  const d = turf.distance(pt, c, { units: "kilometers" });
                  if (d < bestD) {
                    bestD = d;
                    best = fi;
                  }
                } catch {
                  // ignore
                }
              }
              matched = best;
            }

            score.set(matched, (score.get(matched) || 0) + 1);
          }

          let bestFi = null;
          let bestScore = -1;
          for (const [fi, sc] of score.entries()) {
            if (sc > bestScore) {
              bestScore = sc;
              bestFi = fi;
            }
          }
          if (bestFi !== null) selectedFeatureIndexes.add(bestFi);
        }

        const badDistricts = Array.from(selectedFeatureIndexes)
          .map((i) => features[i])
          .filter(Boolean);

        setDistrictsGeo({ type: "FeatureCollection", features: badDistricts });

        // Province outline
        let province = null;
        try {
          const temp = {
            type: "FeatureCollection",
            features: badDistricts.map((f) => ({
              ...f,
              properties: { ...(f.properties || {}), __p: "BAD" },
            })),
          };

          if (typeof turf.dissolve === "function") {
            const dissolved = turf.dissolve(temp, { propertyName: "__p" });
            province = dissolved?.features?.[0] || null;
          }
        } catch {
          // ignore
        }

        if (!province && badDistricts.length) {
          try {
            let merged = badDistricts[0];
            for (let i = 1; i < badDistricts.length; i++) {
              try {
                merged = turf.union(merged, badDistricts[i]) || merged;
              } catch {
                // ignore
              }
            }
            province = merged || null;
          } catch {
            province = null;
          }
        }

        setProvinceGeo(province);
      } catch (e) {
        console.error("ADM2 load error:", e);
      }
    })();
  }, [pointsAfghanistan]);

  /* Keep only facilities inside Badakhshan polygon */
  const pointsBadakhshan = useMemo(() => {
    if (!provinceGeo) return pointsAfghanistan;
    return pointsAfghanistan.filter((p) => {
      try {
        return turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), provinceGeo);
      } catch {
        return true;
      }
    });
  }, [pointsAfghanistan, provinceGeo]);

  /* Types & counts */
  const types = useMemo(() => {
    const set = new Set(pointsBadakhshan.map((p) => p._type || "Unknown"));
    const preferred = ["BHC", "SHC", "CHC", "CHC+", "DH", "PH", "Other", "Unknown"];
    const arr = Array.from(set);
    arr.sort((a, b) => preferred.indexOf(a) - preferred.indexOf(b));
    return arr;
  }, [pointsBadakhshan]);

  const typeCounts = useMemo(() => {
    const counts = {};
    for (const p of pointsBadakhshan) counts[p._type] = (counts[p._type] || 0) + 1;
    return counts;
  }, [pointsBadakhshan]);

  const [selectedTypes, setSelectedTypes] = useState(new Set());
  const didInitTypes = useRef(false);
  useEffect(() => {
    if (!didInitTypes.current && types.length) {
      setSelectedTypes(new Set(types));
      didInitTypes.current = true;
    }
  }, [types]);

  /* Smart display rules */
  const effectiveShowFacilityLabels = showFacilityLabels && zoom >= 10;
  const effectiveShowBufferLabels = showBufferLabels && zoom >= 9;
  const effectiveShowDistrictLabels = showDistrictLabels && zoom >= 8;

  // Buffers can be heavy; show only at zoom >= 9
  const effectiveShowBuffers = showBuffers && zoom >= 9;

  /* Search results list (top 10) */
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return pointsBadakhshan
      .filter((p) => {
        const hay = `${p._name} ${p._district} ${p._hfCode} ${p._type}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 10);
  }, [pointsBadakhshan, search]);

  /* Filter points by type + search */
  const pointsFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pointsBadakhshan.filter((p) => {
      if (selectedTypes.size && !selectedTypes.has(p._type)) return false;
      if (!q) return true;
      const hay = `${p._name} ${p._district} ${p._hfCode} ${p._type}`.toLowerCase();
      return hay.includes(q);
    });
  }, [pointsBadakhshan, selectedTypes, search]);

  /* Basemap */
  const tile = useMemo(() => {
    if (basemap === "osm") {
      return {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attrib: "&copy; OpenStreetMap contributors",
      };
    }
    if (basemap === "satellite") {
      return {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attrib:
          "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      };
    }
    return {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attrib: "&copy; OpenStreetMap &copy; CARTO",
    };
  }, [basemap]);

  /* Search click -> fly + open popup */
  const onSelectResult = (p) => {
    const map = mapRef.current;
    if (!map) return;

    map.flyTo([p.lat, p.lon], 11, { duration: 0.8 });

    const ref = markerRefs.current.get(p._id);
    if (ref && ref.openPopup) setTimeout(() => ref.openPopup(), 900);
  };

  /* Legend click -> toggle type */
  const onToggleType = (t) => {
    const next = new Set(selectedTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setSelectedTypes(next);
  };

  /* District click -> summary */
  const onEachDistrict = (feature, layer) => {
    const name = getDistrictNameFromFeature(feature);

    // Bind/unbind tooltip cleanly
    if (effectiveShowDistrictLabels && name) {
      if (!layer.getTooltip()) {
        layer.bindTooltip(String(name), {
          permanent: true,
          direction: "center",
          className: "district-label",
          opacity: 0.9,
        });
      }
    } else {
      if (layer.getTooltip()) layer.unbindTooltip();
    }

    layer.on("click", () => {
      const id = getFeatureId(feature);
      setSelectedDistrictId(id);

      try {
        const inside = pointsBadakhshan.filter((p) =>
          turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), feature)
        );

        const byType = {};
        for (const t of ["BHC", "SHC", "CHC", "CHC+", "DH", "PH", "Other", "Unknown"]) {
          if (types.includes(t)) byType[t] = 0;
        }
        for (const p of inside) byType[p._type] = (byType[p._type] || 0) + 1;

        const villagesSum = inside.reduce((s, p) => s + (toNumber(p._villages) || 0), 0);

        setSelectedDistrictSummary({
          id,
          name: name || "District",
          facilityCount: inside.length,
          villagesSum: Math.round(villagesSum),
          byType,
        });
      } catch {
        setSelectedDistrictSummary(null);
      }
    });
  };

  const clearDistrict = () => {
    setSelectedDistrictId(null);
    setSelectedDistrictSummary(null);
  };

  const districtStyle = (feature, idx) => {
  const id = getFeatureId(feature, idx);
  const selected = String(id) === String(selectedDistrictId);

  return {
    color: "blue",
    weight: selected ? 3.2 : 1.4,

    // ✅ IMPORTANT: keep a small fill so the polygon interior catches clicks
    fillColor: "blue",
    fillOpacity: selected ? 0.10 : 0.04,

    // ✅ make sure it is clickable
    interactive: true,
  };
};


  /* Active filter chips for TopBar */
  const activeChips = useMemo(() => {
    const chips = [];
    if (search.trim()) chips.push({ key: "search", label: `Search: ${search.trim()}` });

    // Types: if not all selected
    if (types.length && selectedTypes.size && selectedTypes.size !== types.length) {
      // show up to 4 chips; then "+N more"
      const arr = Array.from(selectedTypes);
      const max = 4;
      for (let i = 0; i < Math.min(max, arr.length); i++) {
        chips.push({ key: `type-${arr[i]}`, label: `Type: ${arr[i]}`, type: arr[i] });
      }
      if (arr.length > max) chips.push({ key: "types-more", label: `+${arr.length - max} more types` });
    }

    if (!showBuffers) chips.push({ key: "buf-off", label: "Buffers: Off" });
    if (!showDistrictLabels) chips.push({ key: "dl-off", label: "District labels: Off" });
    if (!showFacilityLabels) chips.push({ key: "fl-off", label: "Facility labels: Off" });
    if (!showBufferLabels) chips.push({ key: "bl-off", label: "Buffer labels: Off" });

    if (basemap !== "carto") chips.push({ key: "basemap", label: `Basemap: ${basemap}` });

    return chips;
  }, [
    search,
    types,
    selectedTypes,
    showBuffers,
    showDistrictLabels,
    showFacilityLabels,
    showBufferLabels,
    basemap,
  ]);

  const onRemoveChip = (chip) => {
    if (chip.key === "search") setSearch("");
    if (chip.key.startsWith("type-") && chip.type) {
      const next = new Set(selectedTypes);
      next.delete(chip.type);
      setSelectedTypes(next);
    }
    if (chip.key === "buf-off") setShowBuffers(true);
    if (chip.key === "dl-off") setShowDistrictLabels(true);
    if (chip.key === "fl-off") setShowFacilityLabels(true);
    if (chip.key === "bl-off") setShowBufferLabels(true);
    if (chip.key === "basemap") setBasemap("carto");
  };

  const clearAll = () => {
    setSearch("");
    if (types.length) setSelectedTypes(new Set(types));
    setBasemap("carto");
    setShowBuffers(true);
    setShowBufferLabels(true);
    setShowFacilityLabels(false);
    setShowDistrictLabels(true);
    clearDistrict();
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;

    if (provinceGeo) {
      try {
        const b = L.geoJSON(provinceGeo).getBounds();
        if (b.isValid()) {
          map.fitBounds(b, { padding: [40, 40] });
          return;
        }
      } catch {
        // ignore
      }
    }

    map.setView(BADAKHSHAN_CENTER, DEFAULT_ZOOM);
  };

  if (loading) {
    return <div style={{ fontFamily: "Arial", padding: 16 }}>Loading…</div>;
  }

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <style>{`
       .district-label, .facility-label, .buffer-label {
            font-family: Arial;
            font-weight: 900;
            border-radius: 10px;
            padding: 2px 6px;
            border: 1px solid rgba(0,0,0,0.22);
            box-shadow: 0 2px 10px rgba(0,0,0,0.10);
            background: rgba(255,255,255,0.90);
          }
          
          /* keep district + buffer single-line */
          .district-label, .buffer-label {
            white-space: nowrap;
          }
          
          /* allow facility label to wrap when you show name + target pop */
          .facility-label--multi {
            white-space: normal;
              line-height: 1.15;
              max-width: 220px;
          }
          
          .district-label { font-size: 11px; }
          .facility-label { font-size: 11px; }
          .buffer-label   { font-size: 11px; }
          
          .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large {
            border: 2px solid rgba(0,0,0,0.55) !important;
          }

      `}
</style>

      <TopBar
        rowsCount={rows.length}
        facilitiesCount={pointsBadakhshan.length}
        showingCount={pointsFiltered.length}
        outliersExcluded={excludedOutliers}
        activeChips={activeChips}
        onRemoveChip={onRemoveChip}
        onClearAll={clearAll}
        onResetView={resetView}
        controlsOpen={controlsOpen}
        setControlsOpen={setControlsOpen}
        legendOpen={legendOpen}
        setLegendOpen={setLegendOpen}
      />

      <ControlDrawer
        open={controlsOpen}
        onClose={() => setControlsOpen(false)}
        zoom={zoom}
        search={search}
        setSearch={setSearch}
        results={searchResults}
        onSelectResult={onSelectResult}
        basemap={basemap}
        setBasemap={setBasemap}
        showBuffers={showBuffers}
        setShowBuffers={setShowBuffers}
        showBufferLabels={showBufferLabels}
        setShowBufferLabels={setShowBufferLabels}
        showFacilityLabels={showFacilityLabels}
        setShowFacilityLabels={setShowFacilityLabels}
        showDistrictLabels={showDistrictLabels}
        setShowDistrictLabels={setShowDistrictLabels}
        types={types}
        selectedTypes={selectedTypes}
        setSelectedTypes={setSelectedTypes}
        selectedDistrictSummary={selectedDistrictSummary}
        onClearDistrict={clearDistrict}
      />

      <LegendPanel
        open={legendOpen}
        onClose={() => setLegendOpen(false)}
        types={types}
        typeCounts={typeCounts}
        selectedTypes={selectedTypes}
        onToggleType={onToggleType}
      />

      {/* Map */}
      <MapContainer
        center={BADAKHSHAN_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
        whenCreated={(m) => (mapRef.current = m)}
      >
        <TileLayer attribution={tile.attrib} url={tile.url} />
        <MapZoomWatcher onZoom={setZoom} />
        <MapLockAndFit
          provinceGeo={provinceGeo}
          fallbackCenter={BADAKHSHAN_CENTER}
          fallbackZoom={DEFAULT_ZOOM}
        />

        {/* District boundaries */}
       {districtsGeo && (
  <GeoJSON
    key={`districts-${selectedDistrictId}-${effectiveShowDistrictLabels}`}
    data={districtsGeo}
    style={districtStyle}
    onEachFeature={(feature, layer) => {
      layer.options.interactive = true; // ✅
      onEachDistrict(feature, layer);
    }}
  />
)}



        {/* Province outline */}
        {provinceGeo && (
  <GeoJSON
    data={provinceGeo}
    style={{ color: "red", weight: 4, fillOpacity: 0 }}
    interactive={false}     // ✅ IMPORTANT
    bubblingMouseEvents={false}
  />
)}


        {/* Buffers */}
        {effectiveShowBuffers &&
          pointsFiltered.map((p) => {
            const villages = toNumber(p._villages);
            const radius = bufferRadiusMeters(villages);
            const opacity = zoom >= 9 ? 0.10 : 0.06;

            return (
              <Circle
                key={`buf-${p._id}`}
                center={[p.lat, p.lon]}
                radius={radius}
                pathOptions={{
                  color: "#111",
                  weight: 1,
                  fillColor: "#111",
                  fillOpacity: opacity,
                }}
              >
                {effectiveShowBufferLabels && villages !== null && (
                  <Tooltip permanent direction="center" className="buffer-label" opacity={0.95}>
                    {Math.round(villages)}
                  </Tooltip>
                )}
              </Circle>
            );
          })}

        {/* Markers + clustering */}
        <MarkerClusterGroup
          chunkedLoading
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          removeOutsideVisibleBounds
        >
          {pointsFiltered.map((p) => {
            const icon = makeDivIcon(p._type);
            const villages = toNumber(p._villages);
            const radius = bufferRadiusMeters(villages);

            return (
              <Marker
                key={`m-${p._id}`}
                position={[p.lat, p.lon]}
                icon={icon}
                ref={(ref) => {
                  if (ref) markerRefs.current.set(p._id, ref);
                  else markerRefs.current.delete(p._id);
                }}
              >
                {effectiveShowFacilityLabels && (
                    <Tooltip
                      permanent
                      direction="top"
                      offset={[0, -18]}
                      className="facility-label facility-label--multi"
                      opacity={0.95}
                    >
                      <div style={{ display: "grid", gap: 2, lineHeight: 1.1 }}>
                        <div>{p._name}</div>
                  
                        {fmtInt(p._targetPop) && (
                          <div style={{ fontWeight: 800, fontSize: 10, opacity: 0.85 }}>
                            Target pop: {fmtInt(p._targetPop)}
                          </div>
                        )}
                      </div>
                    </Tooltip>
                  )}


                <Popup>
                  <div style={{ fontFamily: "Arial", fontSize: 13, lineHeight: 1.35, minWidth: 260 }}>
                    <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8 }}>{p._name}</div>

                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        <tr>
                          <td style={{ fontWeight: 900, paddingRight: 8 }}>Type</td>
                          <td>{p._type}</td>
                        </tr>
                        {p._hfCode ? (
                          <tr>
                            <td style={{ fontWeight: 900, paddingRight: 8 }}>HF Code</td>
                            <td>{p._hfCode}</td>
                          </tr>
                        ) : null}
                        {p._district ? (
                          <tr>
                            <td style={{ fontWeight: 900, paddingRight: 8 }}>District</td>
                            <td>{p._district}</td>
                          </tr>
                        ) : null}
                        {villages !== null ? (
                          <tr>
                            <td style={{ fontWeight: 900, paddingRight: 8 }}>Villages</td>
                            <td>{Math.round(villages)}</td>
                          </tr>
                        ) : null}
                        {fmtInt(p._targetPop) ? (
                          <tr>
                            <td style={{ fontWeight: 900, paddingRight: 8 }}>Target pop</td>
                            <td>{fmtInt(p._targetPop)}</td>
                          </tr>
                        ) : null}
                        <tr>
                          <td style={{ fontWeight: 900, paddingRight: 8 }}>Lat/Lon</td>
                          <td>
                            {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {effectiveShowBuffers && villages !== null && (
                      <div style={{ marginTop: 8, color: "#333" }}>
                        Coverage radius: <b>{Math.round(radius)} m</b>
                      </div>
                    )}

                    {!effectiveShowBuffers && showBuffers && (
                      <div style={{ marginTop: 8, color: "#555", fontSize: 12, fontWeight: 800 }}>
                        Buffers are hidden at this zoom. Zoom in to see buffers.
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}
