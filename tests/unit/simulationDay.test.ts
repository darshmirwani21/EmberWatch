import { describe, expect, it } from 'vitest';
import { requestSchema } from '../../shared/contracts';
import { simulate, pointContact, project, location, STEP } from '../../shared/engine';
import { indexBusinessExposure, measureBusinessExposure, verifiedBusinessAsset } from '../../shared/businessExposure';
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
