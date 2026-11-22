import { describe, expect, it, vi } from 'vitest';
import { buildHistoricalPlayback, historicalBranchDuration, practiceOrigin, practiceSeed } from '../../shared/historicalPlayback';
import { DAY_HORIZON_MINUTES } from '../../shared/simulationTime';
import { historicalInterventionInput } from '../../shared/historicalIntervention';
import { simulateIntervention } from '../../shared/interventionSimulation';
import { replayRequest } from '../../shared/historyContracts';
import { downwind, project } from '../../shared/engine';
import { compareFootprints, historyCases, historyPolygon, makeReplayStudy } from '../../shared/history';
import { hasHistoryContext, loadHistory, runHistoryAgent } from '../../server/historyAgent';
import type { Complete } from '../../server/nvidia';

describe('historical playback', () => {
  it('starts all cases at their own ignition with a zero footprint and distinct weather', async () => {
    const weather = new Set<string>();
    for (const id of ['eaton', 'park', 'mosquito'] as const) {
      const run = buildHistoricalPlayback(await loadHistory(id));
      const [start, next] = run.frames;
      expect(start.time).toBe(Date.parse(historyCases[id].started));
      expect(start.recorded).toBeUndefined();
      expect(start.model?.acres).toBe(0);
      expect(next.model?.acres).toBeGreaterThan(0);
      expect(start.context).toBeDefined();
      weather.add(JSON.stringify(start.context));
      expect(run.modelEnd).toBe(DAY_HORIZON_MINUTES);
      expect(run.reconstruction).toHaveLength(289);
      const endOfDay = run.frames.find((frame) => frame.time === start.time + 86_400_000)!;
      expect(endOfDay.model!.acres).toBeGreaterThan(run.reconstruction[24].acres);
      expect(endOfDay.newRecord).toBeUndefined();
    }
    expect(weather.size).toBe(3);
  });

  it('uses source UTC hourly wind and humidity in each integration step and stops at a missing hour', async () => {
    const data = await loadHistory('eaton');
    const start = Date.parse(historyCases.eaton.started);
    const hour = Math.floor(start / 3600000) * 3600000;
    const weather = [
      { at: new Date(hour).toISOString(), fromDeg: 0, speedMph: 20, humidity: 10, temperatureF: 55 },
      { at: new Date(hour + 3600000).toISOString(), fromDeg: 180, speedMph: 20, humidity: 85, temperatureF: 45 },
    ];
    const run = buildHistoricalPlayback({ ...data, weather });
    const hourlyChange = run.frames.find((f) => f.time === hour + 3600000)!;
    expect(hourlyChange.context?.humidity).toBe(85);
    expect(hourlyChange.context?.fromDeg).toBe(180);
    expect(downwind(weather[0])).toBe(180);
    expect(downwind(weather[1])).toBe(0);
    expect(project(historyCases.eaton.ignition, downwind(weather[1]), 200)[1]).toBeGreaterThan(historyCases.eaton.ignition.lat);
    expect(run.reconstruction.find((s) => s.minute === 40)?.activeWind.fromDeg).toBe(0);
    expect(run.reconstruction.find((s) => s.minute === 45)?.activeWind.fromDeg).toBe(180);
    const at = (minute: number) => run.reconstruction[minute / 5].radial;
    const wetGrowth = at(50)[0] - at(45)[0];
    const drierGrowth = at(40)[36] - at(35)[36];
    expect(wetGrowth).toBeLessThan(drierGrowth);
    expect(run.modelLimitedByWeather).toBe(true);
    expect(run.frames.find((f) => f.time === hour + 2 * 3600000)?.context).toBeUndefined();
    expect(run.frames.at(-1)?.model).toBeUndefined();
  });

  it('presents each timed survey at its exact timestamp and never assigns archive-only geometry a time', async () => {
    for (const id of ['eaton', 'park', 'mosquito'] as const) {
      const bundled = await loadHistory(id);
      const run = buildHistoricalPlayback(bundled);
      expect(run.frames.flatMap((frame) => frame.newRecord ? [frame.newRecord.id] : [])).toEqual(run.timed.map((r) => r.id));
      for (const r of run.timed) {
        const index = run.frames.findIndex((frame) => frame.at === new Date(r.at!).toISOString());
        expect(run.frames[index].recorded?.geometry).toEqual(r.geometry);
        expect(run.frames[index - 1]?.recorded?.id).not.toBe(r.id);
      }
    }
  });

  it('branches from the correct archived outline or modeled sample without changing the replay', async () => {
    const data = await loadHistory('eaton');
    const run = buildHistoricalPlayback(data);
    const modeled = run.frames.find((frame) => frame.model?.minute === 30)!;
    const seed = practiceSeed(modeled);
    const study = makeReplayStudy(data, seed, { speedMph: 10, fromDeg: 180 }, 60);
    expect(practiceOrigin(seed)).toBe('Modeled reconstruction');
    expect(study.branch[0].radial).toEqual(modeled.model?.radial);
    expect(study.branch[1].radial).not.toEqual(modeled.model?.radial);
    const recorded = run.frames.find((frame) => frame.newRecord)!;
    const surveyed = makeReplayStudy(data, practiceSeed(recorded), { speedMph: 10, fromDeg: 0 }, 60);
    expect(compareFootprints(historyPolygon(recorded.newRecord!), surveyed.shape('baseline', 0)).iou).toBeCloseTo(1);
  });

  it('ends a historical counterfactual started at hour 6 at the first-day endpoint', async () => {
    const data = await loadHistory('mosquito');
    const records = structuredClone(data.records);
    const fire = historyCases[data.id];
    const frame = buildHistoricalPlayback(data).frames.find((entry) => entry.model?.minute === 360)!;
    const seed = practiceSeed(frame);
    const duration = historicalBranchDuration(fire.started, frame.at);
    const wind = { speedMph: 20, fromDeg: 315 };
    const barriers = [{ id: 'history', readyMinute: 300, geometry: { type: 'LineString' as const,
      coordinates: [project(fire.ignition, 145, 12_000), project(fire.ignition, 150, 12_000)] } }];
    const request = replayRequest.parse({ caseId: data.id, replayAt: frame.at, practicing: true, question: 'Compare the final sample.',
      workflow: 'barrier', wind, duration, minute: 1080, intervention: { barriers, manualWind: true } });
    const result = simulateIntervention(historicalInterventionInput(data, seed, wind, duration, request.intervention!));
    expect(duration).toBe(1080);
    expect(result.baseline[0].shape).toEqual(seed.model!.polygon);
    expect(result.baseline.at(-1)!.minute).toBe(1080);
    expect(result.intervention.at(-1)!.minute).toBe(1080);
    expect(result.intervention.at(-1)!.acres).toBeGreaterThan(result.intervention[24].acres);
    expect(data.records).toEqual(records);
  }, 20_000);

  it('validates the selected archive clock and exposes time-aligned ERA5 and modeled evidence', async () => {
    const data = await loadHistory('eaton');
    const frame = buildHistoricalPlayback(data).frames.find((item) => item.model?.minute === 60)!;
    const input = { caseId: 'eaton' as const, replayAt: frame.at, practicing: false, workflow: 'replay' as const, wind: { fromDeg: 0, speedMph: 0 },
      duration: 120, question: 'Describe weather and reconstruction.' };
    const names = ['retrieve_historical_fire', 'inspect_historical_weather', 'run_historical_reconstruction'];
    const invoke = vi.fn<Complete>().mockImplementationOnce(async (_, tools) => {
      expect(tools?.map((tool) => tool.function.name)).toEqual(names);
      return { model: 'nemotron-fixture', content: null, calls: names.map((name) => ({ id: name, type: 'function', function: { name, arguments: '{}' } })) };
    }).mockResolvedValue({ model: 'nemotron-fixture', content: '{"selectedEvidence":["E1","E2","E3"]}', calls: [] });
    expect(await hasHistoryContext(input)).toBe(true);
    expect(await hasHistoryContext({ ...input, replayAt: '2000-01-01T00:00:00Z' })).toBe(false);
    const result = await runHistoryAgent(input, invoke);
    expect(result.status).toBe('completed');
    expect(JSON.parse(result.evidence[1].text)).toMatchObject({ selectedTime: frame.at, currentWeather: frame.context });
    expect(JSON.parse(result.evidence[2].text)).toMatchObject({ atCursor: frame.model!.acres });
  });
});

