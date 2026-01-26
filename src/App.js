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
  "https://raw.githubusercontent.com/rahimiabdulrahmanab/Mapping-Project-NGO-/main/Data.csv";

const ADM2_GEOJSON_URL =
  "https://raw.githubusercontent.com/rahimiabdulrahmanab/Mapping-Project-NGO-/main/geoBoundaries-AFG-ADM2_simplified.geojson";

/* =========================
   MAP SETTINGS
========================= */
const BADAKHSHAN_CENTER = [36.7, 70.8];
const DEFAULT_ZOOM = 8;

// Rough Afghanistan bbox — excludes obvious bad outliers
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
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
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
   COLORFUL SYMBOL ICONS
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
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "CHC":
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="6" width="16" height="16" rx="1" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "CHC+":
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,4 24,14 14,24 4,14" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "DH":
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,3 17,10 24.5,10 18.5,14.5 21,23 14,18.5 7,23 9.5,14.5 3.5,10 11,10"
          fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>
      </svg>`;
    case "SHC":
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,5 25,24 3,24" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "PH":
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <polygon points="14,4 22,9 22,19 14,24 6,19 6,9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
    case "Other":
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5h4v7h7v4h-7v7h-4v-7H5v-4h7z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
      </svg>`;
    default:
      return `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="9" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      </svg>`;
  }
}

