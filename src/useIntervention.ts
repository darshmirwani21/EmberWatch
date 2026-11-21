import { useEffect, useState } from 'react';
import type { InterventionInput, InterventionResult } from '../shared/interventionSimulation';

export function useIntervention(key: string, automaticInput?: InterventionInput) {
  const [run, setRun] = useState<{ key: string; input: InterventionInput }>();
  const [response, setResponse] = useState<{ run: typeof run; result?: InterventionResult; error?: string }>();
  useEffect(() => {
    if (automaticInput) setRun({ key, input: automaticInput });
  }, [automaticInput, key]);
  useEffect(() => {
    if (!run || run.key !== key) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./intervention.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setResponse({ run, error: 'The simulation worker is unavailable in this browser.' }); return;
    }
    worker.onmessage = (event) => { setResponse({ run, ...event.data }); worker.terminate(); };
    worker.onerror = () => { setResponse({ run, error: 'The simulation worker could not finish.' }); worker.terminate(); };
    worker.postMessage(run.input);
    return () => worker.terminate();
  }, [run, key]);
  const current = run?.key === key && response?.run === run ? response : undefined;
  return { result: current?.result, error: current?.error, running: Boolean(run?.key === key && !current),
    stale: Boolean(run && run.key !== key), start: (input: InterventionInput) => setRun({ key, input }) };
}

