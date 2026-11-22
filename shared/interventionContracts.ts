import { z } from 'zod';
import { DAY_HORIZON_MINUTES } from './simulationTime';
import { positionSchema } from './contracts';

export const MAX_BARRIERS = 8;
export const BARRIER_ASSUMPTION = 'Idealized barrier simulation. Assumes completed lines hold without breach or spotting. Not a prediction of actual containment success.';
export const barrierSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  readyMinute: z.number().int().min(0).max(DAY_HORIZON_MINUTES).multipleOf(5),
  geometry: z.strictObject({ type: z.literal('LineString'), coordinates: z.array(positionSchema).min(2).max(32) }),
});
export type BarrierLine = z.infer<typeof barrierSchema>;
export const interventionOptions = z.strictObject({
  barriers: z.array(barrierSchema).max(MAX_BARRIERS).refine((lines) => new Set(lines.map((line) => line.id)).size === lines.length),
  manualWind: z.boolean(),
  shift: z.strictObject({ minute: z.number().int().min(0).max(DAY_HORIZON_MINUTES).multipleOf(5),
    wind: z.strictObject({ speedMph: z.number().min(0).max(100), fromDeg: z.number().min(0).max(359) }) }).optional(),
  location: positionSchema.optional(),
});
export type InterventionOptions = z.infer<typeof interventionOptions>;

