import { z } from 'zod';
import type { Point, Weather, OfficialAlert, SourceResult } from '../shared/contracts';
import { AIR_QUALITY_SOURCE, AIR_QUALITY_URL, type AirQualityForecast } from '../shared/businessContracts';
export const weatherSource = 'https://open-meteo.com/en/docs';
export const nwsSource = 'https://www.weather.gov/alerts';

async function read(url: URL, signal?: AbortSignal, headers?: Record<string, string>) {
  const timeout = AbortSignal.timeout(6500);
  const response = await fetch(url, { headers, signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  if (!response.ok) throw new Error('Source request failed');
  return response.json() as Promise<unknown>;
}
const weatherSchema = z.object({ current: z.object({
  temperature_2m: z.number(), wind_speed_10m: z.number().min(0),
  wind_direction_10m: z.number().min(0).max(360), relative_humidity_2m: z.number().min(0).max(100),
  time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
}), current_units: z.object({ wind_speed_10m: z.literal('mp/h'), wind_direction_10m: z.literal('°'),
  relative_humidity_2m: z.literal('%'), temperature_2m: z.literal('°F') }) });

export async function getWeather(point: Point, signal?: AbortSignal): Promise<SourceResult<Weather>> {
  const meta = { source: 'Open-Meteo best-match forecast model', url: weatherSource };
  const customer = process.env.OPEN_METEO_API_KEY?.trim();
  const url = new URL(customer ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(point.lat), longitude: String(point.lng), timezone: 'GMT',
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'mph', temperature_unit: 'fahrenheit',
  }).toString();
  if (customer) url.searchParams.set('apikey', customer);
  try {
    const { current } = weatherSchema.parse(await read(url, signal));
    return { ...meta, retrievedAt: new Date().toISOString(), status: 'ok', data: {
      temperatureF: current.temperature_2m, speedMph: current.wind_speed_10m, fromDeg: current.wind_direction_10m % 360,
      humidity: current.relative_humidity_2m, validAt: current.time + ':00Z',
    } };
  } catch {
    return { ...meta, retrievedAt: new Date().toISOString(), status: 'unavailable', reason: 'Open-Meteo conditions could not be retrieved or verified.' };
  }
}

const airQualitySchema = z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), utc_offset_seconds: z.literal(0),
  hourly_units: z.object({ pm2_5: z.enum(['μg/m³', 'µg/m³']) }),
  hourly: z.object({ time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)).max(48),
    pm2_5: z.array(z.number().nonnegative().nullable()).max(48) }),
});

export function parseAirQuality(data: unknown): Omit<AirQualityForecast, 'wind'> {
  const parsed = airQualitySchema.parse(data);
  const { time, pm2_5 } = parsed.hourly;
  if (time.length !== pm2_5.length || !pm2_5.some((value) => value !== null)) throw new Error('No usable PM2.5 samples.');
  return { grid: { lat: parsed.latitude, lng: parsed.longitude },
    hours: time.map((value, index) => ({ validAt: value + ':00Z', pm25: pm2_5[index] })) };
}

export async function getAirQuality(point: Point, signal?: AbortSignal): Promise<SourceResult<AirQualityForecast>> {
  const meta = { source: AIR_QUALITY_SOURCE, url: AIR_QUALITY_URL };
  const customer = process.env.OPEN_METEO_API_KEY?.trim();
  const url = new URL(customer ? 'https://customer-air-quality-api.open-meteo.com/v1/air-quality' :
    'https://air-quality-api.open-meteo.com/v1/air-quality');
  url.search = new URLSearchParams({
    latitude: String(point.lat), longitude: String(point.lng), domains: 'cams_global',
    timezone: 'GMT', forecast_hours: '12', hourly: 'pm2_5',
  }).toString();
  if (customer) url.searchParams.set('apikey', customer);
  try {
    const [forecast, weather] = await Promise.all([read(url, signal).then(parseAirQuality), getWeather(point, signal)]);
    return { ...meta, retrievedAt: new Date().toISOString(), status: 'ok', data: { ...forecast,
      wind: weather.status === 'ok' ? { speedMph: weather.data.speedMph, fromDeg: weather.data.fromDeg, validAt: weather.data.validAt } : null,
    } };
  } catch {
    return { ...meta, retrievedAt: new Date().toISOString(), status: 'unavailable', reason: 'A regional PM2.5 forecast could not be retrieved or verified.' };
  }
}

const alertUrl = z.url().refine((url) => {
  const parsed = new URL(url);
  return parsed.origin === 'https://api.weather.gov' && parsed.pathname.startsWith('/alerts/');
});
const alertsSchema = z.object({ features: z.array(z.object({ properties: z.object({
  '@id': alertUrl, event: z.string(), sent: z.iso.datetime({ offset: true }),
  effective: z.iso.datetime({ offset: true }), expires: z.iso.datetime({ offset: true }), areaDesc: z.string(), severity: z.string(),
}) })) });
export async function getAlerts(point: Point, signal?: AbortSignal): Promise<SourceResult<OfficialAlert[]>> {
  const meta = { source: 'NOAA / National Weather Service', url: nwsSource };
  const url = new URL('https://api.weather.gov/alerts/active');
  url.searchParams.set('point', point.lat.toFixed(4) + ',' + point.lng.toFixed(4));
  try {
    const { features } = alertsSchema.parse(await read(url, signal, {
      Accept: 'application/geo+json',
      'User-Agent': process.env.NWS_USER_AGENT || 'EmberWatch Scenario Lab/1.0 (educational prototype)',
    }));
    return { ...meta, retrievedAt: new Date().toISOString(), status: 'ok', data: features.map(({ properties: p }) => ({
      title: p.event, url: p['@id'], issuedAt: p.sent, effectiveAt: p.effective, expiresAt: p.expires, scope: p.areaDesc, severity: p.severity,
    })) };
  } catch {
    return { ...meta, retrievedAt: new Date().toISOString(), status: 'unavailable', reason: 'NWS alerts could not be retrieved or verified for this point.' };
  }
}
