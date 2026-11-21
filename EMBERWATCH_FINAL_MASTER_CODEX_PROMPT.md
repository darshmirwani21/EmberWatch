# EMBERWATCH — FINAL MASTER CODEX BUILD INSTRUCTION

You are the lead software engineer, geospatial engineer, agent-systems engineer, and product designer for **EmberWatch**. Build, integrate, test, and polish the application in this repository. **Do not stop at an implementation plan. Actually write and run code.** This is a solo hackathon project with roughly **3.5–4 hours of effective implementation time**. The highest-priority goal is one coherent, visually impressive, truly functional demo that demonstrates **real NVIDIA Nemotron tool calling**.

## 0. Repo inspection, precedence, and rules

1. Inspect the repository: `pwd`, source tree, `package.json`, lockfile, existing frontend/backend, scripts, `.gitignore`, and tests. Determine what already works before editing.
2. Read the repository-root files **`AGENTS.md`**, **`EMBERWATCH_SPEC.md`**, **`NEMOTRON_AGENTS_ADDENDUM.md`**, **`CODEX_START.md`**, and `README_FIRST.md` if present. Treat them as supporting specifications. **This prompt is the authoritative instruction when those documents disagree**, especially concerning priorities, the NVIDIA model ID, deployment, and scope. Do not discard useful detail from them.
3. Preserve working code and user changes. Do not blindly replace the app, overwrite unrelated files, erase user data, or reset Git history. If the repository contains only Markdown files, scaffold the application.
4. Execute the work in phases, testing each vertical slice. Make reasonable engineering decisions independently; do not stop repeatedly for approval. Clearly identify a genuine blocker rather than claiming success.
5. No fabricated AI responses, fake live weather, fake historical datasets, fake fire station responses, fake tool traces, nonfunctional buttons, invented response times, or invented testing results.
6. Make the project work **without NVIDIA credentials or internet data feeds** in a clearly labeled offline/demo mode. When an actual NVIDIA inference call succeeds, show an unmistakably distinct **Live Nemotron** state. Never simulate or falsely claim Nemotron execution.
7. Never expose private keys, full saved home coordinates, contact lists, or raw secrets in the browser bundle, URLs, committed files, AI prompts, or server logs.
8. The entire product is **educational/research simulation, NOT operational wildfire forecasting, certified evacuation routing, incident command, or firefighting tactical advice**. Use honest labels everywhere.

## 1. Product and navigation

Build **EmberWatch — Wildfire Intelligence & Scenario Lab**: one shared interactive map and deterministic fire-simulation engine, with two mode tabs:

**CIVILIAN** — Explore, Scenario Simulator, My Preparedness Plan, Alerts, Analyze with Nemotron.

**RESPONDER LAB — TRAINING SANDBOX** — Operations Lab, Control Lines, Compare, Wind History, Analyze with Nemotron.

The top navigation switches modes without resetting the shared simulated ignition, time, wind conditions, and map position. Civilian saved personal places and emergency contacts remain local/private and are never surfaced as shared responder assets. Do not imply actual agency authorization or credentialing.

**Core story for judges:** A hypothetical fire develops, wind shifts, a civilian explores a *preparedness* plan, a responder draws proposed control lines, and **Nemotron actually invokes tools** to investigate both situations with verifiable numbers and an activity trace.

## 2. Stack and executable setup

Use the existing compatible stack if present; otherwise build:

- Frontend: **React + TypeScript (strict) + Vite + Tailwind CSS + Lucide React**.
- Map: **MapLibre GL JS** with **OpenFreeMap** (verify current usable style; provide a fallback and proper attribution).
- Geometry: **Turf.js**, using GeoJSON `[longitude, latitude]`, geodesic distances, real point-in-polygon and line intersections.
- Charts: **Recharts** only where valuable.
- Backend: lightweight **Node.js + TypeScript + Express or Fastify**, with `dotenv`, Zod validation and an OpenAI-compatible NVIDIA client. Put secrets on the backend only.
- Testing: **Vitest** for the engine and agent orchestration; use a browser smoke test / Playwright if already available or feasible.
- Mobile: responsive PWA using `vite-plugin-pwa` once the core desktop/mobile app works.

