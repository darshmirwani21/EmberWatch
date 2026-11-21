import 'dotenv/config';
import { demos, defaultComparison } from '../shared/demos';
import type { AgentResult, Investigation } from '../shared/contracts';
import { credentialsConfigured } from '../server/nvidia';

const root = 'http://127.0.0.1:' + (process.env.PORT || 3001);
const [south, santa] = demos;
const probes: Array<{ title: string; input: Investigation; tools: string[] }> = [
  { title: 'Civilian wind shift', input: { mode: 'civilian', scenario: south.scenario, point: south.point,
    comparison: defaultComparison(south.scenario, 0), question: 'Compare active scenario A with a 90° clockwise shift at minute 35. Compare their ending footprint areas and the modeled contact at the selected point in each run.' },
    tools: ['compare_scenarios'] },
  { title: 'Responder control lines', input: { mode: 'responder', scenario: santa.scenario, lines: santa.lines,
    question: 'Under the active shifted wind, compare proposed lines A and B in scenario A. Which receives the first modeled front intersection? Describe the geometry-only limitation.' },
    tools: ['analyze_proposed_control_line'] },
  { title: 'Official alert context', input: { mode: 'civilian', scenario: south.scenario,
    question: 'Check current NWS alerts for the ignition area. Distinguish weather alerts from evacuation orders.' }, tools: ['get_official_alerts'] },
];
async function main() {
  if (!credentialsConfigured) { console.log('NOT RUN — NVIDIA credentials missing.'); return; }
  for (const { title, input, tools } of probes) {
    const response = await fetch(root + '/api/agent/investigate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) { console.log(title + ' — HTTP ' + response.status); process.exitCode = 1; continue; }
    const result = await response.json() as AgentResult;
    const actual = result.toolTrace.map((tool) => tool.name);
    const meets = new Set(tools).size > 0 && [...new Set(tools)].every((name) =>
      actual.filter((actualName) => actualName === name).length >= tools.filter((tool) => tool === name).length);
    console.log(JSON.stringify({ title, model: result.modelId, live: result.live, status: result.status,
      summary: result.summary, facts: result.numericEvidence.map(({ label, value, unit, detail }) => ({ label, value, unit, detail })),
      trace: result.toolTrace.map(({ name, outcome, source, detail }) => ({ name, outcome, source, detail })),
      sources: result.sources, passed: result.live && meets && result.status === 'completed' }, null, 2));
    if (!result.live || !meets || result.status !== 'completed') process.exitCode = 1;
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Evaluation failed.'); process.exitCode = 1; });
