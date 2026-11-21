import { z } from 'zod';
import { interventionOptions } from './interventionContracts';
import { positionSchema } from './contracts';

export const caseIds = ['eaton', 'park', 'mosquito'] as const;
export type CaseId = typeof caseIds[number];

const ring = z.array(positionSchema).min(4).max(100000).refine((points) =>
  points[0][0] === points.at(-1)?.[0] && points[0][1] === points.at(-1)?.[1], 'Expected closed perimeter ring');
const rings = z.array(ring).min(1).max(500);
export const historicalGeometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: rings }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(rings).min(1).max(250) }),
]);
export const historicalRecord = z.strictObject({
  id: z.string(), label: z.string(), at: z.iso.datetime().nullable(),
  date: z.iso.date().nullable(), precision: z.enum(['time', 'day', 'archive']),
  source: z.string(), url: z.url(), geometry: historicalGeometry,
}).refine((record) => record.precision === 'time' ? Boolean(record.at) : record.precision === 'day' ? !record.at && Boolean(record.date) : !record.at && !record.date);
export const historicWeather = z.strictObject({
  at: z.iso.datetime(), fromDeg: z.number().min(0).max(360),
  speedMph: z.number().nonnegative(), humidity: z.number().min(0).max(100), temperatureF: z.number(),
});
export const historyDataset = z.strictObject({
  id: z.enum(caseIds), retrievedAt: z.iso.datetime(), records: z.array(historicalRecord).min(1).max(35),
  weather: z.array(historicWeather).max(1250), weatherGrid: z.tuple([z.number(), z.number()]).nullable(),
}).refine(({ records }) => {
  const dates = records.map((record) => record.at ?? record.date ?? 'archive');
  return new Set(records.map((record) => record.id)).size === records.length && dates.every((date, index) => index === 0 || dates[index - 1] <= date);
}, 'Historical records must have distinct IDs and be ordered by timestamp, with undated records last.');
export const replayRequest = z.strictObject({
  caseId: z.enum(caseIds), recordId: z.string().max(60).optional(), replayAt: z.iso.datetime().optional(),
  practicing: z.boolean().optional(),
  question: z.string().trim().min(3).max(700),
  workflow: z.enum(['alternatives', 'refine', 'replay', 'barrier']).optional(),
  wind: z.strictObject({ fromDeg: z.number().min(0).max(359), speedMph: z.number().min(0).max(100) }),
  duration: z.number().int().min(30).max(240).multipleOf(5),
  minute: z.number().int().min(0).max(240).multipleOf(5).optional(),
  line: z.array(positionSchema).min(2).max(32).optional(),
  intervention: interventionOptions.optional(),
  lines: z.array(z.array(positionSchema).min(2).max(32)).max(3).optional(),
}).refine((request) => Boolean(request.replayAt) !== Boolean(request.recordId), 'Provide one historical time or archive record.')
  .refine((request) => !request.workflow || request.workflow === 'replay' || !request.replayAt || request.practicing === true, 'A guided fireline workflow requires an active practice branch.')
  .refine((request) => request.workflow !== 'barrier' || Boolean(request.intervention?.barriers.length), 'Provide at least one barrier for the intervention workflow.')
  .refine((request) => request.minute === undefined || request.minute <= request.duration, 'Historical sample must fall within the branch.');
export type HistoricRecord = z.infer<typeof historicalRecord>;
export type HistoricDataset = z.infer<typeof historyDataset>;
export type ReplayRequest = z.infer<typeof replayRequest>;

