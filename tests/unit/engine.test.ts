import { describe, expect, it } from 'vitest';
import { distance } from '@turf/turf';
import { demos, defaultComparison } from '../../shared/demos';
import { analyzeLine, coordinate, expansionRate, footprintOverlap, geometryAt, pointContact, project, simulate } from '../../shared/engine';
import type { Coordinate, Scenario } from '../../shared/contracts';
import { summarizeWind } from '../../shared/windHistory';

const center = demos[0].scenario.ignition;
const scenario: Scenario = { ignition: center, durationMinutes: 120, wind: { fromDeg: 0, speedMph: 24 }, humidity: 30, dryness: .7 };
const final = (s: Scenario) => simulate(s).at(-1)!;

describe('geodesic illustrative front', () => {
  it('projects [longitude, latitude] and produces valid closed rings and acre units', () => {
    const north = project(center, 0, 1000);
    expect(north[0]).toBeCloseTo(center.lng, 8);
    expect(north[1]).toBeGreaterThan(center.lat);
    expect(distance(coordinate(center), north, { units: 'meters' })).toBeCloseTo(1000, 5);
    const start = simulate(scenario)[0];
    const ring = start.polygon.geometry.coordinates[0];
    expect(ring).toHaveLength(73);
    expect(ring.at(-1)).toEqual(ring[0]);
    expect(start.acres).toBeCloseTo(Math.PI * 75 ** 2 / 4046.8564224, 1);
  });
  it.each([[180, 0, 36], [0, 36, 0], [90, 54, 18]])('wind FROM %i grows downwind', (fromDeg, down, up) => {
    const end = final({ ...scenario, wind: { fromDeg, speedMph: 24 } });
    expect(end.radial[down]).toBeGreaterThan(end.radial[up]);
  });
  it('keeps calm rays symmetric and grows more with higher wind, lower humidity and drier fuel', () => {
    const calm = final({ ...scenario, wind: { fromDeg: 90, speedMph: 0 } });
    expect(new Set(calm.radial).size).toBe(1);
    expect(final(scenario).radial[36]).toBeGreaterThan(calm.radial[36]);
    expect(final({ ...scenario, humidity: 15 }).acres).toBeGreaterThan(final(scenario).acres);
    expect(final({ ...scenario, dryness: .9 }).acres).toBeGreaterThan(final(scenario).acres);
  });
  it('preserves the entire pre-shift record and only adds future growth', () => {
    const shifted = { ...scenario, shift: { minute: 35, wind: { fromDeg: 180, speedMph: 32 } } };
    const first = simulate(shifted);
    const steady = simulate(scenario);
    expect(first).toEqual(simulate(shifted));
    expect(first.slice(0, 7)).toEqual(steady.slice(0, 7));
    expect(first[7].polygon).toEqual(steady[7].polygon);
    expect(first[7].activeWind.fromDeg).toBe(180);
    expect(first[8].polygon).not.toEqual(steady[8].polygon);
    for (let i = 1; i < first.length; i++) first[i].radial.forEach((r, j) => expect(r).toBeGreaterThan(first[i - 1].radial[j]));
  });
  it('tests contact, no-contact, and the actual fictional demo outcomes', () => {
    const south = demos[0];
    const run = simulate(south.scenario);
    expect(pointContact(run, center)).toEqual({ from: 0, to: 0 });
    expect(pointContact(run, { lat: 35, lng: -119 })).toBeNull();
    expect(pointContact(run, south.point!)).not.toBeNull();
    expect(final(demos[2].scenario).acres).toBeLessThan(final(defaultComparison(demos[2].scenario, 2)).acres);
    const santa = simulate(demos[1].scenario);
    const [a, b] = demos[1].lines.map((line) => analyzeLine(santa, line.coordinates));
    expect(a.contact?.to).toBeLessThan(b.contact?.to ?? 0);
    expect(b.contact?.to).toBeLessThanOrEqual(120);
  });
  it('identifies perimeter crossing, tangent, wholly overlapped and disjoint geometries', () => {
    const snapshots = simulate(scenario);
    const start = snapshots[0];
    const across: Coordinate[] = [project(center, 270, 1000), project(center, 90, 1000)];
    expect(analyzeLine(snapshots, across).km).toBeCloseTo(2, 4);
    expect(geometryAt(start, across).intersections).toHaveLength(2);
    const clipped = footprintOverlap(start, across);
    expect(clipped.kilometers).toBeCloseTo(.15, 3);
    expect(clipped.segments).toHaveLength(1);
    expect(distance(...clipped.segments[0] as [Coordinate, Coordinate], { units: 'kilometers' })).toBeCloseTo(clipped.kilometers, 8);
    const corner = start.polygon.geometry.coordinates[0].reduce((a, b) => a[1] > b[1] ? a : b);
    const tangent: Coordinate[] = [[corner[0] - .001, corner[1]], [corner[0] + .001, corner[1]]];
    expect(geometryAt(start, tangent).intersections).toHaveLength(1);
    const inner: Coordinate[] = [coordinate(center), project(center, 180, 10)];
    expect(analyzeLine(snapshots, inner)).toMatchObject({ contact: null, overlappedWithoutIntersection: { from: 0, to: 0 } });
    expect(geometryAt(start, inner).overlap).toBe(true);
    expect(footprintOverlap(start, inner).kilometers).toBeCloseTo(.01, 5);
    expect(geometryAt(start, [[-115, 35], [-115, 36]]).overlap).toBe(false);
    expect(simulate(scenario)).toEqual(snapshots);
  });
  it('normalizes expansion by elapsed minutes using the interval after the selected snapshot', () => {
    const run = simulate(demos[1].scenario);
    const current = run[7];
    const next = run[8];
    expect(expansionRate(current, next)).toBeCloseTo((next.acres - current.acres) / 5, 8);
    expect(expansionRate(current, next)).not.toBeCloseTo(expansionRate(run[6], current), 2);
  });
});
it('summarizes wind directions circularly and tracks calm hours separately', () => {
  const result = summarizeWind([{ speed: 2, direction: 359 }, { speed: 4, direction: 1 }, { speed: 0, direction: 160 }]);
  expect(result.meanFrom).toBe(0);
  expect(result.sectors).toEqual([2,0,0,0,0,0,0,0]);
  expect(result).toMatchObject({ calm: 1, median: 2, observations: 3 });
});
