# EmberWatch 4.0 — MASTER CODEX IMPLEMENTATION SPECIFICATION

**Status:** implementation specification, not a claim of a functioning application.  
**Audience:** Codex agent implementing a polished solo-hackathon project.  
**Mission:** Build a cohesive two-mode, map-first wildfire education, preparedness, and responder *training* platform. Maintain a four-hour, solo-friendly P0 vertical slice, with P1/P2 as genuine enhancements rather than fake controls.

**Product promise:** “Understand the conditions. Explore what-if scenarios. Prepare with official guidance.”

**Modes:** (1) **Civilian** and (2) **Responder Lab**. Both use a shared map, geographic timeline, weather adapters, and educational simulation engine. A prominent two-segment mode switch at the top persists the selected mode; accessible desktop and mobile. Responder Lab is an **unvalidated training/sandbox interface**, not authorized operational decision support. Never describe it as an agency-approved tool.

## 0 — Build contract and priorities

1. Inspect the repository; preserve working V3 code if present. Read `AGENTS.md` and this spec completely. Implement actual source files, not only a plan.
2. Keep the entire core working with no backend accounts/API keys; no fake live data, firefighter stations, actual evacuation orders, or reliable fire ETA.
3. **P0, ship first:** Great responsive shell; two real mode tabs; real map; click-to-place ignition/location; deterministic wind-sensitive simulated perimeter and mid-run wind shift; play/scrub; Civilian evacuation preparedness builder with two **manually chosen** options; Responder Lab drawn, editable and deletable control-line overlays with measured length and **computed first model-front contact** (not automatically contained); demo presets; methodology/disclaimers; tests/build.
4. **P1, add after P0 passes:** Open-Meteo live weather and NWS official weather alerts; civilian drill route comparison using honest routing/provisional lines; illustrative 2D grid-based line-barrier *sensitivity sandbox* to compare “without line” vs “with line”; 20-year ERA5 wind-climatology charts via a cached/offline ETL; NOAA RONI ENSO phase comparisons; scenario A/B and HomeWatch; mobile installable PWA.
5. **P2, only if P0/P1 stable:** Live agency-verified incident/perimeter overlays; LANDFIRE fuels/terrain enhancements; actual timed responder resource schedules; privacy-safe hosted accounts; server-scheduled official source change notifications; optional consented email/SMS; read-only MCP; web-hosting deployment.
6. Respond with honest completion report and `IMPLEMENTATION_STATUS.md`: implemented, tested, blocked, deferred. Never claim unimplemented features or successful tests.

**Definition of success:** Judges switch Civilian → Responder Lab, draw a proposed line, initiate a wind shift, scrub the timeline, see how a modeled fire interacts with the line, explore season-specific historical wind patterns, and return to a civilian preparedness rehearsal—all within a working, visually cohesive app.

## 1 — Stack, interfaces, architecture

- React + TypeScript strict + Vite + Tailwind CSS, Lucide, MapLibre GL JS, OpenFreeMap basemap, Turf.js for geographic geometry, Recharts for analytical charts, Vitest, `vite-plugin-pwa` when P1 is reached.
- For drawing: prefer `maplibre-gl-terradraw`/Terra Draw if verified compatible, or implement stable MapLibre click-to-add-vertex + finish/edit/delete controls; never depend on a broken drawing plugin. Render valid GeoJSON LineStrings/Points. Support Esc cancel, Backspace remove vertex, finish via button/double-click with correct event handling, line selection, edit/reset/undo.
- Modular files: `src/engine/{spread,geo,exposure,response,containment,climatology,enso,types}.ts`; `src/components/{map,layout,civilian,responder,climate,common}/`; `src/data/{demoPresets,cachedClimate}.ts`; `src/services/{weather,nws,incidents,routing}.ts`; `scripts/buildClimateCache.*`; `server/` and `services/intelligence-mcp/` only for P2.
- Use one source of truth for simulation state and scenario timestamps. Separate *observed/reanalysis*, *official alert*, *historical statistic*, *illustrative simulation*, and *drill* data in typed models and the UI. No floating numbers unconnected to calculations.
- Basemap example: `https://tiles.openfreemap.org/styles/dark` with attribution. Verify access; provide graceful fallback. Start centered on California but support all U.S. states.
- No public exposure of precise saved home coordinates or API secrets. By default save places only in device `localStorage`, with a Delete Place action. Do not place exact home coordinates into shareable URL parameters.

