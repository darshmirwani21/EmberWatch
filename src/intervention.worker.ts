import { simulateIntervention, type InterventionInput } from '../shared/interventionSimulation';

self.onmessage = ({ data }: MessageEvent<InterventionInput>) => {
  try { self.postMessage({ result: simulateIntervention(data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'The intervention could not be computed.' }); }
};

