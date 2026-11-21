export const sectorLabels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export type WindRecord = { speed: number; direction: number };
export function summarizeWind(records: WindRecord[]) {
  const sectors = Array<number>(8).fill(0);
  const speeds = records.map((record) => record.speed).sort((a, b) => a - b);
  const percentile = (p: number) => {
    if (!speeds.length) return null;
    const index = p * (speeds.length - 1);
    const lower = Math.floor(index);
    return Number((speeds[lower] + (speeds[Math.ceil(index)] - speeds[lower]) * (index - lower)).toFixed(2));
  };
  let calm = 0;
  let north = 0;
  let east = 0;
  for (const { speed, direction } of records) {
    if (speed < 1) { calm++; continue; }
    const radians = direction * Math.PI / 180;
    sectors[Math.floor((direction + 22.5) / 45) % 8]++;
    north += Math.cos(radians);
    east += Math.sin(radians);
  }
  const magnitude = Math.hypot(north, east);
  const directional = records.length - calm;
  const concentration = directional ? magnitude / directional : null;
  const meanFrom = directional && magnitude > 1e-9 ? (Math.atan2(east, north) * 180 / Math.PI + 360) % 360 : null;
  return { observations: records.length, calm, sectors, p10: percentile(.1), median: percentile(.5), p90: percentile(.9),
    meanFrom: meanFrom === null ? null : Number(meanFrom.toFixed(2)) % 360, concentration: concentration === null ? null : Number(concentration.toFixed(3)) };
}
export type WindSummary = ReturnType<typeof summarizeWind>;
export type WindArchive = {
  region: string; requested: { lat: number; lng: number }; sampled: { lat: number; lng: number };
  start: string; end: string; retrievedAt: string; expected: number; missing: number; model: string; units: 'mph'; source: string;
  all: WindSummary; months: WindSummary[]; seasons: Record<'DJF' | 'MAM' | 'JJA' | 'SON', WindSummary>;
};