## 2 — UX: high-end two-sided map application

### Main navigation

Use a premium dark mission-control design, deep navy #080D16, panel #111827, border #243146, main text #F2F5FA, muted #94A3B8, fire #FF6038, wind #38C6E8, scenario B violet #A78BFA. Avoid gradients/visual clutter over the map.

Header: EmberWatch mark, mode switch [**Civilian** | **Responder Lab**], LIVE / SIMULATED provenance indicator, region/search, weather age, demo, settings. Distinct active mode labels, but do not imply a responder credentials check unless auth is actually implemented. Mark responder interface **Training Sandbox**.

Desktop layout: left control panel ~300px, central dominant interactive map, right intelligence panel ~310px, bottom scrubber. Mobile: map full width/height, floating mode switch, collapsible bottom sheets and accessible large 44px tap targets. Preserve proper iPhone safe-area padding and map zoom/gesture behavior.

### Civilian sub-tabs

**Explore** | **Scenario** | **My Preparedness Plan** | **Alerts**

### Responder sub-tabs

**Operations Lab** | **Control Lines** | **Wind History** | **Compare** | **Map Layers**

Mode switching must preserve underlying fire geometry, geographic scope, scenario clock and source provenance. Civilian private saved places should not automatically become shared team data or be exposed in responder dashboards.

### Key dashboard interactions

- Geographic pin modes: Explore / Place Ignition / Choose My Place / Select Responder Origin / Draw Line / Edit Line. Show active mode. Do not silently treat clicks as edits.
- Smooth time slider play/pause/restart, 1x/2x/4x, snapshot metrics, change-wind marker, event annotations, scenario A/B toggle.
- One-click demo launches a *fully fictional, labeled* California scenario including modeled fire perimeter, wind shift, sample civilian location and proposed responder line. It must not pretend to show a real current incident.
- Provide explanatory empty/loading/error states and disable genuinely unavailable integrations, never decorative dead buttons.

## 3 — Shared educational wildfire engine (P0)

### Inputs

```ts
type LatLng = { lat: number; lng: number };
type Wind = { speedMph: number; fromDeg: number }; // meteorological FROM
type WindShift = { enabled: boolean; minute: number; newWind: Wind };
type FireParams = {
  ignition: LatLng; durationMinutes: number; stepMinutes: number;
  initialRadiusMeters: number; wind: Wind; windShift: WindShift;
  relativeHumidityPct: number; fuelDryness01: number;
};
type FireSnapshot = {
  elapsedMinutes: number; polygon: GeoJSON.Polygon; radialMeters: number[];
  areaAcres: number; activeWind: Wind;
};
```

Deterministic radial-front MVP: 72 rays at five-degree azimuth increments, initially 75m radius, five-minute steps, default 120-minute horizon. Wind `fromDeg=180` is FROM south and blows NORTH; downwind bearing `(fromDeg+180)%360`. GeoJSON coordinate order is `[longitude, latitude]`. Geodesically project ray endpoints; close polygon; compute area using Turf. Every radial distance is nondecreasing.

**Illustrative (uncalibrated) growth law**; units shown:

```text
baseRate = 10 m/minute
fuel = 0.75 + 0.90 * clamp(dryness,0,1)
humidity = clamp(1.45 - RH/100, 0.65, 1.55)
wind = clamp(1 + 0.045 * speedMph * cos(rayBearing-downwindBearing), 0.20, 3.80)
deltaR = baseRate * fuel * humidity * wind * timestepMinutes
```

