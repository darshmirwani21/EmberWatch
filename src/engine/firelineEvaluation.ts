import { length, lineString, pointToLineDistance } from '@turf/turf';
import type { FirelineCandidate, FirelineEvaluation } from '../../shared/firelineContracts';
import { geometryAt, interval, STEP, type Snapshot } from '../../shared/engine';
import { makeFirelineStudy, studyAlternative } from './firelineCandidates';

export function sampledIntersections(snapshots: Snapshot[], candidate: FirelineCandidate, from: number, through: number) {
  let intersectsFootprint = false;
  for (const snapshot of snapshots.slice(from / STEP, through / STEP + 1)) {
    const hit = geometryAt(snapshot, candidate.geometry.coordinates);
    intersectsFootprint ||= hit.overlap;
    if (hit.intersections.length) return { intersectsFootprint, contact: snapshot.minute === from ? { from, to: from } : interval(snapshot.minute) };
  }
  return { intersectsFootprint, contact: null };
}

export function evaluateFireline(candidate: FirelineCandidate, study: ReturnType<typeof makeFirelineStudy>): FirelineEvaluation {
  const { request, baseline, alternative } = study;
  const current = baseline[request.minute / STEP];
  const boundary = lineString(current.polygon.geometry.coordinates[0]);
  const line = lineString(candidate.geometry.coordinates);
  const currentHit = geometryAt(current, candidate.geometry.coordinates).intersections.length;
  const perimeterDistanceMeters = currentHit ? 0 : Math.min(
    ...line.geometry.coordinates.map((p) => pointToLineDistance(p, boundary, { units: 'meters', method: 'geodesic' })),
    ...boundary.geometry.coordinates.map((p) => pointToLineDistance(p, line, { units: 'meters', method: 'geodesic' })),
  );
  const main = sampledIntersections(baseline, candidate, request.minute, request.horizon);
  const other = sampledIntersections(alternative, candidate, request.minute, request.horizon);
  return { id: candidate.id, lengthMeters: length(line, { units: 'meters' }), perimeterDistanceMeters,
    contact: main.contact, alternativeContact: other.contact, intersectsFootprint: main.intersectsFootprint,
    alternativeIntersectsFootprint: other.intersectsFootprint, deltaMinutes: main.contact && other.contact ? other.contact.to - main.contact.to : null,
    sampleFrom: request.minute, sampleThrough: request.horizon };
}

export function compareFirelines(metrics: FirelineEvaluation[]) {
  const firstLength = metrics[0]?.lengthMeters ?? 0;
  return metrics.map((metric) => ({ id: metric.id, lengthDifferenceMeters: metric.lengthMeters - firstLength, windShiftDeltaMinutes: metric.deltaMinutes }));
}

export function evaluateSensitivity(candidates: FirelineCandidate[], study: ReturnType<typeof makeFirelineStudy>) {
  const { request, baseline } = study;
  const variants = [baseline, ...[[-30, 1], [30, 1], [0, .8], [0, 1.2]]
    .map(([angle, factor]) => studyAlternative(request, baseline, angle, factor))];
  return candidates.map((candidate) => {
    const outcomes = variants.map((snapshots) => sampledIntersections(snapshots, candidate, request.minute, request.horizon));
    const times = outcomes.flatMap(({ contact }) => contact ? [contact.to] : []);
    const earliest = times.length ? Math.min(...times) : null;
    const latest = times.length ? Math.max(...times) : null;
    return { id: candidate.id, outcomes, earliest, latest, spread: earliest !== null && latest !== null ? latest - earliest : null,
      overlaps: outcomes.filter(({ intersectsFootprint }) => intersectsFootprint).length };
  });
}
