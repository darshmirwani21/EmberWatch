import { useEffect, useMemo, useState } from 'react';
import { Bell, BriefcaseBusiness, ChevronDown, CircleHelp, ClipboardList, Crosshair, Flag, Flame, FlaskConical, History, Wind, Map as MapIcon, MapPin, Play, Radio, RotateCcw, Route, Shield, Sparkles, X } from 'lucide-react';
import { booleanPointInPolygon, length, lineString } from '@turf/turf';
import { DAY_HORIZON_MINUTES, EXTENDED_PLAYBACK_THRESHOLD_MINUTES, elapsedClock, playbackStride } from '../shared/simulationTime';
import { BARRIER_ASSUMPTION } from '../shared/interventionContracts';
import { interventionComparison, lineOutcome } from '../shared/interventionSimulation';
import { scenarioInterventionInput } from '../shared/scenarioIntervention';
import { InterventionHorizonSummary } from './InterventionHorizonSummary';
import { useIntervention } from './useIntervention';
import type { ControlLine, Coordinate, Mode, Point, Scenario, Weather } from '../shared/contracts';
import { MAX_ASSET_VERTICES, PROPERTY_BOUNDARY } from '../shared/businessContracts';
import { indexBusinessExposure, measureBusinessExposure } from '../shared/businessExposure';
import { vineyardDemo } from '../shared/vineyardDemo';
import { BusinessAssetsPanel, BusinessDemoButton, BusinessExposurePanel, VineyardSmokePanel, useBusinessRegistry } from './BusinessWorkspace';
import { defaultComparison, demos } from '../shared/demos';
import { analyzeLine, contactLabel, coordinate, downwind, expansionRate, footprintOverlap, geometryAt, location, pointContact, project, simulate, STEP } from '../shared/engine';
import { Intelligence, type IntelligenceSession } from './Intelligence';
import { FirelineIntelligence, candidateColors, useFirelineStudy } from './FirelineIntelligence';
import { MapView, type Overlay } from './MapView';
import { MobileHeader, MobileMapActions, MobileNavigation, MobileSheet, MobileTools, useMobileWorkspace } from './MobileWorkspace';
import { Preparedness, emptyPlans, type Place, type PlanKey, type Plans } from './Preparedness';
import { AlertsPanel, LinePanel, ResponseGap, ScenarioControls } from './ScenarioPanels';
import { SimulationDock } from './SimulationDock';
import { WindHistory } from './WindHistory';
import { decimal, Disclosure, Section, useLocal } from './ui';

import { legacyReplay, useHistoricalReplay } from './HistoricalReplay';

type MapMode = 'Explore' | 'Place Ignition' | 'Select Location' | 'Select Example Responder Origin' | 'Draw Line' | 'Edit Line' | 'Edit Candidate' | 'Sketch Plan' | 'Draw Asset';
type Tab = 'explore' | 'scenario' | 'preparedness' | 'alerts' | 'lines' | 'firelines' | 'replay' | 'history' | 'insights' | 'presets' | 'wind' | 'assets' | 'exposure' | 'smoke';
const sheetTitles: Record<Tab, string> = {
  explore: 'Map tools', scenario: 'Scenario controls', preparedness: 'Preparedness', alerts: 'Alerts',
  lines: 'Fireline tools', firelines: 'Fireline Intelligence', replay: 'Historical Replay', history: 'Wind history', insights: 'Scenario insights', presets: 'Scenario presets', wind: 'Wind shift',
  assets: 'Asset registry', exposure: 'Modeled exposure', smoke: 'Vineyard smoke monitoring',
};
const tabs = {
  civilian: [{ key: 'explore', title: 'Explore', icon: MapIcon }, { key: 'scenario', title: 'Scenario', icon: Flame },
    { key: 'preparedness', title: 'My Preparedness Plan', icon: ClipboardList }, { key: 'alerts', title: 'Alerts', icon: Bell }],
  responder: [{ key: 'scenario', title: 'Operations Lab', icon: Radio }, { key: 'lines', title: 'Control Lines', icon: Route },
    { key: 'wind', title: 'Wind Shift', icon: Wind }, { key: 'replay', title: 'Historical Replay', icon: History },
    { key: 'insights', title: 'Analysis', icon: CircleHelp }, { key: 'history', title: 'Wind History', icon: History },
    { key: 'firelines', title: 'Fireline Intelligence', icon: Sparkles }],
  business: [{ key: 'scenario', title: 'Scenario', icon: Flame }, { key: 'assets', title: 'Asset Registry', icon: BriefcaseBusiness },
    { key: 'exposure', title: 'Exposure', icon: Crosshair }, { key: 'smoke', title: 'Smoke Monitoring', icon: MapIcon }],
} satisfies Record<Mode, { key: Tab; title: string; icon: typeof Flame }[]>;

const defaultTab = (mode: Mode): Tab => mode === 'business' ? 'assets' : mode === 'responder' ? 'lines' : 'scenario';
const layerLabels = {
  fire: 'Modeled footprint', proximity: '300 m proximity outline', wind: 'Wind direction',
  comparison: 'Scenario B', route: 'Practice sketches', line: 'Proposed control lines', assets: 'Asset polygons',
};
type Layer = keyof typeof layerLabels;
const lineColors = ['#fcd776', '#62dbc7', '#85a9ff', '#f6a9d3'];
const demoPlans: Plans = {
  A: [[-118.542, 34.142], [-118.546, 34.149], [-118.552, 34.163]],
  B: [[-118.542, 34.142], [-118.529, 34.146], [-118.522, 34.155]],
};
const uid = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const pin = (kind: string, color: string, p: Coordinate): Overlay =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind, color } });
const path = (kind: string, color: string, points: number[][], soft = false): Overlay =>
  ({ type: 'Feature', geometry: { type: 'LineString', coordinates: points }, properties: { kind, color, soft } });

