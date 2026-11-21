import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, FlaskConical, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { AgentProgress, AgentResult, Investigation } from '../shared/contracts';
import { contactLabel } from '../shared/engine';
import { dollars } from './BusinessWorkspace';
import { api, decimal, timeLabel } from './ui';
import { streamAgentRequest } from './agentStream';
import { trackDialogViewport } from './MobileWorkspace';

export const questions = {
  civilian: [
    ['Wind shift', 'For this hypothetical fire and my selected point, compare the active wind scenario A with a 90° clockwise wind FROM shift at minute 35. What changes in modeled contact and why?'],
    ['Point exposure', 'Run scenario A and explain the footprint and modeled contact interval at the selected point.'],
    ['Official alerts', 'What active NWS alerts match the ignition region, and how do weather warnings differ from evacuation orders?'],
  ],
  business: [
    ['Business overview', 'Use run_fire_simulation, analyze_business_exposure, and get_business_air_quality to summarize the active modeled footprint, asset exposure at the selected minute, and separate regional PM2.5 and wind context. Explain the limits of each.'],
    ['Asset exposure', 'Run scenario A and use analyze_business_exposure for A. Summarize affected acreage, first contact, and declared value in the footprint at the selected minute.'],
    ['Regional air quality', 'Use get_business_air_quality to report regional PM2.5 and weather wind with valid times. Explain what the readings can tell us about vineyard smoke.'],
  ],
  responder: [
    ['Compare lines', 'Compare the proposed control lines under the active wind shift in scenario A. Which line does the modeled front intersect first, and what are the geometry-only limitations?'],
    ['Scenario A/B', 'Compare the modeled footprints in A and B. Analyze first front intersection for each proposed line in both runs.'],
    ['Current weather', 'Retrieve current Open-Meteo conditions for the ignition region and explain their provenance.'],
  ],
};

export type IntelligenceSession = { question: string; result: AgentResult | null };

