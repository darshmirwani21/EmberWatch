import { STEP, simulate, type Snapshot } from './engine';
import { historyCases } from './history';
import { DAY_HORIZON_MINUTES } from './simulationTime';
import type { HistoricDataset, HistoricRecord } from './historyContracts';

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
export const HISTORICAL_DRYNESS = .65;

export function buildHistoricalPlayback(data: HistoricDataset) {
  const fire = historyCases[data.id];
  const start = Date.parse(fire.started);
  const weather = new Map(data.weather.map((sample) => [Date.parse(sample.at), sample]));
  const contextAt = (time: number) => weather.get(Math.floor(time / hourMs) * hourMs);
  const modelEnd = Array.from({ length: DAY_HORIZON_MINUTES / STEP + 1 }, (_, index) => index * STEP)
    .find((minute) => !contextAt(start + minute * minuteMs)) ?? DAY_HORIZON_MINUTES;
  const startingWeather = contextAt(start);
  const atmospheric = (minute: number) => {
    const sample = contextAt(start + minute * minuteMs);
    if (!sample) throw new Error('Historical weather sample unavailable.');
    return { humidity: sample.humidity, wind: { speedMph: sample.speedMph, fromDeg: sample.fromDeg % 360 } };
  };
  // The terminal frame uses the wind that drove the previous increment if the next hour is missing.
  // The public timeline still reports missing weather for that timestamp.
  const reconstruction = startingWeather ? simulate({
    ignition: fire.ignition, ...atmospheric(0), dryness: HISTORICAL_DRYNESS, durationMinutes: modelEnd,
  }, { minute: 0, radial: Array.from({ length: 72 }, () => 0) }, (minute) =>
    minute === modelEnd && !contextAt(start + minute * minuteMs) ? atmospheric(minute - STEP) : atmospheric(minute)) : [];
  const timed = data.records.flatMap((record) => record.at && Date.parse(record.at) >= start ?
    [{ time: Date.parse(record.at), record }] : []).sort((a, b) => a.time - b.time);
  const modelFrames = new Map(reconstruction.map((frame) => [start + frame.minute * minuteMs, frame]));
  const end = Math.max(start + modelEnd * minuteMs, timed.at(-1)?.time ?? start);
  const hours = Array.from({ length: Math.max(0, Math.floor(end / hourMs) - Math.floor(start / hourMs)) },
    (_, i) => (Math.floor(start / hourMs) + i + 1) * hourMs);
  const instants = [...new Set([start, ...modelFrames.keys(), ...hours, ...timed.map((entry) => entry.time)])].sort((a, b) => a - b);
  let recorded: HistoricRecord | undefined;
  let recordIndex = 0;
  const frames = instants.map((time) => {
    let newRecord: HistoricRecord | undefined;
    while (recordIndex < timed.length && timed[recordIndex].time <= time) {
      recorded = timed[recordIndex++].record;
      if (Date.parse(recorded.at!) === time) newRecord = recorded;
    }
    const modeledMinute = Math.floor((time - start) / (STEP * minuteMs)) * STEP;
    const model = time <= start + modelEnd * minuteMs ? reconstruction[modeledMinute / STEP] : undefined;
    return { time, at: new Date(time).toISOString(), context: contextAt(time), recorded, newRecord, model };
  });
  return { frames, modelEnd, reconstruction, timed: timed.map((entry) => entry.record), modelLimitedByWeather: modelEnd < DAY_HORIZON_MINUTES };
}

export function historicalBranchDuration(ignitionAt: string, branchAt: string) {
  const elapsed = (Date.parse(branchAt) - Date.parse(ignitionAt)) / minuteMs;
  return elapsed >= DAY_HORIZON_MINUTES ? DAY_HORIZON_MINUTES :
    Math.max(STEP, Math.floor((DAY_HORIZON_MINUTES - elapsed) / STEP) * STEP);
}

export type HistoricalPlayback = ReturnType<typeof buildHistoricalPlayback>;
export type PlaybackFrame = HistoricalPlayback['frames'][number];
export type PracticeSeed = {
  at: string; record?: HistoricRecord; model?: Snapshot; context?: PlaybackFrame['context'];
};
export function practiceSeed(frame: PlaybackFrame): PracticeSeed {
  if (frame.recorded) return { at: frame.at, record: frame.recorded, context: frame.context };
  if (frame.model && frame.model.minute > 0) return { at: frame.at, model: frame.model, context: frame.context };
  return { at: frame.at, record: frame.recorded, context: frame.context };
}
export function practiceOrigin(seed: PracticeSeed) {
  if (seed.record) return seed.record.at === seed.at ? 'Recorded outline' : 'Latest earlier recorded outline';
  return seed.model ? 'Modeled reconstruction' : 'Ignition point';
}

