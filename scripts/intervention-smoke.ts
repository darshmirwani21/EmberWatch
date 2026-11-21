import { runHistoryAgent } from '../server/historyAgent';
import { credentialsConfigured } from '../server/nvidia';

if (!credentialsConfigured) {
  console.log('SKIPPED / MISSING KEY — fireline intervention smoke test');
} else {
  const result = await runHistoryAgent({
    caseId: 'eaton', replayAt: '2025-01-08T02:18:00.000Z', practicing: true, workflow: 'barrier',
    question: 'Compare the historical weather, grid baseline, and idealized fireline intervention, including the computed area and selected-location contact.',
    duration: 30, minute: 30, wind: { speedMph: 30, fromDeg: 0 },
    intervention: { manualWind: true, location: [-118.10544,34.185], barriers: [
      { id: 'verified-smoke-line', readyMinute: 0, geometry: { type: 'LineString', coordinates: [[-118.114,34.188],[-118.096,34.188]] } },
    ] },
  });
  for (const entry of result.trace) console.log(entry.outcome, entry.name, entry.detail ?? '');
  const executed = new Set(result.trace.filter((step) => step.outcome === 'success').map((step) => step.name));
  const evidence = result.evidence.find((item) => item.label === 'simulate_fireline_intervention');
  if (!result.live || result.status !== 'completed' || !executed.has('read_intervention_configuration') || !executed.has('simulate_fireline_intervention') || !evidence) throw Error(result.detail);
  const verified = JSON.parse(evidence.text);
  if (!(verified.differenceAcres > 0) || verified.lineContacts[0]?.id !== 'verified-smoke-line') throw Error('The tool did not return the saved line and computed difference.');
  if (verified.baselineContact !== 20 || verified.interventionContact !== null || !verified.interpretation.includes('fewer modeled acres')) throw Error('Expected verified contact times and an area explanation.');
  console.log(result.model, result.status, 'baseline', verified.baselineAcres.toFixed(2), 'intervention', verified.interventionAcres.toFixed(2),
    'difference', verified.differenceAcres.toFixed(2), 'contact', verified.baselineContact, verified.interventionContact);
}
