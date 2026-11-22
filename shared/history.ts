import { area, bbox, booleanIntersects, distance, feature, featureCollection, intersect, lineIntersect, lineString, pointToLineDistance, union } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { CaseId, HistoricDataset, HistoricRecord } from './historyContracts';
import type { Coordinate, Point, Scenario, Wind } from './contracts';
import { coordinate, interval, project, simulate, STEP } from './engine';
import { SQUARE_METERS_PER_ACRE } from './businessExposure';
import { generateCandidate, makeFirelineStudy } from '../src/engine/firelineCandidates';
import { MAX_FIRELINE_STUDY_RADIUS_METERS, type FirelineParameters, type FirelineRequest } from './firelineContracts';
import type { PracticeSeed } from './historicalPlayback';

export const historicalWeatherUrl = 'https://open-meteo.com/en/docs/historical-weather-api';
export const historyCases = {
  eaton: { title: 'Eaton Fire', place: 'Altadena and Pasadena', ignition: { lat: 34.19163, lng: -118.10544 }, started: '2025-01-08T02:18:00Z',
    incident: 'https://www.fire.ca.gov/incidents/2025/1/7/eaton-fire' },
  park: { title: 'Park Fire', place: 'Upper Bidwell Park, Northern California', ignition: { lat: 39.818579, lng: -121.802601 }, started: '2024-07-24T21:52:00Z',
    incident: 'https://www.fire.ca.gov/incidents/2024/7/24/park-fire' },
  mosquito: { title: 'Mosquito Fire', place: 'Sierra Nevada foothills', ignition: { lat: 39.00122, lng: -120.7246 }, started: '2022-09-07T01:00:00Z',
    incident: 'https://www.fire.ca.gov/incidents/2022/9/6/mosquito-fire' },
} satisfies Record<CaseId, { title: string; place: string; started: string; ignition: Point; incident: string }>;

export type ReplayShape = Feature<Polygon | MultiPolygon>;
export const historyPolygon = (record: HistoricRecord): ReplayShape => feature(record.geometry);
export const acres = (shape: ReplayShape) => area(shape) / SQUARE_METERS_PER_ACRE;
export const historyTime = (at: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short',
}).format(new Date(at));
export function recordTime(record: HistoricRecord) {
  return record.at ? historyTime(record.at) : record.date ? record.date + ' · date only' : 'Archive · observation time unavailable';
}

export function weatherAt(dataset: HistoricDataset, timestamp: string) {
  const targetHour = Math.floor(Date.parse(timestamp) / 3600000) * 3600000;
  return dataset.weather.find((row) => Date.parse(row.at) === targetHour);
}
export function archiveWeather(dataset: HistoricDataset, record: HistoricRecord) {
  if (record.at) return weatherAt(dataset, record.at);
  if (record.date) return weatherAt(dataset, record.date + 'T20:00:00Z');
  return weatherAt(dataset, historyCases[dataset.id].started);
}

const ringsOf = (shape: ReplayShape) => shape.geometry.type === 'Polygon' ? shape.geometry.coordinates : shape.geometry.coordinates.flat();
const boundaries = (shape: ReplayShape) => ringsOf(shape).map((ring) => lineString(ring));
export function seedRadii(origin: Point, shape: ReplayShape) {
  const [west, south, east, north] = bbox(shape);
  const center = coordinate(origin);
  const max = Math.max(...[[west,south],[west,north],[east,south],[east,north]].map((corner) => distance(center, corner, { units: 'meters' }))) + 100;
  const boundary = boundaries(shape);
  return Array.from({ length: 72 }, (_, index) => {
    const ray = lineString([center, project(origin, index * 5, max)]);
    const hits = boundary.flatMap((line) => lineIntersect(ray, line).features);
    return Math.max(75, ...hits.map((hit) => distance(center, hit, { units: 'meters' })));
  });
}

