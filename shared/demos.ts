import type { ControlLine, Point, Scenario } from './contracts';
import { project } from './engine';

const south: Scenario = {
  ignition: { lat: 34.150, lng: -118.550 }, durationMinutes: 120, wind: { speedMph: 24, fromDeg: 315 },
  humidity: 22, dryness: .85, shift: { minute: 35, wind: { fromDeg: 180, speedMph: 32 } },
};
const santa: Scenario = {
  ignition: { lat: 38.470, lng: -122.720 }, durationMinutes: 120, wind: { speedMph: 30, fromDeg: 315 },
  humidity: 18, dryness: .90, shift: { minute: 35, wind: { fromDeg: 180, speedMph: 32 } },
};
const sierra: Scenario = {
  ignition: { lat: 38.900, lng: -121.070 }, durationMinutes: 120, wind: { speedMph: 10, fromDeg: 270 },
  humidity: 55, dryness: .40,
};
function demoLine(origin: Point, id: 'A' | 'B', angle: number, meters: number): ControlLine {
  return { id, name: 'Line ' + id, color: id === 'A' ? '#fcd776' : '#62dbc7', type: 'Other example', completionMinute: 30,
    coordinates: [project(origin, angle - 18, meters), project(origin, angle + 18, meters)] };
}
export const demos = [
  { title: 'Southern California Wind Shift', location: 'Santa Monica Mountains, CA', scenario: south,
    point: { lat: 34.142, lng: -118.542 }, lines: [demoLine(south.ignition, 'A', 135, 850), demoLine(south.ignition, 'B', 10, 1550)] },
  { title: 'Santa Rosa Control Lines', location: 'Santa Rosa, CA', scenario: santa,
    point: undefined, lines: [demoLine(santa.ignition, 'A', 135, 1050), demoLine(santa.ignition, 'B', 15, 1700)] },
  { title: 'Sierra Foothills Scenario Showdown', location: 'Sierra Foothills, CA', scenario: sierra,
    point: { lat: 38.900, lng: -121.052 }, lines: [demoLine(sierra.ignition, 'A', 90, 1000), demoLine(sierra.ignition, 'B', 80, 1800)] },
];
export function defaultComparison(scenario: Scenario, demo: number): Scenario {
  if (demo === 2) return { ...scenario, wind: { speedMph: 35, fromDeg: 270 }, humidity: 20, dryness: .90 };
  const { shift, ...base } = scenario;
  const minute = Math.min(35, scenario.durationMinutes);
  return shift ? base : { ...base, shift: { minute, wind: { fromDeg: (scenario.wind.fromDeg + 90) % 360, speedMph: scenario.wind.speedMph } } };
}
