import { STEP } from './engine';
import type { Wind } from './contracts';
import { HISTORICAL_DRYNESS, type PracticeSeed } from './historicalPlayback';
import { historyCases, historyPolygon, makeReplayStudy } from './history';
import type { HistoricDataset } from './historyContracts';
import type { InterventionOptions } from './interventionContracts';
import type { InterventionInput } from './interventionSimulation';

export function historicalInterventionInput(data: HistoricDataset, seed: PracticeSeed, wind: Wind, duration: number, options: InterventionOptions): InterventionInput {
  let previous = seed.context;
  const start = Date.parse(seed.at);
  const hourMs = 3_600_000;
  const archive = new Map(data.weather.map((sample) => [Date.parse(sample.at), sample]));
  const weather = Array.from({ length: duration / STEP + 1 }, (_, i) => {
    const minute = i * STEP;
    previous = archive.get(Math.floor((start + minute * 60_000) / hourMs) * hourMs) ?? previous;
    const archived = previous ? { speedMph: previous.speedMph, fromDeg: previous.fromDeg % 360 } : { speedMph: 0, fromDeg: 0 };
    return { wind: options.shift && minute >= options.shift.minute ? options.shift.wind : options.manualWind ? wind : archived,
      humidity: previous?.humidity ?? 35 };
  });
  return { seed: seed.record ? historyPolygon(seed.record) : seed.model?.polygon ?? makeReplayStudy(data, seed, wind, STEP).seed,
    origin: historyCases[data.id].ignition, duration, dryness: HISTORICAL_DRYNESS, weather, barriers: options.barriers, location: options.location };
}

