import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { bbox, length, lineString } from '@turf/turf';
import { Crosshair, Flame, GitBranch, History, Route, Sparkles, X } from 'lucide-react';
import { type BusinessAsset } from '../shared/businessContracts';
import { indexBusinessExposure, measureBusinessExposure } from '../shared/businessExposure';
import { type AgentProgress, type Coordinate, type Wind } from '../shared/contracts';
import { contactLabel, coordinate, downwind, location, project, STEP } from '../shared/engine';
import { MAX_FIRELINE_STUDY_RADIUS_METERS, type FirelineCandidate } from '../shared/firelineContracts';
import { acres, compareFootprints, matchedHistory, historicalWeatherUrl, historyCases, historyPolygon, historyTime, makeReplayStudy, recordTime, replayCandidate, replayLineContact, seedRadii, type ReplayShape } from '../shared/history';
import { caseIds, historyDataset, type CaseId, type HistoricDataset } from '../shared/historyContracts';
import { type HistoryAgentResult } from '../server/historyAgent';
import { buildHistoricalPlayback, practiceOrigin, practiceSeed, historicalBranchDuration, type PracticeSeed } from '../shared/historicalPlayback';
import { BARRIER_ASSUMPTION, MAX_BARRIERS, type BarrierLine, type InterventionOptions } from '../shared/interventionContracts';
import { historicalInterventionInput } from '../shared/historicalIntervention';
import { interventionComparison, lineOutcome } from '../shared/interventionSimulation';
import { DAY_HORIZON_MINUTES, EXTENDED_PLAYBACK_THRESHOLD_MINUTES, elapsedClock, playbackStride } from '../shared/simulationTime';
import { InterventionHorizonSummary } from './InterventionHorizonSummary';
import { useIntervention } from './useIntervention';
import { SimulationDock } from './SimulationDock';
import { defaultFirelineParameters, firelineStrategies, updateCandidateGeometry, validateCandidateLine } from './engine/firelineCandidates';
import { streamAgentRequest } from './agentStream';
import { type Overlay } from './MapView';
import { MobileMapActions, trackDialogViewport } from './MobileWorkspace';
import { decimal, Disclosure, Section, Slider } from './ui';

const formatContact = (minute: number | null) => minute === null ? 'not reached' : minute === 0 ? 'at branch start' : 'by minute ' + minute;
const observedColor = '#ff7d50';
const baselineColor = '#54cbe9';
const branchColor = '#c59cfa';
const initialPrompt = 'Retrieve the historical fire and weather, run the baseline, branch from this historical timestamp, generate three hypothetical fireline alternatives, evaluate their modeled intersection times, and compare simulated and recorded outcomes where timestamps match.';
type ReplayTool = 'replay' | 'lines' | 'firelines' | 'wind' | 'analysis';
type Props = { active: boolean; initialCase?: CaseId; mobile: boolean; assets: BusinessAsset[]; close: () => void;
  showTool: (tool: ReplayTool) => void; viewMap: () => void };
const emptyRecords: HistoricDataset['records'] = [];
const archiveCache = new Map<CaseId, HistoricDataset>();
type SavedPractice = { seed: PracticeSeed; wind: Wind; duration: number; minute: number;
  options: InterventionOptions; candidates: FirelineCandidate[]; evaluated: boolean };