Prefer a single npm repository, minimal dependencies, and a root `npm run dev` that starts both frontend and API backend. Implement a Vite `/api` proxy. If an existing architecture already supports these needs, keep it.

Configure the following scripts, or faithfully adapt existing equivalent scripts and document them:

- `npm run dev` — frontend + backend.
- `npm run typecheck` — strict TypeScript checks on all relevant packages.
- `npm run test` — unit/integration tests with no external credentials required.
- `npm run build` — production frontend and backend build.
- `npm run test:nemotron` — **real** authenticated NVIDIA smoke test when the key is configured; without key, report SKIPPED/MISSING KEY accurately, not PASS.

Create/update `.env.example`:

```dotenv
NVIDIA_API_KEY=
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
PORT=3001
```

Load values from a server-side `.env` file. Ensure `.env`, `.env.*` (except `.env.example`), logs, secrets, and build artifacts are excluded in `.gitignore`. Never create a real secret or ask the user to paste it into chat. **Do not use `VITE_NVIDIA_API_KEY`.** A previous kit incorrectly specified a deprecated Nemotron 3 Super hosted endpoint; override it with **`nvidia/nemotron-3.5-lightning-30b-a3b`** by default. Keep model configurable and confirm the chosen model supports tools at runtime.

Official reference model/API: https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b and `POST https://integrate.api.nvidia.com/v1/chat/completions`. Keep request settings compatible with the endpoint; check its documented parameters rather than blindly copying older model settings. Start with a simple nonstreaming request to verify authentication, then test a real `tool_calls` turn, before introducing streaming. Handle API 401/403/429/5xx and timeout transparently. Do not silently switch to a non-Nemotron model.

## 3. UI design — polished, not generic

Premium dark mission-control visual design. Background `#080D16`, panels `#111827`, thin borders `#243146`, primary text `#F2F5FA`, muted text `#94A3B8`, fire orange `#FF6038`, wind cyan `#38C6E8`, scenario-B violet `#A78BFA`. Restrained motion, consistent spacing, crisp typography, accurate visual hierarchy, no distracting gradients or fake analytics.

Desktop layout: slim top nav; left controls (~300px); dominant interactive map center; right metrics/intelligence panel (~300px); bottom playable timeline. Mobile: full-width map, accessible mode switch, bottom-sheet/drawer controls, 44px touch targets, safe-area padding. Preserve gesture handling and map controls. Show source/provenance labels: `HYPOTHETICAL`, `CURRENT WEATHER`, `OFFICIAL ALERT`, `HISTORICAL REANALYSIS`, `DRILL`, and `NEMOTRON LIVE` only when proven.

Required working interaction modes: Explore, Place Ignition, Select Location, Select Example Responder Origin, Draw Line, Edit Line. Visibly show the active mode; clicks must do what the mode says. Provide map zoom, pan, layer toggles, legends, reset, demo presets, loading/empty/error states, and keyboard support. Keep a persistent methodology/safety information panel.

## 4. Shared wildfire simulation — real numerical geometry

Implement a deterministic, typed, **illustrative** radial-front simulator. It is not a validated wildfire spread forecast. Use the shared engine in both tabs, in comparison mode, and in the server tool registry. Put pure computation in a framework-independent module that can be used by the frontend and backend without importing React or browser APIs.

Inputs: ignition `{lat,lng}`, duration (default 120 minutes), 5-minute steps, initial 75m radius, wind `{speedMph,fromDeg}`, humidity `%`, fuel dryness `0..1`, optional wind shift `{minute,newWind}`. Use 72 rays at 5° intervals. **Meteorological wind direction is FROM:** `fromDeg=180` means wind coming from south, moving north; `downwind=(fromDeg+180)%360`. Convert radians correctly.

Implement one explicit, documented *illustrative* formula (not a physics claim):

```text
baseRate = 10 meters/minute
fuelFactor = 0.75 + 0.90 * clamp(dryness, 0, 1)
humidityFactor = clamp(1.45 - RH/100, 0.65, 1.55)
windFactor = clamp(1 + 0.045*windSpeedMph*cos(rayBearing-downwindBearing), 0.20, 3.80)
growthMeters = baseRate * fuelFactor * humidityFactor * windFactor * timestepMinutes
```

