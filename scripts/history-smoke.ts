import { runHistoryAgent } from '../server/historyAgent';
import { credentialsConfigured } from '../server/nvidia';
if (!credentialsConfigured) {
  console.log('SKIPPED / MISSING KEY — historical Nemotron smoke test');
} else {
  const refine = process.argv.includes('--refine');
  const replay = process.argv.includes('--replay');
  const result = await runHistoryAgent({ caseId: 'eaton', replayAt: replay ? '2025-01-08T03:18:00.000Z' : '2025-01-10T14:22:09.000Z', practicing: !replay,
    workflow: replay ? 'replay' : refine ? 'refine' : 'alternatives', duration: 120, wind: { speedMph: 25, fromDeg: 100 },
    question: replay ? 'Use the historical fire, historical weather and modeled reconstruction tools to describe how the wind and humidity changed and how the modeled acres evolved.' : 'Retrieve the historical fire and weather, run the baseline, branch from this historical timestamp, generate three hypothetical fireline alternatives, evaluate their modeled intersection times, and compare simulated and recorded outcomes where timestamps match.' + (refine ? ' Refine the three lines and verify revised crossings.' : '') });
  console.log(result.model, result.status, result.candidates.length + ' candidates');
  for (const entry of result.trace) console.log(entry.outcome, entry.name, entry.detail ?? '');
  const expected = replay ? ['retrieve_historical_fire', 'inspect_historical_weather', 'run_historical_reconstruction'] : ['retrieve_historical_fire', 'inspect_historical_weather', 'run_replay_baseline', 'create_intervention_branch', 'generate_replay_firelines',
    'evaluate_replay_firelines', 'compare_replay_footprints', ...(refine ? ['refine_replay_firelines'] : [])];
  if (!result.live || result.status !== 'completed' || result.candidates.length !== (replay ? 0 : 3) ||
    expected.some((name) => !result.trace.some((step) => step.name === name && step.outcome === 'success'))) throw Error(result.detail);
  if (refine && !result.trace.some((entry) => entry.name === 'refine_replay_firelines' && entry.outcome === 'success')) throw Error('Expected verified refined crossings.');
}

