import { mkdir, rename, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { summarizeWind, type WindArchive, type WindRecord } from '../shared/windHistory';

const requested = { lat: 38.900, lng: -121.070 };
const responseSchema = z.object({ latitude: z.number(), longitude: z.number(), utc_offset_seconds: z.literal(0),
  hourly_units: z.object({ wind_speed_10m: z.literal('mp/h'), wind_direction_10m: z.literal('°') }),
  hourly: z.object({ time: z.array(z.string()), wind_speed_10m: z.array(z.number().nullable()), wind_direction_10m: z.array(z.number().nullable()) }) });

async function fetchBatch(start: string, end: string) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({
    latitude: String(requested.lat), longitude: String(requested.lng), start_date: start, end_date: end,
    hourly: 'wind_speed_10m,wind_direction_10m', models: 'era5', wind_speed_unit: 'mph', timezone: 'GMT',
  }).toString();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return responseSchema.parse(await response.json());
    } catch (error) {
      if (attempt === 2) throw error;
      await delay(2500 * (attempt + 1));
    }
  }
  throw new Error('Archive fetch exhausted');
}
async function main() {
  const months = Array.from({ length: 12 }, () => [] as WindRecord[]);
  let expected = 0;
  let missing = 0;
  let sampled: WindArchive['sampled'] | undefined;
  for (let year = 2006; year <= 2025; year += 2) {
    const start = year + '-01-01';
    const end = (year + 1) + '-12-31';
    const batch = await fetchBatch(start, end);
    const cell = { lat: batch.latitude, lng: batch.longitude };
    if (sampled && (cell.lat !== sampled.lat || cell.lng !== sampled.lng)) throw new Error('Archive grid cell changed across batches.');
    sampled = cell;
    const startMs = Date.parse(start + 'T00:00:00Z');
    const endMs = Date.parse(end + 'T23:00:00Z');
    const hours = (endMs - startMs) / 3_600_000 + 1;
    const { time, wind_speed_10m: speeds, wind_direction_10m: directions } = batch.hourly;
    if (time.length !== speeds.length || time.length !== directions.length) throw new Error('Archive arrays are not aligned.');
    const seen = new Set<number>();
    for (let i = 0; i < time.length; i++) {
      const epoch = Date.parse(time[i] + ':00Z');
      const speed = speeds[i];
      const direction = directions[i];
      if (!Number.isFinite(epoch) || epoch < startMs || epoch > endMs || (epoch - startMs) % 3_600_000 || seen.has(epoch)) throw new Error('Invalid or duplicate archive timestamp.');
      seen.add(epoch);
      if (speed === null || direction === null || speed < 0 || direction < 0 || direction > 360) { missing++; continue; }
      months[new Date(epoch).getUTCMonth()].push({ speed, direction: direction % 360 });
    }
    expected += hours;
    missing += hours - seen.size;
    console.log(start + ' through ' + end + ' · ' + seen.size + ' hourly timestamps');
    if (year < 2024) await delay(1150);
  }
  if (!sampled || !months.flat().length) throw new Error('No archive data retrieved.');
  const season = (indices: number[]) => summarizeWind(indices.flatMap((i) => months[i]));
  const cache: WindArchive = { region: 'Sierra Foothills, California', requested, sampled,
    start: '2006-01-01', end: '2025-12-31', retrievedAt: new Date().toISOString(), expected, missing,
    model: 'ERA5', units: 'mph', source: 'https://open-meteo.com/en/docs/historical-weather-api',
    all: summarizeWind(months.flat()), months: months.map(summarizeWind),
    seasons: { DJF: season([11, 0, 1]), MAM: season([2, 3, 4]), JJA: season([5, 6, 7]), SON: season([8, 9, 10]) },
  };
  await mkdir('public/data', { recursive: true });
  const path = 'public/data/sierra-era5.json';
  await writeFile(path + '.tmp', JSON.stringify(cache, null, 2) + '\n');
  await rename(path + '.tmp', path);
  console.log('Wrote ' + cache.all.observations + ' valid samples with ' + cache.missing + ' missing of ' + cache.expected + '.');
}
main().catch((error: unknown) => {
  console.error('Archive build failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
  process.exitCode = 1;
});
