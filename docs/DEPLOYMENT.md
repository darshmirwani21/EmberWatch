# Deployment

## Full-stack Node host

Use a Node.js host that supports a long-running process and HTTPS. Build with `npm ci` and `npm run build`, then run `npm start` from the repository root. The Express process serves `dist/client` and the API from the same origin. Set `NODE_ENV=production` and use the host’s `PORT`. In production the default bind address is `0.0.0.0`. Keep `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `NVIDIA_BASE_URL` and any NWS contact user agent in the host environment. If its reverse proxy is configured, set `TRUST_PROXY_HOPS` to the verified fixed number of trusted hops.

Check `GET /api/health` for API readiness and configuration. Check `npm run test:nemotron` in a server-side environment with the credentials to verify actual provider access. If you expose the live agent beyond a trusted audience, use host-level access control and spending limits. The prototype includes local request caps and per-IP limits.

## Split frontend and API

A static host such as Vercel or Netlify can serve `dist/client` after `npm run build`. Set `VITE_API_BASE_URL` to the HTTPS origin of the separately hosted Node API at frontend build time. Configure `FRONTEND_ORIGIN` on the API to the exact frontend origin. The API allows the configured origin and requests to its own origin. Configure the host to pass through NDJSON without buffering for progress events.

Treat `.env` as local. Do not expose it, put keys in frontend variables, or enable request-body logging on your gateway. The Node backend serves the credential-dependent integration.

## Browser install and offline use

For iPhone, open the HTTPS site in Safari and use **Share → Add to Home Screen**. On supported desktop browsers use the browser’s install action. The first successful visit loads the app and registers its service worker. Its precache includes same-origin static assets and the historical snapshot. Investigations, weather and official alerts use uncached API requests. If external tiles are unavailable, the simulator draws on its offline geographic grid.

Same-Wi-Fi HTTP from a local dev PC is intended for browser preview. Remote notifications, background monitoring, and deployment are outside this build.
