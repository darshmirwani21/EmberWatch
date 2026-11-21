import assert from 'node:assert/strict';
import 'dotenv/config';
import { generationResultSchema } from '../shared/firelineContracts';
import { generateWithNemotron } from '../server/firelineAgent';
import { credentialsConfigured } from '../server/nvidia';

if (!credentialsConfigured) {
  console.log('SKIPPED / MISSING KEY — fireline tool workflow');
} else {
  const result = generationResultSchema.parse(await generateWithNemotron({
    scenario: { ignition: { lat: 38.47, lng: -122.72 }, durationMinutes: 120,
      wind: { speedMph: 30, fromDeg: 315 }, humidity: 18, dryness: .9,
      shift: { minute: 35, wind: { speedMph: 32, fromDeg: 180 } } },
    minute: 20, horizon: 85, radiusMeters: 12000, refine: true,
  }));
  const executed = result.toolExecutionSummary.filter((entry) => entry.outcome === 'success').map((entry) => entry.name);
  console.log(JSON.stringify({ status: result.status, modelId: result.modelId, strategies: result.candidateStrategies,
    candidateCount: result.candidateIds.length, executed, verificationWarning: result.verificationWarning,
    failures: result.toolExecutionSummary.filter((entry) => entry.outcome === 'error').map(({ name, detail }) => ({ name, detail })),
    narrative: result.narrativeExplanation }, null, 2));
  assert.equal(result.status, 'completed');
  assert(result.candidates.length > 0);
  for (const name of ['get_fire_simulation_state', 'generate_fireline_candidates', 'evaluate_fireline_candidates',
    'refine_fireline_candidates', 'compare_fireline_candidates']) assert(executed.includes(name), 'Missing executed tool ' + name);
}
