import { distance, kinks, length, lineString } from '@turf/turf';
import { positionSchema, type Coordinate, type Point, type Scenario } from '../../shared/contracts';
import { firelineLimitations, firelineParametersSchema, firelineRequestSchema, type FirelineCandidate, type FirelineParameters, type FirelineRequest } from '../../shared/firelineContracts';
import { coordinate, downwind, location, project, simulate, STEP, type Snapshot } from '../../shared/engine';

export const firelineStrategies = {
  crosswind: { label: 'Crosswind transect', description: 'A straight transect across the modeled direction of growth at the chosen offset.' },
  'perimeter-offset': { label: 'Perimeter offset', description: 'A curved line following part of a projected footprint at the chosen offset.' },
  'shift-corridor': { label: 'Wind-shift corridor', description: 'A transect derived from the footprint under a hypothetical 90° wind shift.' },
} satisfies Record<FirelineParameters['strategy'], { label: string; description: string }>;
export const defaultFirelineParameters: FirelineParameters[] = [
  { strategy: 'crosswind', offsetMeters: 130, targetLengthMeters: 900, bearingAdjustment: -15, anchorPercent: 48 },
  { strategy: 'perimeter-offset', offsetMeters: 220, targetLengthMeters: 1200, bearingAdjustment: 14, anchorPercent: 62 },
  { strategy: 'shift-corridor', offsetMeters: 150, targetLengthMeters: 850, bearingAdjustment: 0, anchorPercent: 56 },
];

export function shiftedStudy(request: FirelineRequest, baseline: Snapshot[], angle: number, speedFactor = 1): Scenario {
  const configured = request.scenario.shift;
  const pivot = configured && configured.minute > request.minute && configured.minute < request.horizon
    ? configured.minute : request.minute;
  // The engine supports one shift. If it has already passed, preserve it in the
  // baseline and splice its accumulated front into the evaluation run below.
  const baseWind = baseline[pivot / STEP].activeWind;
  return { ...request.scenario, durationMinutes: request.horizon, shift: {
    minute: pivot,
    wind: { fromDeg: (baseWind.fromDeg + angle + 360) % 360, speedMph: Math.min(100, baseWind.speedMph * speedFactor) },
  } };
}

export function scenarioIdFor(request: FirelineRequest) {
  const { scenario: s, minute, horizon, radiusMeters } = request;
  const key = [s.ignition.lat, s.ignition.lng, s.durationMinutes, s.wind.fromDeg, s.wind.speedMph, s.humidity, s.dryness,
    s.shift?.minute, s.shift?.wind.fromDeg, s.shift?.wind.speedMph, minute, horizon, radiusMeters].join('|');
  return 'study-' + stableId(key);
}
function stableId(key: string) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function validateCandidateLine(coordinates: Coordinate[], center: Point, radiusMeters: number) {
  if (coordinates.length < 2 || coordinates.length > 32 ||
      !coordinates.every((position) => positionSchema.safeParse(position).success) ||
      new Set(coordinates.map((p) => p.join(','))).size !== coordinates.length) {
    throw new Error('A candidate needs two to 32 distinct geographic vertices.');
  }
  const origin = coordinate(center);
  if (coordinates.some((p) => distance(origin, p, { units: 'meters' }) > radiusMeters)) {
    throw new Error('The line runs outside the selected study boundary.');
  }
  const feature = lineString(coordinates);
  const meters = length(feature, { units: 'meters' });
  if (!Number.isFinite(meters) || meters < 50 || meters > 3500 || kinks(feature).features.length) {
    throw new Error('The line must be simple and between 50 and 3,500 meters.');
  }
  return { type: 'LineString' as const, coordinates };
}