Recompute wind at each discrete timestep; when a shift triggers, only *future* growth changes—never rotate, erase, or shrink the pre-shift footprint. Normalize angle/radians and validate inputs. Show area, extent, contact time with user point and an explicit not-reached state. This model does not predict real wildfire rates, spotting, smoke, ember transport, fuel moisture, slope, or suppression success.

**Live weather import** (P1): Open-Meteo forecast endpoint `https://api.open-meteo.com/v1/forecast` for coordinates and `current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m`, mph/Fahrenheit. Show forecast/model timestamp; once controls are edited, mark scenario as hypothetical. API absence must not block demos.

## 4 — Civilian: actual evacuation *preparedness* (P0/P1)

The new civilian screen is **Prepare & Rehearse**, not “AI tells you where it is safe to evacuate.” It must have a functional preparedness checklist and plan viewer even offline.

**P0 components:**

- Saved Place: user picks location manually and nicknames it (e.g. Home, Apartment, Campus). Device-local by default; delete it immediately on request.
- **Primary Plan and Alternate Plan:** user sets an intended destination/meeting place and optional waypoints for each. Clearly label these *user-planned options*. Show both paths on the same map. If a routing service is unavailable, show manually drawn schematic lines—not roads/travel times—and label them accordingly.
- Emergency contacts and household readiness checklist (medications, pets, transport, communication, go-bag, local alert registration). Local-only data with edit/delete/export text. Do not upload contacts.
- Official Guidance hub with links: county/local emergency management site when verified, CAL FIRE preparedness, official evacuation alerts/zones, and Caltrans QuickMap. A weather alert alone is not an evacuation order.
- **Rehearsal Mode:** select a fictional ignition and compare selected plan paths against *simulated* fire polygons at the chosen time. Identify intersecting paths/geographic overlap and say “This practice path intersects the hypothetical modeled footprint”; never “This path is safe.” A route that does not intersect has NOT been validated for road access, traffic, smoke, escape viability, or emergency orders.
- Two labeled timelines: hypothetical modeled fire contact at a chosen point, and an optional assumed response-arrival calculation. Response Gap is NOT an evacuation countdown or guarantee of containment.

**P1 with actual routing:** Add a documented routing backend (e.g. user-configured OSRM/Valhalla/OpenRouteService) after checking licensing, privacy, rate limits and availability. Present ordinary road paths and estimated normal travel times with service/time stamp. **No algorithmically determined wildfire evacuation direction** and no guaranteed safe route. Do not silently use straight-line distance as driving distance. If official closures cannot be fetched/verified, say “Road closures not verified” and link https://quickmap.dot.ca.gov/ . The app may open an ordinary maps app for a user-selected destination, but it must not claim safety.

**Authoritative reference**: NIST 2025 ESCAPE guidance and U.S. Fire Administration preparedness guidance emphasize advance planning, alternatives, and official instructions. The app must follow that scope, with prominently visible public-safety limitations.

## 5 — Responder Lab: draw proposed wildfire control lines (P0)

This is the *new hero workflow*. It must be functional and scientifically honest.

### Map drawing tools

- Toggle **Draw Proposed Line**. Click map for vertices; preview dashed segment to cursor; double-click or press “Finish” to commit, Esc to cancel; mobile tap-to-add with Finish. Support select, rename, drag edit vertices if feasible, undo, delete, and clear all.
- Store each line as a valid GeoJSON `LineString` with id, name, createdAt, completionMinute (assumed), optional resource label, and a `lineType` enum such as `handline_example`, `dozerline_example`, `existing_road_example`, `fuel_break_example`. These names are *training annotations*, not operational capabilities.
- Compute geodesic line length in miles/km using Turf. Color dashed planned lines differently from a solid hypothetically completed line. A drawn line is not an existing/official fire line.
- Optional training overlays: anchor point (pin), lookout (pin), communication checkpoint (pin), escape-route sketch (LineString), and safety-zone sketch (polygon). Mark all `TRAINING ANNOTATION — not certified for personnel safety`. Add contextual NWCG LCES educational checklist without telling responders these annotations satisfy real LCES requirements.
- Show legend: official observed perimeter (read-only, when available), hypothetical fire footprint, proposed control line, existing example barrier, selected point, wind direction, training overlays.

