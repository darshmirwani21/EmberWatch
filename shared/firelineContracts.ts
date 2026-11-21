import { z } from 'zod';
import { pointSchema, positionSchema, scenarioSchema } from './contracts';

export const strategySchema = z.enum(['crosswind', 'perimeter-offset', 'shift-corridor']);
export const firelineParametersSchema = z.strictObject({
  strategy: strategySchema,
  offsetMeters: z.number().int().min(0).max(1500),
  targetLengthMeters: z.number().int().min(200).max(2500),
  bearingAdjustment: z.number().int().min(-60).max(60),
  anchorPercent: z.number().int().min(20).max(85),
});
const time = z.number().int().min(0).max(240).multipleOf(5);
export const firelineRequestSchema = z.strictObject({
  scenario: scenarioSchema, minute: time, horizon: time,
  radiusMeters: z.number().int().min(2000).max(25000),
  refine: z.boolean().optional(),
}).refine((request) => request.minute <= request.horizon && request.horizon <= request.scenario.durationMinutes, 'Select an interval inside the simulation.');
export type FirelineRequest = z.infer<typeof firelineRequestSchema>;
export type FirelineParameters = z.infer<typeof firelineParametersSchema>;
export const firelineLimitations = [
  'Experimental training scenario. Generated lines are not validated firefighting deployment recommendations.',
  'Terrain, fuel, access, current incident conditions and crew safety are unverified.',
  'Sampled geometry does not model suppression or containment.',
] as const;

const geometrySchema = z.strictObject({ type: z.literal('LineString'), coordinates: z.array(positionSchema).min(2).max(32) });
export const candidateSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  geometry: geometrySchema, original: geometrySchema, parameters: firelineParametersSchema,
  studyCenter: pointSchema, studyRadiusMeters: z.number().int().min(2000).max(25000),
  horizon: time, provenance: z.enum(['geometric', 'nemotron']),
});
export const firelineExplanationSchema = z.strictObject({
  study: firelineRequestSchema,
  candidates: z.array(candidateSchema).min(1).max(3),
}).refine((input) => new Set(input.candidates.map((candidate) => candidate.id)).size === input.candidates.length, 'Use distinct candidates.');
const contactSchema = z.strictObject({ from: time, to: time });
export const evaluationSchema = z.strictObject({
  id: z.string(), lengthMeters: z.number().nonnegative(), perimeterDistanceMeters: z.number().nonnegative(),
  contact: contactSchema.nullable(), alternativeContact: contactSchema.nullable(),
  intersectsFootprint: z.boolean(), alternativeIntersectsFootprint: z.boolean(),
  deltaMinutes: z.number().nullable(), sampleFrom: time, sampleThrough: time,
});
const traceSchema = z.strictObject({
  id: z.string(), name: z.string(), outcome: z.enum(['success', 'error']), source: z.string(),
  timestamp: z.string(), durationMs: z.number().nonnegative(), detail: z.string().optional(),
});
export const generationResultSchema = z.strictObject({
  status: z.enum(['completed', 'partial', 'unavailable']), scenarioId: z.string(), modelId: z.string().nullable(),
  candidateIds: z.array(z.string()).max(3), candidateStrategies: z.array(strategySchema).max(3),
  generationParameters: z.array(firelineParametersSchema).max(3), candidates: z.array(candidateSchema).max(3),
  evaluations: z.array(evaluationSchema).max(3),
  comparison: z.array(z.strictObject({ id: z.string(), lengthDifferenceMeters: z.number(), windShiftDeltaMinutes: z.number().nullable() })).max(3),
  limitations: z.array(z.string()), toolExecutionSummary: z.array(traceSchema), narrativeExplanation: z.string(),
  verificationWarning: z.string().optional(),
}).refine((r) => r.candidates.every((candidate, i) =>
  candidate.id === r.candidateIds[i] && candidate.id === r.evaluations[i]?.id && candidate.id === r.comparison[i]?.id &&
  candidate.parameters.strategy === r.candidateStrategies[i]) &&
  [r.candidateIds, r.candidateStrategies, r.generationParameters, r.evaluations, r.comparison].every((list) => list.length === r.candidates.length),
'Generation result contains inconsistent candidate IDs or metrics.');
export type FirelineCandidate = z.infer<typeof candidateSchema>;
export type FirelineEvaluation = z.infer<typeof evaluationSchema>;
export type FirelineGeneration = z.infer<typeof generationResultSchema>;
