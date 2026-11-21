import { area, booleanPointInPolygon, booleanPointOnLine, destination, length, lineIntersect, lineOverlap, lineString, point, polygon } from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import type { Coordinate, Point, Scenario, Wind } from './contracts';

export const STEP = 5;
export const PROXIMITY_METERS = 300;
const SQ_METERS_PER_ACRE = 4046.8564224;
const BEARINGS = Array.from({ length: 72 }, (_, i) => i * 5);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const coordinate = ({ lng, lat }: Point): Coordinate => [lng, lat];
export const location = ([lng, lat]: Coordinate): Point => ({ lng, lat });
export const downwind = ({ fromDeg }: Wind) => (fromDeg + 180) % 360;
export const lineReference = (id: string, index: number) => /^[AB]$/.test(id) ? id : 'L' + (index + 1);
export const unwrap = (lng: number, reference: number) => reference + ((((lng - reference) + 180) % 360 + 360) % 360 - 180);

export function project(origin: Point, bearing: number, meters: number): Coordinate {
  const [lng, lat] = destination(coordinate(origin), meters, bearing, { units: 'meters' }).geometry.coordinates;
  return [unwrap(lng, origin.lng), lat];
}

const spreadBase = (humidity: number, dryness: number) =>
  10 * (0.75 + 0.90 * clamp(dryness, 0, 1)) * clamp(1.45 - humidity / 100, 0.65, 1.55);
const windFactor = (wind: Wind, bearing: number) =>
  clamp(1 + 0.045 * wind.speedMph * Math.cos((bearing - downwind(wind)) * Math.PI / 180), 0.20, 3.80);
export function spreadMetersPerMinute(wind: Wind, humidity: number, dryness: number, bearing: number) {
  return spreadBase(humidity, dryness) * windFactor(wind, bearing);
}

function footprint(origin: Point, radial: number[], extra = 0): Feature<Polygon> {
  // Reverse compass bearings for a counterclockwise exterior ring.
  const ring = BEARINGS.map((bearing, i) => project(origin, bearing, radial[i] + extra)).reverse();
  return polygon([[...ring, ring[0]]]);
}

export type Snapshot = {
  minute: number; polygon: Feature<Polygon>; proximity: Feature<Polygon>;
  radial: number[]; acres: number; maxRadiusMeters: number; activeWind: Wind;
};
export function simulate(scenario: Scenario, initial?: Pick<Snapshot, 'minute' | 'radial'>,
  weatherAtStep?: (minute: number) => { wind: Wind; humidity: number }): Snapshot[] {
  const { ignition, humidity, dryness, durationMinutes, shift } = scenario;
  let radial = initial?.radial ?? BEARINGS.map(() => 75);
  const snapshots: Snapshot[] = [];
  for (let minute = initial?.minute ?? 0; minute <= durationMinutes; minute += STEP) {
    const weather = weatherAtStep?.(minute);
    const activeWind = weather?.wind ?? (shift && minute >= shift.minute ? shift.wind : scenario.wind);
    const base = spreadBase(weather?.humidity ?? humidity, dryness);
    const shape = footprint(ignition, radial);
    snapshots.push({
      minute, polygon: shape, proximity: footprint(ignition, radial, PROXIMITY_METERS),
      radial, acres: area(shape) / SQ_METERS_PER_ACRE, maxRadiusMeters: Math.max(...radial), activeWind,
    });
    radial = radial.map((radius, i) => radius + STEP * base * windFactor(activeWind, BEARINGS[i]));
  }
  return snapshots;
}

export type Contact = { from: number; to: number };
export const expansionRate = (start: Pick<Snapshot, 'minute' | 'acres'>, end: Pick<Snapshot, 'minute' | 'acres'>) => (end.acres - start.acres) / (end.minute - start.minute);
export const interval = (minute: number): Contact => ({ from: Math.max(0, minute - STEP), to: minute });
export const contactLabel = (contact: Contact | null) =>
  contact ? (contact.to === 0 ? 'Present at minute 0' : contact.from + '–' + contact.to + ' min') : 'Not reached during horizon';