export function legacyReplay(url: URL) {
  const path = url.pathname.match(/^\/(?:historical-replay|history|replay)(?:\/([^/]+))?\/?$/i);
  const hash = url.hash.match(/^#(?:historical-replay|history|replay)(?:[\/=]([^&/]+))?$/i);
  const replay = url.searchParams.get('replay');
  const historical = url.searchParams.get('historical');
  const workbench = url.searchParams.get('tab') === 'replay' || url.searchParams.get('tab') === 'historical-replay';
  if (!path && !hash && replay === null && historical === null && !workbench) return undefined;
  const requested = [url.searchParams.get('fire'), url.searchParams.get('case'), path?.[1], hash?.[1], replay, historical];
  return caseIds.find((id) => requested.some((value) => value?.toLowerCase() === id)) ?? 'eaton';
}

export function useHistoricalReplay({ active, initialCase, mobile, assets, close, showTool, viewMap }: Props) {
  const [id, setId] = useState<CaseId>(initialCase ?? 'eaton');
  const [dataset, setDataset] = useState<HistoricDataset>();
  const [loadError, setLoadError] = useState(false);
  const [retries, setRetries] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showWind, setShowWind] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [showAssets, setShowAssets] = useState(false);
  const [camera, setCamera] = useState(0);
  const [showBaseline, setShowBaseline] = useState(true);
  const [showBranch, setShowBranch] = useState(true);
  const [showObserved, setShowObserved] = useState(true);
  const [seed, setSeed] = useState<PracticeSeed>();
  const [savedPractices, setSavedPractices] = useState<Partial<Record<CaseId, SavedPractice>>>({});
  const [showModel, setShowModel] = useState(true);
  const [archiveId, setArchiveId] = useState('');
  const [wind, setWind] = useState<Wind>({ fromDeg: 90, speedMph: 20 });
  const [duration, setDuration] = useState(DAY_HORIZON_MINUTES);
  const [minute, setMinute] = useState(60);
  const [edit, setEdit] = useState<string>();
  const [vertex, setVertex] = useState<number>();
  const drawing = edit !== undefined;
  const tapping = edit === 'new' || (drawing && vertex !== undefined);
  const [selected, selectLine] = useState<string>();
  const [draft, setDraft] = useState<Coordinate[]>([]);
  const [barriers, setBarriers] = useState<BarrierLine[]>([]);
  const [previousEdit, setPreviousEdit] = useState<BarrierLine>();
  const [manualWind, setManualWind] = useState(false);
  const [shift, setShift] = useState<InterventionOptions['shift']>();
  const [target, setTarget] = useState<Coordinate>();
  const [placingTarget, setPlacingTarget] = useState(false);
  const [candidates, setCandidates] = useState<FirelineCandidate[]>([]);
  const [evaluated, setEvaluated] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [agentOpen, setAgentOpen] = useState(false);
  const fire = historyCases[id];
  const data = dataset?.id === id ? dataset : undefined;
  const records = data?.records ?? emptyRecords;
  const playback = useMemo(() => data ? buildHistoricalPlayback(data) : undefined, [data]);
  const lastFrame = (playback?.frames.length ?? 1) - 1;
  const current = playback?.frames[frame];
  const ignitionTime = Date.parse(fire.started);
  const reconstructionEnd = useMemo(() => playback?.frames.findIndex((sample) => sample.time === ignitionTime + playback.modelEnd * 60_000) ?? 0,
    [playback, ignitionTime]);
  const record = current?.recorded;
  const context = current?.context;
  const reconstruction = current?.model && current.model.minute > 0 ? current.model : undefined;
  const archive = records.find((entry) => entry.id === archiveId);
  const archived = useMemo(() => record ? historyPolygon(record) : undefined, [record]);
  const reference = useMemo(() => archive ? historyPolygon(archive) : undefined, [archive]);
  const modelWind = useDeferredValue(wind);
  const radii = useMemo(() => active && seed?.record ? seedRadii(fire.ignition, historyPolygon(seed.record)) : undefined, [active, fire, seed]);
  const study = useMemo(() => active && seed && data ? makeReplayStudy(data, seed, modelWind, duration, radii) : undefined, [active, data, seed, modelWind, duration, radii]);
  const elapsed = Math.min(minute, duration);
  const options: InterventionOptions = useMemo(() => ({ barriers, manualWind, shift, location: target }), [barriers, manualWind, shift, target]);
  const runInput = useMemo(() => active && data && seed ? historicalInterventionInput(data, seed, wind, duration, options) : undefined,
    [active, data, seed, wind, duration, options]);
  const [hasRun, setHasRun] = useState(false);
  const run = useIntervention(JSON.stringify([active, id, seed?.at, duration, wind, options]), hasRun ? runInput : undefined);
  const paired = run.result;
  const comparison = paired ? interventionComparison(paired, elapsed) : undefined;
  const finalComparison = useMemo(() => paired && interventionComparison(paired, paired.baseline.at(-1)!.minute), [paired]);
  const modelFitRadius = !seed && showModel && reconstruction ?
    [16_000, 8_000, 4_000].find((radius) => reconstruction.maxRadiusMeters >= radius) : undefined;
  const fit = useMemo<Coordinate[] | undefined>(() => {
    const footprint = reference ?? archived;
    if (!footprint && modelFitRadius) return [0, 90, 180, 270].map((bearing) => project(fire.ignition, bearing, modelFitRadius * 1.75));
    if (!footprint) return undefined;
    const bounds = bbox(footprint);
    return [[bounds[0], bounds[1]], [bounds[2], bounds[3]], coordinate(fire.ignition)];
  }, [reference, archived, fire, camera, modelFitRadius]);
  const baseline = paired?.baseline[elapsed / 5].shape ?? study?.seed;
  const branch = paired?.intervention[elapsed / 5].shape;
  const independentSurvey = seed && data && paired ? matchedHistory(data, seed, elapsed) : undefined;
  const validation = useMemo(() => independentSurvey && baseline && branch ? {
    baseline: compareFootprints(historyPolygon(independentSurvey), baseline), branch: compareFootprints(historyPolygon(independentSurvey), branch),
  } : undefined, [independentSurvey, baseline, branch]);
  const assetOverlap = useMemo(() => {
    if (!active || !showAssets || !assets.length || !(reference ?? archived)) return undefined;
    const frame = { minute: 0, polygon: (reference ?? archived)! };
    return measureBusinessExposure(indexBusinessExposure(assets, []), frame);
  }, [active, showAssets, assets, reference, archived]);
  const modeledAssets = useMemo(() => {
    if (!active || !showAssets || !branch || !assets.length) return undefined;
    return measureBusinessExposure(indexBusinessExposure(assets, []), { minute: elapsed, polygon: branch });
  }, [active, showAssets, assets, elapsed, branch]);
  const crossings = useMemo(() => evaluated && study ? [
    ...candidates.map((candidate) => ({ id: candidate.id, name: firelineStrategies[candidate.parameters.strategy].label, points: candidate.geometry.coordinates })),
  ].map(({ id, name, points }) => ({ id, name, baseline: replayLineContact(study, points, 'baseline'), branch: replayLineContact(study, points, 'branch') })) : [], [evaluated, candidates, study]);

  useEffect(() => {
    if (!active) return;
    const cached = archiveCache.get(id);
    if (cached) { setDataset(cached); setLoadError(false); return; }
    const controller = new AbortController();
    setLoadError(false);
    void fetch('/data/history-' + id + '.json', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Historical records unavailable');
      const verified = historyDataset.parse(await response.json());
      if (verified.id !== id) throw new Error('Case mismatch');
      archiveCache.set(id, verified);
      if (!controller.signal.aborted) setDataset(verified);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [active, id, retries]);

  useEffect(() => {
    const atEnd = seed ? elapsed >= duration : frame >= lastFrame;
    if (!active || !playing || !current || (seed && !paired) || atEnd) {
      if (playing) setPlaying(false);
      return;
    }
    const stride = playbackStride(speed);
    const interval = seed ? 800 * stride : current.newRecord ? 1100 : current.model ? 205 : 60;
    const timer = window.setTimeout(() => {
      if (seed) setMinute((value) => Math.min(duration, value + stride * STEP));
      else setFrame((value) => Math.min(lastFrame, value + 1));
    }, Math.max(16, interval / speed));
    return () => window.clearTimeout(timer);
  }, [active, current, lastFrame, playing, frame, speed, seed, elapsed, duration, paired]);

  function selectCase(next: CaseId) {
    if (next === id) return;
    savePractice();
    setHasRun(false);
    setPreviousEdit(undefined); selectLine(undefined);
    setId(next); setFrame(0); setPlaying(false); setSeed(undefined); setArchiveId(''); setShowModel(true); setShowObserved(true); setCandidates([]); setBarriers([]);
    cancelEdit(); setNotice(undefined); setEvaluated(false); setCamera((value) => value + 1);
  }

  function startBranch() {
    if (!current || seed || playing) return;
    const horizon = historicalBranchDuration(fire.started, current.at);
    setHasRun(false); setPreviousEdit(undefined); setPlaying(false); setSeed(practiceSeed(current)); setMinute(0); setDuration(horizon);
    if (horizon <= EXTENDED_PLAYBACK_THRESHOLD_MINUTES) setSpeed((previous) => Math.min(previous, 4));
    setWind({ speedMph: Math.min(100, context?.speedMph ?? 0), fromDeg: (context?.fromDeg ?? 0) % 360 });
    cancelEdit(); setCandidates([]); setBarriers([]); setManualWind(false); setShift(undefined); setTarget(undefined); setEvaluated(false); setNotice(undefined);
    selectLine(undefined);
    setShowBranch(true); setShowBaseline(true); setShowLines(true); showTool('lines');
  }

  function savePractice() {
    if (seed) setSavedPractices((saved) => ({ ...saved, [id]: { seed, wind, duration, minute: elapsed, options, candidates, evaluated } }));
  }
  function returnToReplay() { savePractice(); setHasRun(false); setPlaying(false); setSeed(undefined); cancelEdit(); showTool('replay'); }
  function resumePractice() {
    const saved = savedPractices[id];
    const index = playback?.frames.findIndex((item) => item.at === saved?.seed.at) ?? -1;
    if (!saved || index < 0) return;
    setPlaying(false); setFrame(index); setSeed(saved.seed); setWind(saved.wind); setDuration(saved.duration); setMinute(saved.minute);
    if (saved.duration <= EXTENDED_PLAYBACK_THRESHOLD_MINUTES) setSpeed((previous) => Math.min(previous, 4));
    setBarriers(saved.options.barriers); setManualWind(saved.options.manualWind); setShift(saved.options.shift); setTarget(saved.options.location); setCandidates(saved.candidates); setEvaluated(saved.evaluated); setShowLines(true); setShowBranch(true);
    cancelEdit(); showTool('lines');
  }
  function cancelEdit() { setPlacingTarget(false); setEdit(undefined); setVertex(undefined); setDraft([]); setNotice(undefined); }
  function editLine(id: string) {
    const points = barriers.find((item) => item.id === id)?.geometry.coordinates ?? candidates.find((item) => item.id === id)?.geometry.coordinates;
    if (id !== 'new' && !points) return;
    setEdit(id); setDraft(points ?? []); setVertex(undefined); setNotice(undefined); setShowLines(true);
    if (id === 'new') viewMap();
  }
  function pick(position: Coordinate) {
    if (Math.abs(position[1]) > 84) return;
    if (placingTarget) { setTarget(position); setPlacingTarget(false); showTool('lines'); return; }
    if (!edit) return;
    if (edit === 'new') {
      setDraft((points) => points.length < 32 && !points.some((v) => v[0] === position[0] && v[1] === position[1]) ? [...points, position] : points);
    } else if (vertex !== undefined) {
      setDraft((points) => points.map((point, index) => index === vertex ? position : point));
      setVertex(undefined);
    }
    setNotice(undefined);
  }
  function finishLine() {
    try {
      if (edit === 'new') {
        const geometry = validateCandidateLine(draft, fire.ignition, MAX_FIRELINE_STUDY_RADIUS_METERS);
        const id = globalThis.crypto?.randomUUID?.() ?? 'line-' + Date.now().toString(36);
        setBarriers((items) => [...items, { id, readyMinute: 0, geometry }]); selectLine(id);
      } else if (barriers.some((item) => item.id === edit)) {
        const geometry = validateCandidateLine(draft, fire.ignition, MAX_FIRELINE_STUDY_RADIUS_METERS);
        setPreviousEdit(barriers.find((item) => item.id === edit));
        setBarriers((items) => items.map((item) => item.id === edit ? { ...item, geometry } : item));
      } else {
        const candidate = candidates.find((item) => item.id === edit);
        if (!candidate) return;
        const updated = updateCandidateGeometry(candidate, draft);
        setCandidates((items) => items.map((item) => item.id === updated.id ? updated : item));
      }
      setEvaluated(true); cancelEdit(); if (mobile) showTool('lines');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Invalid line.'); }
  }

  function runIntervention() {
    if (!runInput || !barriers.length || run.running) return;
    setPlaying(false); setMinute(0); setShowBaseline(true); setShowBranch(true);
    if (hasRun) run.start(runInput);
    else setHasRun(true);
    viewMap();
  }

  function generate() {
    if (!study) return;
    try { setCandidates(defaultFirelineParameters.map((params) => replayCandidate(study, params))); setEvaluated(true); setShowLines(true); setNotice(undefined); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Candidates unavailable for this perimeter.'); }
  }
  const shape = (data: ReplayShape, kind: string, color: string): Overlay => ({ ...data, properties: { kind, color } });
  const lineShape = (coordinates: Coordinate[], kind: string, color: string): Overlay =>
    ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { kind, color } });
  const overlays: Overlay[] = [{ type: 'Feature', geometry: { type: 'Point', coordinates: coordinate(fire.ignition) }, properties: { kind: 'ignition', color: observedColor } }];
  if (archived && showObserved) overlays.push(shape(archived, 'observed', observedColor));
  if (reference && (archive?.id !== record?.id || !showObserved)) overlays.push(shape(reference, 'comparison', '#e8bc78'));
  if (!seed && reconstruction && showModel) overlays.push(shape(reconstruction.polygon, 'fire', '#ff6038'));
  if (baseline && showBaseline) overlays.push(shape(baseline, 'history-baseline', baselineColor));
  if (branch && showBranch) overlays.push(shape(branch, 'history-branch', branchColor));
  if (seed && showLines) for (const line of barriers) overlays.push({ ...lineShape(line.geometry.coordinates, 'line', '#fbd482'), properties: { kind: 'line', color: '#fbd482', selected: line.id === selected, soft: Boolean(selected && selected !== line.id) } });
  if (seed && target) overlays.push({ type: 'Feature', geometry: { type: 'Point', coordinates: target }, properties: { kind: 'point', color: '#9eeaff' } });
  if (draft.length >= 2) overlays.push(lineShape(draft, 'draft', '#fff7d8'));
  draft.forEach((position, index) => overlays.push({ type: 'Feature', geometry: { type: 'Point', coordinates: position }, properties: { kind: 'vertex', color: index === vertex ? '#ff7d50' : '#fff7d8' } }));
  if (seed && showLines) candidates.forEach((candidate, index) => {
    if (barriers.some((line) => line.id === candidate.id)) return;
    const kind = 'candidate-' + candidate.provenance;
    const color = ['#fbd482', '#77e1b7', '#e6a1ea'][index];
    overlays.push({ ...lineShape(candidate.geometry.coordinates, kind, color), properties: { kind, color, candidateId: candidate.id, selected: candidate.id === selected } });
  });
  for (const row of assetOverlap?.rows ?? []) {
    overlays.push(shape({ type: 'Feature', geometry: row.asset.geometry, properties: {} }, 'asset', '#25867b'));
    if (row.clip && showObserved) overlays.push(shape(row.clip, 'asset-overlap', '#fac257'));
  }
  const legend = <div className="legend">{archived && showObserved && <span><i style={{ background: observedColor }}/>Historical perimeter</span>}
    {reference && <span><i style={{ background: '#e8bc78' }}/>Archive reference</span>}
    {!seed && reconstruction && showModel && <span><i style={{ background: '#ff6038' }}/>Modeled Historical Reconstruction</span>}
    {seed && showBaseline && <span><i style={{ background: baselineColor }}/>Modeled baseline</span>}
    {seed && showBranch && <span><i style={{ background: branchColor }}/>Hypothetical branch</span>}
    {assetOverlap && <span><i style={{ background: '#fac257' }}/>Historical asset overlap</span>}</div>;
  const layers = [
    { key: 'record', label: 'Historical perimeter', enabled: showObserved, toggle: () => setShowObserved(!showObserved) },
    ...(!seed ? [{ key: 'reconstruction', label: 'Modeled Historical Reconstruction', enabled: showModel, toggle: () => setShowModel(!showModel) }] : []),
    { key: 'wind', label: 'Wind direction', enabled: showWind, toggle: () => setShowWind(!showWind) },
    ...(seed ? [
      { key: 'training-lines', label: 'Training lines', enabled: showLines, toggle: () => setShowLines(!showLines) },
      { key: 'baseline', label: 'Modeled baseline', enabled: showBaseline, toggle: () => setShowBaseline(!showBaseline) },
      { key: 'branch', label: 'Hypothetical branch', enabled: showBranch, toggle: () => setShowBranch(!showBranch) },
    ] : []),
  ];
  const mapWind = showWind ? study ? (runInput?.weather[elapsed / 5].wind ?? modelWind) : context && { speedMph: context.speedMph, fromDeg: context.fromDeg % 360 } : undefined;

  if (mapWind && mapWind.speedMph > 0) {
    const direction = downwind(mapWind);
    const [start, end] = [140, Math.min(500, 225 + mapWind.speedMph * 7)].map((meters) => project(fire.ignition, direction, meters));
    overlays.push(lineShape([start, end], 'wind', '#38c6e8'));
    overlays.push(lineShape([project(location(end), direction + 160, 70), end, project(location(end), direction - 160, 70)], 'wind', '#38c6e8'));
  }
  const stamp = seed ? new Date(Date.parse(seed.at) + elapsed * 60_000).toISOString() : current?.at ?? fire.started;
  const dataLabel = seed ? 'Practice intervention' : archived && showObserved ? current?.newRecord ? 'Recorded perimeter' : 'Last recorded perimeter' :
    current?.model && showModel ? 'Modeled Historical Reconstruction' : 'Awaiting recorded perimeter';
  const clockWind = seed ? runInput?.weather[elapsed / 5].wind : context && { speedMph: context.speedMph, fromDeg: context.fromDeg % 360 };
  const scrub = (value: number) => { setPlaying(false); if (seed) setMinute(value); else setFrame(value); };
  const restart = () => { scrub(0); if (!seed) { setArchiveId(''); setCamera((value) => value + 1); } };
  function openAgent() { if (current) { viewMap(); setAgentOpen(true); } }
  const clockElapsed = seed ? elapsed : Math.floor(((current?.time ?? ignitionTime) - ignitionTime) / 60_000);
  const timeline = <SimulationDock mobile={mobile} historical={{ value: seed ? elapsed : frame, label: historyTime(stamp) + ' · ' + elapsedClock(clockElapsed),
    fastPlayback: !seed || duration > EXTENDED_PLAYBACK_THRESHOLD_MINUTES,
    step: seed ? 5 : 1, wind: clockWind, humidity: seed ? runInput?.weather[elapsed / 5].humidity : context?.humidity,
    actions: <><span className="replay-data-label" role="status">{run.error ?? (run.running ? 'Computing baseline and intervention…' : paired ? 'Intervention ready' : dataLabel)}</span>
      {!mobile && <button aria-label="Replay controls" onClick={() => showTool('replay')}>Replay controls</button>}
      <button disabled={!seed && (playing || !current)} onClick={seed ? returnToReplay : startBranch}><GitBranch size={15}/>
        {seed ? 'Return to replay' : 'Practice Intervention'}</button></> }}
    duration={seed ? paired ? duration : 0 : lastFrame} playing={playing} speed={speed} setSpeed={setSpeed} markers={[]}
    metrics={[fire.title, seed ? run.running ? 'Computing paired spread…' : paired ? elapsed + ' min into branch' : 'Add a line and run' : reconstruction && showModel ? decimal(reconstruction.acres) + ' modeled ac' : archived && showObserved ? decimal(acres(archived)) + ' mapped ac' : 'Ignition timeline']}
    toggle={() => { if (!playing && (seed ? elapsed >= duration : frame >= lastFrame)) restart(); setPlaying(!playing); }}
    restart={restart} scrub={scrub} showMetrics={() => showTool(seed ? 'analysis' : 'replay')} analyze={openAgent}/>;

  const replayPanel = <Section title={mobile ? undefined : 'Historical Replay'} action={<History size={17}/>}>
    <label className="field">Historical fire<select value={id} onChange={(event) => selectCase(event.target.value as CaseId)}>
      {caseIds.map((key) => <option key={key} value={key}>{historyCases[key].title} · {historyCases[key].started.slice(0, 4)}</option>)}
    </select></label>
    <div className="button-row"><button onClick={viewMap}>View replay map</button><button onClick={close}>Return to hypothetical scenario</button></div>
    <p className="muted">{dataLabel}</p>
    {!seed && reconstructionEnd > 0 && <button onClick={() => { setShowModel(true); scrub(reconstructionEnd); viewMap(); }}>
      {playback?.modelLimitedByWeather ? 'Jump to last modeled sample' : 'Jump to modeled hour 24'}</button>}
    {!seed && savedPractices[id] && <button onClick={resumePractice}>Resume saved practice</button>}
    {seed && <div className="button-row"><button onClick={() => showTool('wind')}>Branch wind</button>
      <button onClick={() => showTool('firelines')}>Open branch firelines</button><button onClick={() => showTool('analysis')}>Branch analysis</button></div>}
    <div className="history-context">
      {loadError && <p role="alert">The case records couldn’t be loaded. <button onClick={() => setRetries((value) => value + 1)}>Retry</button></p>}
      <section className="history-section">
        <h3><Flame size={16}/>Historical ignition</h3>
        <p>{historyTime(fire.started)} · {fire.place}</p>
        <p className="muted">Approximate WFIGS origin {fire.ignition.lat.toFixed(3)}°, {fire.ignition.lng.toFixed(3)}°. The ignition marker represents the reported origin area.</p>
        <p className="history-links"><a href={fire.incident} target="_blank" rel="noreferrer">CAL FIRE incident</a>
          <a href="https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0" target="_blank" rel="noreferrer">NIFC WFIGS</a></p>
      </section>
      <section className="history-section">
        <h3>Archived weather</h3>
        {context ? <><div className="history-numbers"><div><small>10 m wind FROM</small><strong>{decimal(context.speedMph)} mph · {context.fromDeg % 360}°</strong></div>
          <div><small>Temperature / humidity</small><strong>{decimal(context.temperatureF)}°F · {context.humidity}%</strong></div></div>
          <p className="muted">{historyTime(context.at)} · Hourly ERA5 grid reanalysis.</p></> : <p className="muted">Historical weather unavailable for this hour.</p>}
        <a href={historicalWeatherUrl} target="_blank" rel="noreferrer">Open-Meteo / ECMWF ERA5</a>
      </section>
      <section className="history-section">
        <h3>Recorded outlines</h3>
        <p className="muted">{playback?.timed.length ? playback.timed.length + ' time-stamped survey' + (playback.timed.length === 1 ? '' : 's') + '. The last recorded outline stays on the map until a newer survey is available.' :
          'No time-stamped perimeter progression is available for this fire.'}</p>
        {playback?.timed.length ? <label className="field">Jump to recorded survey<select disabled={Boolean(seed)} value={record?.id ?? ''} onChange={(event) => {
          const index = playback.frames.findIndex((item) => item.newRecord?.id === event.target.value);
          if (index >= 0) { setShowObserved(true); scrub(index); } else restart();
        }}><option value="">Ignition</option>{playback.timed.map((entry) => <option key={entry.id} value={entry.id}>{recordTime(entry)}</option>)}</select></label> : null}
        {record && archived && <p>{recordTime(record)} · {decimal(acres(archived))} mapped ac · <a href={record.url} target="_blank" rel="noreferrer">{record.source}</a></p>}
        {records.length > 0 && <label className="field">Archive outline overlay<select value={archiveId} onChange={(event) => setArchiveId(event.target.value)}>
          <option value="">Off</option>{records.map((item) => <option key={item.id} value={item.id}>{item.label} · {recordTime(item)}</option>)}</select></label>}
        {archive && <p><a href={archive.url} target="_blank" rel="noreferrer">{archive.source}</a> · {recordTime(archive)}</p>}
        {id === 'eaton' && <a href="https://svs.gsfc.nasa.gov/5558" target="_blank" rel="noreferrer">NASA satellite progression</a>}
      </section>
    </div>
    <div className="history-layer-controls">{layers.map((layer) => <label key={layer.key} className="check">
      <input type="checkbox" checked={layer.enabled} onChange={layer.toggle}/>{layer.label}
    </label>)}</div>
    <p className="muted">Modeled reconstruction uses hourly wind and humidity for up to 24 hours after ignition and assumes 65% fuel dryness. {playback?.modelLimitedByWeather ? 'A gap in archived weather limits this run. ' : ''}Recorded outlines appear at their original survey times.</p>
  </Section>;

  const branchEndTime = seed && historyTime(new Date(Date.parse(seed.at) + duration * 60_000).toISOString());
  const branchHorizon = seed ? historicalBranchDuration(fire.started, seed.at) : DAY_HORIZON_MINUTES;
  const branchHint = <p className="muted">Pause Historical Replay and choose <strong>Practice Intervention</strong> to start training.</p>;
  const windPanel = <Section title="Intervention wind">
    {seed ? <>
      <p className="muted">Branch from {historyTime(seed.at)}. Start state: {practiceOrigin(seed)}{seed.record && seed.record.at !== seed.at ? ' · ' + recordTime(seed.record) : ''}.</p>
      <p className="muted">Both trajectories use the same hourly archived conditions unless wind is overridden. Missing hours retain the last available sample. With no sample the model assumes calm and 35% humidity.</p>
      <label className="check"><input type="checkbox" checked={manualWind} onChange={(event) => setManualWind(event.target.checked)}/>Override archived wind in both runs</label>
      <Slider label="Hypothetical wind FROM" value={wind.fromDeg} max={359} suffix="°" change={(fromDeg) => { setManualWind(true); setWind({ ...wind, fromDeg }); }}/>
      <Slider label="Hypothetical wind speed" value={wind.speedMph} max={100} suffix=" mph" change={(speedMph) => { setManualWind(true); setWind({ ...wind, speedMph }); }}/>
      <label className="check"><input type="checkbox" checked={Boolean(shift)} onChange={(event) => setShift(event.target.checked ? { minute: Math.min(30, duration), wind: { ...wind, fromDeg: (wind.fromDeg + 90) % 360 } } : undefined)}/>Apply wind shift to both runs</label>
      {shift && <><Slider label="Shift minute" value={shift.minute} max={duration} step={5} suffix=" min" change={(minute) => setShift({ ...shift, minute })}/>
        <Slider label="Shifted wind FROM" value={shift.wind.fromDeg} max={359} suffix="°" change={(fromDeg) => setShift({ ...shift, wind: { ...shift.wind, fromDeg } })}/></>}
      <Slider label="Experiment horizon" value={duration} min={Math.min(30, branchHorizon)} max={branchHorizon} step={STEP} suffix=" min" change={(value) => {
        setDuration(value); setMinute((previous) => Math.min(previous, value));
        setShift((previous) => previous && { ...previous, minute: Math.min(previous.minute, value) });
        if (value <= EXTENDED_PLAYBACK_THRESHOLD_MINUTES) setSpeed((previous) => Math.min(previous, 4));
      }}/>
      <p className="muted">Both modeled runs end at {branchEndTime}.</p>
      {paired && <Slider label="Branch playback minute" value={elapsed} max={duration} step={5} suffix=" min" change={setMinute}/>}
      <button onClick={viewMap}>View updated map</button>
      {barriers.length > 0 && <button className="primary" disabled={run.running} onClick={runIntervention}>Run Intervention</button>}
    </> : branchHint}
  </Section>;

  const selectedCandidate = candidates.find((item) => item.id === selected);
  const selectedBarrier = barriers.find((item) => item.id === selected);
  const selectedPoints = selectedBarrier?.geometry.coordinates ?? selectedCandidate?.geometry.coordinates;
  const draftLength = draft.length >= 2 ? length(lineString(draft), { units: 'meters' }) : 0;
  const lineControls = <Section title="Intervention firelines" action={<Route size={17}/>}>
    {seed ? <>
      <p className="muted">Training geometry from {historyTime(seed.at)}.</p>
      <button className="primary full" disabled={!barriers.length || run.running} onClick={runIntervention}>{run.running ? 'Computing intervention…' : 'Run Intervention'}</button>
      {!barriers.length && <p className="muted">Draw a line or use a generated candidate as a barrier.</p>}
      {run.error && <p role="alert">{run.error}</p>}
      {run.stale && <p className="muted">Updating the comparison with the current inputs.</p>}
      <div className="button-row"><button onClick={() => showTool('analysis')}>Review baseline comparison</button>
        <button onClick={openAgent}>Ask Nemotron</button></div>
      {edit === 'new' ? <button onClick={viewMap}>Resume drawing</button> : <button disabled={barriers.length >= MAX_BARRIERS} onClick={() => editLine('new')}>Draw a line</button>}
      {barriers.length >= MAX_BARRIERS && <p className="muted">Remove a line to add another. This study supports eight barriers.</p>}
      {barriers.map((line, i) => <button key={line.id} aria-pressed={selected === line.id} onClick={() => selectLine(line.id)}>{i === 0 ? 'Drawn line' : 'Drawn line ' + (i + 1)}</button>)}
      {candidates.map((item) => <button key={item.id} aria-pressed={item.id === selected} onClick={() => selectLine(item.id)}>
        {firelineStrategies[item.parameters.strategy].label}
      </button>)}
      {selectedPoints && !drawing && <>
        <p className="muted">Length {decimal(length(lineString(selectedPoints), { units: 'meters' }))} m</p>
        <button onClick={() => editLine(selected!)}>Edit vertices</button>
        {selectedCandidate && !selectedBarrier && <button disabled={barriers.length >= MAX_BARRIERS} onClick={() => {
          setBarriers((items) => [...items, { id: selectedCandidate.id, readyMinute: 0, geometry: selectedCandidate.geometry }]);
        }}>Use as barrier</button>}
        {selectedBarrier && <Slider label="Barrier ready after" value={selectedBarrier.readyMinute} max={DAY_HORIZON_MINUTES} step={5} suffix=" min" change={(readyMinute) =>
          setBarriers((items) => items.map((item) => item.id === selected ? { ...item, readyMinute } : item))}/>}
        {selectedBarrier && previousEdit?.id === selectedBarrier.id && <button onClick={() => {
          setBarriers((items) => items.map((item) => item.id === selectedBarrier.id ? previousEdit : item)); setPreviousEdit(undefined);
        }}>Undo last edit</button>}
        {selectedBarrier && <button onClick={() => { setPreviousEdit(undefined); setBarriers((items) => items.filter((item) => item.id !== selected)); selectLine(undefined); }}>Remove line</button>}
        {selectedCandidate && <button onClick={() => {
          setCandidates((items) => items.map((item) => item.id === selected ? { ...item, geometry: item.original } : item));
          setBarriers((items) => items.map((item) => item.id === selected ? { ...item, geometry: selectedCandidate.original } : item));
        }}>Restore original line</button>}
      </>}
      {edit && edit !== 'new' && <div className="button-row">{draft.map((_, index) => <button key={index}
        aria-pressed={vertex === index} onClick={() => { setVertex(index); viewMap(); }}>Vertex {index + 1}</button>)}</div>}
      {drawing && <div className="button-row">
        {edit === 'new' && <button disabled={!draft.length} onClick={() => setDraft((items) => items.slice(0, -1))}>Undo</button>}
        <button onClick={cancelEdit}>Cancel</button>
        <button disabled={draft.length < 2} onClick={finishLine}>Finish line</button>
      </div>}
      <div className="button-row"><button onClick={() => { cancelEdit(); setPlacingTarget(true); viewMap(); }}>Select comparison location</button>
        {target && <button onClick={() => setTarget(undefined)}>Clear comparison location</button>}</div>
      {placingTarget && !mobile && <p>Click the map to select the comparison location.</p>}
      {notice && <p role="alert" className="notice error">{notice}</p>}
      {crossings.length > 0 && <><p className="muted">Candidate screening in the radial preview</p><ul className="business-exposure-list">{crossings.map((hit) => <li key={hit.id}><strong>{hit.name}</strong>
        <small>Baseline · {contactLabel(hit.baseline)} / Branch · {contactLabel(hit.branch)}</small></li>)}</ul></>}
    </> : <>{branchHint}<button onClick={startBranch} disabled={!current || playing}>Start Practice Intervention</button></>}
  </Section>;

  const intelligencePanel = <><Section title="Fireline Intelligence" action={<Sparkles size={17}/>}>
    {seed ? <div className="button-row"><button onClick={generate}>Generate lines</button></div> : branchHint}
    {notice && !drawing && <p role="alert" className="notice error">{notice}</p>}
  </Section>{seed && lineControls}</>;

  const analysisPanel = <><Section title="Intervention analysis">
    {study && seed ? <>
      <p className="muted">{BARRIER_ASSUMPTION}</p>
      {run.error ? <p role="alert">Intervention results could not be calculated. {run.error}</p> : run.running ? <p role="status">Computing baseline and intervention…</p> :
        !comparison && <p className="muted">Run Intervention from Fireline tools to compare both trajectories.</p>}
      {comparison && <><p>{elapsed === duration ? 'Final sample' : 'Playback sample'} · {historyTime(stamp)}</p>
        <p>Difference in modeled burned area under idealized barrier assumptions: <strong>{decimal(comparison.differenceAcres, 2)} ac</strong></p>
        <p>{comparison.activeBarrierCount} active {comparison.activeBarrierCount === 1 ? 'barrier' : 'barriers'} · {decimal(comparison.activeLengthMeters)} m · {comparison.cellMeters} m grid cells{comparison.cellMeters > 75 ? ' (coarsened to cover the study region)' : ''}{comparison.localCellMeters < comparison.cellMeters && ' · ' + decimal(comparison.localCellMeters, 1) + ' m near lines'}.</p>
        {comparison.lineContacts.map((line, index) => <p key={line.id}><strong>Line {index + 1}</strong> · {decimal(line.lengthMeters, 1)} m · {lineOutcome(line, elapsed)}. First modeled contact · baseline {formatContact(line.baseline)} · intervention {formatContact(line.intervention)}.</p>)}
        {target && <p>Selected location · baseline {formatContact(comparison.baselineContact)} · intervention {formatContact(comparison.interventionContact)}.
          {comparison.contactDelayMinutes !== null ? ' Change: ' + comparison.contactDelayMinutes + ' min.' : ''}</p>}
      </>}
      {comparison && <div className="history-numbers"><div><small>Modeled baseline</small><strong>{decimal(comparison.baselineAcres)} ac</strong></div>
              <div><small>Barrier intervention</small><strong>{decimal(comparison.interventionAcres)} ac</strong></div>
              <div><small>Model-to-model IoU</small><strong>{decimal(comparison.iou * 100, 2)}%</strong></div>
              <div><small>Modeled area reduction</small><strong>{decimal(comparison.reductionPercent, 2)}%</strong></div></div>}
            {finalComparison && elapsed !== duration && branchEndTime && <InterventionHorizonSummary comparison={finalComparison} end={branchEndTime}/>}
            <Disclosure title="Historical validation and assumptions">
              {validation && independentSurvey ? <p>Matched at {recordTime(independentSurvey)}. Observed {decimal(validation.branch.observed)} ac.
                Baseline IoU {decimal(validation.baseline.iou * 100, 1)}% · intervention IoU {decimal(validation.branch.iou * 100, 1)}%.</p> :
                <p>No independent time-stamped perimeter matches this modeled sample. Historical overlap is unavailable.</p>}
              {seed.at && <p>Modeled sample time {historyTime(new Date(Date.parse(seed.at) + elapsed * 60000).toISOString())}.</p>}
              <p>Both numerical runs start from the same source footprint. Spread travels between four neighboring grid cells, and a completed line blocks intersecting travel paths. Open ends can be bypassed. Boundaries and contact are sampled every five minutes and are approximate at the grid scale. The seed outline is retained exactly. Fuel dryness is assumed at 65%.</p>
            </Disclosure>
    </> : branchHint}
  </Section>
    <Section title="Registered asset overlap">
      <label className="check"><input type="checkbox" checked={showAssets} onChange={(event) => setShowAssets(event.target.checked)}/>Check assets registered in Business</label>
      {showAssets && <>{assetOverlap?.rows.length ? <><div className="history-numbers">
        <div><small>Inside recorded outline</small><strong>{decimal(assetOverlap.affectedAcres, 2)} ac</strong></div>
        {modeledAssets && <div><small>Inside branch · minute {elapsed}</small><strong>{decimal(modeledAssets.affectedAcres, 2)} ac</strong></div>}
      </div><ul className="business-exposure-list">{assetOverlap.rows.map((row, i) => <li key={row.asset.id}><strong>{row.asset.name}</strong>
        <small>{decimal(row.affectedAcres, 2)} ac recorded{modeledAssets ? ' · ' + decimal(modeledAssets.rows[i].affectedAcres, 2) + ' ac modeled' : ''}</small></li>)}</ul></>
        : <p className="muted">Register asset polygons in Business to check this footprint.</p>}
        <p className="muted">Overlap measures area. Damage and financial loss require separate evidence.</p></>}
    </Section></>;

  return {
    title: fire.title + ' · ' + fire.started.slice(0, 4),
    status: seed ? 'PRACTICE' : archived && showObserved ? current?.newRecord ? 'RECORDED' : 'LAST RECORDED' : current?.model && showModel ? 'RECONSTRUCTED' : 'IGNITION / RECORD GAP',
    point: fire.ignition, camera, fit, overlays, layers, legend,
    recenter: () => setCamera((value) => value + 1), pick, selectCandidate: (id: string) => { selectLine(id); showTool('firelines'); }, drawing: drawing || placingTarget, tapping: tapping || placingTarget, cancelEdit,
    mapMode: placingTarget ? 'Select comparison location' : drawing ? edit === 'new' ? 'Draw training line' : 'Edit training line' : 'Explore',
    wind: mapWind ? { from: mapWind.fromDeg, toward: downwind(mapWind), mph: mapWind.speedMph } : undefined,
    summaryPanel: <Section title={fire.title} action={<History size={17}/>}>
      <p className="muted">{current ? historyTime(current.at) : fire.place}</p>
      {archived && <p>{decimal(acres(archived))} mapped acres</p>}
      <button onClick={() => showTool('replay')}>Open Historical Replay</button>
    </Section>,
    panels: { replay: replayPanel, lines: lineControls, firelines: intelligencePanel, wind: windPanel, analysis: analysisPanel }, timeline,
    mapActions: placingTarget ? <div className="fireline-drawing-toolbar"><MobileMapActions label="Comparison location" detail="Tap the map to choose a location." cancel={cancelEdit}/></div> : drawing && <div className="fireline-drawing-toolbar"><MobileMapActions label={edit === 'new' ? 'Drawing fireline' : 'Editing fireline'}
      detail={notice ?? (edit === 'new' ? 'Tap the map to place fireline points. ' + draft.length + ' vertices · ' + decimal(draftLength) + ' m' : vertex === undefined ? 'Choose a vertex first' : 'Tap the new position')}
      cancel={() => { cancelEdit(); showTool('lines'); }} vertices={edit !== 'new' ? () => { setVertex(undefined); showTool('lines'); } : undefined}
      undo={edit === 'new' && draft.length ? () => setDraft((items) => items.slice(0, -1)) : undefined}
      finish={finishLine} canFinish={draft.length >= 2} finishLabel="Finish line"/></div>,
    hasBranch: Boolean(seed),
    openAgent,
    agent: active && agentOpen && current && <HistoryAgent input={{ caseId: id, replayAt: seed?.at ?? current.at, practicing: Boolean(seed), wind, duration, minute: seed ? elapsed : undefined, intervention: seed ? options : undefined,
      lines: seed ? candidates.map((item) => item.geometry.coordinates) : undefined }}
      close={() => setAgentOpen(false)} apply={(result) => { setCandidates(result); setShowLines(true); setEvaluated(true); setAgentOpen(false); viewMap(); }}/>,
  };
}

function HistoryAgent({ input, close, apply }: {
  input: Omit<import('../shared/historyContracts').ReplayRequest, 'question'>;
  close: () => void; apply: (result: FirelineCandidate[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState(input.intervention?.barriers.length ? 'Compare the historical context with the two modeled grid runs. Explain how the idealized barriers affect burned area and selected-location contact at the selected time.' : input.practicing ? initialPrompt : 'Use the archived historical weather and modeled reconstruction tools to show how wind direction, speed, and humidity changed near ignition. Distinguish modeled growth from recorded perimeters.');
  const [workflow, setWorkflow] = useState<import('../shared/historyContracts').ReplayRequest['workflow']>(input.intervention?.barriers.length ? 'barrier' : input.practicing ? 'alternatives' : 'replay');
  const [progress, setProgress] = useState<AgentProgress>();
  const [result, setResult] = useState<HistoryAgentResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const cleanup = trackDialogViewport(element);
    return () => { controller.current?.abort(); cleanup(); element.close(); };
  }, []);

  async function run() {
    const abort = new AbortController();
    controller.current = abort;
    setPending(true); setError(undefined); setResult(undefined); setProgress(undefined);
    try {
      const reply = await streamAgentRequest('history', { ...input, question, workflow }, abort.signal, setProgress, (value) => value as HistoryAgentResult);
      if (!abort.signal.aborted) setResult(reply);
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Investigation unavailable.');
    } finally { if (!abort.signal.aborted) setPending(false); }
  }
  return <dialog className="intelligence history-agent" ref={dialog} aria-labelledby="history-agent-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="agent-header"><span className="agent-icon"><Sparkles size={20}/></span>
      <div><small>HISTORICAL REPLAY</small><h2 id="history-agent-title">Nemotron Replay Analyst</h2></div>
      <button className="icon-button" onClick={close} aria-label="Close replay analyst"><X size={20}/></button></header>
    <div className="agent-body"><form onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <label className="field">Investigation question<textarea value={question} maxLength={700} rows={4} onChange={(event) => { setQuestion(event.target.value); setWorkflow(undefined); }}/></label>
      {input.practicing && <button type="button" onClick={() => { setWorkflow('refine'); setQuestion(initialPrompt + ' Refine the three alternatives after evaluating them, then verify the revised crossings.'); }}>Refine alternatives</button>}
      <button className="primary full" disabled={pending || question.trim().length < 3}>Run replay investigation</button>
    </form>
      {pending && <p role="status">{progress?.phase === 'tool' ? 'Running ' + progress.name : progress?.phase === 'verified' ? 'Tool returned · ' + progress.trace.name : 'Requesting Nemotron…'}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && <div className="agent-output">
        <p className="muted">{result.live ? result.model + ' · live · ' : ''}{result.status}</p><p>{result.detail}</p>
        <Disclosure title={'Agent activity · ' + result.trace.length + ' executed'}><ol className="trace">{result.trace.map((item) =>
          <li key={item.id}><div><strong>{item.name}</strong><small>{item.outcome} · {item.source} · {historyTime(item.timestamp)}</small>
          {item.detail && <small>{item.detail}</small>}</div></li>)}</ol></Disclosure>
        {result.candidates.length > 0 && <button className="primary full" onClick={() => apply(result.candidates)}><Crosshair size={16}/>View Nemotron lines on map</button>}
        <h3>Verified evidence</h3>
        {result.evidence.map((item, index) => <div className="history-evidence" key={index}><strong>{item.label.replaceAll('_', ' ')}</strong>
          <EvidenceDetails text={item.text}/></div>)}
      </div>}
    </div>
  </dialog>;
}

function EvidenceDetails({ text }: { text: string }) {
  const data = JSON.parse(text) as unknown;
  const interpretation = data && typeof data === 'object' && 'interpretation' in data && typeof data.interpretation === 'string' ? data.interpretation : undefined;
  const show = (value: unknown): string => value === null ? 'Unavailable' : typeof value === 'number' ? decimal(value, 2) : String(value);
  const fields = (value: unknown): string[] => value && typeof value === 'object' ? Object.entries(value).filter(([key]) => key !== 'interpretation').flatMap(([key, value]) =>
    value && typeof value === 'object' ? fields(value).map((child) => key + ' · ' + child) : [key.replace(/([a-z])([A-Z])/g, '$1 $2') + ' · ' + show(value)]) : [show(value)];
  return <>{interpretation && <p>{interpretation}</p>}
    <ul>{(Array.isArray(data) ? data.flatMap(fields) : fields(data)).map((item, index) => <li key={index}>{item}</li>)}</ul></>;
}