At each timestep, add nonnegative growth to each ray, geodesically project new vertices, produce closed valid GeoJSON polygons, compute acres with Turf, and preserve reproducibility. Keep the already computed footprint when wind changes; only new radial increments use the shifted wind. Store time snapshots for smooth playback and scrub-back. Avoid accidental double conversion of meters/miles, and distinguish the 5-minute time resolution from a precise arrival prediction.

Map overlays: ignition, modeled red/orange footprint, illustrative proximity buffer (not an uncertainty confidence interval), user-selected point, wind direction arrows, fireline features, A/B comparison, timeline events. Animate through real snapshots. Report computed area, growth, modeled point-contact interval (or `not reached during horizon`), and source of inputs. Wind changes affect the actual geometry, not merely the arrow graphics.

**Wind Shift Lab:** a toggle to change wind *from* bearing and speed at minute T. A visible timeline marker. Preserve pre-shift snapshots bit-for-bit relative to an equivalent no-shift run. Update UI active wind when scrubbing.

## 5. CIVILIAN MODE — HomeWatch and evacuation preparedness

- Save a named location locally on the device (e.g. `Home`, `Campus`) with a delete control. Use explicit consent for any server interaction involving precise personal coordinates. No default public sharing, analytics logging of exact home points, or automatic model transmission of private home data.
- Pick an ignition point, change wind/humidity/dryness and watch the educational fire simulation. Clearly show modeled contact at selected point, if any; do not label a point outside the polygon `safe`.
- Build **Plan A and Plan B** with user-selected destinations/meeting points and manually entered/map-selected waypoints. Render separate GeoJSON LineStrings. In MVP, these are **schematic user-planned route sketches** with no claims about road availability or driving times. If a legitimate routing service is later configured, distinguish ordinary road paths from validated emergency evacuation guidance.
- **Rehearsal Mode:** test whether the *practice route sketches* intersect a hypothetical fire footprint at selected timestamps, using actual Turf geometric calculations. The result is an educational overlay, **not a safe/unsafe route recommendation**. Never issue an automated evacuation order or tell people to evacuate in a particular direction solely from simulator output.
- Include a compact readiness checklist (meeting place, transport, household and pet needs, alert enrollment, essential supplies) and links to CAL FIRE, Caltrans QuickMap, local emergency information when verified, and official alerts. Do not imply a Red Flag Warning is an evacuation order.
- Show a **Hypothetical Response Gap** optionally: illustrative response arrival = selected call delay + dispatch delay + turnout delay + estimated travel time. If no road router exists, label road travel as an approximation; never invent an average 911 response time. Compare against *modeled* contact with caveats: responder arrival does not mean containment or safety.
- HomeWatch Alerts panel: source-backed official alert items with publication/retrieval times; simulation-generated messages prominently prefixed `DRILL — SIMULATED`. Local notification display is allowed in demo mode; do not send real SMS/email or assert background monitoring without an actual opt-in scheduled backend.

## 6. RESPONDER LAB — proposed control lines and scenario testing

Responder Lab must be labeled **TRAINING SANDBOX — NOT INCIDENT-COMMAND SOFTWARE**. No operational firefighting deployment guidance.

- Users can draw **proposed control lines** as GeoJSON `LineString` via click/tap to add vertices, Finish, Esc cancel, Undo, select, rename, edit vertices if feasible, delete. Provide fallback manual drawing if a plugin is incompatible.
- Let each line have a unique ID, name, color, line type annotation, optional assumed completion minute, and a visibly hypothetical status. Drawing a line is **not** modeling its construction or effectiveness.
- Compute exact geodesic line length, segment count, first modeled *perimeter-line intersection* timestamp (or no intersection), and intersection coordinates using Turf. Make first-contact analysis robust for crossing, tangent and already-overlapped cases; do not claim containment or show percent-contained from this engine.
- Comparison: multiple proposed lines and/or Scenario A/B with a wind shift. Display same-time outlines orange/violet, changed contact/area metrics, and actual front-line intersection. Separate modeled influence of weather from mere line annotations.
- Optional training annotation layers: proposed anchor points, example lookouts/communications/escape-route/safety-zone sketches, all clearly educational, unverified and not certified for crew safety. NWCG terminology can be explanatory but should never become automatic real-world tactical recommendations.
- **Important:** The radial-front model MUST NOT automatically stop at a drawn line. Only add a separate *experimental barrier-aware grid engine* if time permits and it is truly implemented, tested, clearly labeled, and independently computes with-line and no-line outcomes. Otherwise leave barrier effectiveness explicitly unavailable. No fake “containment improvement”.