function onBranch(position: Coordinate, shape: Feature<Polygon>): Coordinate {
  return [unwrap(position[0], shape.geometry.coordinates[0][0][0]), position[1]];
}
export function pointContact(snapshots: Snapshot[], position: Point): Contact | null {
  const hit = snapshots.find((s) => booleanPointInPolygon(point(onBranch(coordinate(position), s.polygon)), s.polygon));
  return hit ? interval(hit.minute) : null;
}

export function geometryAt(snapshot: Snapshot, coordinates: Coordinate[]) {
  const vertices = coordinates.map((p) => onBranch(p, snapshot.polygon));
  const path = lineString(vertices);
  const boundary = lineString(snapshot.polygon.geometry.coordinates[0]);
  const intersections = new Map<string, Coordinate>();
  function add(position: number[]) {
    const [lng, lat] = position;
    intersections.set(lng.toFixed(9) + ',' + lat.toFixed(9), [lng, lat]);
  }
  for (const hit of lineIntersect(path, boundary, { ignoreSelfIntersections: true }).features) add(hit.geometry.coordinates);
  // Turf's sweep can miss coincident endpoints or collinear portions.
  if (!intersections.size) {
    for (const vertex of vertices) {
      const p = point(vertex);
      if (booleanPointInPolygon(p, snapshot.polygon) && !booleanPointInPolygon(p, snapshot.polygon, { ignoreBoundary: true })) add(vertex);
    }
    if (!intersections.size) {
      for (const vertex of boundary.geometry.coordinates) {
        if (booleanPointOnLine(point(vertex), path, { epsilon: 1e-12 })) add(vertex);
      }
    }
    if (!intersections.size && vertices.some((v) => booleanPointInPolygon(point(v), snapshot.polygon))) {
      for (const overlap of lineOverlap(path, boundary).features) overlap.geometry.coordinates.forEach(add);
    }
  }
  return {
    intersections: [...intersections.values()],
    overlap: intersections.size > 0 || vertices.some((v) => booleanPointInPolygon(point(v), snapshot.polygon)),
  };
}

export function footprintOverlap(snapshot: Snapshot, coordinates: Coordinate[]) {
  const shape = snapshot.polygon;
  const segments: Coordinate[][] = [];
  let kilometers = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const a = onBranch(coordinates[i - 1], shape);
    const b = onBranch(coordinates[i], shape);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const squared = dx * dx + dy * dy;
    if (!squared) continue;
    const { intersections } = geometryAt(snapshot, [a, b]);
    const fractions = [0, 1, ...intersections.map(([x, y]) => clamp(((x - a[0]) * dx + (y - a[1]) * dy) / squared, 0, 1))]
      .sort((x, y) => x - y);
    const at = (t: number): Coordinate => [a[0] + t * dx, a[1] + t * dy];
    for (let j = 1; j < fractions.length; j++) {
      const [start, end] = [fractions[j - 1], fractions[j]];
      if (end - start > 1e-12 && booleanPointInPolygon(point(at((start + end) / 2)), shape)) {
        const segment = [at(start), at(end)];
        segments.push(segment);
        kilometers += length(lineString(segment), { units: 'kilometers' });
      }
    }
  }
  return { kilometers, segments };
}

export function analyzeLine(snapshots: Snapshot[], coordinates: Coordinate[]) {
  const km = length(lineString(coordinates), { units: 'kilometers' });
  let overlappedWithoutIntersection: Contact | null = null;
  for (const snapshot of snapshots) {
    const hit = geometryAt(snapshot, coordinates);
    if (hit.intersections.length) return {
      km, segments: coordinates.length - 1, contact: interval(snapshot.minute), intersections: hit.intersections,
      overlappedWithoutIntersection,
    };
    if (hit.overlap && !overlappedWithoutIntersection) overlappedWithoutIntersection = interval(snapshot.minute);
  }
  return { km, segments: coordinates.length - 1, contact: null, intersections: [], overlappedWithoutIntersection };
}