export function makeReplayStudy(dataset: HistoricDataset, input: HistoricRecord | PracticeSeed, wind: Wind, duration: number, preparedRadii?: number[]) {
  const record = 'id' in input ? input : input.record;
  const model = 'id' in input ? undefined : input.model;
  const observedShape = record && historyPolygon(record);
  const ignition = historyCases[dataset.id].ignition;
  const sample = 'id' in input ? archiveWeather(dataset, input) : input.context;
  const originalWind = sample ? { fromDeg: sample.fromDeg % 360, speedMph: sample.speedMph } : { fromDeg: 0, speedMph: 0 };
  const scenario: Scenario = { ignition, wind: originalWind, durationMinutes: duration, humidity: sample?.humidity ?? 35, dryness: .65 };
  const radial = model?.radial ?? (observedShape ? preparedRadii ?? seedRadii(ignition, observedShape) : undefined);
  const initial = radial ? { minute: 0, radial } : undefined;
  const baseline = simulate(scenario, initial);
  const branch = simulate({ ...scenario, wind }, initial);
  const seed = observedShape ?? baseline[0].polygon;
  const shapes = { baseline: new Map<number, ReplayShape>(), branch: new Map<number, ReplayShape>() };
  function shape(kind: 'baseline' | 'branch', minute: number): ReplayShape {
    if (minute === 0) return seed;
    const cached = shapes[kind].get(minute);
    if (cached) return cached;
    const frame = (kind === 'baseline' ? baseline : branch)[minute / STEP];
    if (!frame) throw new Error('Choose a five-minute sample inside the experiment.');
    // Retain the entire source perimeter, including portions the radial model cannot represent.
    const result = observedShape ? union(featureCollection([observedShape, frame.polygon])) ?? frame.polygon : frame.polygon;
    shapes[kind].set(minute, result);
    return result;
  }
  return { seed, scenario, baseline, branch, duration, shape };
}
type ReplayStudy = ReturnType<typeof makeReplayStudy>;
export function replayCandidate(study: ReplayStudy, parameters: FirelineParameters, duration = study.duration) {
  const request: FirelineRequest = { scenario: study.scenario, minute: 0, horizon: duration, radiusMeters: MAX_FIRELINE_STUDY_RADIUS_METERS };
  return generateCandidate(request, parameters, makeFirelineStudy(request, study.baseline));
}
export function replayLineContact(study: ReplayStudy, coordinates: Coordinate[], kind: 'baseline' | 'branch') {
  const line = lineString(coordinates);
  for (let minute = 0; minute <= study.duration; minute += STEP) {
    if (boundaries(study.shape(kind, minute)).some((edge) => booleanIntersects(line, edge))) return interval(minute);
  }
  return null;
}
export function compareFootprints(reference: ReplayShape, modeled: ReplayShape) {
  const overlap = intersect(featureCollection([reference, modeled]));
  const shared = overlap ? acres(overlap) : 0;
  const observed = acres(reference);
  const simulated = acres(modeled);
  return { observed, simulated, overlapAcres: shared, iou: shared / (observed + simulated - shared) };
}
export function sampledDisplacement(reference: ReplayShape, modeled: ReplayShape) {
  const sampled = (source: ReplayShape, target: ReplayShape) => {
    const all = ringsOf(source).flat();
    const step = Math.max(1, Math.ceil(all.length / 24));
    const targetEdges = boundaries(target);
    return all.filter((_, i) => i % step === 0).map((vertex) =>
      Math.min(...targetEdges.map((edge) => pointToLineDistance(vertex, edge, { units: 'meters', method: 'planar' }))));
  };
  const values = [...sampled(reference, modeled), ...sampled(modeled, reference)].sort((a, b) => a - b);
  return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
}

export function matchedHistory(dataset: HistoricDataset, seed: HistoricRecord | PracticeSeed, minute: number) {
  if (!seed.at || minute <= 0) return undefined;
  const elapsed = Date.parse(seed.at) + minute * 60000;
  const matches = dataset.records.filter((record) => record.at && record.id !== ('id' in seed ? seed.id : seed.record?.id) && Math.abs(Date.parse(record.at) - elapsed) <= 150000);
  return matches.length === 1 ? matches[0] : undefined;
}

export function compareWithHistory(dataset: HistoricDataset, record: HistoricRecord | PracticeSeed, study: ReplayStudy, minute: number) {
  const match = matchedHistory(dataset, record, minute);
  if (!match) return null;
  const observed = historyPolygon(match);
  const baseline = study.shape('baseline', minute);
  const branch = study.shape('branch', minute);
  return { matchedAt: match.at, baseline: compareFootprints(observed, baseline), branch: compareFootprints(observed, branch),
    baselineMedianMeters: sampledDisplacement(observed, baseline), branchMedianMeters: sampledDisplacement(observed, branch) };
}