## 7. REAL weather, official sources, and data science

**Current weather:** Load weather from documented Open-Meteo forecast API for ignition/selected map location (`wind_speed_10m`, `wind_direction_10m`, `relative_humidity_2m`, temperature). Display retrieved timestamp, data model/source and units; copying values into the scenario makes the scenario *based on imported conditions*, not a real fire forecast. User edits mark hypothetical overrides. Gracefully fail without breaking simulation.

**Official alerts:** Use the NOAA/NWS API only after verifying the exact endpoint/headers/area handling: https://www.weather.gov/documentation/services-web-api . Display source URL, issued/effective/expires times, scope and last fetch. Do not convert weather alerts into evacuation orders. CAL FIRE official reference: https://www.fire.ca.gov/incidents/ . Only add real incident/perimeter overlays with verified public endpoints and timestamps. NASA FIRMS may be added later with server-side `NASA_FIRMS_MAP_KEY` but is not required for MVP. Never turn satellite hot spots into fabricated fire perimeter polygons.

**Historical wind / ENSO data science (after core + Nemotron work):** Work from a reproducible, cached ERA5/Open-Meteo archive dataset for **complete calendar years 2006–2025**, ideally one verified California region first. Build a throttled ETL job that fetches time series in sensible batches and computes compact summaries. Source: https://open-meteo.com/en/docs/historical-weather-api . Show period, latitude/longitude of sampled region, model, resolution caveat, fetch timestamp, number of actual observations, gaps, and whether values are reanalysis rather than direct station measurements. Never invent a 20-year dataset; if an API is unavailable, show an honest unavailable state.

Produce a **wind rose** with 8 or 16 directional FROM sectors; speed distribution (p10, median, p90), calm conditions, monthly/seasonal breakdown, and *circular* directional statistics (359° and 1° should center near 0°, not 180°). Optionally correlate **historical** same-season summaries with NOAA CPC RONI ENSO phases using genuine index records from https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/ . Correctly align three-month rolling ENSO seasons and sample counts. **Do not claim El Niño/La Niña deterministically predicts an individual fire's direction or arrival.** An optional seeded ensemble can vary illustrative spread inputs to show sensitivity ranges, never calibrated probabilities.

Prioritize one real historical dataset plus correct statistics over invented broad coverage. Add explanatory cards linking climate context to scenario assumptions, not to unsupported real fire forecasts.

## 8. REAL NVIDIA NEMOTRON AGENT — prize-critical requirement

**This is central to the project's NVIDIA prize entry, not an optional decorative chatbot.** Implement a real **Nemotron Intelligence Agent** that can decide which deterministic tools to call and then synthesize source-backed conclusions. One orchestrator with mode-specific workflows is preferred over four pretend agents.

### 8A. Authenticated backend integration

- Real server-only NVIDIA client using an OpenAI-compatible API; default `NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b`, `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1`, `NVIDIA_API_KEY` loaded on the backend.
- Create `GET /api/health` that reports service readiness and *whether credentials are configured*, without leaking secrets or claiming model connectivity.
- Create `POST /api/agent/investigate` accepting validated `{mode,question,scenario,selectedPointId?,lineIds?,comparison?}` or analogous context. The frontend may submit **ephemeral scenario geometry and explicitly selected points/lines to the backend** for deterministic calculations; map IDs to those geometries in the per-request server context so the tool registry can actually resolve them. Do not send stored address books, emergency contacts, or unnecessary raw saved-home coordinates to the model. When a user location is necessary, obtain explicit consent before transferring it to the backend; pass aggregated/geometric tool results to Nemotron rather than raw precise saved-home coordinates. Do not persist or log the raw coordinates.
- Implement `npm run test:nemotron` that makes (1) a simple **real** completion and (2) an authenticated **real tool-call roundtrip** using a harmless analysis tool, verifying actual invocation and result. If the model or endpoint does not return tool calls, report failure/unsupported status honestly and debug the documented protocol. A normal text completion alone must not be counted as the complete agent.
- Use robust timeout, retry/backoff for 429/transient errors, request budget, and plain-English unavailable/error state. Do not use fake automatic fallbacks that pretend another model is Nemotron.