### Actual computed line analysis (P0)

For each timestep, intersect the modeled fire **perimeter** and the proposed LineString with Turf using robust line/polygon conversions and the actual geographic points. Calculate:

- Proposed length and number of segments.
- Earliest *model-front intersection* time (or “no modeled contact in scenario”).
- Whether the hypothetical footprint crosses/extends to the far side of the proposed line under a clearly documented geometric test, or simply report geometric intersection if side-of-line classification is unreliable.
- Geometric intersection points and portion of line overlaid by footprint at selected time.
- Wind angle relative to average line orientation (circular line bearing); label only as geometry, not tactics.

**Do NOT make an isolated line automatically stop a radial-front simulator.** The P0 radial model has no control-line mechanics. Mark the analysis panel: “Fireline is an illustrative annotation. Geometry and timing are calculated; containment effectiveness is not modeled in this view.” Never show a fabricated `% contained` or infer actual feasibility or crew safety.

### Optional meaningful line-effect simulation (P1)

To simulate a line affecting hypothetical spread, build a **separate experimental, deterministic 2D raster/cellular fire spread engine**, not a gimmick that merely clips a polygon at a line. Compare no-line and with-line runs under **identical** baseline inputs.

- Fix a bounded local metric projection/grid around ignition, e.g. 12km × 12km at 50–100m cell resolution, with adjustable resolution and capped cell count. Derive geographic mapping carefully; ensure realistic local extents for demo and explain truncation at grid boundaries.
- A cell has arrival time (or deterministic ignition state); transition to adjacent cell depends on time-specific assumed wind, RH, dryness and direction. Dijkstra-style arrival-time propagation with an explicitly stated approximation for wind changing during cell traversal is acceptable; deterministic step-wise cellular exposure is also acceptable. Do not treat air wind speed as fire rate.
- Pre-rasterize line segments onto traversable neighbor-edge intersections, including correct handling of polyline gaps. A proposed line affects an edge only **after its configured completionMinute**.
- Provide experimental `barrierCrossingFactor` in [0,1]; 1 = no modeled barrier reduction; values closer to zero increasingly slow/block *modeled* crossing. Default to a clearly illustrative mid-value and let users disable it. Do NOT derive factor from line type or claim a handline has known real-world effectiveness.
- Fire may flow around line endpoints; model both sides of barrier. Lines cannot erase already burned cells. No spotting, safety qualification, ember escape, structural ignition, or suppression resource feasibility is represented.
- Compute affected area and first-contact differences vs no-line baseline, return “Model sensitivity to assumed line barrier.” Show source engine badge: `Radial P0` vs `Experimental Grid P1`. Do not compare areas across engines as if they use the same physics. Ensure resulting raster footprints convert into valid map polygons without false holes; approximate render with raster/cell layer if polygonization is too costly.
- If this engine isn't implemented and verified, disable “Apply barrier to fire model” with a note and keep fully working line geometry metrics. Do not fake a reduction in fire footprint.

### Firefighting context (educational)

Use NWCG terminology carefully: direct/parallel/indirect attacks, control lines, anchor points, fire behavior monitoring, access/terrain constraints, resource availability, LCES and escape/safety considerations. Explain that choosing suppression tactics is a real incident-command responsibility requiring field observation, certified training and complex models. Do not generate tactical deployment instructions or claim an unverified line would hold. Never let a civilian mistake training overlays for official incident management data.

## 6 — Responder Lab: dynamic wind and scenario comparison

