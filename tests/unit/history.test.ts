import { describe, it, expect, vi } from 'vitest';
import { feature, polygon } from '@turf/turf';
import { loadHistory, runHistoryAgent } from '../../server/historyAgent';
import { type Complete, type ToolCall } from '../../server/nvidia';
import { acres, archiveWeather, compareFootprints, compareWithHistory, historyPolygon, makeReplayStudy, matchedHistory, replayCandidate, replayLineContact, sampledDisplacement } from '../../shared/history';
import { historyDataset, replayRequest } from '../../shared/historyContracts';
import { defaultFirelineParameters } from '../../src/engine/firelineCandidates';

const rectangle = (left: number, right: number) => polygon([[[left, 34.19], [right, 34.19], [right, 34.2], [left, 34.2], [left, 34.19]]]);
describe('historical evidence', () => {
  it('ships three verified case records and keeps undated geometry outside temporal matching', async () => {
    const [eaton, park, mosquito] = await Promise.all([loadHistory('eaton'), loadHistory('park'), loadHistory('mosquito')]);
    expect(eaton.records.map((record) => record.precision)).toEqual(['time', 'day', 'day', 'archive']);
    expect(park.records).toHaveLength(2);
    expect(mosquito.records.every((record) => !record.at && !record.date)).toBe(true);
    expect([eaton, park, mosquito].every((data) => data.weather.length && data.records.every((r) => acres(historyPolygon(r)) > 1000))).toBe(true);
    expect(archiveWeather(eaton, eaton.records[0])?.at).toBe('2025-01-10T14:00:00Z');
    expect(matchedHistory(eaton, eaton.records[0], 120)).toBeUndefined();
    expect(matchedHistory(eaton, eaton.records[1], 120)).toBeUndefined();
    expect(matchedHistory(park, park.records[0], 0)).toBeUndefined();
  });
  it('calculates areas, intersections, IoU, and displacement with actual geometry', () => {
    const a = rectangle(-118.12, -118.10);
    const b = rectangle(-118.11, -118.09);
    const match = compareFootprints(a,b);
    expect(match.overlapAcres).toBeCloseTo(match.observed / 2, 6);
    expect(match.iou).toBeCloseTo(1 / 3, 6);
    expect(compareFootprints(a,a).iou).toBeCloseTo(1);
    expect(compareFootprints(a,rectangle(-118.08,-118.07)).iou).toBe(0);
    expect(sampledDisplacement(a,a)).toBeCloseTo(0);
    expect(sampledDisplacement(a,b)).toBeGreaterThan(0);
  });
  it('seeds both futures with the exact observation and retains it while growing', async () => {
    const data = await loadHistory('eaton');
    const record = data.records[0];
    const study = makeReplayStudy(data, record, { speedMph: 25, fromDeg: 110 }, 60);
    expect(study.shape('baseline', 0).geometry).toEqual(record.geometry);
    expect(study.shape('branch', 0).geometry).toEqual(record.geometry);
    const comparison = compareFootprints(historyPolygon(record), study.shape('branch', 60));
    expect(comparison.overlapAcres).toBeCloseTo(comparison.observed, 4);
    expect(comparison.simulated).toBeGreaterThan(comparison.observed);
    const candidate = replayCandidate(study, defaultFirelineParameters[0]);
    const crossing = replayLineContact(study, candidate.geometry.coordinates, 'branch');
    expect(crossing === null || (crossing.to <= 60 && crossing.to % 5 === 0)).toBe(true);
    expect(compareWithHistory(data, record, study, 60)).toBeNull();
  });
  it('computes historical validation only when a later independent observation can be aligned', async () => {
    const bundled = await loadHistory('eaton');
    const first = bundled.records[0];
    const later = { ...first, id: 'later', at: '2025-01-10T15:22:10.000Z', geometry: feature(rectangle(-118.12,-118.10).geometry).geometry };
    const data = historyDataset.parse({ ...bundled, records: [first, later] });
    const study = makeReplayStudy(data, first, { fromDeg: 90, speedMph: 22 }, 60);
    expect(compareWithHistory(data, first, study, 55)).toBeNull();
    expect(compareWithHistory(data, first, study, 60)?.matchedAt).toBe(later.at);
  });
});

describe('historical Nemotron tools', () => {
  const input = replayRequest.parse({ caseId: 'eaton', recordId: 'firis-survey', question: 'Replay the observed fire.' ,
    duration: 60, minute: 35, wind: { fromDeg: 180, speedMph: 17 }, workflow: 'alternatives' });
  const model = 'nemotron-unit-test';
  const call = (name: string, args: object = {}): ToolCall => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  it('executes genuine calculations through validated provider tool calls and returns named evidence', async () => {
    const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model, content: null, calls: [
      call('retrieve_historical_fire'), call('inspect_historical_weather'), call('run_replay_baseline'), call('create_intervention_branch'),
      call('generate_replay_firelines', { alternatives: defaultFirelineParameters }),
    ] }).mockResolvedValueOnce({ model, content: null, calls: [call('evaluate_replay_firelines'), call('compare_replay_footprints')] })
      .mockResolvedValue({ model, content: '{"selectedEvidence":["E1","E2","E6","E7"]}', calls: [] });
    const result = await runHistoryAgent(input, invoke);
    expect(result.status).toBe('completed');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((candidate) => candidate.provenance === 'nemotron')).toBe(true);
    expect(result.trace).toHaveLength(7);
    const comparison = JSON.parse(result.evidence.find((entry) => entry.label === 'compare_replay_footprints')!.text);
    expect(comparison).toMatchObject({ minute: 35, matchedHistory: null });
    expect(replayRequest.safeParse({ ...input, minute: 65 }).success).toBe(false);
  });
  it('refines a verified candidate set and calculates revised crossing evidence', async () => {
    const alternatives = defaultFirelineParameters.map((params) => ({ ...params, targetLengthMeters: params.targetLengthMeters + 75 }));
    const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model, content: null, calls: [call('generate_replay_firelines', { alternatives: defaultFirelineParameters })] })
      .mockResolvedValueOnce({ model, content: null, calls: [call('evaluate_replay_firelines')] })
      .mockResolvedValueOnce({ model, content: null, calls: [call('refine_replay_firelines', { alternatives })] })
      .mockResolvedValue({ model, content: '{"selectedEvidence":["E3"]}', calls: [] });
    const result = await runHistoryAgent({ ...input, workflow: undefined }, invoke);
    expect(result.status).toBe('completed');
    expect(result.candidates[0].parameters.targetLengthMeters).toBe(alternatives[0].targetLengthMeters);
    const revised = JSON.parse(result.evidence[0].text);
    expect(revised.crossings.map(({ id }: { id: string }) => id)).toEqual(result.candidates.map(({ id }) => id));
  });
  it('rejects tools outside the allowlist and unsupported evidence references', async () => {
    const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model, content: null, calls: [call('invent_perimeter')] })
      .mockResolvedValue({ model, content: '{"selectedEvidence":["E1"]}', calls: [] });
    const result = await runHistoryAgent({ ...input, workflow: undefined }, invoke);
    expect(result.status).toBe('unavailable');
    expect(result.trace[0].outcome).toBe('error');
    expect(result.evidence).toEqual([]);
  });
});