### 8B. Real allowlisted tools (adapt names to existing code)

Implement Zod-validated, bounded tools using actual shared simulation and data-service functions:

1. `run_fire_simulation(params)` → snapshots summary, computed polygon/area/extent, elapsed times and provenance `SIMULATED`.
2. `compare_scenarios(scenarioA,scenarioB)` → measured differences with same horizon when comparable.
3. `analyze_point_exposure(scenario,pointId)` → first intersecting snapshot or not reached, and source `SIMULATED`.
4. `analyze_proposed_control_line(scenario,lineId)` → geodesic length, first front contact, intersections and source `TRAINING_SIMULATED`.
5. `get_current_weather(lat,lng)` → actual Open-Meteo response with source and timestamp, or explicit unavailable status.
6. `get_official_alerts(lat,lng)` → actual NWS records with source/issue times or explicit no-matching-records/unavailable states.
7. Optional `get_historical_wind_summary(regionId,season,phase)` → only after verified ERA5 cache exists, including sample counts and methodology.
8. Optional `inspect_preparedness_plan(planId)` → user-planned route identifiers and hypothetical geometric intersections only; never certify routes.

**Minimum true prize demonstration:** one Civilian question that causes real Nemotron tool calls for simulation/comparison/exposure, and one Responder question that causes real tool calls for proposed-line geometry. `get_current_weather` is desirable and must not invent values when unavailable. Share the same deterministic engine as the UI so the agent's facts agree with on-screen values.

### 8C. Bounded function-calling loop

1. On an explicit user click of **Analyze with Nemotron**, call server endpoint. Never fire costly inference on every slider update.
2. Send model system/developer instructions that distinguish `OBSERVED`, `OFFICIAL`, `HISTORICAL`, `SIMULATED`, `DRILL`, and `INFERENCE` and forbid unsupported evacuation or tactical guidance.
3. Expose real tool JSON schemas to NVIDIA's function/tool calling protocol. Validate all arguments and reject unknown tools, invalid coordinates, malformed JSON, exorbitant time horizons, excess tool calls, and unexpected shapes.
4. Run bounded loop (e.g. max 4 model turns, max 8 tool calls). On `tool_calls`, execute the actual allowed tools, capture success/error/provenance/timestamp/duration, append matching tool call IDs and tool-result messages, then ask the model to finish or choose more tools. Do not hard-code a pretend trace.
5. Return structured answer with `modelId`, `status`, `summary`, `findings`, `numericEvidence`, `limitations`, and **actual** `toolTrace`.
6. Validate structured output with Zod. Treat model-generated numeric assertions as untrusted; bind displayed numerical fact cards to the verified tool-result objects, never unvalidated prose. Unsupported claims should be removed, corrected via a bounded retry, or replaced with a factual template and marked PARTIAL.
7. Display sources, timestamps and limitations. Never show raw chain-of-thought or any API key.

### 8D. Agent user interface

Both modes must have a prominent **Analyze with Nemotron** button that opens a beautiful slide-out Intelligence panel with:
- Short editable question plus three scenario-aware presets.
- Meaningful status based on real server progress.
- **Agent Activity** trace showing actual chosen tool names, source/provenance, success/error, and verification status.
- Results grouped into a one-paragraph synthesis, verified numeric cards sourced from engine output, direct links to official sources when fetched, and limitations.
- Exact returned NVIDIA model ID and live/offline status.
- Retry and useful API-error handling.

