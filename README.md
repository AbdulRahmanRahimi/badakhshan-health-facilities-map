# NGO Project Mapping

A web GIS app that maps an NGO's health facilities and project coverage by district, with spatial analysis done in the browser.

**Live demo:** https://mapping-project-ngo.vercel.app

## Features

- **Facility map** with marker clustering and a clickable legend to show or hide facility types
- **District analysis** with Turf.js: point-in-polygon matching of facilities to districts, dissolved and unioned coverage areas, centroids and distances
- **District summary**: click a district to see its totals, such as villages covered
- **Search** that flies to a facility and opens its popup, plus filter chips that can be removed one by one
- **Basemaps**: Carto Light, OpenStreetMap and Esri satellite imagery
- Collapsible control panels and a reset view button

## Tech stack

| Area | Tools |
|---|---|
| UI | React 19 |
| Mapping | Leaflet, React-Leaflet, react-leaflet-cluster |
| Spatial analysis | Turf.js |
| Data | PapaParse (CSV), GeoJSON (ADM2 districts) |

## Run locally

```bash
npm install
npm start
```

---

Built by **Abdul Rahman Rahimi**, Software Developer & Geospatial Analyst, [Rahimi Tech Solution](https://github.com/rahimiabdulrahmanab).
