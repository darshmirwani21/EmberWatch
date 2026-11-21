import { area, polygon } from '@turf/turf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { investigate } from '../../server/agent';
import type { Complete, ToolCall } from '../../server/nvidia';
import { getAirQuality, parseAirQuality } from '../../server/sources';
import { PROPERTY_BOUNDARY } from '../../shared/businessContracts';
import { businessPolygon, indexBusinessExposure, measureBusinessExposure, SQUARE_METERS_PER_ACRE, verifiedBusinessAsset } from '../../shared/businessExposure';
import { requestSchema, type Coordinate } from '../../shared/contracts';
import { simulate } from '../../shared/engine';
import { vineyardAssets, vineyardDemo } from '../../shared/vineyardDemo';

const box = (left: number, right: number): Coordinate[] => [[left, 38.3], [right, 38.3], [right, 38.31], [left, 38.31]];
const asset = (id: string, left: number, right: number, declaredValue?: number, category = 'Timber stand') =>
  verifiedBusinessAsset({ id, category, name: 'Private outline ' + id, geometry: businessPolygon(box(left, right)), declaredValue, areaAcres: 1 });
const seed = simulate(vineyardDemo.scenario)[0];
const frame = (minute: number, left: number, right: number) => ({ ...seed, minute, polygon: polygon(businessPolygon(box(left, right)).coordinates) });

describe('Business exposure', () => {
  it('recomputes acreage, uses positive-area contact and prorates values at the selected frame', () => {
    const a = asset('a', 0, .02, 1000);
    expect(a.areaAcres).toBeCloseTo(area(polygon(a.geometry.coordinates)) / SQUARE_METERS_PER_ACRE, 8);
    const frames = [frame(0, -.01, 0), frame(5, -.01, .01), frame(10, -.01, .02)];
    const index = indexBusinessExposure([a], frames);
    expect(measureBusinessExposure(index, frames[0])).toMatchObject({ affectedAcres: 0, firstContact: { from: 0, to: 5 }, declaredValueInFootprint: 0 });
    const overlap = measureBusinessExposure(index, frames[1]);
    expect(overlap.affectedAcres).toBeCloseTo(a.areaAcres / 2, 7);
    expect(overlap.declaredValueInFootprint).toBeCloseTo(500, 7);
    expect(measureBusinessExposure(index, frames[2]).declaredValueInFootprint).toBeCloseTo(1000);
  });
  it('counts shared ground once, adds separate declared assets and excludes property outlines', () => {
    const frames = [frame(0, 0, .02)];
    const a = asset('a', 0, .02, 120);
    const index = indexBusinessExposure([a, asset('b', .005, .015, 30), asset('c', 0, .02),
      asset('property', -.01, .04, undefined, PROPERTY_BOUNDARY)], frames);
    const exposure = measureBusinessExposure(index, frames[0]);
    expect(exposure.rows).toHaveLength(3);
    expect(exposure.affectedAcres).toBeCloseTo(a.areaAcres, 8);
    expect(exposure).toMatchObject({ declaredValueInFootprint: 150, unvaluedAffected: 1, assetsAffected: 3, firstContact: { from: 0, to: 0 } });
  });
  it('preserves missing values and distinguishes zero and no contact', () => {
    const frames = [frame(0, 0, .02)];
    const measure = (assets: ReturnType<typeof asset>[]) => measureBusinessExposure(indexBusinessExposure(assets, frames), frames[0]);
    expect(measure([asset('missing', 0, .02)])).toMatchObject({ declaredValueInFootprint: null, unvaluedAffected: 1 });
    expect(measure([asset('zero', 0, .02, 0)])).toMatchObject({ declaredValueInFootprint: 0, unvaluedAffected: 0 });
    expect(measure([asset('outside', .03, .04)])).toMatchObject({ affectedAcres: 0, firstContact: null, declaredValueInFootprint: 0 });
    expect(measure([])).toMatchObject({ rows: [], affectedAcres: 0, firstContact: null });
  });
  it('rejects crossed and open rings and has a measurable fictional wind-shift demo', () => {
    expect(() => businessPolygon([[0, 0], [1, 1], [0, 1], [1, 0]])).toThrow();
    const a = asset('a', 0, .02, 0);
    const ring = a.geometry.coordinates[0].slice();
    ring[ring.length - 1] = [.0001, 38.3];
    expect(() => verifiedBusinessAsset({ ...a, geometry: { type: 'Polygon', coordinates: [ring] } })).toThrow('closed');
    const frames = simulate(vineyardDemo.scenario);
    const selected = frames[vineyardDemo.minute / 5];
    const demo = measureBusinessExposure(indexBusinessExposure(vineyardAssets, frames), selected);
    expect(vineyardAssets.every((a) => a.fictional)).toBe(true);
    expect(demo.affectedAcres).toBeGreaterThan(0);
    expect(demo.assetsAffected).toBeLessThan(demo.rows.length);
    expect(selected.activeWind).toEqual(vineyardDemo.scenario.shift.wind);
  });
});

