import { describe, expect, it } from 'vitest';
import { requestSchema } from '../../shared/contracts';
import { simulate, pointContact, project, location, STEP } from '../../shared/engine';
import { indexBusinessExposure, measureBusinessExposure, verifiedBusinessAsset } from '../../shared/businessExposure';
import { interventionComparison, simulateIntervention } from '../../shared/interventionSimulation';
import { scenarioInterventionInput } from '../../shared/scenarioIntervention';
import { DAY_HORIZON_MINUTES } from '../../shared/simulationTime';

const ignition = { lat: 34, lng: -118 };
const scenario = { ignition, durationMinutes: DAY_HORIZON_MINUTES, wind: { speedMph: 26, fromDeg: 270 },
  humidity: 24, dryness: .8, shift: { minute: 900, wind: { speedMph: 15, fromDeg: 0 } } };

describe('24-hour workbench', () => {
  it('advances Civilian spread and point contact beyond four hours', () => {
    const parsed = requestSchema.parse({ mode: 'civilian', scenario, question: 'Where does the modeled front reach?' });
    const frames = simulate(parsed.scenario);
    expect(frames).toHaveLength(289);
    expect(frames.at(-1)!.minute).toBe(DAY_HORIZON_MINUTES);
    expect(frames.at(-1)!.acres).toBeGreaterThan(frames[240 / STEP].acres);
    expect(frames[900 / STEP].activeWind).toEqual(scenario.shift.wind);
    const position = location(project(ignition, 90, 16_000));
    expect(pointContact(frames, position)?.to).toBeGreaterThan(240);
  });

  it('continues matched Responder branches from hour 6 through hour 24', () => {
    const start = 6 * 60;
    const seed = simulate(scenario)[start / STEP];
    const center = location(project(ignition, 90, seed.maxRadiusMeters + 900));
    const request = requestSchema.parse({
      mode: 'responder', scenario, question: 'Compare the selected sample and the final run.',
      intervention: { start, minute: 900 },
      lines: [{ id: 'A', name: 'Hypothetical barrier', type: 'Other example', color: '#ededed', completionMinute: 425,
        coordinates: [project(center, 0, 18_000), project(center, 180, 18_000)] }],
    });
    const input = scenarioInterventionInput(request.scenario, seed, request.lines!);
    expect(input.barriers[0].readyMinute).toBe(65);
    expect(input.weather[(900 - start) / STEP].wind).toEqual(scenario.shift.wind);
    const run = simulateIntervention(input);
    expect(run.baseline[0].shape).toEqual(seed.polygon);
    expect(run.intervention[0]).toEqual(run.baseline[0]);
    expect(run.baseline[12]).toEqual(run.intervention[12]);
    expect(run.baseline.at(-1)!.minute + start).toBe(DAY_HORIZON_MINUTES);
    expect(run.intervention.at(-1)!.minute).toBe(run.baseline.at(-1)!.minute);
    const final = interventionComparison(run, DAY_HORIZON_MINUTES - start);
    expect(final.baselineAcres).toBeGreaterThan(seed.acres);
    expect(final.differenceAcres).toBeGreaterThan(0);
    expect(final.reductionPercent).toBeCloseTo(final.differenceAcres / final.baselineAcres * 100);
    expect(final.iou).toBeCloseTo(final.interventionAcres / final.baselineAcres);
  }, 40_000);

  it('calculates Business contact and declared exposure at hour 24', () => {
    const corners = [88, 89, 92, 93].map((bearing, i) => project(ignition, bearing, i === 1 || i === 2 ? 16_500 : 16_000));
    const asset = verifiedBusinessAsset({ id: 'late-asset', name: 'Fictional block', category: 'Vineyard block',
      declaredValue: 2500, fictional: true, geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
    const request = requestSchema.parse({ mode: 'business', question: 'Measure the final exposure.', scenario,
      business: { assets: [asset], minute: DAY_HORIZON_MINUTES } });
    const frames = simulate(request.scenario);
    const index = indexBusinessExposure([asset], frames);
    const exposure = measureBusinessExposure(index, frames[request.business!.minute / STEP]);
    expect(exposure.firstContact?.to).toBeGreaterThan(240);
    expect(exposure.affectedAcres).toBeGreaterThan(0);
    expect(exposure.declaredValueInFootprint).toBeGreaterThan(0);
  });
});