export function App() {
  const mobile = useMobileWorkspace();
  const [initialReplay] = useState(() => legacyReplay(new URL(window.location.href)));
  const [storedMode, setMode] = useLocal<Mode>('emberwatch.mode', 'civilian');
  const [migrating, setMigrating] = useState(Boolean(initialReplay));
  const mode: Mode = migrating ? 'responder' : storedMode;
  const [tab, setTab] = useState<Tab>(initialReplay ? 'replay' : defaultTab(mode));
  const registry = useBusinessRegistry();
  const business = mode === 'business';
  const civilian = mode === 'civilian';
  const [businessLocation, setBusinessLocation] = useState<string>();
  const [scenarioInputs, setScenario] = useState(demos[0].scenario);
  const [extendedDuration, setExtendedDuration] = useState(DAY_HORIZON_MINUTES);
  const responder = mode === 'responder';
  const scenario = useMemo(() => {
    const durationMinutes = responder ? scenarioInputs.durationMinutes : extendedDuration;
    return { ...scenarioInputs, durationMinutes, shift: scenarioInputs.shift && scenarioInputs.shift.minute <= durationMinutes ? scenarioInputs.shift : undefined };
  }, [scenarioInputs, responder, extendedDuration]);
  const [demo, setDemo] = useState(0);
  const [fictional, setFictional] = useState(true);
  const [scenarioLabel, setScenarioLabel] = useState('FICTIONAL PRESET');
  const [importedWeather, setImportedWeather] = useState<Weather>();
  const [archivedWind, setArchivedWind] = useState<string>();
  const [point, setPoint] = useState<Point | undefined>(demos[0].point);
  const [places, setPlaces] = useLocal<Place[]>('emberwatch.places', []);
  const [savedPlans, setSavedPlans] = useLocal<Plans>('emberwatch.plans', emptyPlans);
  const [showDemoPlans, setShowDemoPlans] = useState(false);
  const [practicePlans, setPracticePlans] = useState(demoPlans);
  const plans = showDemoPlans ? practicePlans : savedPlans;
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('A');
  const [origin, setOrigin] = useState<Point>();
  const [lines, setLines] = useState<ControlLine[]>(demos[0].lines);
  const [selectedId, setLineId] = useState<string | undefined>('A');
  const [draft, setDraft] = useState<Coordinate[]>([]);
  const [candidateUndo, setCandidateUndo] = useState<Coordinate[]>();
  const [insertVertex, setInsertVertex] = useState(false);
  const [candidateError, setCandidateError] = useState<string>();
  const [focusCandidate, setFocusCandidate] = useState<Coordinate[]>();
  const [vertex, setVertex] = useState<number>();
  const [mapMode, setMapMode] = useState<MapMode>('Explore');
  const [camera, setCamera] = useState(0);
  const [cursor, setMinute] = useState(35);
  const minute = Math.min(cursor, scenario.durationMinutes);
  const [interventionStart, setInterventionStart] = useState<number>();
  const [showBaseline, setShowBaseline] = useState(true);
  const [playing, play] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [compare, setCompare] = useState(false);
  const [replay, setReplay] = useState(Boolean(initialReplay));
  const [replayReturnTab, setReplayReturnTab] = useState<Tab>('lines');
  const historyActive = mode === 'responder' && replay;
  const [agent, setAgent] = useState(false);
  const [agentReturnToSheet, setAgentReturnToSheet] = useState(false);
  const [drill, setDrill] = useState<{ minute: number; acres: number; id: string }>();
  const [sheetOpen, setSheetOpen] = useState(Boolean(initialReplay));
  const [expanded, setExpanded] = useState(false);
  const [investigations, setInvestigations] = useState<Partial<Record<Mode, IntelligenceSession>>>({});
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ fire: true, proximity: true, wind: true, comparison: true, route: true, line: true, assets: true });

  const history = useHistoricalReplay({ active: historyActive, initialCase: initialReplay, mobile, assets: registry.assets,
    close: closeReplay, viewMap: viewCandidateMap, showTool: (tool) => showTab(tool === 'analysis' ? 'insights' : tool) });
  const snapshots = useMemo(() => simulate(scenario), [scenario]);
  const comparison = useMemo(() => defaultComparison(scenario, demo), [scenario, demo]);
  const comparisonSnapshots = useMemo(() => compare ? simulate(comparison) : undefined, [compare, comparison]);
  const snapshot = snapshots[Math.min(Math.round(minute / STEP), snapshots.length - 1)];
  const exposureIndex = useMemo(() => indexBusinessExposure(business ? registry.assets : [], snapshots), [business, registry.assets, snapshots]);
  const exposure = useMemo(() => measureBusinessExposure(exposureIndex, snapshot), [exposureIndex, snapshot]);
  const firelines = useFirelineStudy(scenario, snapshot.minute, snapshots, !historyActive && tab === 'firelines' && (!mobile || sheetOpen));
  const lineKey = JSON.stringify(lines.map(({ id, coordinates, completionMinute }) => ({ id, coordinates, completionMinute })));
  const barriers = useMemo(() => JSON.parse(lineKey) as Pick<ControlLine, 'id' | 'coordinates' | 'completionMinute'>[], [lineKey]);
  const input = useMemo(() => responder && !historyActive && interventionStart !== undefined && interventionStart < scenario.durationMinutes ?
    scenarioInterventionInput(scenario, snapshots[interventionStart / STEP], barriers) : undefined,
  [responder, historyActive, interventionStart, scenario, snapshots, barriers]);
  const interventionRun = useIntervention(JSON.stringify([input && scenario, input && interventionStart, input && lineKey]), input);
  const paired = interventionRun.result;
  const branchMinute = interventionStart === undefined ? -1 : snapshot.minute - interventionStart;
  const branchFrame = branchMinute < 0 ? undefined : paired?.intervention[branchMinute / STEP];
  const baselineFrame = branchMinute < 0 ? undefined : paired?.baseline[branchMinute / STEP];
  const fireAcres = branchFrame?.acres ?? snapshot.acres;
  const result = paired && branchFrame ? interventionComparison(paired, branchMinute) : undefined;
  const finalComparison = useMemo(() => paired && interventionComparison(paired, paired.baseline.at(-1)!.minute), [paired]);
  const bSnapshot = comparisonSnapshots?.[snapshot.minute / STEP];
  const prior = snapshots[Math.max(0, snapshot.minute / STEP - 1)];
  const growthFrames = branchFrame ? paired!.intervention : snapshots;
  const growthIndex = (branchFrame?.minute ?? snapshot.minute) / STEP;
  const growthPrevious = growthFrames[Math.max(0, growthIndex - 1)];
  const growthNext = growthFrames[growthIndex + 1];
  const rateStart = growthNext ? growthFrames[growthIndex] : growthPrevious;
  const rateEnd = growthNext ?? growthFrames[growthIndex];
  const rateOffset = branchFrame ? interventionStart! : 0;
  const addedAcres = fireAcres - growthPrevious.acres;
  const contact = useMemo(() => point ? pointContact(snapshots, point) : null, [point, snapshots]);
  const selectedLine = lines.find((line) => line.id === selectedId);
  const totalLineKm = useMemo(() => lines.reduce((sum, line) => sum + length(lineString(line.coordinates), { units: 'kilometers' }), 0), [lines]);
  const lineStats = useMemo(() => selectedLine ? analyzeLine(snapshots, selectedLine.coordinates) : null, [selectedLine, snapshots]);
  const selectedGeometry = useMemo(() => mode === 'responder' && selectedLine ? geometryAt(snapshot, selectedLine.coordinates) : null,
    [mode, selectedLine, snapshot]);
  const selectedOverlap = useMemo(() => mode === 'responder' && selectedLine ? footprintOverlap(snapshot, selectedLine.coordinates) : null,
    [mode, selectedLine, snapshot]);
  const overlapPercent = lineStats && lineStats.km > 0 && selectedOverlap ? Math.min(100, selectedOverlap.kilometers / lineStats.km * 100) : 0;
  const bContact = useMemo(() => comparisonSnapshots && point ? pointContact(comparisonSnapshots, point) : null, [point, comparisonSnapshots]);

  useEffect(() => {
    if (!initialReplay) return;
    setMode('responder'); setMigrating(false);
    window.history.replaceState(window.history.state, '', '/?tab=replay&fire=' + initialReplay);
  }, [initialReplay]);
  useEffect(() => {
    if (!playing || historyActive) return;
    const stride = playbackStride(speed);
    const timer = setInterval(() => setMinute((value) => Math.min(value + stride * STEP, scenario.durationMinutes)), 800 * stride / speed);
    return () => clearInterval(timer);
  }, [playing, speed, scenario.durationMinutes, historyActive]);
  useEffect(() => { if (minute >= scenario.durationMinutes || interventionRun.running) play(false); }, [minute, scenario.durationMinutes, interventionRun.running]);
  useEffect(() => { if (scenario.durationMinutes <= EXTENDED_PLAYBACK_THRESHOLD_MINUTES) setSpeed((value) => Math.min(value, 4)); }, [scenario.durationMinutes]);
  useEffect(() => {
    if (!mobile && !tabs[mode].some((item) => item.key === tab)) setTab(defaultTab(mode));
    if (!mobile) { setSheetOpen(false); setExpanded(false); }
  }, [mobile, mode, tab]);
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (agent || (mobile && sheetOpen) || event.defaultPrevented || (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
      if (historyActive) { if (event.key === 'Escape' && history.drawing) history.cancelEdit(); return; }
      if (event.key === 'Escape') { if (mapMode === 'Draw Asset') registry.resetDraft(); setMapMode('Explore'); setDraft([]); setVertex(undefined); }
      if (event.key === 'Backspace' && mapMode === 'Draw Line') { event.preventDefault(); setDraft((points) => points.slice(0, -1)); }
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [mapMode, agent, mobile, sheetOpen, historyActive, history.drawing]);

  function editScenario(next: Scenario, label = 'HYPOTHETICAL INPUTS') {
    if (!responder) setExtendedDuration(next.durationMinutes);
    setScenario((previous) => ({ ...next, durationMinutes: responder ? next.durationMinutes : previous.durationMinutes,
      shift: responder && !scenario.shift && previous.shift && previous.shift.minute > scenario.durationMinutes ? next.shift ?? previous.shift : next.shift }));
    if (next.durationMinutes !== scenario.durationMinutes) setMinute((value) => Math.min(value, next.durationMinutes));
    if (responder && interventionStart !== undefined && next.durationMinutes <= interventionStart) setInterventionStart(undefined);
    setScenarioLabel(label);
    setImportedWeather(undefined);
    setArchivedWind(undefined);
    setFictional(false);
  }
  function importWeather(w: Weather) {
    editScenario({ ...scenario, humidity: w.humidity, wind: { speedMph: w.speedMph, fromDeg: w.fromDeg } }, 'IMPORTED WEATHER INPUTS');
    setImportedWeather(w);
  }
  function launch(index: number) {
    if (historyActive) closeReplay();
    const preset = demos[index];
    setBusinessLocation(undefined);
    setInterventionStart(undefined);
    setDrill(undefined);
    firelines.clear();
    setDemo(index); setScenario(preset.scenario); if (index !== 1) setExtendedDuration(DAY_HORIZON_MINUTES); setPoint(preset.point); setOrigin(undefined); setLines(preset.lines);
    setLineId(preset.lines[0]?.id); setMinute(index === 1 ? 45 : 35); play(false); setMapMode('Explore');
    setDraft([]); setVertex(undefined); setCamera((value) => value + 1); setCompare(index === 2);
    setLayers({ fire: true, proximity: true, wind: true, comparison: true, route: true, line: true, assets: true });
    setFictional(true); setScenarioLabel('FICTIONAL PRESET'); setImportedWeather(undefined); setArchivedWind(undefined); setShowDemoPlans(index === 0); setPracticePlans(demoPlans);
    setMode(index === 1 ? 'responder' : 'civilian');
    setTab(index === 1 ? 'lines' : 'scenario');
    setSheetOpen(false);
  }
  function launchBusiness() {
    registry.openDemo();
    setMode('business'); setTab('assets'); setSheetOpen(false);
    setInterventionStart(undefined);
    setScenario({ ...vineyardDemo.scenario, durationMinutes: DAY_HORIZON_MINUTES });
    setExtendedDuration(DAY_HORIZON_MINUTES); setBusinessLocation(vineyardDemo.location);
    setFictional(true); setScenarioLabel('FICTIONAL VINEYARD SCENARIO');
    setImportedWeather(undefined); setArchivedWind(undefined); setCompare(false);
    setMinute(vineyardDemo.minute); play(false); setMapMode('Explore'); setCamera((value) => value + 1);
    setFocusCandidate(undefined); setLayers((previous) => ({ ...previous, fire: true, wind: true, assets: true }));
    if (mobile && !expanded) window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }
  function switchMode(next: Mode) {
    if (mode === next) return;
    if (mapMode === 'Draw Asset') registry.resetDraft();
    setMode(next); setTab(next === 'responder' && replay ? 'replay' : defaultTab(next));
    setMapMode('Explore'); setDraft([]); setVertex(undefined);
    setSheetOpen(false);
    if (mobile && !expanded) window.scrollTo(0, 0);
  }
  function closeReplay() {
    history.cancelEdit(); setReplay(false); setTab(replayReturnTab); setSheetOpen(false);
    if (legacyReplay(new URL(window.location.href))) window.history.replaceState(window.history.state, '', '/');
  }
  function showTab(next: Tab) {
    if (next === 'replay' && !historyActive) {
      setReplayReturnTab(tab); play(false); setReplay(true); setFocusCandidate(undefined);
    }
    setTab(next);
    if (historyActive || next === 'replay') { if (mobile) setSheetOpen(true); return; }
    if (mapMode === 'Draw Asset') { registry.resetDraft(); setMapMode('Explore'); }
    if (!mobile || next !== tab) { setMapMode('Explore'); setDraft([]); setVertex(undefined); }
    if (mobile) setSheetOpen(true);
  }
  function returnToTools(next: Tab) { setTab(next); setSheetOpen(true); }
  function openAgent() { if (historyActive) { history.openAgent(); return; } setAgentReturnToSheet(mobile && sheetOpen); setSheetOpen(false); setAgent(true); }
  function viewCandidateMap() {
    setSheetOpen(false);
    if (mobile) window.requestAnimationFrame(() => {
      const panel = document.querySelector('.map-panel');
      if (!expanded) panel?.scrollIntoView({ block: 'start' });
      if (historyActive) panel?.querySelector<HTMLCanvasElement>('canvas')?.focus({ preventScroll: true });
    });
  }
  function pickMode(next: MapMode) {
    setMapMode(next);
    if (next === 'Explore') return;
    if (mobile) {
      setSheetOpen(false);
      if (!expanded) window.requestAnimationFrame(() => document.querySelector('.map-panel')?.scrollIntoView({ block: 'nearest' }));
    }
  }
  function addPoint(id: PlanKey, p: Coordinate) {
    const current = plans[id];
    if (current.length >= 60 || (current.at(-1)?.[0] === p[0] && current.at(-1)?.[1] === p[1])) return;
    updatePlan(id, [...current, p]);
  }
  function updatePlan(id: PlanKey, coordinates: Coordinate[]) {
    const next = { ...plans, [id]: coordinates };
    if (showDemoPlans) setPracticePlans(next);
    else setSavedPlans(next);
  }
  function mapPick(p: Coordinate) {
    if (Math.abs(p[1]) > 84) return;
    if (business && mapMode === 'Draw Asset') {
      if (registry.draft.length < MAX_ASSET_VERTICES && !registry.draft.some(([lng, lat]) => lng === p[0] && lat === p[1])) {
        registry.setDraft((corners) => [...corners, p]); registry.setError(undefined);
      }
      return;
    }
    if (business && mapMode === 'Explore' && layers.assets) {
      const matches = registry.assets.filter((asset) => booleanPointInPolygon(p, asset.geometry));
      const asset = matches.find((entry) => entry.category !== PROPERTY_BOUNDARY) ?? matches[0];
      if (asset) { registry.select(asset.id); showTab('assets'); }
    }
    if (mapMode === 'Place Ignition') { editScenario({ ...scenario, ignition: location(p) }); setMapMode('Explore'); }
    if (mapMode === 'Select Location' && mode === 'civilian') {
      setPoint(location(p)); setMapMode('Explore');
      if (mobile && tab === 'preparedness') returnToTools('preparedness');
    }
    if (mapMode === 'Select Example Responder Origin' && mode === 'responder') { setOrigin(location(p)); setMapMode('Explore'); }
    if (mapMode === 'Sketch Plan' && mode === 'civilian') addPoint(selectedPlan, p);
    if (mapMode === 'Draw Line' && mode === 'responder') {
      setDraft((points) => points.length >= 60 || (points.at(-1)?.[0] === p[0] && points.at(-1)?.[1] === p[1]) ? points : [...points, p]);
    }
    if (mapMode === 'Edit Line' && vertex !== undefined && mode === 'responder') {
      setDraft((points) => points.map((point, index) => index === vertex ? p : point));
      setVertex(undefined);
    }
    if (mapMode === 'Edit Candidate' && vertex !== undefined) {
      setCandidateUndo(draft);
      const next = [...draft];
      const insert = insertVertex && draft.length < 32;
      next.splice(insert ? vertex + 1 : vertex, insert ? 0 : 1, p);
      setDraft(next); setVertex(undefined); setCandidateError(undefined);
    }
  }
  function updateLine(line: ControlLine) {
    setLines((all) => all.map((item) => item.id === line.id ? line : item));
  }
  function cancelLine() { setDraft([]); setVertex(undefined); setMapMode('Explore'); }
  function finishCandidate() {
    const error = firelines.changeGeometry(draft);
    if (error) { setCandidateError(error); return; }
    cancelLine();
    if (mobile) returnToTools('firelines');
  }
  function finishLine() {
    if (new Set(draft.map((p) => p.join(','))).size < 2) return;
    if (mapMode === 'Edit Line' && selectedLine) updateLine({ ...selectedLine, coordinates: draft });
    if (mapMode === 'Draw Line') {
      const id = uid();
      setLines([...lines, { id, name: 'Proposed line ' + (lines.length + 1), color: lineColors[lines.length % lineColors.length], type: 'Other example', coordinates: draft }]);
      setLineId(id);
    }
    cancelLine();
    if (mobile) returnToTools('lines');
  }

  function finishAsset() {
    if (!registry.finish()) return;
    setMapMode('Explore');
    if (mobile) returnToTools('assets');
  }
  function cancelAsset() { registry.resetDraft(); setMapMode('Explore'); if (mobile) returnToTools('assets'); }
  function undoAsset() { registry.setDraft((corners) => corners.slice(0, -1)); registry.setError(undefined); }

  const overlays: Overlay[] = [];
  const fireColor = '#ff6038';
  if (layers.fire) overlays.push(branchFrame ?
    { ...branchFrame.shape, properties: { kind: 'history-branch', color: '#c59cfa' } } :
    { ...snapshot.polygon, properties: { kind: 'fire', color: fireColor } });
  if (baselineFrame && showBaseline) overlays.push({ ...baselineFrame.shape, properties: { kind: 'history-baseline', color: '#54cbe9' } });
  if (layers.proximity && !branchFrame) overlays.push({ ...snapshot.proximity, properties: { kind: 'proximity', color: '#ff9a6c' } });
  if (bSnapshot && layers.comparison) overlays.push({ ...bSnapshot.polygon, properties: { kind: 'comparison', color: '#a78bfa' } });
  overlays.push(pin('ignition', fireColor, coordinate(scenario.ignition)));
  if (mode === 'civilian') {
    if (point) overlays.push(pin('point', '#80d9ff', coordinate(point)));
    if (layers.route) for (const id of ['A', 'B'] as const) {
      const color = id === 'A' ? '#62dbc7' : '#a78bfa';
      if (plans[id].length >= 2) overlays.push(path('route', color, plans[id]));
      if (plans[id].length) overlays.push(pin('vertex', color, plans[id].at(-1)!));
    }
  } else if (mode === 'responder') {
    if (origin) overlays.push(pin('origin', '#80d9ff', coordinate(origin)));
    if (layers.line) for (const line of lines) {
      const annotatedComplete = line.completionMinute !== undefined ? snapshot.minute >= line.completionMinute :
        interventionStart !== undefined && snapshot.minute >= interventionStart;
      overlays.push(path(annotatedComplete ? 'line' : 'line-planned', line.color, line.coordinates, line.id !== selectedId));
      if (line.id === selectedId) {
        for (const part of branchFrame ? [] : selectedOverlap?.segments ?? []) overlays.push(path('line-overlap', '#fff6ed', part));
        for (const p of branchFrame ? [] : selectedGeometry?.intersections ?? []) overlays.push(pin('hit', '#ffd26f', p));
        if (bSnapshot && layers.comparison) for (const p of geometryAt(bSnapshot, line.coordinates).intersections) overlays.push(pin('hit', '#a78bfa', p));
      }
    }
    if (firelines.preview && firelines.candidates.length && firelines.horizon > snapshot.minute) {
      overlays.push({ ...snapshots[firelines.horizon / STEP].polygon, properties: { kind: 'future', color: '#b67643' } });
    }
    firelines.candidates.forEach((candidate, i) => overlays.push({
      type: 'Feature', geometry: candidate.geometry, properties: { kind: 'candidate-' + candidate.provenance,
        color: candidateColors[i], candidateId: candidate.id, selected: candidate.id === firelines.selected?.id },
    }));
    if (draft.length >= 2) overlays.push(path('draft', '#f2f5fa', draft));
    if (draft.length) draft.forEach((p, index) => overlays.push(pin('vertex', index === vertex ? '#ff6038' : '#f2f5fa', p)));
  }
  if (business) {
    if (layers.assets) {
      for (const asset of registry.assets) {
        const property = asset.category === PROPERTY_BOUNDARY;
        overlays.push({ type: 'Feature', geometry: asset.geometry, properties: {
          kind: property ? 'property' : 'asset', color: property ? '#527f9b' : '#087f70', selected: registry.selected?.id === asset.id,
        } });
      }
      for (const row of exposure.rows) if (row.clip) overlays.push({ ...row.clip, properties: { kind: 'asset-overlap', color: '#fac257' } });
    }
    if (registry.pendingGeometry) overlays.push({ type: 'Feature', geometry: registry.pendingGeometry, properties: { kind: 'property', color: '#087f70', selected: true } });
    if (registry.draft.length >= 2) overlays.push(path('draft', '#f2f5fa', registry.draft));
    for (const p of registry.draft) overlays.push(pin('vertex', '#f2f5fa', p));
  }
  const direction = downwind(snapshot.activeWind);
  if (layers.wind && snapshot.activeWind.speedMph > 0) {
    const start = project(scenario.ignition, direction, 140);
    const end = project(scenario.ignition, direction, Math.min(500, 225 + snapshot.activeWind.speedMph * 7));
    overlays.push(path('wind', '#38c6e8', [start, end]));
    overlays.push(path('wind', '#38c6e8', [project(location(end), direction + 160, 70), end, project(location(end), direction - 160, 70)]));
  }
  const layerControls: { key: string; label: string; enabled: boolean; toggle: () => void }[] = (Object.keys(layerLabels) as Layer[]).filter((key) => key === 'route' ? civilian : key === 'line' ? responder : key === 'assets' ? business : key !== 'proximity' || !branchFrame).map((key) => ({
    key, label: key === 'fire' && branchFrame ? 'Barrier intervention' : layerLabels[key], enabled: key === 'comparison' ? compare && layers[key] : layers[key],
    toggle: () => {
      if (key === 'comparison') { setCompare(!compare); setLayers({ ...layers, comparison: true }); }
      else setLayers({ ...layers, [key]: !layers[key] });
    },
  }));
  const shift = scenario.shift;
  if (input) layerControls.push({ key: 'baseline', label: 'Modeled baseline', enabled: showBaseline, toggle: () => setShowBaseline(!showBaseline) });
  const center = historyActive ? history.recenter : () => setCamera((value) => value + 1);
  const hasLineDraft = mapMode === 'Draw Line' || mapMode === 'Edit Line';
  const editingCandidate = mapMode === 'Edit Candidate';
  const sketching = mapMode === 'Sketch Plan';
  const drawingAsset = mapMode === 'Draw Asset';
  const closeMapTool = () => {
    if (drawingAsset) { cancelAsset(); return; }
    cancelLine();
    if (editingCandidate) returnToTools('firelines');
    if (hasLineDraft) returnToTools('lines');
    if (sketching) returnToTools('preparedness');
  };
  function undoCandidateVertex() {
    if (candidateUndo) setDraft(candidateUndo);
    setCandidateUndo(undefined);
    setCandidateError(undefined);
  }
  const candidateEditor = <Section title="Edit candidate">
    <p className="muted">{vertex === undefined ? 'Choose a vertex, then place it on the map.' : 'Tap the map to place the selected vertex.'}</p>
    {candidateError && <p className="notice error" role="alert">{candidateError}</p>}
    <label className="check"><input type="checkbox" checked={insertVertex} disabled={draft.length >= 32}
      onChange={(event) => setInsertVertex(event.target.checked)}/>Insert after selected vertex</label>
    <div className="button-row vertex-list">{draft.map((_, index) => <button key={index}
      aria-pressed={vertex === index} aria-label={'Candidate vertex ' + (index + 1)}
      onClick={() => { setVertex(index); pickMode('Edit Candidate'); }}>Vertex {index + 1}</button>)}</div>
    <div className="button-row"><button onClick={finishCandidate}>Finish edit</button>
      <button onClick={undoCandidateVertex} disabled={!candidateUndo}>Undo vertex</button><button onClick={cancelLine}>Cancel edit</button></div>
  </Section>;

  const interaction = business ? <BusinessExposurePanel exposure={exposure} minute={snapshot.minute} fictional={registry.fictional} compact={tab === 'exposure'}/>
    : responder ? <Section title="Fire–line interaction" action={<Route size={17}/>}>
          {selectedLine && selectedOverlap && selectedGeometry && lineStats ? <>
            <div className="overlap-card">
              <div className="overlap-heading"><strong>{selectedLine.name}</strong><small>Minute {snapshot.minute}</small></div>
              <p className="contact-value">{decimal(overlapPercent, 1)}% <span>inside footprint</span></p>
              <div className="overlap-bar" aria-hidden="true"><span style={{ width: overlapPercent + '%' }}/></div>
              <small>{decimal(selectedOverlap.kilometers * 1000, 0)} m of {decimal(lineStats.km * 1000, 0)} m · {selectedGeometry.intersections.length} perimeter intersections</small>
            </div>
            <p className="muted"><strong>First perimeter contact</strong><br/>{lineStats.contact ? contactLabel(lineStats.contact) : 'No sampled perimeter intersection'}</p>
            {lineStats.contact && <button className="full" disabled={snapshot.minute === lineStats.contact.to} onClick={() => {
              play(false); setMinute(lineStats.contact!.to);
              document.querySelector('.map-panel')?.scrollIntoView({ block: 'nearest' });
            }}>Jump to first contact</button>}
            <p className="muted">This geometry check uses the unimpeded radial footprint.</p>
          </> : <p className="muted">Choose a proposed line in Control Lines.</p>}
        </Section> : <Section title="Selected point contact" action={<MapPin size={17}/>}>
          <p className="contact-value">{point ? contactLabel(contact) : 'Select a location on the map'}</p>
          <p className="muted">First modeled overlap within the full scenario horizon, sampled every five minutes.</p>
          <ResponseGap contact={contact}/>
        </Section>;
  const metricContent = <>
        <Section title="Scenario metrics" action={<span className="tag">SIMULATED</span>}>
          <div className="metric-hero"><span>Modeled footprint</span><div><b>{decimal(fireAcres)}</b><small>acres</small></div></div>
          <div className="metric-pair">{responder
            ? <article className="expansion-rate"><small>{growthNext ? 'Current expansion rate' : 'Last expansion rate'}</small>
                <strong>{decimal(expansionRate(rateStart, rateEnd), 2)} <span>ac/min</span></strong>
                <small>Minutes {rateStart.minute + rateOffset}–{rateEnd.minute + rateOffset} · modeled average</small></article>
            : <article><small>Growth since last step</small><strong>+{decimal(snapshot.acres - prior.acres)} <span>ac</span></strong></article>}
            {!branchFrame && <article><small>Maximum radius</small><strong>{decimal(snapshot.maxRadiusMeters / 1000, 2)} <span>km</span></strong></article>}</div>
          {responder && snapshot.minute > 0 && <p className="muted">Last step added {decimal(addedAcres)} acres.</p>}
          {bSnapshot && <div className="line-stats"><strong className="violet">Scenario B · {decimal(bSnapshot.acres)} ac</strong>
            <span>B minus A · {decimal(bSnapshot.acres - snapshot.acres)} ac</span>
            {civilian && point && <small>B point contact · {contactLabel(bContact)}</small>}</div>}
        </Section>
        {responder && <Section title="Barrier comparison">
          {interventionStart !== undefined && <p>Branch runs from {elapsedClock(interventionStart)} to {elapsedClock(scenario.durationMinutes)}.</p>}
          {interventionRun.running && <p role="status">Computing baseline and intervention…</p>}
          {interventionRun.error && <p role="alert">Intervention results could not be calculated. {interventionRun.error}</p>}
          {paired && !result && <p>Move the clock to the branch start or later.</p>}
          {result && <>
            <p>{minute === scenario.durationMinutes ? 'Final sample' : 'Playback sample'} · {elapsedClock(minute)}</p>
            <div className="history-numbers">
              <div><small>Modeled baseline</small><strong>{decimal(result.baselineAcres, 2)} ac</strong></div>
              <div><small>Barrier intervention</small><strong>{decimal(result.interventionAcres, 2)} ac</strong></div>
              <div><small>Modeled burned area avoided</small><strong>{decimal(result.differenceAcres, 2)} ac</strong></div>
              <div><small>Modeled area reduction</small><strong>{decimal(result.reductionPercent, 2)}%</strong></div>
              <div><small>Model-to-model IoU</small><strong>{decimal(result.iou * 100, 2)}%</strong></div>
            </div>
            <p>{result.activeBarrierCount} active · {decimal(result.activeLengthMeters, 1)} m · {decimal(result.cellMeters)} m grid{result.localCellMeters < result.cellMeters && ' · ' + decimal(result.localCellMeters, 1) + ' m near lines'}</p>
            {result.lineContacts.map((line) => {
              return <p key={line.id}><strong>{lines.find(({ id }) => id === line.id)?.name}</strong> · {decimal(line.lengthMeters, 1)} m · {lineOutcome(line, branchMinute)}.
                {line.intervention !== null && ' First modeled intervention contact by minute ' + (interventionStart! + line.intervention) + '.'}</p>;
            })}
          </>}
          {finalComparison && minute !== scenario.durationMinutes && <InterventionHorizonSummary comparison={finalComparison} end={elapsedClock(scenario.durationMinutes)}/>}
          {interventionStart === undefined && <p>Open Fireline tools to run a comparison from the selected minute.</p>}
          <p className="safety-note">{BARRIER_ASSUMPTION}</p>
        </Section>}
        {interaction}
        {!mobile && <Section title="Nemotron Intelligence" action={<Sparkles size={17}/>}>
          <p className="muted">{responder ? 'Investigate proposed line contact with the same geometry used on the map.' :
            business ? 'Review verified asset intersections and regional air-quality evidence.' :
            'Investigate wind shifts, point contact and official sources with verifiable tools.'}</p>
          <button className="primary full" onClick={openAgent}><Sparkles size={16}/>Analyze with Nemotron</button>
        </Section>}
        <Section title="Methodology & safety" action={<CircleHelp size={17}/>}>
          <p className="safety-note">{responder ? 'Training sandbox. Lines block surface spread in the paired intervention under idealized assumptions.' :
            'Educational simulation. Follow official incident information and local emergency instructions.'}</p>
          <Disclosure title="How the model works"><p>72 geodesic rays advance in five-minute steps. Wind FROM, humidity, and fuel dryness control illustrative radial increments. The proximity outline extends each ray by 300 m. The model omits terrain, embers, smoke, and road conditions. Responder barrier runs use a local grid with the same environmental spread rates.</p></Disclosure>
        </Section>
  </>;
  const historyTool = tab === 'insights' ? 'analysis' : tab === 'scenario' || tab === 'history' ? 'wind' : tab;
  const historicalTools = historyActive && (historyTool === 'replay' || historyTool === 'wind' || historyTool === 'lines' || historyTool === 'firelines' || historyTool === 'analysis');
  const toolContent = historicalTools ? history.panels[historyTool] : <>
          {mobile && (tab === 'scenario' || tab === 'wind') && <div className="mobile-sheet-shortcuts">
            <button onClick={() => setSheetOpen(false)}><MapIcon size={17}/>View updated map</button>
          </div>}
          {(tab === 'scenario' || tab === 'wind') && <ScenarioControls scenario={scenario} snapshot={snapshot} change={editScenario} dataLabel={scenarioLabel} mode={mode}
            mobile={mobile} leadWithShift={tab === 'wind'} selected={civilian ? point : undefined}
            importedWeather={importedWeather} archivedWind={archivedWind}
            setIgnition={() => pickMode('Place Ignition')} setPoint={() => pickMode('Select Location')} onImport={importWeather}
            setOrigin={() => pickMode('Select Example Responder Origin')}/>}
          {business && tab === 'assets' && <BusinessAssetsPanel registry={registry} mobile={mobile} drawing={drawingAsset}
            draw={() => { registry.start(); setLayers((previous) => ({ ...previous, assets: true })); pickMode('Draw Asset'); }} finish={finishAsset} cancel={cancelAsset} undo={undoAsset}
            focus={() => { if (registry.selected) { setFocusCandidate(registry.selected.geometry.coordinates[0]); viewCandidateMap(); } }} launchDemo={launchBusiness}/>}
          {business && tab === 'exposure' && <BusinessExposurePanel exposure={exposure} minute={snapshot.minute} fictional={registry.fictional}/>}
          {business && tab === 'smoke' && <VineyardSmokePanel key={[scenario.ignition.lat, scenario.ignition.lng, registry.selected?.id].join(',')}
            ignition={scenario.ignition} asset={registry.selected}/>}
          {tab === 'explore' && <Section title="Explore the map">
            <p className="muted">Pan and zoom around a fictional California scenario. Use the map tools to move ignition or select a location.</p>
            <div className="stack"><button onClick={() => pickMode('Explore')}><MapIcon size={16}/>Explore mode</button>
              <button onClick={() => pickMode('Place Ignition')}><Crosshair size={16}/>Place ignition</button>
              <button onClick={() => pickMode('Select Location')}><MapPin size={16}/>Select location</button></div>
          </Section>}
          {tab === 'preparedness' && civilian && <Preparedness point={point} places={places} plans={plans} selectedPlan={selectedPlan} snapshot={snapshot}
            demoPlans={showDemoPlans} onUseSaved={() => { setShowDemoPlans(false); setMapMode('Explore'); }}
            pendingPlan={mapMode === 'Sketch Plan'} onPlace={(p) => p ? setPoint(p) : pickMode('Select Location')}
            onSave={(name) => { if (point) setPlaces([...places, { id: uid(), name, point }]); }}
            onDelete={(id) => { const removed = places.find((place) => place.id === id); setPlaces(places.filter((place) => place.id !== id));
              if (point && removed?.point.lat === point.lat && removed.point.lng === point.lng) setPoint(undefined); }}
            onDraw={(id) => { setSelectedPlan(id); pickMode(mapMode === 'Sketch Plan' && selectedPlan === id ? 'Explore' : 'Sketch Plan'); }}
            onRemove={(id) => updatePlan(id, plans[id].slice(0, -1))} onClear={(id) => updatePlan(id, [])} onAddCoordinate={addPoint}/>}
          {tab === 'alerts' && (!responder || mobile) && <AlertsPanel key={[scenario.ignition.lat, scenario.ignition.lng, point?.lat, point?.lng].join(',')}
            ignition={scenario.ignition} selected={civilian ? point : undefined}
            onDrill={() => { setDrill({ minute: snapshot.minute, acres: snapshot.acres, id: uid() }); setSheetOpen(false); }}/>}
          {tab === 'lines' && responder && mobile && <div className="mobile-sheet-shortcuts">
            <label className="check"><input type="checkbox" checked={layers.fire} onChange={() => setLayers({ ...layers, fire: !layers.fire })}/>Show fire perimeter</label>

          </div>}
          {tab === 'lines' && responder && <Section title="Intervention">
            <button className="primary full" disabled={!lines.length || minute >= scenario.durationMinutes} onClick={() => {
              setInterventionStart(minute); setShowBaseline(true); play(false); viewCandidateMap();
            }}>{interventionStart === undefined ? 'Run Intervention' : 'Branch at current minute'}</button>
            {minute >= scenario.durationMinutes && <p className="muted">Move the clock before the end to start a branch.</p>}
            {interventionStart !== undefined && <button onClick={() => setInterventionStart(undefined)}>End intervention</button>}
            {interventionRun.running && <p role="status">Computing barrier study…</p>}
            {paired && <button onClick={() => showTab('insights')}>Review barrier comparison</button>}
          </Section>}
          {tab === 'lines' && responder && <LinePanel lines={lines} selectedId={selectedId} draft={draft} stats={lineStats} mobile={mobile}
            isDrawing={mapMode === 'Draw Line'} isEditing={mapMode === 'Edit Line'} begin={() => { setDraft([]); pickMode('Draw Line'); }}
            finish={finishLine} cancel={cancelLine} undo={() => mapMode === 'Draw Line' ? setDraft(draft.slice(0, -1)) : setDraft(selectedLine?.coordinates ?? [])}
            select={(id) => { cancelLine(); setLineId(id); }} edit={() => { if (selectedLine) {
              setDraft(selectedLine.coordinates);
              if (mobile) setMapMode('Edit Line'); else pickMode('Edit Line');
            } }}
            editVertex={(index) => { setVertex(index); pickMode('Edit Line'); }} update={updateLine}
            remove={() => { const remaining = lines.filter((line) => line.id !== selectedId); setLines(remaining); setLineId(remaining[0]?.id); }}/>}
          {tab === 'firelines' && responder && (editingCandidate ? candidateEditor :
            <FirelineIntelligence firelines={firelines} snapshot={snapshot} scenario={scenario} canSave={lines.length < 8}
              edit={() => { if (firelines.selected) {
                setDraft(firelines.selected.geometry.coordinates); setCandidateUndo(undefined); setInsertVertex(false);
                setCandidateError(undefined); setMapMode('Edit Candidate');
              } }}
              zoom={() => { if (firelines.selected) { setFocusCandidate([...firelines.selected.geometry.coordinates]); viewCandidateMap(); } }}
              view={mobile ? viewCandidateMap : undefined}
              save={() => { if (firelines.selected && lines.length < 8) {
                const id = uid();
                setLines([...lines, { id, name: 'Training candidate', color: candidateColors[firelines.candidates.indexOf(firelines.selected)],
                  type: 'Other example', coordinates: firelines.selected.geometry.coordinates }]);
                setLineId(id); showTab('lines');
              } }}/>)}
          {tab === 'history' && (responder || mobile) && <WindHistory apply={(wind, label) => {
            editScenario({ ...scenario, wind }, 'HISTORICAL WIND INPUT');
            setArchivedWind(label);
            showTab('scenario');
          }}/>}
          {tab === 'insights' && mobile && <><div className="mobile-sheet-shortcuts">
            <button onClick={() => showTab('history')}><History size={16}/>Historical wind</button>
            <button onClick={openAgent}><Sparkles size={16}/>Analyze with Nemotron</button>
          </div>{responder && <div className="mobile-line-total"><span><strong>{lines.length}</strong> proposed {lines.length === 1 ? 'line' : 'lines'}</span>
            <span><strong>{decimal(totalLineKm, 2)} km</strong> total</span></div>}{metricContent}</>}
          {tab === 'preparedness' && mobile && <Section title="Response timing"><ResponseGap contact={contact}/></Section>}
          {business && (tab === 'scenario' || tab === 'presets') && <BusinessDemoButton launch={launchBusiness}/>}
          {!business && (!mobile || tab === 'scenario' || tab === 'presets') && <Section title="Fictional demo presets" action={<RotateCcw size={15}/>}>
            <div className="preset-list">{demos.map((preset, index) => <button key={preset.title} className={index === demo && fictional ? 'active' : ''}
              onClick={() => launch(index)}><span><b>{preset.title}</b><small>{preset.location}</small></span><ChevronDown size={14}/></button>)}</div>
          </Section>}
  </>;
  const mobileTools = <MobileTools mode={mode} scenario={() => showTab(responder ? 'wind' : 'scenario')} preparedness={() => showTab('preparedness')}
    alerts={() => showTab('alerts')} insights={() => showTab('insights')} lines={() => showTab('lines')}
    replay={() => showTab('replay')} replayActive={historyActive} intelligence={() => showTab('firelines')}
    assets={() => showTab('assets')} exposure={() => showTab('exposure')} smoke={() => showTab('smoke')}/>;

  const mapLegend = <div className="legend"><span><i style={{ background: branchFrame ? '#c59cfa' : '#ff6038' }}/>{branchFrame ? 'Barrier intervention' : 'Modeled footprint'}</span>
          {branchFrame ? showBaseline && <span><i style={{ background: '#54cbe9' }}/>Modeled baseline</span> :
            <span><i style={{ background: '#ff9a6c' }}/>300 m proximity</span>}
          {compare && <span><i style={{ background: '#a78bfa' }}/>Scenario B</span>}
          {responder && <span><i style={{ background: '#fcd776' }}/>Proposed lines</span>}
          {responder && !branchFrame && layers.line && selectedLine && <span><i className="overlap-key"/>Selected line inside footprint</span>}
          {responder && layers.line && Boolean(selectedGeometry?.intersections.length) && <span><i style={{ background: '#ffd26f' }}/>Perimeter intersection</span>}
          {responder && firelines.candidates.length > 0 && <span><i style={{ background: '#4ed8ef' }}/>Generated candidates</span>}
          {responder && firelines.preview && firelines.candidates.length > 0 && <span><i style={{ background: '#b67643' }}/>Future footprint</span>}
          {civilian && point && <span><i style={{ background: '#80d9ff' }}/>Selected point</span>}
          {business && layers.assets && registry.assets.some((asset) => asset.category === PROPERTY_BOUNDARY) && <span><i style={{ background: '#527f9b' }}/>Property boundary</span>}
          {business && layers.assets && registry.assets.some((asset) => asset.category !== PROPERTY_BOUNDARY) && <span><i style={{ background: '#168578' }}/>Registered assets</span>}
          {business && layers.assets && exposure.affectedAcres > 0 && <span><i style={{ background: '#fac257' }}/>Assets in footprint</span>}
          {civilian && (plans.A.length >= 2 || plans.B.length >= 2) && <span><i style={{ background: '#62dbc7' }}/>Practice sketches</span>}
        </div>;
  const markers: Parameters<typeof SimulationDock>[0]['markers'] = [];
  if (shift) markers.push({ kind: 'shift', minute: shift.minute, label: 'Wind shift · minute ' + shift.minute });
  if (business && exposure.firstContact) markers.push({ kind: 'contact', minute: exposure.firstContact.to,
    label: 'First modeled asset contact · ' + contactLabel(exposure.firstContact) });
  if (civilian && contact) markers.push({ kind: 'completion', minute: contact.to, label: 'Modeled point contact · ' + contactLabel(contact) });
  const selectedBarrier = paired?.lines.find(({ id }) => id === selectedId);
  const firstLineContact = selectedBarrier ? selectedBarrier.intervention === null ? undefined : interventionStart! + selectedBarrier.intervention : lineStats?.contact?.to;
  if (responder && selectedLine && firstLineContact !== undefined) markers.push({ kind: 'contact', minute: firstLineContact,
    label: 'First sampled line contact · minute ' + firstLineContact });
  const completion = selectedLine && (interventionStart === undefined ? selectedLine.completionMinute :
    Math.max(interventionStart, selectedLine.completionMinute ?? interventionStart));
  if (responder && completion !== undefined && completion <= scenario.durationMinutes) {
    markers.push({ kind: 'completion', minute: completion, label: 'Assumed line completion · minute ' + completion });
  }

  return <div className={'shell' + (mobile ? ' mobile-shell' : '')}>
    {mobile ? <MobileHeader recenter={center} alerts={() => showTab('alerts')} presets={() => showTab('presets')}/> : <>
    <header className="masthead">
      <div className="brand"><span className="brand-icon"><Flame size={24}/></span><div><strong>Ember<span>Watch</span></strong><small>WILDFIRE INTELLIGENCE & SCENARIO LAB</small></div></div>
      <nav className="modes" aria-label="Workspace mode">
        <button aria-pressed={civilian} onClick={() => switchMode('civilian')}><Shield size={17}/>Civilian</button>
        <button aria-pressed={responder} onClick={() => switchMode('responder')}><Radio size={17}/>Responder Lab</button>
        <button aria-pressed={business} onClick={() => switchMode('business')}><BriefcaseBusiness size={17}/>Business</button>
      </nav>
      <div className="mast-actions"><span className="tag hypothetical"><i/>{historyActive ? 'HISTORICAL REPLAY' : fictional ? 'FICTIONAL SCENARIO' : 'HYPOTHETICAL'}</span>
        <button className="demo-button" onClick={business ? launchBusiness : () => launch(responder ? 1 : 0)}><Play size={15}/>Launch Demo</button></div>
    </header>
    <div className={'subhead' + (responder ? ' responder-subhead' : '')}>
      <nav aria-label="Workspace tools">{tabs[mode].map(({ key, title, icon: Icon }) => <button key={key} onClick={() => showTab(key)} aria-label={title}
        aria-current={tab === key ? 'page' : undefined}><Icon size={16}/><span className={key === 'preparedness' ? 'wide-label' : undefined}>{title}</span>
        {key === 'preparedness' && <span className="narrow-label">Preparedness</span>}</button>)}</nav>
      {responder && <span className="training" title="Training sandbox only. Use official incident-command software for operations."><FlaskConical size={14}/><span>Training sandbox</span></span>}
      <button className="sub-agent" onClick={openAgent}><Sparkles size={16}/>Analyze with Nemotron</button>
    </div>
    </>}
    <main className={'workspace' + (historyActive ? ' historical-workspace' : '')}>
      {!mobile && <aside className="left-panel" aria-label="Scenario controls"><div className="left-scroll">{toolContent}</div></aside>}
      <div className={'map-column' + (mobile && expanded ? ' is-expanded' : '')}>
        <MapView overlays={historyActive ? history.overlays : overlays} point={historyActive ? history.point : scenario.ignition}
          viewport={historyActive ? 'history' : 'scenario'} camera={historyActive ? history.camera : camera}
          title={historyActive ? history.title : fictional ? businessLocation ?? demos[demo].location : mobile ? 'Custom scenario' : 'Scenario map'}
          mode={historyActive ? history.mapMode : mapMode} historical={historyActive} drawing={historyActive ? history.tapping : mapMode === 'Draw Line' || mapMode === 'Edit Line' && vertex !== undefined} drawingToolbar={mobile && historyActive ? history.mapActions : undefined} historicalStatus={historyActive ? history.status : undefined} fictional={fictional}
          mobile={mobile} legend={mobile ? (historyActive ? history.legend : mapLegend) : undefined}
          expanded={expanded} onExpand={() => setExpanded(!expanded)}
          onMapTools={() => returnToTools(historyActive ? 'replay' : business ? 'assets' : responder ? 'scenario' : 'explore')}
          focusCandidate={historyActive ? history.fit : focusCandidate}
          onCandidate={historyActive ? history.selectCandidate : responder ? (id) => { firelines.select(id); showTab('firelines'); } : undefined}
          centerOnIgnition={center} onPick={historyActive ? history.pick : mapPick}
          wind={historyActive ? history.wind : { from: snapshot.activeWind.fromDeg, toward: direction, mph: snapshot.activeWind.speedMph }}
          layers={historyActive ? history.layers : layerControls}/>
        {!mobile && (historyActive ? history.legend : mapLegend)}
        {mobile && !historyActive && mapMode !== 'Explore' && <MobileMapActions label={mapMode}
          detail={editingCandidate ? candidateError ?? (vertex === undefined ? 'Choose a vertex to edit' : 'Tap its new position')
            : hasLineDraft ? (mapMode === 'Edit Line' ? vertex === undefined ? 'Choose a vertex to move' : 'Tap its new position' : draft.length + ' vertices · tap to add')
            : drawingAsset ? registry.error ?? registry.draft.length + '/' + MAX_ASSET_VERTICES + ' corners · tap to add'
            : sketching ? 'Tap to add points to Plan ' + selectedPlan : 'Tap the map to place a pin'}
          cancel={closeMapTool} vertices={editingCandidate ? () => returnToTools('firelines') : mapMode === 'Edit Line' ? () => returnToTools('lines') : undefined}
          undo={drawingAsset && registry.draft.length ? undoAsset : editingCandidate && candidateUndo ? undoCandidateVertex : mapMode === 'Draw Line' && draft.length ? () => setDraft(draft.slice(0, -1)) : mapMode === 'Edit Line' ? () => {
            setDraft(selectedLine?.coordinates ?? []); setVertex(undefined);
          } : sketching && plans[selectedPlan].length ? () => updatePlan(selectedPlan, plans[selectedPlan].slice(0, -1)) : undefined}
          finish={drawingAsset ? finishAsset : editingCandidate ? finishCandidate : hasLineDraft ? () => { finishLine(); returnToTools('lines'); } : sketching ? closeMapTool : undefined}
          finishLabel={drawingAsset ? 'Finish polygon' : sketching ? 'Finish sketch' : undefined}
          canFinish={drawingAsset ? registry.draft.length >= 3 : editingCandidate || (hasLineDraft ? new Set(draft.map((position) => position.join(','))).size >= 2 : sketching)}/>}
      </div>
      {!mobile && <aside className="right-panel" aria-label="Scenario metrics">{historyActive ? (tab === 'insights' ? history.summaryPanel : history.panels.analysis) : metricContent}</aside>}
      {historyActive ? history.timeline : <SimulationDock mobile={mobile} snapshot={snapshot} duration={scenario.durationMinutes} clockFormat={responder} waiting={interventionRun.running} playing={playing} speed={speed} setSpeed={setSpeed}
        markers={markers} metrics={[
          decimal(fireAcres) + ' acres',
          responder ? decimal(expansionRate(rateStart, rateEnd), 2) + ' ac/min' :
            business ? decimal(exposure.affectedAcres, 2) + ' asset ac in footprint' : point ? 'Contact · ' + contactLabel(contact) : 'Select a point',
        ]} toggle={() => {
          if (!playing && minute >= scenario.durationMinutes) setMinute(0);
          play(!playing);
        }} restart={() => { setMinute(0); play(false); }} scrub={(value) => { setMinute(value); play(false); }}
        showMetrics={() => showTab(business ? 'exposure' : 'insights')} analyze={openAgent}/>}
      {mobile && mobileTools}
    </main>
    {mobile && <><MobileNavigation mode={mode} select={switchMode}/>
      <MobileSheet compact={historyActive} title={sheetTitles[tab]} open={sheetOpen && !(historyActive && history.tapping)} close={() => setSheetOpen(false)}>{toolContent}</MobileSheet>
    </>}
    <div className="drill-live" aria-live="polite" aria-atomic="true">
      {drill && <aside className="drill-toast" aria-label="Simulated drill notification" key={drill.id}>
        <Flag size={19}/>
        <div><strong>DRILL — SIMULATED</strong><p>At minute {drill.minute}, the hypothetical footprint covers {decimal(drill.acres)} acres in this exercise.</p></div>
        <button aria-label="Dismiss drill notification" onClick={() => setDrill(undefined)}><X size={18}/></button>
      </aside>}
    </div>
    {history.agent}
    {!historyActive && agent && <Intelligence input={{ mode, scenario, comparison, lines: responder ? lines : undefined,
      intervention: responder && interventionStart !== undefined && branchMinute >= 0 ? { start: interventionStart, minute } : undefined,
      business: business ? { minute: snapshot.minute, assets: registry.assets } : undefined }} showPoint={civilian ? point : undefined}
      mobile={mobile} session={investigations[mode]} close={(session) => {
        setInvestigations((previous) => ({ ...previous, [mode]: session }));
        setAgent(false);
        if (mobile && agentReturnToSheet) setSheetOpen(true);
      }}/>}
  </div>;
}
