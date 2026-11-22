# EmberWatch

EmberWatch is a map-first wildfire education and preparedness lab. Civilian mode lets households rehearse schematic Plan A and Plan B sketches. Responder Lab lets users draw proposed training lines and measure their intersection with a modeled front. Business maps registered property and asset polygons against the modeled footprint. All three use the same geographic simulation and timeline.

## Run locally on Windows

From the repository root in PowerShell with Node.js 22.12 or later:

```powershell
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite serves the UI and proxies `/api` to the Node server, which defaults to port 3001. The simulator, local preparedness tools, and historical cache work without a key. Without external map access, the workspace uses a geographic grid.

All workspaces open on USGS Topo with shaded relief and contours. Use **Map layers → Basemap** for Streets, Dark, or Aerial / Satellite Hybrid. In **Alerts**, **Check at ignition** makes an on-demand NWS lookup, and **Preview drill notification** shows a dismissible in-app message at the current simulation minute.

The main wind sliders edit the wind at the current timeline minute. When a shift is enabled, **Wind Shift Lab** exposes the other wind setting. The blue arrow points where the wind is blowing, and its map readout shows both the FROM and TOWARD bearings.

To configure Nemotron, create `.env` from `.env.example` if you do not already have one. Set `NVIDIA_API_KEY` in that server-side file and restart the dev server. Leave `NVIDIA_MODEL` at `nvidia/nemotron-3.5-lightning-30b-a3b` for the verified integration. Never use a `VITE_` variable for credentials. [NVIDIA model API reference](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/apireference)

For a phone on the same Wi-Fi, run `npm run dev -- --host 0.0.0.0` and open the reachable **Network** URL printed by Vite in the phone’s browser. A QR code for that URL opens the web app. An installed iOS Home Screen experience uses Safari and a reachable HTTPS deployment. [Deployment guide](docs/DEPLOYMENT.md)

On a phone, switch between **Civilian**, **Business**, and **Responders** using the bottom bar. Each page uses the same map and playback strip. Civilian scenario, preparedness, alert, and insight controls open from the cards under the map. Responder tools start with **Fireline tools**, **Fireline Intelligence**, **Wind shift**, **Historical Replay**, and **Analysis**. While drawing or editing a line, finish, undo, and cancel are available directly below the map. Expand the map with the upper-right control and use the same control to return to the workspace.

## Demo

1. **Southern California Wind Shift.** Launch Demo in Civilian mode, scrub across minute 35, and open **My Preparedness Plan** for the fictional A/B sketches. Choose **Use my saved sketches** to switch to your device-local plans.
2. **Civilian investigation.** Open **Analyze with Nemotron**, use **Wind shift**, and consent to the fictional selected point for this request. The selected point is calculated on the server. Nemotron receives the interval and other evidence, without the point’s coordinates.
3. **Santa Rosa Control Lines.** Switch to Responder Lab to keep the current map and clock. Launch Demo in that mode to open Santa Rosa. Edit or draw a line, scrub to its first intersection, and run the **Compare lines** question.
4. **Sierra Foothills Showdown.** Choose the third fictional preset for orange/violet A/B footprints. In Responder Lab, open **Wind History** for the cached Sierra grid cell, with seasonal and monthly filters.

Nemotron chooses tools from the mode’s allowlist, receives their actual data, and selects relevant evidence for the synthesis. The server checks its evidence IDs and builds numerical cards directly from tool returns. The UI shows the provider-returned model ID and actual tool activity. [Verified evaluation](docs/NEMOTRON_EVALUATION.md)

Civilian, Business, and Responder Lab default to a 24-hour horizon with five-minute simulation frames. In the playback control, choose up to 60× or scrub to any modeled minute. Asset exposure and selected-point contact use the full horizon.

In Responder Lab, pause at the minute where you want the intervention to begin. Open **Control Lines** or **Fireline tools**, draw a line, and choose **Run Intervention**. The violet footprint shows the intervention and the optional cyan footprint shows the matched baseline. **Analysis** reports area, acreage difference, percent reduction, IoU, and the modeled outcome for each line. Branches continue from the selected minute to the configured endpoint. **End of run** shows the final comparison while playback is at an earlier sample. On the unimpeded radial run, the selected line still shows geometric overlap and its first sampled perimeter contact. **Current expansion rate** measures the next five minutes or the last interval at the horizon.

## Fireline Intelligence

Open **Responders → Fireline Intelligence** on mobile or **Responder Lab → Fireline Intelligence** on desktop. Pick a look-ahead time and study radius, then generate three geometric experiments locally or let Nemotron choose its own strategy parameters. **Include one Nemotron refinement** asks the model to revise one candidate and measure the revised set. **Explain current comparison** re-evaluates the displayed lines after a wind change.

Select a candidate on the map or in the comparison list. You can zoom to it, edit its vertices, undo or revert changes, and save a separate custom training line. Wind changes recalculate measurements while keeping edited coordinates. Replacing an edited set requires confirmation.

The baseline and alternate compare sampled perimeter contact. The alternate turns the modeled wind 90° at the indicated time and resumes from the accumulated footprint. A missing contact means the model did not sample a perimeter crossing in that window. Candidate screening uses radial geometry. Save a candidate to Control Lines and run an intervention to calculate its effect on the barrier grid.

Run `npm run test:firelines-live` with the existing server-side NVIDIA configuration to exercise live state, generation, evaluation, refinement, and comparison calls.

Saved places, route sketches, contacts and the readiness checklist are device-local. A selected point only leaves the browser when explicitly shared for one of the supported lookups or for deterministic agent geometry. The API sends user-entered investigation questions to NVIDIA. Enter questions without private addresses or contact information.

## Business workspace

Select **Business**, then **Asset Registry** on desktop or **Assets** on mobile. Choose **Draw asset polygon**, mark the corners on the map, and finish the polygon to enter its details. Categories are editable text, so you can use the same registry for vineyard blocks, buildings, equipment, or timber stands. Register the property boundary as a reference and draw the assets you want to measure separately. Assets stay in the current browser. The fictional Napa–Sonoma demo has a separate practice registry with sample values and a wind shift at minute 35. **My assets** restores your saved registry.

**Exposure** measures against the footprint at the timeline minute and checks the full scenario horizon in five-minute steps for first positive-area contact. The total affected acreage counts overlapping ground once. Declared USD values are prorated by the overlap fraction of each asset and then summed. The panel flags affected assets without a declared value. These figures describe modeled exposure and provide no estimate of financial loss.

**Smoke Monitoring** (or **Smoke** on mobile) fetches regional CAMS Global PM2.5 forecasts and Open-Meteo weather-model wind. It shows each valid time and the retrieval time. The public Open-Meteo endpoint is for noncommercial use. Set the optional server-side `OPEN_METEO_API_KEY` for a commercial Open-Meteo subscription. Regional PM2.5, wind, and distance cannot reliably determine vineyard smoke exposure or grape smoke taint. [Open-Meteo air-quality documentation](https://open-meteo.com/en/docs/air-quality-api) · [UC ANR vineyard smoke research](https://ucanr.edu/blog/green-blog/article/uc-researchers-study-smoke-risk-vineyards-prescribed-grassland-fires)

Open **Analyze with Nemotron** and select **Business overview**. Consent to send the current registry to the EmberWatch server for the calculation. NVIDIA receives computed results and asset aliases. Review **Verified asset summary** and **Agent activity** for the measurements and calls. The analyst fetches regional air quality near scenario ignition. The separate Smoke panel can use the selected asset’s approximate location. Run `npm run test:business-live` to repeat the authenticated check with the fictional data.

## Historical Replay & Intervention Lab

Open **Responders → Historical Replay**. The existing map stays in place, and the replay controls open in the responder sidebar or mobile bottom sheet. Eaton opens first. Use **Return to hypothetical scenario** to restore the previous map view and simulation timeline. Choose a fire and use the same playback dock as the scenario simulator. Each preset starts at the approximate WFIGS ignition with a zero-area modeled footprint. Up to 24 hours of hourly ECMWF ERA5 wind and humidity via Open-Meteo drive the labeled modeled reconstruction, which ends early if the archive has a weather gap. **Jump to modeled hour 24** opens the full-day modeled sample when available. The clock preserves recorded outlines at their actual survey timestamps and holds each until the next available survey. Eaton includes one timed FIRIS delineation plus day-dated and undated outlines. Park has two timed perimeters. Mosquito has a single archive outline and modeled playback. Day-only and undated shapes are available through **Archive outline overlay**. [NASA Eaton progression](https://svs.gsfc.nasa.gov/5558) · [Open-Meteo archive](https://open-meteo.com/en/docs/historical-weather-api)

Use **Map layers → Basemap** to select **Detailed Terrain** for elevation contours and shaded relief or **Aerial / Satellite Hybrid** for USGS imagery with OpenFreeMap labels. Terrain is the shared default. The basemap shows geographic context from the map providers. Its imagery date may differ from the fire record. [USGS The National Map](https://apps.nationalmap.gov/services/)

Pause at any replay time and choose **Practice Intervention → Draw a line**. Tap the map to place vertices, then use **Undo** or **Finish line** in the floating toolbar. You can also generate lines in **Fireline Intelligence** and choose **Use as barrier**. Optionally set each line’s completion minute, pick a comparison location, or edit the wind for both runs. Choose **Run Intervention**, then play or scrub the cyan baseline and violet intervention on the shared map. **Analysis** shows modeled area, first line contact, and selected-location contact for both runs. **Resume saved practice** restores the latest branch and lines for a fire during the current app session.

Both runs start from the same latest observed perimeter, modeled reconstruction, or labeled ignition seed. A branch opened within the first day defaults to the remaining modeled samples through hour 24. A later archived position starts its own hypothetical window of up to 24 hours. Spread uses archived hourly weather by default. The grid coarsens to cover large study areas and subdivides cells near barriers for finer local crossings. Completed lines block intersecting spread paths while fire can move around open ends. After the first run, edits, deletions, and weather changes update the comparison at the current clock position. The idealized simulation assumes completed lines hold without breach or spotting. Historical validation requires a later independent survey within 2.5 minutes of the modeled sample. In **Analysis**, enable **Check assets registered in Business** to measure recorded and hypothetical overlap with your local registry.

**Ask Nemotron** analyzes the matched grid results when at least one barrier is saved. **Agent activity** shows the actual calls, including `simulate_fireline_intervention`. Candidate generation and refinement use quick radial screening before you apply a candidate as a barrier. Run `npm run test:intervention-live` for the authenticated barrier workflow, `npm run test:history-live -- --replay` for historical weather and reconstruction, or `npm run test:history-live -- --refine` for alternatives and refinement. `npx tsx scripts/buildHistory.ts` rebuilds the bundled GIS and weather extracts.

## Verify and build

```powershell
npm run typecheck
npm test
npm run build
npm run test:nemotron
npx playwright install chromium
npm run test:browser
```

For live scenario benchmarks, leave the dev server running and execute `npx tsx scripts/nemotron-evaluation.ts` in a second terminal. To rebuild the bundled wind archive, run `npx tsx scripts/buildClimateCache.ts`. It retrieves hourly ERA5 in two-year batches and writes a compact cache after validating the full series.

Use `npm start` after the production build to serve the browser application and API from one Node process. [Implementation status](IMPLEMENTATION_STATUS.md) · [Model limitations](docs/MODEL_LIMITATIONS.md)
