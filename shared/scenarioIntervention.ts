import type { ControlLine, Scenario } from './contracts';
import { STEP, type Snapshot } from './engine';
import type { InterventionInput } from './interventionSimulation';

export function scenarioInterventionInput(scenario: Scenario, seed: Snapshot, lines: Pick<ControlLine, 'id' | 'coordinates' | 'completionMinute'>[]): InterventionInput {
  const duration = scenario.durationMinutes - seed.minute;
  return {
    seed: seed.polygon, origin: scenario.ignition, duration, dryness: scenario.dryness,
    weather: Array.from({ length: duration / STEP + 1 }, (_, i) => ({
      humidity: scenario.humidity,
      wind: scenario.shift && seed.minute + i * STEP >= scenario.shift.minute ? scenario.shift.wind : scenario.wind,
    })),
    barriers: lines.map((line) => ({
      id: line.id, readyMinute: Math.max(0, (line.completionMinute ?? seed.minute) - seed.minute),
      geometry: { type: 'LineString', coordinates: line.coordinates },
    })),
  };
}
