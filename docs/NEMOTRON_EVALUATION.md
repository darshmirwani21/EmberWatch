# Live Nemotron evaluation

**Executed November 21, 2026 (America/Chicago)** using `nvidia/nemotron-3.5-lightning-30b-a3b` on NVIDIA’s OpenAI-compatible hosted endpoint. `npm run test:nemotron` passed a plain authenticated completion and a second test in which Nemotron selected `read_demo_measurement`, received a matching tool-role message, and returned the runtime-generated verification value. [NVIDIA model API reference](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/apireference)

Run these real benchmarks against the running API with `npx tsx scripts/nemotron-evaluation.ts`. The tool trace below records the successful run after grouping related calculations into a bounded tool call.

| Benchmark prompt | Live trace | Verified outcome |
| --- | --- | --- |
| Compare active scenario A with a 90° clockwise shift at minute 35. Compare their ending footprint areas and the modeled contact at the selected point in each run. | `compare_scenarios` · success · SIMULATED, EmberWatch radial front | A ended at 5,959.96 ac and the 90° alternate ended at 5,631.36 ac. Both sampled point contact at 25–30 min. The shift came after contact. |
| Under the active shifted wind, compare proposed lines A and B in scenario A. Which receives the first modeled front intersection? Describe the geometry-only limitation. | `analyze_proposed_control_line` · success · TRAINING_SIMULATED, Turf geometry | Line A was 0.65 km with first front contact at 15–20 min. Line B was 1.05 km with first front contact at 60–65 min. The selected synthesis identified Line A and the geometry-only limitation. |
| Check current NWS alerts for the ignition area. Distinguish weather alerts from evacuation orders. | `get_official_alerts` · success · NOAA / National Weather Service | NWS returned zero matching active records at 11:30:33 a.m. CST. The synthesis distinguished weather warnings from local evacuation orders. [NWS alerts](https://www.weather.gov/alerts) |

The first live Civilian run exhausted its turn budget after running separate simulation and exposure calls. The updated comparison tool computes both scenarios and both point contact outcomes in one invocation. The Responder tool accepts a bounded list of proposed lines and calculates their ordering in one invocation per scenario. Model tool selection stays dynamic.

The numerical evidence comes from the same engine used by the map. The model determines what to investigate and which checked interpretations to present. It does not directly control numeric cards, source links, external notifications, or real-world actions. The mocked tests exercise invalid arguments, unsupported tools, missing/slow providers, matching tool IDs, privacy and hallucinated evidence separately from these live results.