const stamp = '2026-11-21T20:00';
const samples = {
  latitude: 38.3, longitude: -122.4, utc_offset_seconds: 0,
  hourly_units: { pm2_5: 'μg/m³' },
  hourly: { time: [stamp, '2026-11-21T21:00'], pm2_5: [0, null] },
};
const forecast = { current: { temperature_2m: 52, wind_speed_10m: 11, wind_direction_10m: 270, relative_humidity_2m: 62, time: stamp },
  current_units: { temperature_2m: '°F', wind_speed_10m: 'mp/h', wind_direction_10m: '°', relative_humidity_2m: '%' } };
afterEach(() => vi.unstubAllGlobals());
describe('Business sources and tools', () => {
  it('validates timestamps and units, preserves null samples, and reports separately missing wind', async () => {
    expect(parseAirQuality(samples).hours).toEqual([{ validAt: stamp + ':00Z', pm25: 0 }, { validAt: '2026-11-21T21:00:00Z', pm25: null }]);
    expect(() => parseAirQuality({ ...samples, hourly: { ...samples.hourly, pm2_5: [null, null] } })).toThrow();
    expect(() => parseAirQuality({ ...samples, hourly: { ...samples.hourly, pm2_5: [0] } })).toThrow();
    vi.stubGlobal('fetch', (url: URL) => Promise.resolve(url.pathname.endsWith('air-quality') ? Response.json(samples) : new Response(null, { status: 503 })));
    expect(await getAirQuality(vineyardDemo.scenario.ignition)).toMatchObject({ status: 'ok', data: { wind: null } });
  });

  const model = 'nvidia/nemotron-test';
  const call = (name: string, args: string): ToolCall => ({ id: name, type: 'function', function: { name, arguments: args } });
  const input = requestSchema.parse({ mode: 'business', question: 'Business overview', scenario: vineyardDemo.scenario,
    business: { minute: vineyardDemo.minute, assets: vineyardAssets } });
  it('dispatches scenario, exposure and air-quality tools and retries invalid synthesis with verified IDs', async () => {
    vi.stubGlobal('fetch', (url: URL) => Promise.resolve(Response.json(url.pathname.endsWith('air-quality') ? samples : forecast)));
    const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model, content: null,
      calls: [call('run_fire_simulation', '{"scenario":"A"}'), call('analyze_business_exposure', '{"scenario":"A"}'), call('get_business_air_quality', '{}')] })
      .mockResolvedValueOnce({ model, calls: [], content: '{"selectedEvidence":["E99"]}' })
      .mockImplementationOnce(async (messages, tools) => {
        expect(tools).toBeUndefined();
        expect(messages[1].content).toContain('"E3"');
        return { model, calls: [], content: '{"selectedEvidence":["E1","E3","E6"]}' };
      });
    const result = await investigate(input, invoke);
    expect(result).toMatchObject({ live: true, status: 'completed', businessExposure: { minute: 45, fictionalAssets: true } });
    expect(result.toolTrace.map((entry) => [entry.name, entry.outcome])).toEqual([
      ['run_fire_simulation', 'success'], ['analyze_business_exposure', 'success'], ['get_business_air_quality', 'success'],
    ]);
    const modelData = JSON.stringify(invoke.mock.calls);
    expect(modelData).not.toContain('West Pinot Block');
    expect(modelData).not.toContain('-122.381');
    expect(result.numericEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'First regional PM2.5 forecast', value: 0 }),
      expect.objectContaining({ label: 'Regional weather wind FROM', value: 270 }),
    ]));
    expect(result.sources[0].issuedAt).toBe(stamp + ':00Z');
    expect(result.businessExposure?.rows[0]).toMatchObject({ ref: 'Asset 1', name: 'West Pinot Block', fictional: true });
  });
  it('reports when asset consent is missing, and rejects minutes past the horizon', async () => {
    const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model, content: null, calls: [call('analyze_business_exposure', '{"scenario":"A"}')] })
      .mockResolvedValue({ model, content: '{"selectedEvidence":["E1"]}', calls: [] });
    const result = await investigate({ ...input, business: { minute: 0 } }, invoke);
    expect(result).toMatchObject({ status: 'unavailable', toolTrace: [{ outcome: 'error', detail: expect.stringContaining('No asset outlines') }] });
    expect(result.businessExposure).toBeUndefined();
    expect(requestSchema.safeParse({ ...input, business: { minute: 125 } }).success).toBe(false);
  });
});

