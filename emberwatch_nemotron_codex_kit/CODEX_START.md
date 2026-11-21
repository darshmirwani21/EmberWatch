# EmberWatch 4.0 — start in VS Code

## Recommended: update the existing EmberWatch project

1. Open your existing EmberWatch repository in VS Code (or create an empty `emberwatch` folder).
2. Copy `AGENTS.md` and `EMBERWATCH_SPEC.md` from this kit into the **repository root**, replacing previous V3 instructions *only after preserving your existing code*. The new spec supersedes the old kit.
3. Open the Codex extension in a mode with repository edit and terminal execution permission.
4. Paste the prompt below. Let Codex inspect the existing repository; it should update, not blindly rebuild, a working app.

## Kickoff prompt to paste into Codex

> Read `AGENTS.md` and `EMBERWATCH_SPEC.md` completely. Implement EmberWatch 4.0 as a two-mode Civilian + Responder Lab application, preserving existing working code. Do not stop after a plan. Make P0 function end-to-end: real map, correct geographic wind-shift simulation, Civilian Plan A/Plan B evacuation *preparedness* overlays, Responder Lab draw/edit/delete proposed control lines and calculate length plus first simulated front contact. Keep the drawn line analysis honest: do not claim it halts the P0 radial model or show fake containment. Make the UI excellent on desktop and mobile, add one-click demos, run typecheck/tests/build, fix failures, and create `IMPLEMENTATION_STATUS.md`. If time permits, add genuinely sourced Open-Meteo historical ERA5 wind climatology for 2006–2025 and NOAA RONI ENSO comparisons with real sample counts. Keep live notifications, barrier grid physics, and MCP optional; do not fabricate any data. Start editing and executing code now.

## Intended local commands (after Codex creates/updates the app)

```sh
npm install
npm run dev -- --host 0.0.0.0
# in a second terminal, when implemented:
npm run typecheck
npm run test
npm run build
```

For an iPhone preview, use your PC's same-Wi-Fi LAN IP and Vite port (often 5173): `http://YOUR_LAN_IP:5173`. You may create a QR code pointing to that URL. This opens a web browser, **not** Expo Go. For a Home Screen PWA use an HTTPS deployment and Safari > Share > Add to Home Screen. Exact install and deployment steps should be in the generated README.

## Pitch sequence

- Civilian: launch fictional wind-shift scenario, select a place, examine two rehearsed route options with clear limitations.
- Responder: switch tabs, draw a proposed control line, see measured length and front contact time, update wind and replay.
- Data science: open sourced historical wind rose and ENSO comparisons (only if data downloaded and verified; otherwise explain the planned integration without fabricated charts).
- Explain the key distinction: simulated geometry supports education, while official emergency decisions and active-fire operations require competent authorities and validated systems.

## Nemotron track — paste into Codex after adding this kit to the repo

> Read `AGENTS.md`, `EMBERWATCH_SPEC.md`, and `NEMOTRON_AGENTS_ADDENDUM.md` completely. Preserve all working EmberWatch features. Add a real NVIDIA Nemotron 3 Super-backed agent investigator to Civilian and Responder Lab, using an authenticated server-side OpenAI-compatible NVIDIA endpoint and a bounded `tool_calls` loop. The model must actually call existing wildfire simulation, geographic exposure, and control-line comparison tools; show real tool traces and source provenance. Implement schema validation, errors, privacy and safety constraints. Prioritize a working prize-track N0→N2 end-to-end demo instead of optional MCP, SMS, or superficial chatbot UI. Add tests, run typecheck/test/build, fix failures, and document real successful Nemotron API calls or clearly state blockers. Do not stop after planning; implement now.

Get a NVIDIA API key from https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b and place it in the **backend-only** environment as `NVIDIA_API_KEY`. Never paste the key into this chat or commit it. Successful live model integration cannot be claimed until a real authenticated request has succeeded.
