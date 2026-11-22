import { z } from 'zod';
import { DAY_HORIZON_MINUTES } from './simulationTime';
import { businessContextSchema, type BusinessEvidence } from './businessContracts';

// The Mercator workbench limits ignition latitude to keep modeled fronts inside the display.
export const pointSchema = z.strictObject({ lat: z.number().min(-84).max(84), lng: z.number().min(-180).max(180) });
export const windSchema = z.strictObject({ speedMph: z.number().min(0).max(100), fromDeg: z.number().min(0).lt(360) });
const time = z.number().int().multipleOf(5);
export const scenarioSchema = z.strictObject({
  ignition: pointSchema, durationMinutes: time.min(5).max(DAY_HORIZON_MINUTES),
  wind: windSchema, humidity: z.number().min(0).max(100), dryness: z.number().min(0).max(1),
  shift: z.strictObject({ minute: time.min(0).max(DAY_HORIZON_MINUTES), wind: windSchema }).optional(),
}).refine((s) => !s.shift || s.shift.minute <= s.durationMinutes, 'Wind shift must be within the scenario horizon.');
export const positionSchema = z.tuple([pointSchema.shape.lng, pointSchema.shape.lat]);
export const lineSchema = z.strictObject({
  id: z.string().regex(/^[\w-]{1,64}$/), name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), type: z.enum(['Handline example','Road example','Fuel break example','Other example']),
  completionMinute: z.number().int().min(0).max(DAY_HORIZON_MINUTES).optional(),
  coordinates: z.array(positionSchema).min(2).max(60),
});
export const requestSchema = z.strictObject({
  mode: z.enum(['civilian','responder','business']), question: z.string().trim().min(3).max(700),
  scenario: scenarioSchema, comparison: scenarioSchema.optional(), point: pointSchema.optional(),
  lines: z.array(lineSchema).max(8).optional(),
  intervention: z.strictObject({ start: time.min(0).max(DAY_HORIZON_MINUTES), minute: time.min(0).max(DAY_HORIZON_MINUTES) }).optional(),
  business: businessContextSchema.optional(),
}).refine((r) => (r.mode === 'responder' || !r.lines?.length) && (r.mode === 'civilian' || !r.point) &&
  (r.mode === 'business' ? !!r.business && r.business.minute <= r.scenario.durationMinutes : !r.business), 'Context must match the selected mode.')
  .refine((r) => !r.intervention || (r.mode === 'responder' && r.intervention.start < r.scenario.durationMinutes &&
    r.intervention.minute >= r.intervention.start &&
    r.intervention.minute <= r.scenario.durationMinutes), 'Select a sampled minute in the Responder intervention.')
  .refine((r) => !r.lines || new Set(r.lines.map((l) => l.id)).size === r.lines.length, 'Line IDs must be unique.')
  .refine((r) => !r.comparison || (
    r.scenario.ignition.lat === r.comparison.ignition.lat && r.scenario.ignition.lng === r.comparison.ignition.lng &&
    r.scenario.durationMinutes === r.comparison.durationMinutes
  ), 'Comparison requires a shared ignition and horizon.');
export type Point = z.infer<typeof pointSchema>;
export type Wind = z.infer<typeof windSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Coordinate = z.infer<typeof positionSchema>;
export type ControlLine = z.infer<typeof lineSchema>;
export type Investigation = z.infer<typeof requestSchema>;
export type Mode = Investigation['mode'];

export type Weather = { temperatureF: number; speedMph: number; fromDeg: number; humidity: number; validAt: string };
export type OfficialAlert = { title: string; url: string; issuedAt: string; effectiveAt: string; expiresAt: string; scope: string; severity: string };
export type SourceResult<T> = { source: string; url: string; retrievedAt: string } & (
  { status: 'ok'; data: T } | { status: 'unavailable'; reason: string }
);
export type Fact = { label: string; value: number | null; unit: string; toolId: string; detail?: string };
export type Trace = { id: string; name: string; outcome: 'success' | 'error'; source: string; timestamp: string; durationMs: number; detail?: string };
export type AgentResult = {
  modelId: string; status: 'completed' | 'partial' | 'unavailable'; live: boolean;
  summary: string; findings: string[]; limitations: string[]; numericEvidence: Fact[]; toolTrace: Trace[];
  sources: { title: string; url: string; retrievedAt: string; issuedAt?: string }[];
  businessExposure?: BusinessEvidence;
};
export type AgentProgress =
  | { phase: 'model'; turn: number }
  | { phase: 'tool'; name: string }
  | { phase: 'verified'; trace: Trace };
export type AgentEvent = { event: 'progress'; data: AgentProgress } | { event: 'result'; data: AgentResult };