- Existing Wind Shift Lab persists across both modes: shift at minute T, new speed FROM direction, future spread changes. A wind event callout appears on the map and on the timeline. Confirm wind arrows correctly show “FROM” labels and movement “TOWARD” arrows.
- `Scenario A` vs `Scenario B`: same ignition and duration; change wind, humidity, dryness, shift, line geometry and barrier assumptions. Show fire perimeters and line overlays in distinguishable colors at the same simulated timestamp.
- For each scenario compare fire area, contact time, first line intersection, and (for actual experimental grid engine only) affected area due to assumed barrier. Never display a fake suppression success probability.
- Layer controls for terrain/fuels (only if verified data), NWS weather alerts, historical boundaries, satellite hotspots and hypothetical geometry. Source and freshness labels on each retrieved layer; unavailable layers have clear states.

## 7 — Data science: 20 years of historical wind and ENSO (P1)

**This is a climatology explorer, NOT an algorithm to predict an individual fire's direction or arrival.** ENSO influences seasonal probabilities and broad circulation, not deterministic neighborhood wind direction. Preserve that framing in code and UI.

### Data plan

1. Analyze **calendar years 2006–2025** (20 complete years). Do not quietly include incomplete 2026. Start with 3–5 demo California locations representing contrasting wind regimes; expand to arbitrary user-picked locations via an on-demand backend/cache later.
2. Pull Open-Meteo `archive-api.open-meteo.com/v1/archive`, explicitly use one consistent `models=era5` where supported for all years, with hourly `wind_speed_10m`, `wind_direction_10m`, `relative_humidity_2m`, temperature and precipitation where available. Verify exact API parameters with current docs rather than guessing. Reanalysis represents a modeled estimate, not a 20-year local anemometer record. ERA5 at ~25km resolution smooths local complex terrain; display that limitation.
3. Write a **documented batch ETL script** (`scripts/buildClimateCache.py` or .ts) that fetches annual/chunked data with rate limiting, retries, timestamps and a user-agent where appropriate; validates missing data and unit consistency; **computes summary products**, then saves compact JSON under `src/data/climate/`. Do NOT download/parse twenty years of raw hourly data for arbitrary map points on every page load. Do not precompute dozens of locations unless runtime and API usage allow.
4. Keep a small **pre-bundled, genuinely sourced** derived dataset for at least one sample region after real retrieval; include metadata: coordinates, years, reanalysis model, retrieval timestamp, number of samples, data gaps, normalization method. If downloading fails, show “Historical dataset unavailable” or an explicitly labeled synthetic *visualization example* rather than inventing 20 years of measurements.
5. NOAA CPC **RONI** historical ENSO index: https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/ . Use authoritative index values/phase labels, correct three-month rolling season mapping and threshold rules; do not join on arbitrary calendar years without documenting season alignment. Label RONI/ENSO records with source, dates and sample size. RONI 2026 supersedes many older ONI-focused examples; avoid silently mixing incompatible index baselines.
6. Optional official context: NIFC historical fire *perimeters* (2000 onward) and LANDFIRE fuel data. Historical perimeters alone do not provide hour-by-hour fire growth or wind causality. Do not train/claim an arrival forecast from perimeter endpoints alone.

### Statistical methods

- Compute circular wind-direction histograms (wind rose) with 8 or 16 FROM-direction sectors; show sample count and calm hours separately. Do not take the naïve arithmetic mean of degrees (e.g. 359° and 1° should average near 0°, not 180°).
- Weighted vector mean and circular concentration for representative direction; speed p10/p50/p90 and gust percentiles (if dataset supports them). Distinguish calm from missing.
- Show selected **month/season**, region, and ENSO phase (El Niño, La Niña, neutral) filters. Display conditional frequencies and sample sizes. Compare **the same months/seasons** across ENSO phases to reduce obvious season confounding. Do not imply that a 20-year regional summary is statistically conclusive, especially in small phase subsets.
- Compute selected-direction frequency, fraction of hours above user-selected wind speed, RH distribution and historical occurrence of a **specified combination of meteorological conditions**; explicitly label these *observed/reanalysis sample frequencies*, not wildfire hazard probabilities.
- Optional analog explorer: find k nearest historically observed wind vectors/conditions for selected location+season, show dates and actual archived values, not an assertion they will recur.
- Optional baseline forecasting: only with enough validated real data, train lightweight transparent model(s) to estimate a **distribution of future wind conditions** on a historical split, such as years 2006–2021 training and 2022–2025 test. Compare against seasonal baseline and report held-out directional error and speed MAE, sample counts and calibration. Avoid leakage and overclaiming; if validation fails or no dataset, DO NOT advertise prediction. Do not train a model to forecast wildfire spread or evacuation time from ENSO alone.

