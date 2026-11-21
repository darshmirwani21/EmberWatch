import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pointSchema, requestSchema, type AgentProgress } from '../shared/contracts';
import { firelineExplanationSchema, firelineRequestSchema } from '../shared/firelineContracts';
import { validateCandidateLine } from '../src/engine/firelineCandidates';
import { replayRequest } from '../shared/historyContracts';
import { hasHistoryContext, runHistoryAgent } from './historyAgent';
import { investigate } from './agent';
import { generateWithNemotron } from './firelineAgent';
import { credentialsConfigured, modelId } from './nvidia';
import { getAirQuality, getAlerts, getWeather } from './sources';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  const host = req.get('host');
  const browserHost = origin?.match(/^https?:\/\/([^/]+)$/)?.[1];
  const devLan = !process.env.FRONTEND_ORIGIN && process.env.NODE_ENV !== 'production' && browserHost?.endsWith(':5173') &&
    /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):5173$/.test(browserHost);
  if (origin && origin !== process.env.FRONTEND_ORIGIN && (!browserHost || browserHost !== host) && !devLan) {
    res.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }
  if (origin) res.set('Access-Control-Allow-Origin', origin).vary('Origin');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use('/api', express.json({ limit: '48kb' }));
const limiter = (limit: number) => rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Request limit reached. Retry shortly.' } });
app.get('/api/health', (_req, res) => { res.json({ status: 'ready', credentialsConfigured, modelId }); });
async function agentResponse<T>(req: Request, res: Response, run: (signal: AbortSignal, report?: (data: AgentProgress) => void) => Promise<T>) {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  if (req.get('accept') === 'application/x-ndjson') {
    res.type('application/x-ndjson').set('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (payload: { event: 'progress'; data: AgentProgress } | { event: 'result'; data: T }) => {
      if (!controller.signal.aborted) res.write(JSON.stringify(payload) + '\n');
    };
    const data = await run(controller.signal, (data) => send({ event: 'progress', data }));
    send({ event: 'result', data });
    res.end();
    return;
  }
  res.json(await run(controller.signal));
}
app.post('/api/agent/investigate', limiter(8), async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid investigation context.' }); return; }
  await agentResponse(req, res, (signal, report) => investigate(parsed.data, undefined, signal, report));
});
app.post('/api/agent/history', limiter(4), async (req, res) => {
  const parsed = replayRequest.safeParse(req.body);
  if (!parsed.success || !(await hasHistoryContext(parsed.data))) {
    res.status(400).json({ error: 'Invalid historical replay context.' }); return;
  }
  await agentResponse(req, res, (signal, report) => runHistoryAgent(parsed.data, undefined, signal, report));
});
app.post('/api/agent/firelines', limiter(4), async (req, res) => {
  const parsed = firelineRequestSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.minute === parsed.data.horizon) {
    res.status(400).json({ error: 'Invalid fireline study. Choose a future horizon within the simulation.' }); return;
  }
  await agentResponse(req, res, (signal, report) => generateWithNemotron(parsed.data, undefined, signal, report));
});
app.post('/api/agent/firelines/explain', limiter(4), async (req, res) => {
  const parsed = firelineExplanationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid existing fireline candidates.' }); return; }
  const { study, candidates } = parsed.data;
  try {
    for (const candidate of candidates) validateCandidateLine(candidate.geometry.coordinates, candidate.studyCenter, candidate.studyRadiusMeters);
  } catch {
    res.status(400).json({ error: 'One or more existing lines are outside their training geometry bounds.' });
    return;
  }
  await agentResponse(req, res, (signal, report) => generateWithNemotron(study, undefined, signal, report, candidates));
});
app.post('/api/weather', limiter(20), async (req, res) => {
  const parsed = pointSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid location.' }); return; }
  res.json(await getWeather(parsed.data));
});
app.post('/api/air-quality', limiter(12), async (req, res) => {
  const parsed = pointSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid air-quality location.' }); return; }
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  res.json(await getAirQuality(parsed.data, controller.signal));
});
app.post('/api/alerts', limiter(20), async (req, res) => {
  const parsed = pointSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid location.' }); return; }
  res.json(await getAlerts(parsed.data));
});
app.use('/api', (_req, res) => { res.status(404).json({ error: 'API route not found.' }); });
const front = resolve('dist/client');
if (existsSync(front)) {
  app.use(express.static(front, { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(front, 'index.html')));
}
const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
  res.status(status).json({ error: status === 500 ? 'The request could not be completed.' : 'Invalid or oversized request body.' });
};
app.use(handleError);
const port = Number(process.env.PORT || 3001);
app.listen(port, process.env.API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log('EmberWatch API listening on port ' + port + ' · NVIDIA credentials ' + (credentialsConfigured ? 'configured' : 'absent'));
});
