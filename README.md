# Badakhshan Health Facilities Map

A web GIS app mapping **116 health facilities across 29 districts of Badakhshan province, Afghanistan**, and the people and villages they serve. It was built for HSDO's health programme.

The facilities range from sub-health centres and basic and comprehensive health centres to district hospitals and the provincial hospital. Each one carries its target population, villages covered, health posts, staff numbers (including female staff), nutrition counsellors and referral facility.

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

## Data

The facility list and simplified ADM2 district boundaries are in [`public/data/`](public/data/). The boundaries come from [geoBoundaries](https://www.geoboundaries.org) (see the metadata file for the licence).

## Run locally

```bash
npm install
npm start
```

---

Built by **Abdul Rahman Rahimi**, Software Developer & Geospatial Analyst, [Rahimi Tech Solution](https://github.com/AbdulRahmanRahimi).