### Main UX

**Wind History** tab: region selector, year range (default 2006–2025), month/season, ENSO phase; live wind rose; speed percentile cards; historical directional histogram; sample-size indicator; methodology tooltip; “Apply Historical Analog to Simulation” button which copies selected *historical illustrative conditions* into a scenario and clearly labels them as archived, NOT forecast.

**Climate Context**: an ENSO three-column comparison of wind-sector distributions and speed medians for matching seasons; show a “small sample/insufficient records” state. Provide a plain-English explanation based on actual measured values and sample counts. Acknowledge seasonal/terrain patterns and confounders. This is the feature that demonstrates data-science depth without inventing predictive physics.

**FireSense**: separately retain existing seeded simulation sensitivity ensemble (P1/P2): perturb uncertain parameters by declared bounds and show range of outcomes and fraction of sampled illustrative configurations reaching a point—never a calibrated wildfire probability or official safety threshold. Maintain reproducibility via seed.

## 8 — HomeWatch, source-backed alerts and notifications (P1/P2)

Retain Civilian HomeWatch: saved nickname/place, weather with provenance, NWS official weather alerts by location (`https://api.weather.gov/alerts/active?point=lat,lon`, verify exact docs), current incidents only from verified public services, links to CAL FIRE and county/local authorities. Distinguish NWS Red Flag Warnings from wildfire incidents and evacuation orders.

Notification categories:
- `OFFICIAL_SOURCE_UPDATE`: new/changed official alert record relevant to saved place, with exact source ID, issue time, retrieved time, URL, no synthesized evacuation advice.
- `DRILL — SIMULATED`: deliberate in-app training message from model, explicitly labeled DRILL in title, preview and body; cannot be confused with emergency instructions.

In-app polling works only while the app is open unless a real scheduled backend is deployed. Don't claim background monitoring if none exists. Deduplicate events and let user delete stored places/history. Remote email requires consent, verified recipient, provider credentials (e.g. Resend), scheduler, audit record and unsubscribe. SMS similarly requires legitimate configured service and consent. Never auto-send from simulations. No real emergency call action.

Server-scheduled watchers (P2): idempotent fetch of trusted sources, geofencing based on official alert scope not naive radius when possible, privacy-protect saved locations, monitor only subscribed places, store minimal records and backoff/retry. Use Supabase or other supported job scheduler; static-only PWA cannot do reliable background server-side polling.

## 9 — Fire/terrain data sources (P2), verified access only

- NOAA/NWS forecasts and alerts: https://www.weather.gov/documentation/services-web-api
- Open-Meteo current + historical: https://open-meteo.com/en/docs , https://open-meteo.com/en/docs/historical-weather-api
- NOAA RONI: https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/
- Official fire data through NIFC WFIGS public ArcGIS data where the specific endpoint is independently verified: https://www.drought.gov/data-maps-tools/wildland-fire-open-data
- CAL FIRE official incident/evacuation reference: https://www.fire.ca.gov/incidents/ and https://www.fire.ca.gov/readyforwildfire/
- NASA FIRMS satellite hotspots (backend MAP_KEY): https://firms.modaps.eosdis.nasa.gov/api/
- LANDFIRE fuel layers via documented services: https://www.landfire.gov/data
- Caltrans road condition link: https://quickmap.dot.ca.gov/
- USFA preparedness: https://www.usfa.fema.gov/wui/outreach/wildfire-evacuation.html
- NIST 2025 ESCAPE guidance: https://www.nist.gov/news-events/news/2025/04/nist-updates-critical-wildfire-evacuation-and-sheltering-guidance
- NWCG (training context): https://www.nwcg.gov/6mfs/operational-engagement/constructing-line-without-a-safe-anchor-point