function makeDivIcon(type) {
  return L.divIcon({
    className: "hf-div-icon",
    html: `<div style="transform: translate(-14px,-14px);">${svgForType(
      type
    )}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/* =========================
   BUFFERS (Villages)
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

        // ✅ allow panning a bit outside Badakhshan (clean way)
        const expanded = b.pad(0.35);
        map.setMaxBounds(expanded);
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
   UI Helpers
========================= */
function TitleBar() {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "white",
        padding: "10px 14px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.15)",
        boxShadow: "0 2px 16px rgba(0,0,0,0.12)",
        fontFamily: "Arial",
        textAlign: "center",
        minWidth: 520,
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 16 }}>
        Badakhshan Health Facilities Coverage Map
      </div>
      <div style={{ fontSize: 12, color: "#444", marginTop: 2 }}>
        Clustering • District analytics • Coverage buffers • Search & filters
      </div>
    </div>
  );
}

function btn(variant) {
  const base = {
    padding: "10px 10px",
    borderRadius: 14,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
  };
  if (variant === "solid") {
    return {
      ...base,
      border: "1px solid #111",
      background: "#111",
      color: "white",
    };
  }
  return {
    ...base,
    border: "1px solid rgba(0,0,0,0.25)",
    background: "white",
    color: "#111",
  };
}

function chipStyle(extra = {}) {
  return {
    background: "white",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: 12,
    padding: "8px 10px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
    fontFamily: "Arial",
    fontSize: 13,
    ...extra,
  };
}

function smallToggleBtn() {
  return {
    border: "1px solid rgba(0,0,0,0.18)",
    background: "white",
    borderRadius: 12,
    padding: "10px 12px",
    cursor: "pointer",
    fontFamily: "Arial",
    fontWeight: 900,
    fontSize: 12,
    boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
  };
}

/* =========================
   Legend (collapsible)
========================= */
function Legend({
  types,
  typeCounts,
  selectedTypes,
  onToggleType,
  minimized,
  onToggleMinimize,
}) {
  const preferred = ["BHC", "SHC", "CHC", "CHC+", "DH", "PH", "Other", "Unknown"];
  const order = preferred.filter((t) => types.includes(t));

  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        left: 14,
        zIndex: 9999,
        fontFamily: "Arial",
      }}
    >
      {minimized ? (
        <button type="button" onClick={onToggleMinimize} style={smallToggleBtn()}>
          Show legend
        </button>
      ) : (
        <div
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 14,
            padding: "10px 12px",
            width: 320,
            boxShadow: "0 2px 16px rgba(0,0,0,0.12)",
            fontSize: 13,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 14 }}>
              Legend (click to filter)
            </div>
            <button
              type="button"
              onClick={onToggleMinimize}
              style={btn("outline")}
            >
              Minimize
            </button>
          </div>

          <div style={{ marginBottom: 8, color: "#333", fontWeight: 800 }}>
            Facility Type (Symbol + Color)
          </div>

          {order.map((t) => {
            const active = selectedTypes.has(t);
            const count = typeCounts[t] || 0;
            return (
              <button
                key={t}
                onClick={() => onToggleType(t)}
                type="button"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "8px 8px",
                  margin: "4px 0",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  cursor: "pointer",
                  background: active ? "rgba(0,0,0,0.06)" : "white",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div dangerouslySetInnerHTML={{ __html: svgForType(t) }} />
                  <div style={{ fontWeight: 900 }}>{t}</div>
                </div>
                <div style={{ fontWeight: 900, color: "#111" }}>{count}</div>
              </button>
            );
          })}

          <hr style={{ margin: "10px 0" }} />

          <div style={{ fontWeight: 900, marginBottom: 6 }}>Boundaries</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 26, height: 6, background: "red" }} />
            <div style={{ fontWeight: 800 }}>Province boundary</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 26, height: 6, background: "blue" }} />
            <div style={{ fontWeight: 800 }}>District boundary</div>
          </div>

          <hr style={{ margin: "10px 0" }} />

          <div style={{ fontWeight: 900, marginBottom: 4 }}>Coverage buffers</div>
          <div style={{ color: "#444", lineHeight: 1.35 }}>
            Radius scales with villages covered (sqrt scaling, capped).
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   Sidebar (collapsible)
========================= */
function Sidebar({
  minimized,
  onToggleMinimize,

  search,
  setSearch,
  results,
  onSelectResult,

  types,
  selectedTypes,
  setSelectedTypes,

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

  zoom,
  selectedDistrictSummary,
  onClearDistrict,
}) {
  const toggleType = (t) => {
    const next = new Set(selectedTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setSelectedTypes(next);
  };

  if (minimized) {
    return (
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 9999,
          fontFamily: "Arial",
        }}
      >
        <button type="button" onClick={onToggleMinimize} style={smallToggleBtn()}>
          Show controls
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 9999,
        width: 380,
        maxHeight: "92vh",
        overflow: "auto",
        background: "white",
        borderRadius: 16,
        border: "1px solid rgba(0,0,0,0.15)",
        boxShadow: "0 2px 18px rgba(0,0,0,0.15)",
        fontFamily: "Arial",
      }}
    >
      <div style={{ padding: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900 }}>Controls</div>
          <button type="button" onClick={onToggleMinimize} style={btn("outline")}>
            Minimize
          </button>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#444",
            marginBottom: 10,
            lineHeight: 1.35,
          }}
        >
          Smart display: facility labels appear at <b>zoom ≥ 10</b>, buffer
          labels at <b>zoom ≥ 9</b>, district labels at <b>zoom ≥ 8</b>. Current
          zoom: <b>{zoom}</b>.
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
            Search (facility / district / HF code)
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type to search..."
            style={{
              width: "100%",
              padding: "10px 10px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.25)",
              outline: "none",
            }}
          />

          {search.trim() && results.length > 0 && (
            <div
              style={{
                marginTop: 8,
                border: "1px solid rgba(0,0,0,0.15)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {results.map((r) => (
                <button
                  key={r._id}
                  onClick={() => onSelectResult(r)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 10px",
                    border: "none",
                    background: "white",
                    cursor: "pointer",
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 13 }}>{r._name}</div>
                  <div style={{ fontSize: 12, color: "#444" }}>
                    {r._type} • {r._district || "—"} • {r._hfCode || "—"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
            Basemap
          </div>
          <select
            value={basemap}
            onChange={(e) => setBasemap(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 10px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.25)",
            }}
          >
            <option value="carto">Carto Light (recommended)</option>
            <option value="osm">OpenStreetMap</option>
            <option value="satellite">Satellite (Esri)</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={showFacilityLabels}
              onChange={(e) => setShowFacilityLabels(e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 900 }}>
              Show facility name labels
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={showBuffers}
              onChange={(e) => setShowBuffers(e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 900 }}>Show buffers</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={showBufferLabels}
              onChange={(e) => setShowBufferLabels(e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 900 }}>
              Show buffer labels (villages)
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={showDistrictLabels}
              onChange={(e) => setShowDistrictLabels(e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 900 }}>
              Show district labels
            </span>
          </label>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
            Facility types
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => setSelectedTypes(new Set(types))}
              style={btn("outline")}
              type="button"
            >
              Select all
            </button>
            <button
              onClick={() => setSelectedTypes(new Set())}
              style={btn("outline")}
              type="button"
            >
              Clear
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {types.map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                style={btn(selectedTypes.has(t) ? "solid" : "outline")}
                type="button"
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>
            District summary (click a district)
          </div>

          {selectedDistrictSummary ? (
            <div
              style={{
                border: "1px solid rgba(0,0,0,0.15)",
                borderRadius: 14,
                padding: 10,
                background: "rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>{selectedDistrictSummary.name}</div>
                <button type="button" onClick={onClearDistrict} style={btn("outline")}>
                  Clear
                </button>
              </div>

              <div style={{ marginTop: 8, fontSize: 12, color: "#333" }}>
                Facilities: <b>{selectedDistrictSummary.facilityCount}</b> • Villages sum:{" "}
                <b>{selectedDistrictSummary.villagesSum}</b>
              </div>

              <div style={{ marginTop: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>By type</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {Object.entries(selectedDistrictSummary.byType).map(([k, v]) => (
                    <div
                      key={k}
                      style={{ display: "flex", justifyContent: "space-between" }}
                    >
                      <span style={{ fontWeight: 800 }}>{k}</span>
                      <span style={{ fontWeight: 900 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#555", lineHeight: 1.35 }}>
              Click a blue district polygon to see totals and type breakdown.
            </div>
          )}
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

  // Selected district
  const [selectedDistrictId, setSelectedDistrictId] = useState(null);
  const [selectedDistrictSummary, setSelectedDistrictSummary] = useState(null);

  // UI state
  const [search, setSearch] = useState("");
  const [basemap, setBasemap] = useState("carto");
  const [showBuffers, setShowBuffers] = useState(true);
  const [showBufferLabels, setShowBufferLabels] = useState(true);
  const [showFacilityLabels, setShowFacilityLabels] = useState(false);
  const [showDistrictLabels, setShowDistrictLabels] = useState(true);

  // Collapsible panels
  const [sidebarMinimized, setSidebarMinimized] = useState(false);
  const [legendMinimized, setLegendMinimized] = useState(false);

  // Zoom state
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  // Marker refs
  const markerRefs = useRef(new Map());
  const mapRef = useRef(null);

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
      hfCodeCol: findColumnByHints(cols, [
        /hf code/i,
        /facility code/i,
        /code/i,
      ]),
      villagesCol: findColumnByHints(cols, [/villag/i, /cover.*vill/i, /no.*vill/i]),
    };
  }, [rows]);

  /* Parse points + exclude Afghanistan outliers */
  const { pointsAfghanistan, excludedOutliers } = useMemo(() => {
    if (!rows.length) return { pointsAfghanistan: [], excludedOutliers: 0 };

    const { latCol, lonCol, typeCol, nameCol, districtCol, hfCodeCol, villagesCol } =
      meta;

    let id = 0;
    let excluded = 0;

    const known = ["BHC", "CHC", "CHC+", "DH", "SHC", "PH", "OTHER", "UNKNOWN"];

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

        const raw = String(r[typeCol] ?? "").trim().toUpperCase().replace(/\s+/g, "");
        let type = raw || "UNKNOWN";
        if (!known.includes(type)) type = "UNKNOWN";
        if (type === "OTHER") type = "Other";
        if (type === "UNKNOWN") type = "Unknown";

        const name = (r[nameCol] ?? "Facility").toString().trim();
        const district = districtCol ? String(r[districtCol] ?? "").trim() : "";
        const hfCode = hfCodeCol ? String(r[hfCodeCol] ?? "").trim() : "";
        const villages = villagesCol ? r[villagesCol] : null;

        return {
          ...r,
          _id: ++id,
          lat,
          lon,
          _type: type,
          _name: name,
          _district: district,
          _hfCode: hfCode,
          _villages: villages,
        };
      })
      .filter(Boolean);

    return { pointsAfghanistan: pts, excludedOutliers: excluded };
  }, [rows, meta]);

  /* =========================
     GeoJSON FIX (Badakhshan)
  ========================= */
  useEffect(() => {
    if (!pointsAfghanistan.length) return;

    (async () => {
      try {
        const r = await fetch(ADM2_GEOJSON_URL);
        const adm2 = await r.json();
        const features = adm2?.features || [];
        if (!features.length) return;

        const index = new Map(); // normName -> [featureIndex]
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

        const badDistrictsFC = { type: "FeatureCollection", features: badDistricts };
        setDistrictsGeo(badDistrictsFC);

        // Province outline: dissolve/union
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

    // Tooltip behavior: bind/unbind cleanly to reduce flicker
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
        const poly = feature;
        const inside = pointsBadakhshan.filter((p) =>
          turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), poly)
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
      weight: selected ? 3.2 : 1.2,
      fillOpacity: selected ? 0.08 : 0,
      fillColor: selected ? "blue" : "transparent",
    };
  };

  // Optional: reduce heavy buffer rendering at low zoom
  const effectiveShowBuffers = showBuffers && zoom >= 9;

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
          border: 1px solid rgba(0,0,0,0.25);
          box-shadow: 0 2px 10px rgba(0,0,0,0.10);
          background: rgba(255,255,255,0.88);
          white-space: nowrap;
        }
        .district-label { font-size: 11px; }
        .facility-label { font-size: 11px; }
        .buffer-label   { font-size: 11px; }

        .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large {
          border: 2px solid rgba(0,0,0,0.55) !important;
        }
      `}</style>

      <TitleBar />

      {/* Status chips */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 9999,
          display: "flex",
          gap: 10,
        }}
      >
        <div style={chipStyle()}>
          Rows: <b>{rows.length}</b> • Facilities (Badakhshan):{" "}
          <b>{pointsBadakhshan.length}</b>
        </div>

        <div style={chipStyle()}>
          Showing: <b>{pointsFiltered.length}</b>
        </div>

        {excludedOutliers > 0 && (
          <div style={chipStyle({ borderColor: "rgba(200,0,0,0.25)" })}>
            Outliers excluded: <b>{excludedOutliers}</b>
          </div>
        )}
      </div>

      {/* Collapsible Controls Sidebar */}
      <Sidebar
        minimized={sidebarMinimized}
        onToggleMinimize={() => setSidebarMinimized((s) => !s)}
        search={search}
        setSearch={setSearch}
        results={searchResults}
        onSelectResult={onSelectResult}
        types={types}
        selectedTypes={selectedTypes}
        setSelectedTypes={setSelectedTypes}
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
        zoom={zoom}
        selectedDistrictSummary={selectedDistrictSummary}
        onClearDistrict={clearDistrict}
      />

      {/* Collapsible Legend */}
      <Legend
        minimized={legendMinimized}
        onToggleMinimize={() => setLegendMinimized((s) => !s)}
        types={types}
        typeCounts={typeCounts}
        selectedTypes={selectedTypes}
        onToggleType={onToggleType}
      />

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

        {/* District boundaries (BLUE) */}
        {districtsGeo && (
          <GeoJSON
            data={districtsGeo}
            style={districtStyle}
            onEachFeature={onEachDistrict}
          />
        )}

        {/* Province outline (RED) on top */}
        {provinceGeo && (
          <GeoJSON data={provinceGeo} style={{ color: "red", weight: 4, fillOpacity: 0 }} />
        )}

        {/* Buffers */}
        {effectiveShowBuffers &&
          pointsFiltered.map((p) => {
            const villages = toNumber(p._villages);
            const radius = bufferRadiusMeters(villages);
            const opacity = zoom >= 9 ? 0.1 : 0.06;

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
                  <Tooltip
                    permanent
                    direction="center"
                    className="buffer-label"
                    opacity={0.95}
                  >
                    {Math.round(villages)}
                  </Tooltip>
                )}
              </Circle>
            );
          })}

        {/* Clustering for facilities */}
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
                {/* Facility name label (smart) */}
                {effectiveShowFacilityLabels && (
                  <Tooltip
                    permanent
                    direction="top"
                    offset={[0, -18]}
                    className="facility-label"
                    opacity={0.95}
                  >
                    {p._name}
                  </Tooltip>
                )}

                <Popup>
                  <div
                    style={{
                      fontFamily: "Arial",
                      fontSize: 13,
                      lineHeight: 1.35,
                      minWidth: 260,
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8 }}>
                      {p._name}
                    </div>

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
                        <tr>
                          <td style={{ fontWeight: 900, paddingRight: 8 }}>Lat/Lon</td>
                          <td>
                            {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {showBuffers && villages !== null && (
                      <div style={{ marginTop: 8, color: "#333" }}>
                        Coverage radius: <b>{Math.round(radius)} m</b>
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
