import type { Coordinate, Scenario } from './contracts';
import { businessPolygon, verifiedBusinessAsset } from './businessExposure';

export const vineyardDemo = {
  title: 'Napa–Sonoma Vineyard Drill',
  location: 'Napa–Sonoma, California',
  scenario: {
    ignition: { lat: 38.307, lng: -122.385 }, durationMinutes: 120,
    wind: { fromDeg: 250, speedMph: 22 }, humidity: 28, dryness: .76,
    shift: { minute: 35, wind: { fromDeg: 190, speedMph: 29 } },
  } satisfies Scenario,
  minute: 45,
};

function rectangle(west: number, south: number, east: number, north: number): Coordinate[] {
  return [[west,south],[east,south],[east,north],[west,north]];
}
const example = (id: string, name: string, category: string, vertices: Coordinate[], declaredValue?: number) => verifiedBusinessAsset({
  id: 'vineyard-demo-' + id, name, category, geometry: businessPolygon(vertices), declaredValue, fictional: true,
});
export const vineyardAssets = [
  example('property', 'Fictional estate boundary', 'Property boundary', rectangle(-122.382,38.304,-122.361,38.327)),
  example('west', 'West Pinot Block', 'Vineyard block', rectangle(-122.381,38.307,-122.376,38.312), 180000),
  example('bench', 'Bench Chardonnay Block', 'Vineyard block', rectangle(-122.375,38.310,-122.37,38.315), 260000),
  example('ridge', 'Ridge Cabernet Block', 'Vineyard block', rectangle(-122.374,38.319,-122.368,38.324), 315000),
  example('cellar', 'Cellar and crush pad', 'Building', rectangle(-122.378,38.3055,-122.3765,38.307), 390000),
  example('pump', 'Irrigation equipment yard', 'Equipment', rectangle(-122.373,38.306,-122.3718,38.3071)),
];