For each retrieved dataset record: source, URL, data type, observed/published time, retrieval time, coverage limitations, and errors. If official incident/perimeter service doesn't work, leave the layer unavailable; no fabricated fixtures labeled LIVE. Check API terms and public/free commercial usage before production deployment.

## 10 — Optional MCP integration, not the event scheduler (P2)

An MCP server is a read-only tool interface for AI clients, not an inherent web scraper or notification service. When base services work, expose separate authenticated/locally scoped tools:

- `get_weather_at_location({lat,lng})`
- `get_official_alerts({lat,lng})`
- `get_era5_wind_climatology({regionId,season,phase})` (returns sourced aggregates, not fabricated raw data)
- `get_incidents_in_bbox({bbox})` (only from verified API)
- `run_illustrative_fire_simulation({scenario})`
- `analyze_proposed_line_geometry({scenario,line})` (training only)
- `compare_training_scenarios({scenarioA,scenarioB})`
- `get_watch_summary({placeId})` (authorized user only, no exposing others' coordinates)

Use a current verified MCP TypeScript SDK and local stdio transport first; remote transports require auth/origin protection. Do not offer MCP tools that autonomously issue evacuation orders, recommend a certified firefighting tactic, send SMS to bystanders, or make emergency calls. The React app accesses shared backend adapters directly; no unnecessary MCP roundtrip for ordinary UI.

## 11 — Suggested demo presets and flows

**A — Civilian, Southern California:** fictional ignition (34.150,-118.550), sample location (34.142,-118.542); wind FROM NW 24mph initially, shifts to FROM S 32mph at minute 35; demonstrate hypothetical footprint/selected location, preparedness Plan A/Plan B sketch overlay, official-info links and DRILL warning.

**B — Responder Training, Santa Rosa area:** fictional ignition (38.470,-122.720), 30mph FROM NW, RH18%, dryness0.90; show clearly fictional proposed fireline crossing a likely modeled downwind side. When user draws a line, calculate its length and earliest model-front contact. Toggle baseline vs hypothetical line-effect grid model only if that engine actually exists and passes tests.

**C — Climate Lab, Sierra foothills:** fictional ignition (38.900,-121.070); compare season-specific winds / conditional ENSO historical distributions for a real sourced sample region. Apply a historical analog as a hypothetical input and compare fire shapes. If archived data not downloaded, launch the scenario with explicitly synthetic weather and show historical data unavailable, never a synthetic “20-year study.”

Main demo in 90 seconds:
1. Introduce EmberWatch as a dual-audience educational platform.
2. Civilian: shift wind, show modeled location contact, show evacuation preparedness Plan A/Plan B (no safety recommendation).
3. Switch Responder Lab: draw a control line, see geometry contact and model limitations.
4. Toggle wind shift; watch interaction timing change.
5. Open Wind History: show sourced 20-year wind rose, season/ENSO phase comparison (if ETL populated). Explain historical frequency != prediction.
6. Close with what is verified, what is illustrative, and how PWA/official alerts could support continued preparedness.

## 12 — Acceptance tests

### P0 automated tests

1. `fromDeg=180` preferentially grows north, `fromDeg=0` grows south, `fromDeg=90` grows west; degrees and radians correct.
2. Low/no wind near-symmetric; increasing wind increases downwind extent; more dryness/less RH increases illustrative area.
3. Fire radial front never shrinks; wind shift changes only post-shift increments; deterministic run reproducible.
4. GeoJSON polygon valid closed `[lng,lat]`; computed areas finite.
5. Point-in-polygon contact returns first timestep or null.
6. Drawn line can be created/finished/undone/edited/deleted; geodesic measured length matches expected segment test cases.
7. Line/perimeter first-intersection calculation works for contact/no contact, crossings and tangencies; line drawing does not alter P0 radial simulator; must not report containment %.
8. Mode switch preserves simulation state, makes correct controls appear, does not leak civilian local data.
9. Civilian Plan A/B saved/deleted, route diagrams clearly labeled approximate, model intersections flagged as *practice* not safe/unsafe.
10. One-click demo works without live API keys; failure of an external feed cannot break drawing or simulation.
11. Keyboard and touch drawing accessible; major controls functional.

### P1/P2 tests, only if implemented

12. Grid model baseline vs barrier shows real computed difference for a continuous example line, can flow around open endpoints, line completed after burn doesn't retroactively change burned cells, no fabricating output if disabled.
13. Reanalysis cache metadata matches actual pulled data; no fake 20-year entries; 2006–2025 inclusive; sample count and missing records tracked.
14. Wind circular mean e.g. 359°+1° near zero; calm vs missing differentiated; ENSO groups reflect aligned months/seasons, not mixed decades or arbitrary labels.
15. Derived sample frequencies computed from counts, not labeled fire risk probabilities; seed-based sensitivity reproducible.
16. NWS source changes deduplicated, no invented orders, no notifications without consent.
17. Browser responsive desktop 1440×900 and iPhone 390×844; PWA icon/manifest after P1.
18. `npm run typecheck`, `npm run test`, `npm run build` actually pass. Do not claim unrun browser tests.

## 13 — Workflow and deliverables

**Suggested timeboxing for effective four hours:**
- 00:00–00:30 inspect repo, scaffold/refactor two-mode nav and map layout.
- 00:30–01:30 preserve/implement shared simulated fire + wind shift timeline; fix tests.
- 01:30–02:20 responder line drawing and geospatial first-contact analysis; make it visibly awesome.
- 02:20–03:00 Civilian Plan A/B with practice overlay; mobile layout; one-click demos.
- 03:00–03:30 weather and climate cache/chart only if source retrieval is reliable; otherwise focus on UI and documentation.
- 03:30–04:00 stabilize, typecheck, tests, build, phone smoke test, demo rehearsal.

**Deliverables in repo:** runnable React app; `README.md`; methodology and data provenance documentation; `IMPLEMENTATION_STATUS.md`; `.env.example` only for required backend extras; reliable tests; optional `scripts/buildClimateCache.*` with cached output and provenance; `docs/DEPLOYMENT.md`; PWA config when ready; optionally MCP server README/commands.

**Launch expectations:** `npm install`; `npm run dev -- --host 0.0.0.0`; access from same-LAN phone via `http://LAN_IP:5173` QR (browser, not Expo Go). For installable iPhone PWA and push use HTTPS deployment and Safari Add to Home Screen. Do not falsely claim a static app can monitor and send notices after a browser closes without a deployed scheduled service.

**Closing constraint:** An attractive, truthful prototype with excellent interactivity is more impressive than a pretend operational wildfire system. No fire ETA, line-holding guarantee, route safety certification, real dispatch estimate, personnel safety verification, or unverified evacuation instruction may be inferred from this educational model.

## 18 — NVIDIA Nemotron prize-track integration

When targeting the "Best Use of NVIDIA Nemotron" hackathon track, read and implement `NEMOTRON_AGENTS_ADDENDUM.md`. This addendum is the controlling detailed specification for a real Nemotron-driven tool-calling investigator on both Civilian and Responder modes. It does not remove the baseline safe offline simulation requirements. Implement the smallest tested end-to-end agent loop first; prioritize prize-track N0–N2 over optional MCP, SMS and other P2 work. Keep the API key only on the backend and label all hypothetical results accurately.
