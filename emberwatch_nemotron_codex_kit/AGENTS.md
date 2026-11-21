# EmberWatch 4.0 — Codex Agent Instructions

**Read `EMBERWATCH_SPEC.md` in full.** It is the authoritative build contract and explicitly supersedes prior EmberWatch 3.0 requirements where priorities differ. Implement code; don't stop after outlining a plan.

## Goals
- Build a polished **two-mode** React/TypeScript/MapLibre app: **Civilian** and **Responder Lab**.
- Preserve one shared deterministic time-dependent wildfire simulation and source provenance.
- Solo-hackathon scope: deliver P0 end-to-end before any P1/P2 work. P0 includes responder line drawing plus geometry metrics and civilian evacuation **preparedness** Plan A/B; not operational firefighting or dynamic certified evacuation guidance.
- Wind Shift Lab works across modes; real-time wind import is optional. Historical climate / ENSO content cannot be fake 20-year weather data.
- Responsive iPhone and desktop views; actual interactive map and functional controls.

## Strict engineering expectations
- Inspect existing source before edits; preserve useful V3 work. Never overwrite unrelated files.
- Strong TS types, testable numerical/geometry functions, documented units, `[lng,lat]` GeoJSON; correct meteorological wind FROM bearing.
- A drawn proposed control line must **not** automatically block the P0 radial fire engine. Label P0 as geometric interaction only; only enable line-effect preview after actual experimental grid engine implementation and tests. Never report official containment percentages.
- Historical climate analytics must use sourced ERA5 data (default complete years 2006–2025) with provenance, sample counts, circular wind statistics, NOAA RONI phases and season alignment. No invented metrics, untested predictive claims, or fire-risk probabilities derived from climate phases.
- Evacuation preparation is not evacuation routing. Do not select a “safe route” or issue departure directions from hypothetical geometry. Respect official alerts/zones/closures, show sources/timestamps, and make user-drawn route sketches visibly schematic.
- No claims of operational approval or certification; Responder Lab is TRAINING SANDBOX. Never represent proposed lines/points as deployed fire crews or official perimeters.
- Protect saved home addresses and contacts; do not ship precise data to an LLM or URL; local-only unless opted into a properly secured backend.
- Never put secrets in browser bundle. No automatic texts/emails based on simulations. Notify only with explicit consent, credentials and genuine services; DRILL labels for practice.
- Keep all API integrations non-blocking with honest error states. Any unimplemented capability must be disabled or clearly described, never a fake live button.

## Work order
1. Inspect repository and spec. Report any critical blockers in `IMPLEMENTATION_STATUS.md`.
2. Implement/refine dual-mode shell and P0 shared simulation/timeline.
3. Implement responder draw/edit/delete control line and length/intersection metrics.
4. Implement civilian Plan A/Plan B and rehearsal overlays.
5. Add responsive layout, one-click demos, test coverage.
6. Then add live weather, sourced ERA5 wind rose, NOAA RONI comparison, barrier-aware grid experimental model; P2 only if there is time.
7. Run `npm run typecheck`, `npm run test`, `npm run build`; fix failures. Smoke-test browser manually/automated when possible.
8. Report exactly what works, commands executed, incomplete items and launch steps. The spec must remain in repo.

**Start implementing now.** Make pragmatic decisions independently; don't block the P0 demo on credentials or a cloud service.

## NVIDIA Nemotron prize-track addendum (when requested)

Read `NEMOTRON_AGENTS_ADDENDUM.md` fully and implement its N0→N2 prize-critical vertical slice after preserving the existing shared wildfire engine. Nemotron must make real tool calls to real bounded calculation/data tools; do not substitute a decorative chatbot or unverified output. Use server-only NVIDIA credentials. Follow the addendum's tool safety, provenance, privacy and evaluation requirements. Never invent a successful model call.
