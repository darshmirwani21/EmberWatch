import { z } from 'zod';
import type { AgentProgress, Trace } from '../shared/contracts';
import { firelineLimitations, firelineParametersSchema, generationResultSchema,
  type FirelineCandidate, type FirelineEvaluation, type FirelineGeneration, type FirelineRequest } from '../shared/firelineContracts';
import { firelineStrategies, generateCandidate, makeFirelineStudy, scenarioIdFor } from '../src/engine/firelineCandidates';
import { compareFirelines, evaluateFireline } from '../src/engine/firelineEvaluation';
import { complete, ProviderError, type Complete, type Message, type Tool } from './nvidia';

const scenarioRef = z.string().regex(/^study-[a-z0-9]+$/);
const candidateIds = z.array(z.string().regex(/^C[1-4]$/)).min(1).max(3);
const studyRef = z.strictObject({ scenarioId: scenarioRef });
const generationArgs = studyRef.extend({ parameters: z.array(firelineParametersSchema).min(1).max(3) });
const evaluationArgs = studyRef.extend({ candidateIds });
const refinementArgs = studyRef.extend({ candidateId: z.string().regex(/^C[1-3]$/), parameters: firelineParametersSchema });
const observations = z.enum(['baseline', 'shift', 'geometry']);
const finalSchema = z.strictObject({ observations: z.array(observations).min(1).max(3) });

function definition<S extends z.ZodType>(name: string, description: string, schema: S) {
  return { schema, tool: { type: 'function', function: { name, description, parameters: z.toJSONSchema(schema) } } satisfies Tool };
}

const tools = {
  state: definition('get_fire_simulation_state', 'Read the current and future simulated footprint references, wind, and study bounds.', z.strictObject({})),
  generate: definition('generate_fireline_candidates', 'Select up to three distinct strategies and numeric parameters for the supplied study. No coordinates may be supplied.', generationArgs),
  evaluate: definition('evaluate_fireline_candidates', 'Measure every candidate ID in the active set against both scenarios within the supplied study horizon.', evaluationArgs),
  refine: definition('refine_fireline_candidates', 'Optionally replace one evaluated candidate with a revised geometric strategy or parameters. Available once.', refinementArgs),
  compare: definition('compare_fireline_candidates', 'Compare every current evaluated candidate, including wind sensitivity and source limitations.', evaluationArgs),
};
const GEO = 'Shared EmberWatch simulation and Turf geometry';
const SYSTEM = [
  'You are an educational geometry investigator. Select methods and parameters for fictional wildfire-training line drawings.',
  'Use the currently available tool to read, generate, evaluate, optionally refine once, then compare. Always call tools when offered before explaining.',
  'Choose three distinct strategies (crosswind, perimeter-offset, shift-corridor) unless a tight study suggests fewer. A 100–300 m offset and 500–1200 m target usually fit.',
  'Choose all current candidate IDs for evaluation and comparison. Refine only to study a different geometric assumption.',
  'Preserve model provenance. No advice on where to deploy personnel, safety, suppression or real incident operations.',
  'At completion return only JSON with observations (one or more of baseline, shift, geometry). The tools already determine candidate IDs and ordering. Do not supply coordinates or numbers.',
].join(' ');

