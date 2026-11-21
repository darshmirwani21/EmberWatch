import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, FlaskConical, LoaderCircle, Route, Sparkles } from 'lucide-react';
import { firelineLimitations, generationResultSchema, type FirelineCandidate, type FirelineGeneration } from '../shared/firelineContracts';
import type { AgentProgress, Coordinate, Scenario, Trace } from '../shared/contracts';
import { contactLabel, STEP, type Contact, type Snapshot } from '../shared/engine';
import { streamAgentRequest } from './agentStream';
import { candidateModified, firelineStrategies, generateGeometricFirelines, makeFirelineStudy, scenarioIdFor, updateCandidateGeometry } from './engine/firelineCandidates';
import { evaluateFireline, evaluateSensitivity } from './engine/firelineEvaluation';
import { decimal, Disclosure, Section, Slider } from './ui';

export const candidateColors = ['#4ed8ef', '#b596f8', '#ffdc72'];

export function useFirelineStudy(scenario: Scenario, minute: number, snapshots: Snapshot[], active: boolean) {
  const [candidates, setCandidates] = useState<FirelineCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [lookAhead, setLookAhead] = useState(45);
  const [radiusMeters, setRadius] = useState(12000);
  const [refine, setRefine] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<'geometric' | 'nemotron' | 'explain'>();
  const [message, setMessage] = useState<string>();
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [trace, setTrace] = useState<Trace[]>([]);
  const [result, setResult] = useState<FirelineGeneration>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<'geometric' | 'nemotron'>();
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [undo, setUndo] = useState<Record<string, FirelineCandidate>>({});
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const horizon = Math.min(scenario.durationMinutes, minute + lookAhead);
  const request = useMemo(() => ({ scenario, minute, horizon, radiusMeters, refine }), [scenario, minute, horizon, radiusMeters, refine]);
  const study = useMemo(() => active ? makeFirelineStudy(request, snapshots) : undefined, [active, request, snapshots]);
  const metrics = useMemo(() => study ? candidates.map((candidate) => evaluateFireline(candidate, study)) : [], [candidates, study]);
  const sensitivity = useMemo(() => study && showSensitivity ? evaluateSensitivity(candidates, study) : [], [candidates, study, showSensitivity]);
  const selected = candidates.find((candidate) => candidate.id === selectedId);
  const currentStudyId = scenarioIdFor(request);

  function install(lines: FirelineCandidate[]) {
    setCandidates(lines); setSelectedId(lines[0]?.id); setUndo({}); setPreview(true);
  }
  async function generate(source: NonNullable<typeof busy>, confirmed = false) {
    if (!study || (source !== 'explain' && horizon === minute) || busy) return;
    if (source !== 'explain' && !confirmed && candidates.some(candidateModified)) { setConfirmation(source); return; }
    setConfirmation(undefined); setBusy(source); setMessage(undefined); setResult(undefined);
    setWarnings([]); setTrace([]); setProgress(null);
    const call = new AbortController();
    controller.current = call;
    try {
      if (source === 'geometric') {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (call.signal.aborted) return;
        const { candidates: lines, warnings } = generateGeometricFirelines(request, study);
        setWarnings(warnings.slice(firelineLimitations.length));
        if (lines.length) install(lines);
        else setMessage('No candidates fit the selected study boundary and horizon.');
      } else {
        const response = await streamAgentRequest(source === 'explain' ? 'firelines/explain' : 'firelines',
          source === 'explain' ? { study: request, candidates } : request, call.signal, (event) => {
          setProgress(event);
          if (event.phase === 'verified') setTrace((prior) => [...prior, event.trace]);
        }, (data) => generationResultSchema.parse(data));
        setResult(response);
        setTrace(response.toolExecutionSummary);
        if (source !== 'explain' && response.candidates.length && response.modelId) install(response.candidates);
        if (response.status !== 'completed') setMessage(response.narrativeExplanation);
      }
    } catch (error) {
      if (!call.signal.aborted) setMessage(error instanceof Error ? error.message : 'The study could not be completed.');
    } finally {
      if (!call.signal.aborted) setBusy(undefined);
    }
  }
  function edit(candidate: FirelineCandidate, next: FirelineCandidate) {
    setUndo((all) => ({ ...all, [candidate.id]: candidate }));
    setCandidates((all) => all.map((item) => item.id === candidate.id ? next : item));
  }
  function changeGeometry(coordinates: Coordinate[]) {
    if (!selected) return 'Select a candidate to edit.';
    try { edit(selected, updateCandidateGeometry(selected, coordinates)); setMessage(undefined); return null; }
    catch (error) { return error instanceof Error ? error.message : 'Invalid candidate geometry.'; }
  }
  function clear() {
    controller.current?.abort();
    setBusy(undefined); setCandidates([]); setSelectedId(undefined); setResult(undefined); setWarnings([]); setTrace([]);
    setConfirmation(undefined); setPreview(false); setUndo({}); setMessage(undefined); setProgress(null);
  }
  return {
    candidates, selected, select: setSelectedId, clear, horizon, radiusMeters, setRadius, lookAhead, setLookAhead, refine, setRefine,
    alternateAt: study?.shiftMinute, metrics, sensitivity, preview, setPreview, busy, message, trace, result, warnings,
    progress, confirmation, setConfirmation, currentStudyId, generate, showSensitivity, setShowSensitivity, changeGeometry,
    canUndo: Boolean(selected && undo[selected.id]),
    undoEdit: () => {
      if (selected && undo[selected.id]) {
        setCandidates((all) => all.map((item) => item.id === selected.id ? undo[selected.id] : item));
        setUndo(({ [selected.id]: _, ...remaining }) => remaining);
      }
    },
    revert: () => { if (selected) edit(selected, { ...selected, geometry: selected.original }); },
    remove: () => {
      if (!selected) return;
      const remaining = candidates.filter((candidate) => candidate.id !== selected.id);
      setCandidates(remaining); setSelectedId(remaining[0]?.id);
    },
  };
}

