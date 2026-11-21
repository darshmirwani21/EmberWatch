import { area, booleanPointInPolygon, booleanValid, featureCollection, intersect, polygon } from '@turf/turf';
import { describe, expect, it, vi } from 'vitest';
import type { Coordinate } from '../../shared/contracts';
import type { BarrierLine } from '../../shared/interventionContracts';
import { buildHistoricalPlayback } from '../../shared/historicalPlayback';
import { historicalInterventionInput } from '../../shared/historicalIntervention';
import { interventionComparison, lineOutcome, simulateIntervention, type InterventionInput } from '../../shared/interventionSimulation';
import { project, simulate } from '../../shared/engine';
import { barrierConnections, firelineMesh } from '../../shared/firelineGrid';
import { historyCases } from '../../shared/history';
import { scenarioInterventionInput } from '../../shared/scenarioIntervention';
import { loadHistory, runHistoryAgent } from '../../server/historyAgent';
import type { Complete } from '../../server/nvidia';

const origin = { lat: 34, lng: -118 };
function point(x: number, y: number): Coordinate {
  return [origin.lng + x / (111195 * Math.cos(origin.lat * Math.PI / 180)), origin.lat + y / 111195];
}
const seed = polygon([[point(-60,-60), point(60,-60), point(60,60), point(-60,60), point(-60,-60)]]);
const atmosphere = { wind: { speedMph: 32, fromDeg: 270 }, humidity: 20 };
const input: InterventionInput = { origin, seed, duration: 100, dryness: .65, weather: Array.from({ length: 21 }, () => atmosphere),
  barriers: [], cellMeters: 40, location: point(750, 0) };
function wall(x: number, span: number, readyMinute = 0): BarrierLine {
  return { id: 'barrier-1', readyMinute, geometry: { type: 'LineString', coordinates: [point(x,-span),point(x,span)] } };
}

