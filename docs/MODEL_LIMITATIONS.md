# Methodology and limitations

EmberWatch supports education, preparation exercises, and geographic training. For an active emergency, follow local authorities and verified incident information. [CAL FIRE incidents](https://www.fire.ca.gov/incidents/) · [Caltrans QuickMap](https://quickmap.dot.ca.gov/)

## Radial-front model

Each run starts with a 75-meter radius and 72 compass rays at five-degree intervals. Every five minutes the engine increments the rays, projects their endpoints geodesically from ignition, closes the resulting GeoJSON ring, and computes area using Turf’s spherical area. One acre is 4,046.8564224 square meters. GeoJSON uses longitude before latitude. Calculations near the antimeridian use a continuous longitude branch around ignition. The workbench accepts latitudes from −84° to 84°.

```text
base = 10 m/min
fuel = 0.75 + 0.90 × clamp(dryness, 0, 1)
humidity = clamp(1.45 − RH/100, 0.65, 1.55)
downwind = (FROM + 180) mod 360
wind = clamp(1 + 0.045 × windMph × cos(ray − downwind), 0.20, 3.80)
increment = base × fuel × humidity × wind × 5 minutes
```

The footprint at a shift marker reflects growth accumulated under earlier wind. Starting at the marker, subsequent growth uses the shifted wind. The radial model omits terrain, fuel maps, spotting, smoke, suppression and uncertainty calibration. The proximity outline adds 300 meters to every ray for visual context. Civilian and Business calculate 289 snapshots through minute 1,440 at the default horizon. Spread uses the scenario inputs and its configured wind shift across this interval.

Contact is reported in five-minute intervals. A first sample at 30 minutes is shown as 25–30 minutes. In the radial preview, Turf calculates line length, perimeter intersections and length inside the footprint. Geometric overlap can occur between samples or when the line is enclosed.

## Responder interventions

Normal Responder runs seed the branch from the paused radial footprint. Historical Replay uses the latest usable observed outline or the labeled reconstruction at the branch point. The same grid engine computes an unimpeded baseline and an intervention from identical seeds and weather. The solver uses earliest arrival between cells with a shared side. Cells near line geometry are subdivided, and a completed line blocks connectors that intersect it. Open ends allow detours and the model retains previously burned areas. A very short segment that fits between connectors can be represented by a nearby perpendicular edge. The grid resolution limits geographic precision.

Scenario Insights reports both modeled areas, the difference, percent reduction, IoU, and direct blocking or subsequent bypass. The model treats completed lines as perfectly holding and omits embers, breaches, and construction failures. Perimeters follow grid cells and contact time is approximate. The original historical data stays available as a separate reference.

## Preparedness and official sources

Plans are user-placed or manually entered schematic LineStrings. Rehearsal checks geometric overlap at the selected snapshot. Real road availability, smoke, travel time, traffic, and orders require independent current information. The Hypothetical Response Gap adds user-entered assumptions. Responder arrival provides no inference about containment or household safety.

Open-Meteo supplies current best-match forecast-model conditions with a validity time and retrieval time. NWS supplies active records scoped to the queried point and includes issue, effective, expiry and retrieval times. A successful empty lookup reflects the source’s records at that retrieval time. [Open-Meteo forecast API](https://open-meteo.com/en/docs) · [NWS API](https://www.weather.gov/documentation/services-web-api)

The Wind History view uses complete UTC calendar years 2006–2025 for one Open-Meteo ERA5 grid cell. From-direction sectors exclude calm hours under 1 mph. Percentiles include valid calm hours. Circular mean uses the mean unit vector and resultant length describes directional concentration. Winter pools December, January and February across the selected archive. ERA5’s roughly 25 km grid smooths local terrain. These statistics describe the archived region. [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api)

## Investigation grounding

Only allowlisted functions can calculate or fetch evidence. The structured synthesis can select evidence IDs that were returned in the request. The UI takes numbers and source links from validated tools. A partial result retains computed evidence when the provider fails or returns unrecognized evidence IDs. Tool traces describe program execution and provenance. [NVIDIA model API reference](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/apireference)