export async function generateWithNemotron(request: FirelineRequest, invoke: Complete = complete, parentSignal?: AbortSignal,
  report: (progress: AgentProgress) => void = () => {}, existing?: FirelineCandidate[]): Promise<FirelineGeneration> {
  const scenarioId = scenarioIdFor(request);
  const study = makeFirelineStudy(request);
  const traces: Trace[] = [];
  const candidates = new Map<string, FirelineCandidate>(existing?.map((candidate, index) => ['C' + (index + 1), candidate]));
  const evaluations = new Map<string, FirelineEvaluation>();
  let modelId: string | null = null;
  let read = false;
  let refined = false;
  let compared = false;
  let retriedSummary = false;
  let toolCalls = 0;
  let verificationWarning: string | undefined;
  const callIds = new Set<string>();
  const fingerprints = new Set<string>();
  const timeout = AbortSignal.timeout(75_000);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
  const messages: Message[] = [{ role: 'system', content: SYSTEM }, { role: 'user',
    content: existing ? 'Explain the current baseline and altered-wind results for the supplied existing geometries. Read the study, evaluate every existing candidate, and compare. Keep their geometry.'
      : 'Generate and compare geographic candidates for this hypothetical scenario. Begin with get_fire_simulation_state.' +
        (request.refine ? ' After evaluating, perform one refinement by changing a geometric assumption, then compare.' : '') }];
  const result = (status: FirelineGeneration['status'], narrativeExplanation: string): FirelineGeneration => {
    const records = [...candidates].flatMap(([id, candidate]) => {
      const evaluation = evaluations.get(id);
      return candidate && evaluation ? [{ candidate, evaluation }] : [];
    });
    const lines = records.map(({ candidate }) => candidate);
    const metrics = records.map(({ evaluation }) => evaluation);
    return generationResultSchema.parse({ status, scenarioId, modelId,
      candidateIds: lines.map((candidate) => candidate.id), candidateStrategies: lines.map((candidate) => candidate.parameters.strategy),
      generationParameters: lines.map((candidate) => candidate.parameters), candidates: lines, evaluations: metrics,
      comparison: compareFirelines(metrics), limitations: [...firelineLimitations], toolExecutionSummary: traces,
      narrativeExplanation, verificationWarning });
  };
  const fail = (message: string) => result(evaluations.size ? 'partial' : 'unavailable', message);
  const metricsFor = (refs: string[]) => refs.map((id) => {
    const e = evaluations.get(id);
    if (!e) throw new Error('Evaluate every current candidate before comparing.');
    return { ...e, id, lengthMeters: Math.round(e.lengthMeters), perimeterDistanceMeters: Math.round(e.perimeterDistanceMeters) };
  });
  function checkStudy(id: string) { if (id !== scenarioId) throw new Error('Use the study ID returned by the state tool.'); }
  function checkIds(ids: string[]) {
    if (new Set(ids).size !== candidates.size || ids.length !== candidates.size || ids.some((id) => !candidates.has(id))) {
      throw new Error('Use each current candidate ID exactly once.');
    }
  }
  function run(key: keyof typeof tools, raw: unknown) {
    if (key === 'state') {
      tools.state.schema.parse(raw);
      read = true;
      return { scenarioId, ...request, activeWind: study.baseline[request.minute / 5].activeWind, alternateShiftAt: study.shiftMinute,
        footprints: [request.minute, request.horizon].map((minute) => ({ minute, ref: 'baseline:' + minute, acres: Math.round(study.baseline[minute / 5].acres) })),
        existingCandidateIds: [...candidates.keys()], limitations: firelineLimitations };
    }
    if (key === 'generate') {
      const { scenarioId: id, parameters } = tools.generate.schema.parse(raw);
      checkStudy(id);
      if (new Set(parameters.map((p) => p.strategy)).size !== parameters.length) throw new Error('Use distinct generation strategies.');
      const generated = parameters.map((parameters) => generateCandidate(request, parameters, study));
      if (new Set(generated.map((candidate) => JSON.stringify(candidate.geometry))).size !== generated.length) {
        throw new Error('Choose parameters that produce distinct lines.');
      }
      generated.forEach((candidate, index) => candidates.set('C' + (index + 1), { ...candidate, provenance: 'nemotron' }));
      return { candidates: [...candidates].map(([id, c]) => ({ id, geometryRef: c.id, parameters: c.parameters, vertices: c.geometry.coordinates.length })) };
    }
    if (key === 'refine') {
      const { scenarioId: id, candidateId, parameters } = tools.refine.schema.parse(raw);
      checkStudy(id);
      const previous = candidates.get(candidateId);
      if (!previous) throw new Error('Use a current evaluated candidate ID.');
      const updated = generateCandidate(request, parameters, study);
      if ([...candidates.values()].some((candidate) => JSON.stringify(candidate.geometry) === JSON.stringify(updated.geometry))) {
        throw new Error('Refinement must produce distinct geometry.');
      }
      candidates.delete(candidateId);
      evaluations.delete(candidateId);
      candidates.set('C4', { ...updated, provenance: 'nemotron' });
      refined = true;
      return { replaced: candidateId, candidateId: 'C4', previous: previous.parameters, updated: parameters,
        evaluation: evaluateFireline(updated, study), currentIds: [...candidates.keys()] };
    }
    const { scenarioId: id, candidateIds: ids } = tools[key].schema.parse(raw);
    checkStudy(id);
    checkIds(ids);
    if (key === 'evaluate') {
      for (const id of ids) evaluations.set(id, evaluateFireline(candidates.get(id)!, study));
      return { evaluations: metricsFor(ids), units: { length: 'm', time: 'simulated minutes' }, limitations: firelineLimitations };
    }
    const metrics = metricsFor(ids);
    compared = true;
    return { comparison: compareFirelines(metrics), evaluations: metrics, limitations: firelineLimitations };
  }

  try {
    for (let turn = 1; turn <= 9; turn++) {
      if (signal.aborted) return fail('The Nemotron study timed out.');
      const permitted: (keyof typeof tools)[] = !read ? ['state'] : !candidates.size ? ['generate']
        : evaluations.size !== candidates.size ? ['evaluate'] : !compared ? refined || existing ? ['compare'] : request.refine ? ['refine'] : ['compare', 'refine'] : [];
      if (compared) {
        const format = JSON.stringify({ observations: ['baseline', 'shift', 'geometry'] });
        messages.push({ role: 'user', content: 'Return only a JSON object in this format: ' + format +
          '. Choose a subset of the listed observations. Do not add any other fields or prose.' });
      }
      report({ phase: 'model', turn });
      const reply = await invoke(messages, permitted.map((key) => tools[key].tool), signal);
      modelId = reply.model;
      if (compared && !reply.calls.length) {
        let parsed: z.infer<typeof finalSchema>;
        try {
          parsed = finalSchema.parse(JSON.parse((reply.content ?? '').trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, '')));
        } catch {
          if (!retriedSummary && turn < 9) {
            retriedSummary = true;
            messages.push({ role: 'assistant', content: 'The structured summary needs correction.' });
            continue;
          }
          verificationWarning = 'Nemotron’s narrative selection could not be verified. The table contains the executed geographic measurements.';
          return fail('Candidate geometry and measurements were computed by the tools.');
        }
        const metrics = metricsFor([...candidates.keys()]);
        const hits = metrics.filter((metric) => metric.contact).length;
        const changed = metrics.filter((metric) => (metric.contact?.to ?? null) !== (metric.alternativeContact?.to ?? null)).length;
        const statements = {
          baseline: hits + ' of ' + metrics.length + ' candidates had a sampled perimeter intersection in the baseline window.',
          shift: changed + ' of ' + metrics.length + ' candidates changed sampled contact timing or contact status under the alternative wind shift.',
          geometry: 'Each line is an experimental geometry. Its length and perimeter distance describe its placement within the modeled study.',
        };
        return result('completed', [...new Set(parsed.observations)].map((key) => statements[key]).join(' '));
      }
      if (!reply.calls.length) {
        messages.push({ role: 'assistant', content: 'A tool is needed to continue.' },
          { role: 'user', content: 'Call the currently offered tool. Available candidate IDs: ' + [...candidates.keys()].join(', ') });
        continue;
      }
      messages.push({ role: 'assistant', content: null, tool_calls: reply.calls });
      for (const call of reply.calls) {
        if (++toolCalls > 9 || callIds.has(call.id)) return fail('Nemotron reached the geographic tool limit.');
        callIds.add(call.id);
        const start = performance.now();
        const key = permitted.find((entry) => tools[entry].tool.function.name === call.function.name);
        const validName = Object.values(tools).some((entry) => entry.tool.function.name === call.function.name);
        const name = validName ? call.function.name : 'unavailable_tool';
        report({ phase: 'tool', name });
        let output: unknown;
        let error: string | undefined;
        let detail: string | undefined;
        try {
          if (!key || compared || (key === 'refine' && refined)) throw new Error('This tool is unavailable at the current step.');
          const args = JSON.parse(call.function.arguments) as unknown;
          const fingerprint = name + JSON.stringify(args);
          if (fingerprints.has(fingerprint)) throw new Error('Repeated tool call. Use the current candidate IDs and adjust the parameters.');
          fingerprints.add(fingerprint);
          output = run(key, args);
          detail = key === 'state' ? 'Footprint samples at minutes ' + request.minute + ' and ' + request.horizon
            : key === 'generate' ? candidates.size + ' distinct GeoJSON lines'
            : key === 'refine' ? 'One geometry recalculated with updated parameters'
            : candidates.size + ' lines · baseline and alternate wind';
          permitted.length = 0;
        } catch (failure) {
          error = failure instanceof z.ZodError || failure instanceof SyntaxError ? 'Invalid geographic tool arguments.' :
            failure instanceof Error ? failure.message : 'The geographic calculation failed.';
        }
        const trace: Trace = { id: call.id, name, outcome: error ? 'error' : 'success', source: GEO,
          timestamp: new Date().toISOString(), durationMs: Math.round(performance.now() - start), detail: error ?? detail };
        traces.push(trace);
        report({ phase: 'verified', trace });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(error ? { error } : output) });
      }
    }
    return fail('Nemotron did not complete the bounded geographic study.');
  } catch (error) {
    return fail(error instanceof ProviderError ? error.message : 'The Nemotron study could not be completed.');
  }
}