export function Intelligence({ input, showPoint, close, mobile, session }: {
  input: Omit<Investigation, 'question' | 'point'>; showPoint?: Investigation['point'];
  close: (session: IntelligenceSession) => void; mobile: boolean; session?: IntelligenceSession;
}) {
  const business = input.mode === 'business';
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState(session?.question ?? (input.intervention ?
    'Use compare_barrier_intervention to explain the computed area difference and whether each line blocked direct spread or was bypassed.' : questions[input.mode][0][1]));
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResult | null>(session?.result ?? null);
  const [health, setHealth] = useState<{ credentialsConfigured: boolean; modelId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const restoreViewport = element && trackDialogViewport(element);
    const check = new AbortController();
    void api<typeof health>('health', undefined, check.signal).then(setHealth).catch(() => {});
    return () => { controller.current?.abort(); check.abort(); restoreViewport?.(); element?.close(); };
  }, []);
  const dismiss = () => close({ question, result });

  async function submit() {
    const call = new AbortController();
    controller.current = call;
    setPending(true);
    setResult(null);
    setStatus(null);
    setProgress(null);
    try {
      const { business: context, ...scenarioInput } = input;
      const reply = await streamAgentRequest('investigate', { ...scenarioInput, question, point: consent ? showPoint : undefined,
        business: context ? { minute: context.minute, assets: consent ? context.assets : undefined } : undefined }, call.signal, setProgress, (data) => data as AgentResult);
      if (!call.signal.aborted) setResult(reply);
    } catch (error) {
      if (!call.signal.aborted) setStatus(error instanceof Error ? error.message : 'The API is unreachable.');
    } finally {
      if (!call.signal.aborted) setPending(false);
    }
  }
  const traceView = result?.toolTrace.length ? <ol className="trace">{result.toolTrace.map((item) => <li key={item.id}>
    {item.outcome === 'success' ? <Check size={16}/> : <CircleAlert size={16}/>}<div><strong>{item.name}</strong>
    <small>{item.outcome === 'success' ? 'Tool output verified' : 'Tool error'} · {item.source} · {item.durationMs} ms</small>
    <small>{timeLabel(item.timestamp)}{item.detail ? ' · ' + item.detail : ''}</small></div></li>)}</ol> : <p className="muted">No tool calls were executed.</p>;
  return <dialog className="intelligence" ref={dialog} onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => { if (mobile && event.target === event.currentTarget) dismiss(); }} aria-labelledby="agent-title">
    <header className="agent-header"><span className="agent-icon"><Sparkles size={23}/></span><div><small>{business ? 'BUSINESS WORKSPACE' : 'SCENARIO INVESTIGATOR'}</small><h2 id="agent-title">{business ? 'Nemotron Business Analyst' : 'Nemotron Intelligence'}</h2></div>
      <button className="icon-button" aria-label="Close intelligence" onClick={dismiss}><X size={20}/></button></header>
    <div className="agent-body">
      <div className="agent-status"><i className={result?.live ? 'live-dot' : ''}/>{result?.live ? 'LIVE NEMOTRON' : health?.credentialsConfigured ? 'CREDENTIALS CONFIGURED' : health ? 'OFFLINE · KEY MISSING' : 'API STATUS UNCONFIRMED'}</div>
      {(result?.modelId || health?.modelId) && <small className="model-name">{result?.modelId ?? health?.modelId}</small>}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field">Investigation question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={700} required rows={4} /></label>
        <div className="agent-presets">{questions[input.mode].map(([label, value]) => <button key={label} type="button" onClick={() => setQuestion(value)}>{label}</button>)}</div>
        {showPoint && <label className="check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/>Share the selected point with this request for geometry calculation. Nemotron receives the calculated result.</label>}
        {!!input.business?.assets?.length && <label className="check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/>
          Share asset outlines and declared values with the EmberWatch server for this investigation. NVIDIA receives calculated evidence and asset aliases.</label>}
        <p className="fine">Questions go to NVIDIA. Keep addresses and emergency contact details out of your question.</p>
        <button className="primary full" disabled={pending || question.trim().length < 3} type="submit">
          {pending ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>}
          {pending ? 'Investigation requested…' : result || status ? 'Run investigation again' : 'Run investigation'}</button>
      </form>
      <div className="agent-output" aria-live="polite">
        {pending && <p className="notice">{progress?.phase === 'tool' ? 'Running ' + progress.name :
          progress?.phase === 'verified' ? (progress.trace.outcome === 'success' ? 'Tool completed · ' : 'Tool returned an error · ') + progress.trace.name :
            progress?.phase === 'model' ? (progress.turn === 1 ? 'Requesting tool selection from Nemotron…' : 'Nemotron is reviewing tool evidence…') :
              'Waiting for the investigation API…'}</p>}
        {status && <p className="notice error"><CircleAlert size={16}/>Unavailable · {status}</p>}
        {result && <>
          {result === session?.result && <p className="fine">Previous investigation</p>}
          <h3>{result.status === 'completed' ? 'Investigation complete' : result.status === 'partial' ? 'Partial investigation' : 'Investigation unavailable'}</h3>
          <p>{result.summary}</p>
          {!!result.findings.length && <ul>{result.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
          {mobile ? <details className="disclosure agent-trace"><summary>Agent activity · {result.toolTrace.length} executed</summary>{traceView}</details>
            : <><h3>Agent activity</h3>{traceView}</>}
          {result.businessExposure && <><h3>Verified asset summary</h3>
            <p className="muted">{result.businessExposure.scenario} · Minute {result.businessExposure.minute}{result.businessExposure.fictionalAssets ? ' · Fictional assets' : ''}</p>
            <ul className="business-exposure-list">{result.businessExposure.rows.map((row) => <li key={row.ref}>
              <strong>{row.name} · {row.ref}{row.fictional ? ' · fictional' : ''}</strong>
              <small>{decimal(row.affectedAcres, 2)} / {decimal(row.areaAcres, 2)} ac · {contactLabel(row.firstContact)}</small>
              <small>{row.declaredValueInFootprint === null ? 'Declared value unavailable' : dollars(row.declaredValueInFootprint) + ' declared in footprint'}</small>
            </li>)}</ul></>}
          {!!result.numericEvidence.length && <><h3>Verified tool evidence</h3><div className="fact-grid">
            {result.numericEvidence.map((fact, i) => <div className="fact" key={fact.toolId + i}><small>{fact.label}</small>
              {fact.value !== null && !fact.detail && <b>{fact.value} <span>{fact.unit}</span></b>}{fact.detail && <small>{fact.detail}</small>}
              <small>{result.toolTrace.find((item) => item.id === fact.toolId)?.source}</small></div>)}
          </div></>}
          {!!result.sources.length && <><h3>Sources</h3><ul>{result.sources.map((source) => <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small className="block">Retrieved {timeLabel(source.retrievedAt)}
              {source.issuedAt ? ' · Source timestamp ' + timeLabel(source.issuedAt) : ''}</small></li>)}</ul></>}
          <div className="notice limits"><FlaskConical size={17}/><div>{result.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}</div></div>
        </>}
      </div>
    </div>
  </dialog>;
}
