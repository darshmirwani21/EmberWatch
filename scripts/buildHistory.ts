import { writeFile } from 'node:fs/promises';
import { feature, area, simplify, union, featureCollection } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { z } from 'zod';
import { historicalGeometry, historyDataset, type CaseId, type HistoricRecord } from '../shared/historyContracts';

const wfigs = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0';
const firis = 'https://services1.arcgis.com/eGSDp8lpKe5izqVc/arcgis/rest/services/interra_firis_2025_single/FeatureServer/10';
const firisDaily = 'https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/LAC_Wildfires_JAN2025_NIFC_FIRIS_20250203T183059Z_001/FeatureServer/0';
const county = 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Palisades_and_Eaton_Dissolved_Fire_Perimeters_as_of_20250121/FeatureServer/0';
const parkIR = 'https://services2.arcgis.com/3iNbxbY9zhyxPvde/arcgis/rest/services/20240730_c1000_Park_Aircraft3_Perimeter/FeatureServer/0';

const plan = {
  eaton: { lat: 34.19163, lng: -118.10544, from: '2025-01-08', to: '2025-01-22', records: [
    [firis, "mission='CA-LFD-EATON-N40Y_011020251403Z'", 'firis-survey', 'FIRIS aerial perimeter', 'FIRIS via the UC San Diego public GIS archive', '2025-01-10T14:22:09.000Z', null, 'time'],
    [firisDaily, "FIRE_NAME='EATON' AND FID=6", 'firis-daily', 'FIRIS day-dated perimeter', 'FIRIS / NIFC via the USC Spatial Sciences Institute archive', null, '2025-01-11', 'day'],
    [county, '1=1', 'lac-jan21', 'LA County January 21 outline', 'Los Angeles County Public Works', null, '2025-01-21', 'day'],
    [wfigs, 'OBJECTID=53438', 'wfigs-archive', 'National archive perimeter', 'NIFC WFIGS Interagency Fire Perimeters', null, null, 'archive'],
  ] },
  park: { lat: 39.818579, lng: -121.802601, from: '2024-07-24', to: '2024-08-13', records: [
    [parkIR, 'FID=1', 'park-ir', 'Aircraft infrared perimeter', 'Tehama County public GIS aircraft survey', '2024-07-30T10:00:00.000Z', null, 'time'],
    [wfigs, 'OBJECTID=30039', 'park-wfigs', 'NIFC dated perimeter', 'NIFC WFIGS Interagency Fire Perimeters', '2024-08-12T02:51:00.000Z', null, 'time'],
  ] },
  mosquito: { lat: 39.00122, lng: -120.7246, from: '2022-09-06', to: '2022-09-22', records: [
    [wfigs, 'OBJECTID=14571', 'mosquito-wfigs', 'National archive perimeter', 'NIFC WFIGS Interagency Fire Perimeters', null, null, 'archive'],
  ] },
} as const;
const responseSchema = z.object({ features: z.array(z.object({ geometry: historicalGeometry })).min(1) });
const weatherSchema = z.object({
  latitude: z.number(), longitude: z.number(), utc_offset_seconds: z.literal(0),
  hourly_units: z.object({ temperature_2m: z.literal('°F'), wind_speed_10m: z.literal('mp/h'),
    relative_humidity_2m: z.literal('%'), wind_direction_10m: z.literal('°') }),
  hourly: z.object({ time: z.array(z.string()), temperature_2m: z.array(z.number().nullable()), relative_humidity_2m: z.array(z.number().nullable()),
    wind_speed_10m: z.array(z.number().nullable()), wind_direction_10m: z.array(z.number().nullable()) }),
});
async function json(url: URL) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(url.hostname + ' returned ' + response.status);
  return response.json();
}

async function build(id: CaseId) {
  const config = plan[id];
  const records = await Promise.all(config.records.map(async ([link, where, id, label, source, at, date, precision]): Promise<HistoricRecord> => {
    const url = new URL(link + '/query');
    url.search = new URLSearchParams({ where, outFields: '*', f: 'geojson', outSR: '4326', geometryPrecision: '6' }).toString();
    const data = responseSchema.parse(await json(url));
    const parts: Feature<Polygon | MultiPolygon>[] = data.features.map((row) => feature(row.geometry));
    const original = parts.length === 1 ? parts[0] : union(featureCollection(parts));
    if (!original) throw new Error('Missing geometry for ' + id);
    const compact = simplify(original, { tolerance: .00012, highQuality: true });
    if (Math.abs(area(compact) / area(original) - 1) > .01) throw new Error('Simplification changed area for ' + id);
    return { id, label, at, date, precision, source, url: link, geometry: compact.geometry as HistoricRecord['geometry'] };
  }));
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({ latitude: String(config.lat), longitude: String(config.lng), start_date: config.from, end_date: config.to,
    models: 'era5', timezone: 'GMT', wind_speed_unit: 'mph', temperature_unit: 'fahrenheit',
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m' }).toString();
  let weather: z.infer<typeof historyDataset>['weather'] = [];
  let weatherGrid: [number, number] | null = null;
  try {
    const result = weatherSchema.parse(await json(url));
    const { hourly } = result;
    if (![hourly.temperature_2m, hourly.wind_direction_10m, hourly.wind_speed_10m, hourly.relative_humidity_2m].every((series) => series.length === hourly.time.length)) throw new Error('Misaligned hourly weather');
    weatherGrid = [result.longitude, result.latitude];
    weather = hourly.time.flatMap((at, index) => {
      const fromDeg = hourly.wind_direction_10m[index], speedMph = hourly.wind_speed_10m[index];
      const humidity = hourly.relative_humidity_2m[index], temperatureF = hourly.temperature_2m[index];
      if (fromDeg == null || speedMph == null || humidity == null || temperatureF == null) return [];
      return [{ at: at + ':00Z', fromDeg, speedMph, humidity, temperatureF }];
    });
  } catch {
    console.warn(id + ': historical weather unavailable from the provider');
  }
  const dataset = historyDataset.parse({ id, records, retrievedAt: new Date().toISOString(), weather, weatherGrid });
  await writeFile(new URL('../public/data/history-' + id + '.json', import.meta.url), JSON.stringify(dataset) + '\n');
  console.log(id, records.length + ' perimeter records', weather.length + ' weather rows');
}
await Promise.all((Object.keys(plan) as CaseId[]).map(build));

