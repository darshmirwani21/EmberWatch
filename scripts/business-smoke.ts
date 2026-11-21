import { investigate } from '../server/agent';
import { credentialsConfigured } from '../server/nvidia';
import { vineyardAssets, vineyardDemo } from '../shared/vineyardDemo';

async function main() {
  if (!credentialsConfigured) {
    console.log('SKIPPED / MISSING KEY — Business Nemotron smoke test');
    return;
  }
  const result = await investigate({
    mode: 'business', scenario: vineyardDemo.scenario, business: { minute: vineyardDemo.minute, assets: vineyardAssets },
    question: 'Use run_fire_simulation, analyze_business_exposure, and get_business_air_quality to summarize the active modeled footprint, asset exposure at the selected minute, and separate regional PM2.5 and wind context. Explain the limits of each.',
  });
  console.log(result.modelId + ' · ' + result.status);
  for (const call of result.toolTrace) console.log(call.name + ' · ' + call.outcome + ' · ' + (call.detail ?? call.source));
  const tools = ['run_fire_simulation', 'analyze_business_exposure', 'get_business_air_quality'];
  if (!result.live || result.status !== 'completed' || tools.some((name) => !result.toolTrace.some((entry) => entry.name === name && entry.outcome === 'success')) ||
    !result.businessExposure?.affectedAcres || !result.businessExposure.fictionalAssets) throw new Error(result.summary);
  console.log('PASS verified fictional asset rows: ' + result.businessExposure.rows.length);
}

main().catch((error: unknown) => {
  console.error('FAIL Business smoke test · ' + (error instanceof Error ? error.message : 'Unknown failure'));
  process.exitCode = 1;
});