describe('idealized barrier grid', () => {
  it('matches both trajectories with no barrier and is deterministic', () => {
    const first = simulateIntervention(input);
    expect(first.baseline).toEqual(first.intervention);
    expect(first).toEqual(simulateIntervention(input));
    expect(first.baselineContact).toBeGreaterThan(0);
  });
  it('changes the footprint in path while a distant line has no effect', () => {
    const run = simulateIntervention({ ...input, barriers: [wall(480,3000)] });
    const comparison = interventionComparison(run, 40);
    expect(comparison.differenceAcres).toBeGreaterThan(10);
    expect(comparison.interventionContact ?? Infinity).toBeGreaterThan(comparison.baselineContact!);
    expect(comparison.lineContacts[0].baseline).not.toBeNull();
    const distant = simulateIntervention({ ...input, barriers: [wall(19000,2000)] });
    expect(distant.baseline).toEqual(distant.intervention);
  });
  it('allows spread to turn around finite ends', () => {
    const run = simulateIntervention({ ...input, barriers: [wall(480,200)] });
    expect(run.interventionContact).not.toBeNull();
    expect(run.interventionContact!).toBeGreaterThan(run.baselineContact!);
    expect(run.intervention.at(-1)!.acres).toBeGreaterThan(run.intervention[4].acres);
  });
  it('blocks a diagonal closed corridor whose segments meet at shared vertices', () => {
    const barrier: BarrierLine = { ...wall(0, 1), geometry: { type: 'LineString',
      coordinates: [point(-350, 0), point(0, 350), point(350, 0), point(0, -350), point(-350, 0)] } };
    const run = simulateIntervention({ ...input, barriers: [barrier] });
    expect(run.baselineContact).not.toBeNull();
    expect(run.interventionContact).toBeNull();
    expect(run.lines[0].blockedAt).not.toBeNull();
    expect(run.lines[0].bypassedAt).toBeNull();
    expect(booleanPointInPolygon(point(450, 0), run.intervention.at(-1)!.shape)).toBe(false);
  });
  it('gates every cross-diagonal connector where the line hits grid corners', () => {
    const lines: Parameters<typeof firelineMesh>[4] = [{ id: 'diagonal', ready: 0, points: [[0, 0], [150, 150], [300, 300]] }];
    const mesh = firelineMesh(4, 4, 75, [0, 0], lines);
    const gates = barrierConnections(mesh, lines);
    let crossings = 0;
    mesh.tiles.forEach((tile, i) => mesh.sides(tile, (neighbor) => {
      if (neighbor < 0) return;
      const [x, y] = mesh.center(tile), [nx, ny] = mesh.center(mesh.tiles[neighbor]);
      if (!(x - y >= 0 && nx - ny < 0)) return;
      crossings++;
      expect(gates.between(i, neighbor)?.[0].id).toBe('diagonal');
    }));
    expect(crossings).toBeGreaterThan(2);
  });
  it('represents a subcell line locally without blocking every route', () => {
    const settings = { ...input, cellMeters: 125, barriers: [wall(480, 49.05)] };
    const run = simulateIntervention(settings);
    expect(run.cellMeters).toBe(125);
    expect(run.localCellMeters).toBeLessThan(run.cellMeters);
    expect(run.lines[0].represented).toBe(true);
    expect(run.lines[0].blockedAt).not.toBeNull();
    expect(run.lines[0].bypassedAt).not.toBeNull();
    expect(lineOutcome(run.lines[0], 100)).toMatch(/bypassed/);
    expect(run.interventionContact).not.toBeNull();
    expect(run).toEqual(simulateIntervention(settings));
    const tiny = simulateIntervention({ ...settings, barriers: [wall(480, 1)] });
    expect(tiny.lines[0].represented).toBe(true);
  });
  it('does not invent protection behind the advancing front and restores equality after removal', () => {
    const scenario = { ignition: origin, durationMinutes: 55, humidity: atmosphere.humidity,
      dryness: input.dryness, wind: atmosphere.wind };
    const snapshot = simulate(scenario)[6];
    const behind = { id: 'behind', coordinates: [point(-15, -5), point(-15, 5)], completionMinute: 35 };
    const branch = scenarioInterventionInput(scenario, snapshot, [behind]);
    expect(branch.barriers[0].readyMinute).toBe(5);
    const paired = simulateIntervention(branch);
    expect(paired.baseline[0].shape).toEqual(snapshot.polygon);
    expect(paired.intervention).toEqual(paired.baseline);
    expect(lineOutcome(paired.lines[0], branch.duration)).toMatch(/no measurable effect/);
    const removed = simulateIntervention({ ...branch, barriers: [] });
    expect(interventionComparison(removed, branch.duration)).toMatchObject({ differenceAcres: 0, reductionPercent: 0, iou: 1 });
  });
  it('preserves burned cells and aligns trajectories before delayed completion', () => {
    const late = simulateIntervention({ ...input, barriers: [wall(480,3000,30)] });
    for (let i = 0; i < 6; i++) expect(late.intervention[i]).toEqual(late.baseline[i]);
    expect(late.interventionContact).toBe(late.baselineContact);
    const initial = simulateIntervention({ ...input, barriers: [wall(0,3000)] });
    expect(initial.intervention[0].shape).toEqual(seed);
    for (const frames of [late.baseline, late.intervention, initial.intervention]) {
      frames.forEach((frame, i) => {
        expect(Number.isFinite(frame.acres)).toBe(true);
        expect(frame.acres).toBeGreaterThanOrEqual((frames[i - 1]?.acres ?? 0) - 1e-7);
        expect(booleanValid(frame.shape)).toBe(true);
      });
    }
  });
  it('responds to a wind shift and calculates differences directly from snapshots', () => {
    const settings = { ...input, barriers: [wall(480,1600)], location: point(-900,0) };
    const unshifted = simulateIntervention(settings);
    const weather = input.weather.map((step, i) => i < 5 ? step : { ...step, wind: { ...step.wind, fromDeg: 90 } });
    const shifted = simulateIntervention({ ...settings, weather });
    expect(shifted.baseline.slice(0,6)).toEqual(unshifted.baseline.slice(0,6));
    expect(shifted.interventionContact ?? Infinity).toBeLessThan(unshifted.interventionContact ?? Infinity);
    const result = interventionComparison(shifted, 90);
    const before = shifted.baseline[18], after = shifted.intervention[18];
    expect(result.differenceAcres).toBeCloseTo((area(before.shape) - area(after.shape)) / 4046.8564224);
    const shared = intersect(featureCollection([before.shape, after.shape]))!;
    expect(result.iou).toBeCloseTo(area(shared) / (area(before.shape) + area(after.shape) - area(shared)));
    expect(result.contactDelayMinutes).toBe(shifted.interventionContact! - shifted.baselineContact!);
  });
  it('feeds historical weather into matched runs and keeps large Park studies bounded', async () => {
    const data = await loadHistory('park');
    const frame = buildHistoricalPlayback(data).frames.find((item) => item.newRecord)!;
    const config = historicalInterventionInput(data, { at: frame.at, record: frame.recorded, context: frame.context },
      { fromDeg: 90, speedMph: 20 }, 30, { barriers: [], manualWind: false });
    expect(config.weather[0].wind.speedMph).toBe(frame.context?.speedMph);
    const records = structuredClone(data.records);
    const ignition = historyCases.park.ignition;
    const barrier: BarrierLine = { ...wall(80,45), geometry: { type: 'LineString', coordinates: [project(ignition, 30, 300), project(ignition, 50, 300)] } };
    const run = simulateIntervention({ ...config, barriers: [barrier] });
    expect(data.records).toEqual(records);
    expect(run.cells).toBeLessThanOrEqual(36000);
    expect(run.cellMeters).toBeGreaterThan(75);
    expect(run.baseline[0].shape.geometry).toEqual(frame.recorded?.geometry);
  }, 20_000);
});

it('calls the real paired engine in the historical agent and returns its computed evidence', async () => {
  const names = ['retrieve_historical_fire','inspect_historical_weather','read_intervention_configuration','simulate_fireline_intervention'];
  const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model: 'nemotron-fixture', content: null,
    calls: names.map((name) => ({ id: name, type: 'function', function: { name, arguments: '{}' } })) })
    .mockResolvedValue({ model: 'nemotron-fixture', calls: [], content: '{"selectedEvidence":["E4"]}' });
  const result = await runHistoryAgent({
    caseId: 'eaton', replayAt: '2025-01-08T02:18:00.000Z', practicing: true, workflow: 'barrier',
    question: 'Compare my saved line with the no-barrier run.', duration: 30, minute: 30, wind: { speedMph: 30, fromDeg: 0 },
    intervention: { manualWind: true, barriers: [{ id: 'saved-line', readyMinute: 0, geometry: { type: 'LineString',
      coordinates: [[-118.114,34.188],[-118.096,34.188]] } }] },
  }, invoke);
  expect(result.status).toBe('completed');
  const evidence = JSON.parse(result.evidence[0].text);
  expect(evidence).toMatchObject({ branchAt: '2025-01-08T02:18:00.000Z', minute: 30, lineContacts: [{ id: 'saved-line', readyMinute: 0 }] });
  expect(evidence.differenceAcres).toBeGreaterThan(0);
  expect(evidence.interpretation).toContain('fewer modeled acres');
  expect(evidence.interpretation).toContain('No independent historical survey');
});