export function generateCandidate(request: FirelineRequest, params: FirelineParameters, input?: ReturnType<typeof makeFirelineStudy>): FirelineCandidate {
  if (request.minute === request.horizon) throw new Error('Choose a future horizon to generate candidates.');
  const parameters = firelineParametersSchema.parse(params);
  const study = input ?? makeFirelineStudy(request);
  const { ignition } = request.scenario;
  const anchorMinute = request.minute + Math.floor((request.horizon - request.minute) / STEP * parameters.anchorPercent / 100) * STEP;
  const snapshots = parameters.strategy === 'shift-corridor' ? study.alternative : study.baseline;
  // In the shifted strategy, orient to wind at the change even when the anchor precedes it.
  const reference = snapshots[Math.max(anchorMinute, parameters.strategy === 'shift-corridor' ? study.shiftMinute : anchorMinute) / STEP];
  const bearing = (downwind(reference.activeWind) + parameters.bearingAdjustment + 360) % 360;
  const ring = reference.polygon.geometry.coordinates[0];
  const radiusAt = (direction: number) => {
    const index = Math.round((((direction % 360) + 360) % 360) / 5) % 72;
    return distance(coordinate(ignition), ring[71 - index], { units: 'meters' }) + parameters.offsetMeters;
  };
  const radius = radiusAt(bearing);
  let coordinates: Coordinate[];
  if (parameters.strategy === 'perimeter-offset') {
    const halfDegrees = Math.min(65, parameters.targetLengthMeters / (2 * radius) * 180 / Math.PI);
    coordinates = Array.from({ length: 9 }, (_, i) => {
      const direction = bearing - halfDegrees + 2 * halfDegrees * i / 8;
      return project(ignition, direction, radiusAt(direction));
    });
  } else {
    const center = location(project(ignition, bearing, radius));
    const halfLength = parameters.targetLengthMeters / 2;
    coordinates = [project(center, bearing - 90, halfLength), project(center, bearing + 90, halfLength)];
  }
  const geometry = validateCandidateLine(coordinates, ignition, request.radiusMeters);
  const id = parameters.strategy + '-' + stableId(JSON.stringify([scenarioIdFor(request), parameters, coordinates]));
  return { id, geometry, original: geometry, parameters, horizon: request.horizon, studyCenter: ignition,
    studyRadiusMeters: request.radiusMeters, provenance: 'geometric' };
}

/** Continue an existing radial sample with the common engine rather than replaying a changed prior wind. */
export function studyAlternative(request: FirelineRequest, baseline: Snapshot[], angle: number, speedFactor = 1) {
  const scenario = shiftedStudy(request, baseline, angle, speedFactor);
  const pivot = scenario.shift!.minute;
  const initial = baseline[pivot / STEP];
  const future = simulate(scenario, initial);
  return [...baseline.slice(0, pivot / STEP), ...future];
}

export function makeFirelineStudy(input: FirelineRequest, existing?: Snapshot[]) {
  const request = firelineRequestSchema.parse(input);
  const baseline = existing ?? simulate(request.scenario);
  const alternative = studyAlternative(request, baseline, 90);
  const shiftMinute = shiftedStudy(request, baseline, 90).shift!.minute;
  return { request, baseline, alternative, shiftMinute };
}

export function generateGeometricFirelines(request: FirelineRequest, study = makeFirelineStudy(request)) {
  const candidates: FirelineCandidate[] = [];
  const warnings: string[] = [...firelineLimitations];
  for (const parameters of defaultFirelineParameters) {
    try { candidates.push(generateCandidate(request, parameters, study)); }
    catch (error) { warnings.push(firelineStrategies[parameters.strategy].label + ' · ' + (error instanceof Error ? error.message : 'No valid line produced.')); }
  }
  return { candidates, warnings };
}

export function candidateModified(candidate: FirelineCandidate) {
  return JSON.stringify(candidate.geometry.coordinates) !== JSON.stringify(candidate.original.coordinates);
}
export function updateCandidateGeometry(candidate: FirelineCandidate, coordinates: Coordinate[]): FirelineCandidate {
  return { ...candidate, geometry: validateCandidateLine(coordinates, candidate.studyCenter, candidate.studyRadiusMeters) };
}