Demo questions:
- Civilian: “For this hypothetical fire and my selected point, compare the current wind scenario with a 90° shift at minute 35. What changes in the modeled contact and why?”
- Responder: “Compare proposed control lines A and B under the wind-shift scenario. Which line does the modeled front intersect first, and what are the geometry-only limitations?”
- Official data: “What current NWS weather alerts are in this region, and how should I distinguish them from evacuation orders?”

Show the judges **real model invocation → actual tool calls → actual computed values → validated explanation**. If there's no key or failed API call, make the agent state `UNAVAILABLE`; leave non-AI features functional.

### 8E. Security and evaluation

- Treat external source strings and user text as untrusted data, not new executable instructions.
- Tool calls are read-only and do not send messages, command vehicles, call 911, issue evacuation orders or alter a real incident.
- Enforce rate limits, payload limits, strict validation, server origin/CORS controls appropriate to local development, and safe error messages.
- Tests cover malformed tool-call JSON, unknown tools, out-of-range coordinates, model timeout/429/5xx, tool response ID continuity, no fabricated API success, and numeric/source provenance.
- Add 3 benchmark prompts to `docs/NEMOTRON_EVALUATION.md`, including a real result and actual model/tool trace **only if executed**. For no-key cases mark tests **NOT RUN** instead of PASS. Include visible documentation of why Nemotron matters beyond a chatbot.

## 9. Mobile/PWA and hosted-readiness

Build responsive and touch-friendly on desktop and iPhone. After core features work, add manifest, icons, service-worker registration and installable PWA functionality. Make clear: a local LAN QR code opens the **web application in a browser**; this is not Expo Go. An installable iOS Home Screen experience requires a reachable HTTPS deployment, Safari's Add to Home Screen workflow, and browser/device-specific notification support. Prevent service-worker caching from making current weather/alerts appear fresh when offline. Provide proper offline/demo state.

Document a realistic deployment option: static frontend on Vercel/Netlify and server API on a separately supported Node host (or a compatible full-stack host), with server-side `NVIDIA_API_KEY`; production environment variables; CORS, health endpoints, and build instructions. Do **not** deploy or publish on the user's behalf without explicit authorization. A static Vite deployment by itself cannot safely hold the NVIDIA API key or run scheduled background monitoring.

Optional stretch: read-only MCP tools exposing the same validated analytics to compatible AI clients; scheduled official-alert monitoring, user-consented verified email/SMS. **MCP is not a scheduled monitoring service.** Only implement these after the real Nemotron agent, simulation, and core demo pass. Never send autonomous simulated evacuation notices.

## 10. Demo scenarios and one-click walkthrough

Include three obvious, fictional California presets (not assertions of active fires):

1. **Southern California Wind Shift**: ignition `34.150,-118.550`, example place `34.142,-118.542`, initial wind FROM NW 24mph, shift minute 35 to FROM south 32mph, RH 22%, dryness .85; use this for Civilian agent demo.
2. **Santa Rosa Control Lines**: ignition `38.470,-122.720`, wind FROM NW 30mph, RH 18%, dryness .90; two editable example proposed lines placed so actual fire-line contact can be observed in a reasonable time range; use for Responder agent demo.
3. **Sierra Foothills Scenario Showdown**: ignition `38.900,-121.070`, compare A (10mph, RH55%, dryness .40) with B (35mph, RH20%, dryness .90); only show historical overlays when actual sourced climate data is available.

Provide **Launch Demo** or **Demo Walkthrough** buttons that set a known coherent state, map camera, ignition, selected points, lines, timeline, and scenario. Demo must work without secrets and provide honest unavailable messages for real-world sources. Make synthetic scenarios visibly FICTIONAL.

Critical quality check: choose example coordinates and constructed line locations that really generate observable model intersection/contact under your implemented numerical engine. Confirm with tests; don't hardcode a plausible-looking result that isn't computed.

## 11. Tests and acceptance — do not fake completion

Write/execute tests for:

