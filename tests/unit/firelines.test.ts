import { describe, expect, it } from 'vitest';
import { firelineRequestSchema, candidateSchema, type FirelineRequest } from '../../shared/firelineContracts';
import { demos } from '../../shared/demos';
import { project } from '../../shared/engine';
import { candidateModified, defaultFirelineParameters, generateCandidate,
  generateGeometricFirelines, makeFirelineStudy, scenarioIdFor, updateCandidateGeometry, validateCandidateLine } from '../../src/engine/firelineCandidates';
import { evaluateFireline, evaluateSensitivity } from '../../src/engine/firelineEvaluation';
import { generateWithNemotron } from '../../server/firelineAgent';
import type { Complete, ToolCall } from '../../server/nvidia';

const request: FirelineRequest = { scenario: demos[1].scenario, minute: 20, horizon: 85, radiusMeters: 12000 };
const scope = { scenarioId: scenarioIdFor(request) };
const model = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const execute = (name: string, args: unknown, step: number): ToolCall => ({
  type: 'function', id: 'call-' + step, function: { name, arguments: JSON.stringify(args) },
});
const scripted = (invalidFinal = false): Complete => {
  let step = 0;
  return async (messages, available) => {
    const index = step++;
    const sequence = [
      ['get_fire_simulation_state', {}],
      ['generate_fireline_candidates', { ...scope, parameters: defaultFirelineParameters }],
      ['evaluate_fireline_candidates', { ...scope, candidateIds: ['C1','C2','C3'] }],
      ['refine_fireline_candidates', { ...scope, candidateId: 'C1', parameters: { ...defaultFirelineParameters[0], offsetMeters: 240 } }],
      ['evaluate_fireline_candidates', { ...scope, candidateIds: ['C2','C3','C4'] }],
      ['compare_fireline_candidates', { ...scope, candidateIds: ['C2','C3','C4'] }],
    ] as const;
    if (index && index <= sequence.length) expect(messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call-' + (index - 1))).toBe(true);
    if (index >= sequence.length) return { model, calls: [], content: JSON.stringify({
      observations: ['baseline','shift'], ...(invalidFinal ? { lineLength: 987654321 } : {}),
    }) };
    const [name, args] = sequence[index];
    expect(available?.some((entry) => entry.function.name === name)).toBe(true);
    return { model, content: null, calls: [execute(name, args, index)] };
  };
};

describe('training geometry', () => {
  it('produces simple, unique, finite LineStrings from three repeatable strategies', () => {
    const response = generateGeometricFirelines(request);
    expect(response.candidates).toHaveLength(3);
    expect(response).toEqual(generateGeometricFirelines(request));
    expect(new Set(response.candidates.map((candidate) => candidate.id)).size).toBe(3);
    for (const candidate of response.candidates) {
      expect(candidateSchema.safeParse(candidate).success).toBe(true);
      expect(validateCandidateLine(candidate.geometry.coordinates, candidate.studyCenter, candidate.studyRadiusMeters)).toEqual(candidate.geometry);
      const metric = evaluateFireline(candidate, makeFirelineStudy(request));
      expect(Number.isFinite(metric.lengthMeters)).toBe(true);
      expect(metric.lengthMeters).toBeGreaterThan(50);
      expect(metric.perimeterDistanceMeters).toBeGreaterThanOrEqual(0);
    }
  });
  it('uses changed footprint geometry and preserves the front up to the shifted pivot', () => {
    const changed = { ...request, scenario: { ...request.scenario, humidity: 85, dryness: .3 } };
    expect(generateCandidate(changed, defaultFirelineParameters[0]).geometry).not.toEqual(generateCandidate(request, defaultFirelineParameters[0]).geometry);
    const study = makeFirelineStudy(request);
    expect(study.alternative.slice(0, 7)).toEqual(study.baseline.slice(0, 7));
    expect(study.alternative[7].polygon).toEqual(study.baseline[7].polygon);
    expect(study.alternative[8].polygon).not.toEqual(study.baseline[8].polygon);
    const after = makeFirelineStudy({ ...request, minute: 45 });
    expect(after.alternative[9].polygon).toEqual(after.baseline[9].polygon);
    expect(after.alternative[10].polygon).not.toEqual(after.baseline[10].polygon);
  });
  it('returns known crossing, no-contact, and bounded sensitivity results', () => {
    const study = makeFirelineStudy(request);
    const initial = generateCandidate(request, defaultFirelineParameters[0]);
    const origin = request.scenario.ignition;
    const crossing = updateCandidateGeometry(initial, [project(origin, 90, 1700), project(origin, 270, 1700)]);
    const distant = updateCandidateGeometry(initial, [project(origin, 30, 10000), project(origin, 32, 10000)]);
    const hit = evaluateFireline(crossing, study);
    expect(hit.contact).toEqual({ from: 20, to: 20 });
    expect(hit.perimeterDistanceMeters).toEqual(0);
    expect(evaluateFireline(distant, study)).toMatchObject({ contact: null, alternativeContact: null, intersectsFootprint: false });
    const sensitivity = evaluateSensitivity([crossing, distant], study);
    expect(sensitivity[0].outcomes).toHaveLength(5);
    expect(sensitivity[1]).toMatchObject({ overlaps: 0, earliest: null, latest: null, spread: null });
  });
  it('recalculates after manual edits and rejects invalid boundaries and degeneracy', () => {
    const original = generateCandidate(request, defaultFirelineParameters[0]);
    const updated = updateCandidateGeometry(original, [project(request.scenario.ignition, 25, 900), project(request.scenario.ignition, 75, 900)]);
    expect(candidateModified(updated)).toBe(true);
    expect(updated.original).toEqual(original.geometry);
    const changed = makeFirelineStudy({ ...request, scenario: { ...request.scenario, wind: { speedMph: 65, fromDeg: 60 } } });
    expect(evaluateFireline(updated, changed).lengthMeters).toBeCloseTo(evaluateFireline(updated, makeFirelineStudy(request)).lengthMeters);
    expect(updated.geometry).not.toEqual(original.geometry);
    expect(() => validateCandidateLine([original.geometry.coordinates[0], original.geometry.coordinates[0]], original.studyCenter, 12000)).toThrow();
    expect(() => validateCandidateLine([project(original.studyCenter, 25, 14000), project(original.studyCenter, 27, 14000)], original.studyCenter, 12000)).toThrow(/boundary/);
    expect(firelineRequestSchema.safeParse({ ...request, horizon: undefined }).success).toBe(false);
  });
});

describe('bounded Nemotron generation', () => {
  it('executes strategy selection, evaluation, refinement and comparison with real engine outputs', async () => {
    const report: string[] = [];
    const response = await generateWithNemotron(request, scripted(), undefined, (event) => {
      if (event.phase === 'verified') report.push(event.trace.name);
    });
    expect(response.status).toBe('completed');
    expect(response.candidateIds).toHaveLength(3);
    expect(response.candidates.find((candidate) => candidate.parameters.strategy === 'crosswind')?.parameters.offsetMeters).toBe(240);
    expect(response.candidates.every((candidate) => candidate.provenance === 'nemotron')).toBe(true);
    expect(report).toEqual(response.toolExecutionSummary.map((entry) => entry.name));
    expect(response.toolExecutionSummary.every((entry) => entry.outcome === 'success')).toBe(true);
    expect(response.evaluations).toEqual(response.candidates.map((candidate) => evaluateFireline(candidate, makeFirelineStudy(request))));
  });
  it('rejects the model’s invented measurements and exposes a verification warning', async () => {
    const response = await generateWithNemotron(request, scripted(true));
    expect(response.status).toBe('partial');
    expect(response.verificationWarning).toBeTruthy();
    expect(JSON.stringify(response)).not.toContain('987654321');
    expect(response.candidates).toHaveLength(3);
  });
  it('explains existing edited geometry without exposing generation or refinement tools', async () => {
    const original = generateCandidate(request, defaultFirelineParameters[0]);
    const edited = updateCandidateGeometry(original, [project(original.studyCenter, 25, 900), project(original.studyCenter, 75, 900)]);
    const sequence = [
      ['get_fire_simulation_state', {}],
      ['evaluate_fireline_candidates', { ...scope, candidateIds: ['C1'] }],
      ['compare_fireline_candidates', { ...scope, candidateIds: ['C1'] }],
    ] as const;
    let calls = 0;
    const invoke: Complete = async (_messages, available) => {
      if (calls === sequence.length) return { model, calls: [], content: '{"observations":["shift"]}' };
      const [name, args] = sequence[calls];
      expect(available?.map((entry) => entry.function.name)).toEqual([name]);
      return { model, content: null, calls: [execute(name, args, calls++)] };
    };
    const response = await generateWithNemotron(request, invoke, undefined, undefined, [edited]);
    expect(response.status).toBe('completed');
    expect(response.candidates).toEqual([edited]);
    expect(response.evaluations[0]).toEqual(evaluateFireline(edited, makeFirelineStudy(request)));
  });
  it('rejects invalid args and unknown tools within the call cap and hides unauthorized names', async () => {
    let calls = 0;
    const invoke: Complete = async () => ({ model, content: null, calls: [
      execute(calls === 0 ? 'get_fire_simulation_state' : 'SECRET_LIKE_UNAUTHORIZED_NAME', { prohibited: true }, calls++),
    ] });
    const response = await generateWithNemotron(request, invoke);
    expect(calls).toBeLessThanOrEqual(9);
    expect(response.status).toBe('unavailable');
    expect(response.candidates).toHaveLength(0);
    expect(response.toolExecutionSummary[0].detail).toMatch(/Invalid geographic/);
    expect(response.toolExecutionSummary.every((entry) => entry.outcome === 'error')).toBe(true);
    expect(JSON.stringify(response)).not.toContain('SECRET_LIKE_UNAUTHORIZED_NAME');
  });
});
