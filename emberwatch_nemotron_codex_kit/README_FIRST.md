# EmberWatch — NVIDIA Nemotron prize-track Codex Kit

This package includes the prior EmberWatch 4.0 two-sided wildfire simulator specification, plus a new NVIDIA Nemotron agentic integration addendum.

Files:
- `AGENTS.md` — persistent instructions (updated)
- `EMBERWATCH_SPEC.md` — app spec (updated with agent integration reference)
- `NEMOTRON_AGENTS_ADDENDUM.md` — real tool-calling architecture, UI, backend, evaluations, and safety
- `CODEX_START.md` — launch instructions and ready-to-paste Nemotron kickoff

Copy the files into the root of your existing EmberWatch VS Code repository. Do not delete existing source code. Configure `NVIDIA_API_KEY` in a backend-only `.env` file, keep it out of git, and paste the kickoff text from `CODEX_START.md` into Codex. The package is an implementation specification, **not** prebuilt functioning software or a verified inference run.