function firstContact(contact: Contact | null, overlap: boolean) {
  if (!contact) return overlap ? 'Inside footprint in this window' : 'No sampled contact';
  return contact.from === contact.to ? 'At minute ' + contact.to : contactLabel(contact);
}

export function FirelineIntelligence({ firelines, snapshot, scenario, edit, zoom, save, canSave, view }: {
  firelines: ReturnType<typeof useFirelineStudy>; snapshot: Snapshot; scenario: Scenario;
  edit: () => void; zoom: () => void; save: () => void; canSave: boolean; view?: () => void;
}) {
  const f = firelines;
  const unavailable = f.horizon === snapshot.minute;
  const progress = f.progress;
  return <>
    <Section title="Fireline Intelligence" action={<FlaskConical size={17}/>}>
      <p className="muted">{firelineLimitations[0]}</p>
      <div className="fireline-conditions">
        <span>Minute <b>{snapshot.minute}</b></span><span>Wind <b>{snapshot.activeWind.speedMph} mph FROM {snapshot.activeWind.fromDeg}°</b></span>
        <span>{scenario.shift ? 'Scenario shift at ' + scenario.shift.minute + ' min' : 'Steady scenario wind'}</span><span>Through <b>{f.horizon} min</b></span>
      </div>
      <Slider label="Look ahead" value={f.lookAhead} min={5} max={120} step={5} suffix=" min" change={f.setLookAhead}/>
      <Slider label="Study radius" value={f.radiusMeters / 1000} min={2} max={25} suffix=" km" change={(km) => f.setRadius(km * 1000)}/>
      <label className="check"><input type="checkbox" checked={f.refine} onChange={(event) => f.setRefine(event.target.checked)}/>Include one Nemotron refinement</label>
      <div className="fireline-actions">
        <button disabled={unavailable || Boolean(f.busy)} onClick={() => void f.generate('geometric')}><Route size={16}/>Generate Geometrically</button>
        <button className="fireline-ai" disabled={unavailable || Boolean(f.busy)} onClick={() => void f.generate('nemotron')}><Sparkles size={16}/>Generate with Nemotron</button>
      </div>
      {unavailable && <p className="muted">Move the timeline earlier to generate candidates for a future window.</p>}
      {f.confirmation && <div className="notice edit-confirm"><p>Replace the current candidates, including your edits?</p>
        <div className="button-row"><button onClick={() => f.setConfirmation(undefined)}>Keep edits</button>
          <button onClick={() => void f.generate(f.confirmation!, true)}>Replace candidates</button></div></div>}
      {f.busy && <p className="notice" role="status"><LoaderCircle className="spin" size={16}/>{f.busy === 'geometric' ? 'Computing candidate geometries…' :
        progress?.phase === 'tool' ? 'Running ' + progress.name : 'Nemotron is investigating the study…'}</p>}
      {f.message && <p className="notice error" role="status">{f.message}</p>}
      {f.warnings.map((warning) => <small className="muted" key={warning}>{warning}</small>)}
      {!!f.candidates.length && <label className="check"><input type="checkbox" checked={f.preview} onChange={(event) => f.setPreview(event.target.checked)}/>Show future footprint on map</label>}
      {f.result?.modelId && <small className="muted">{f.result.modelId}</small>}
      {f.result?.status === 'completed' && <p>{f.result.scenarioId !== f.currentStudyId ||
        f.candidates.length !== f.result.candidates.length || f.candidates.some((candidate) => !f.result?.candidates.some((previous) =>
          previous.id === candidate.id && JSON.stringify(previous.geometry) === JSON.stringify(candidate.geometry)))
        ? 'Previous investigation · ' : ''}{f.result.narrativeExplanation}</p>}
      {f.result?.verificationWarning && <p className="notice">{f.result.verificationWarning}</p>}
    </Section>
    {!!f.candidates.length && <Section title="Candidate comparison">
      {f.alternateAt !== undefined && <p className="muted">Alternate wind turns 90° clockwise at minute {f.alternateAt}. Earlier growth is preserved.</p>}
      <div className="fireline-candidate-list">
        {f.candidates.map((candidate, i) => {
          const metric = f.metrics.find((entry) => entry.id === candidate.id);
          return <button key={candidate.id} aria-pressed={candidate.id === f.selected?.id} onClick={() => f.select(candidate.id)}>
            <span className="candidate-swatch" style={{ background: candidateColors[i] }}>{String.fromCharCode(65 + i)}</span>
            <span><strong>{firelineStrategies[candidate.parameters.strategy].label}</strong>
              <small>{candidate.provenance === 'nemotron' ? 'Nemotron' : 'Geometric'}{candidateModified(candidate) ? ' · Edited' : ''}</small>
              {metric && <small>{decimal(metric.lengthMeters, 0)} m line · {decimal(metric.perimeterDistanceMeters, 0)} m from perimeter</small>}
              {metric && <small>Baseline {firstContact(metric.contact, metric.intersectsFootprint)} · Shift {firstContact(metric.alternativeContact, metric.alternativeIntersectsFootprint)}
                {metric.deltaMinutes !== null ? ' · ' + (metric.deltaMinutes > 0 ? '+' : '') + metric.deltaMinutes + ' min' : ''}</small>}
            </span>
          </button>;
        })}
      </div>
      {f.selected && <>
        <small className="muted">{firelineStrategies[f.selected.parameters.strategy].description} Offset {f.selected.parameters.offsetMeters} m · target {f.selected.parameters.targetLengthMeters} m.</small>
        <div className="button-row">
          <button onClick={zoom}><Crosshair size={15}/>Zoom to line</button>{view && <button onClick={view}>View candidates on map</button>}
          <button onClick={edit} disabled={Boolean(f.busy)}>Edit candidate</button>
          <button onClick={f.undoEdit} disabled={Boolean(f.busy) || !f.canUndo}>Undo edit</button>
          <button onClick={f.revert} disabled={Boolean(f.busy) || !candidateModified(f.selected)}>Revert</button>
          <button onClick={save} disabled={Boolean(f.busy) || !canSave}>{canSave ? 'Save as custom line' : 'Custom line limit reached'}</button>
          <button onClick={f.remove} disabled={Boolean(f.busy)}>Delete candidate</button>
        </div>
      </>}
      <label className="check"><input type="checkbox" checked={f.showSensitivity} onChange={(event) => f.setShowSensitivity(event.target.checked)}/>Calculate five-run sensitivity</label>
      <button className="fireline-ai" onClick={() => void f.generate('explain')} disabled={Boolean(f.busy)}><Sparkles size={16}/>Explain current comparison</button>
      {!!f.sensitivity.length && <ul className="fireline-sensitivity">{f.sensitivity.map((row, index) =>
        <li key={row.id}>Candidate {String.fromCharCode(65 + index)} · {row.overlaps}/5 modeled footprints overlap · {row.earliest === null
          ? 'No sampled perimeter intersection' : 'First contact samples ' + row.earliest + '–' + row.latest + ' min (spread ' + row.spread + ' min)'}
          <small>Baseline, −30°, +30°, −20% speed, +20% speed contact samples: {row.outcomes.map(({ contact }) => contact?.to ?? '—').join(' / ')}</small>
        </li>)}</ul>}
      <small className="muted">{firelineLimitations[1]} {firelineLimitations[2]}</small>
    </Section>}
    {f.trace.length > 0 && <Section title="Agent activity"><Disclosure title={f.trace.length + ' executed tool calls'}>
      <ol className="trace">{f.trace.map((entry) => <li key={entry.id}><div>
        <strong>{entry.name}</strong><small>{entry.outcome === 'success' ? 'Computed' : 'Error'} · {entry.durationMs} ms · {entry.source}</small>
        {entry.detail && <small>{entry.detail}</small>}
      </div></li>)}</ol>
    </Disclosure></Section>}
  </>;
}