- Geodesic projection and valid closed polygon coordinates; `[lng,lat]` order; finite correct area units.
- FROM south → preferential northward growth; FROM north → south; FROM east → west; zero-wind symmetric behavior.
- Stronger downwind growth with increasing wind; greater illustrative growth under drier/lower-RH input; monotonic radial distances.
- Wind shift leaves all pre-shift snapshots unchanged and changes only later increments.
- Same input reproduces same snapshots.
- First point contact and no-contact cases.
- Draw/add/undo/edit/delete line; measured length, first perimeter contact; drawn line cannot influence radial-fire geometry.
- Civilian Plan A/B storage/deletion, schematic path intersection flag, never certified safe routes.
- Mode switching does not reset scenario unexpectedly or expose personal saved data in responder mode.
- Agent tool-selection dispatch with mocks and deterministic real calculations; malformed arguments rejected; no invented live-model success.
- Agent tool response and final numeric evidence derive from actual tool results; 401/429/timeout behave honestly.
- Real NVIDIA smoke test when credential available: actual completion AND actual tool call.
- Browser smoke test for desktop and mobile view if feasible.
- `npm run typecheck`, `npm run test`, `npm run build` actually execute and pass; fix errors. Check dev server and API route.

If a production feature cannot be completed, disable it, accurately document it, and preserve the working flow. Create `IMPLEMENTATION_STATUS.md` with a **verified** feature matrix: Implemented / Partially Implemented / Not Implemented / Blocked / Not Tested; exact commands and results, model ID and real inference status, weather/ERA5 availability, known issues and next steps.

## 12. Time-aware implementation sequence (IMPORTANT)

Respect the solo-hackathon build budget. Follow this order and do not get distracted by nice-to-haves:

**Phase A — Inventory and ensure a working map (20–30 min)**
- Inspect source and documents. Repair/run existing app; create baseline if needed. Establish shared state, map, mode switch, and styling.

**Phase B — Real NVIDIA proof of life (20–35 min)**
- Backend config, `.env.example`, client, `/api/health`, real plain inference smoke test, real tool-call smoke test. If key is absent, implement and test mocked contract but mark live verification unavailable; don't block independent features.

**Phase C — Shared simulation and Nemotron vertical slice (55–70 min)**
- Deterministic fire/wind-shift engine, real map animation, point exposure, tool registry, actual agent loop, Civilian investigation and activity trace.

**Phase D — Responder Lab differentiator (40–50 min)**
- Real proposed-line drawing, Turf length and front intersection, model tool, Responder agent question. Make mode switching visually seamless.

**Phase E — Civilian preparedness + UI polish (25–35 min)**
- User-chosen Plan A/B route sketches, geometric rehearsal, weather and official alerts if API access works, mobile layout, one-click demo.

**Phase F — Stabilization (30–40 min minimum)**
- Typecheck, Vitest, production build, actual browser walk-through, model/tool trace, demo rehearsal, implementation status and README. Do not skip this phase for historical charts.

**Only then:** 20-year ERA5/NOAA wind history, PWA install, barrier-aware experimental grid, live incident overlays, MCP, remote push/email/SMS, complex deployment infrastructure. If very short on time, use the implementation budget for strong P0/Nemotron rather than partial P2 integrations.

## 13. Deliverables and final response

Deliver actual code and necessary files, including:

- Runnable app and secure API server.
- Shared pure geographic simulation engine and actual geometry-analysis tools.
- Civilian and Responder Lab screens.
- Real (or explicitly credential-blocked) Nemotron integration, tool traces and tests.
- Three fictional demo presets and working map timeline.
- `.env.example`, `.gitignore`, `README.md` with precise Windows/PowerShell steps, `docs/MODEL_LIMITATIONS.md`, `docs/NEMOTRON_EVALUATION.md`, `docs/DEPLOYMENT.md` where appropriate.
- `IMPLEMENTATION_STATUS.md` with verified statuses and executed tests.

At the end, report: files changed, actual features implemented, NVIDIA model used, whether live inference and tool calls were genuinely verified, tests/build command results, unresolved blockers, and exact local run instructions. Never say it is done merely because the UI renders.

**START NOW: inspect this repository and Markdown files, build the smallest compelling working vertical slice, and continue coding/testing until the above acceptance criteria or genuine environmental blockers are reached. Do not stop after presenting a plan.**
