import { area, booleanIntersects, booleanPointInPolygon, booleanValid, featureCollection, length, lineString, multiPolygon, union } from '@turf/turf';
import type { Coordinate, Point, Wind } from './contracts';
import { STEP, coordinate, spreadMetersPerMinute, unwrap } from './engine';
import type { ReplayShape } from './history';
import { BARRIER_ASSUMPTION, type BarrierLine } from './interventionContracts';
import { SQUARE_METERS_PER_ACRE } from './businessExposure';
import { DAY_HORIZON_MINUTES } from './simulationTime';

export const MAX_GRID_CELLS = 36_000;
export const DEFAULT_CELL_METERS = 75;
import { barrierConnections, cross, delta, dx, dy, firelineMesh, type XY } from './firelineGrid';

export type AtmosphericStep = { wind: Wind; humidity: number };
export type InterventionInput = {
  seed: ReplayShape; origin: Point; duration: number; dryness: number; weather: AtmosphericStep[];
  barriers: BarrierLine[]; location?: Coordinate; cellMeters?: number;
};

type Entry = { cell: number; at: number };
class ArrivalQueue {
  private entries: Entry[] = [];
  push(entry: Entry) {
    const items = this.entries;
    let n = items.length;
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (items[parent].at <= entry.at) break;
      items[n] = items[parent]; n = parent;
    }
    items[n] = entry;
  }
  pop() {
    const items = this.entries;
    const first = items[0];
    const last = items.pop();
    if (!last || !items.length) return first;
    let n = 0;
    while (n * 2 + 1 < items.length) {
      let child = n * 2 + 1;
      if (items[child + 1]?.at < items[child].at) child++;
      if (items[child].at >= last.at) break;
      items[n] = items[child]; n = child;
    }
    items[n] = last;
    return first;
  }
}
const compass = [90, 0, 270, 180];
function gridFor(input: InterventionInput) {
  const latitudeScale = 111195;
  const longitudeScale = latitudeScale * Math.cos(input.origin.lat * Math.PI / 180);
  const [lng, lat] = coordinate(input.origin);
  const project = ([x, y]: number[]): XY => [(unwrap(x, lng) - lng) * longitudeScale, (y - lat) * latitudeScale];
  const rings = (input.seed.geometry.type === 'Polygon' ? [input.seed.geometry.coordinates] : input.seed.geometry.coordinates)
    .flatMap((poly) => poly.map((ring) => ring.map(project)));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const rates = input.weather.map(({ wind, humidity }) => compass.map((bearing) => spreadMetersPerMinute(wind, humidity, input.dryness, bearing)));
  // A full-horizon upper bound keeps the modeled front away from the grid boundary.
  const reach = rates.slice(0, input.duration / STEP).reduce((sum, row) => sum + Math.max(...row) * STEP, 0);
  const margin = reach + 2 * DEFAULT_CELL_METERS;
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  const minCell = Math.max(20, input.cellMeters ?? DEFAULT_CELL_METERS);
  let spacing = Math.max(minCell, Math.ceil(Math.sqrt((x1 - x0) * (y1 - y0) / MAX_GRID_CELLS)));
  let columns = Math.ceil((x1 - x0) / spacing) + 4, rows = Math.ceil((y1 - y0) / spacing) + 4;
  while (columns * rows > MAX_GRID_CELLS) {
    spacing++;
    columns = Math.ceil((x1 - x0) / spacing) + 4; rows = Math.ceil((y1 - y0) / spacing) + 4;
  }
  x0 -= 2 * spacing; y0 -= 2 * spacing;
  const lines = input.barriers.map((line) => ({ id: line.id, ready: line.readyMinute, points: line.geometry.coordinates.map(project) }));
  const mesh = firelineMesh(columns, rows, spacing, [x0, y0], lines);
  function geographic(x: number, y: number): Coordinate { return [lng + (x0 + x * mesh.unit) / longitudeScale, lat + (y0 + y * mesh.unit) / latitudeScale]; }
  const initial: number[] = [];
  const scanlines = new Map<number, number[]>();
  for (let cell = 0; cell < mesh.tiles.length; cell++) {
    const [x, y] = mesh.center(mesh.tiles[cell]);
    let crossings = scanlines.get(y);
    if (!crossings) {
      crossings = [];
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
        if ((ay > y) !== (by > y)) crossings.push(ax + (bx - ax) * (y - ay) / (by - ay));
      }
      crossings.sort((a, b) => a - b);
      scanlines.set(y, crossings);
    }
    let low = 0, high = crossings.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (crossings[mid] <= x) low = mid + 1;
      else high = mid;
    }
    if (low % 2) initial.push(cell);
  }
  if (!initial.length) {
    const ring = rings[0].slice(0, -1);
    const [x, y] = ring.reduce<XY>((sum, p) => [sum[0] + p[0] / ring.length, sum[1] + p[1] / ring.length], [0, 0]);
    initial.push(mesh.tileAt(Math.floor((x - x0) / mesh.unit), Math.floor((y - y0) / mesh.unit)));
  }
  // Preserve the exact original footprint until all intersecting seed tiles are covered.
  const boundary = new Set<number>();
  for (const ring of rings) for (let i = 1; i < ring.length; i++) mesh.visit(ring[i - 1], ring[i], (base) => {
    const a = ring[i - 1], b = ring[i];
    const west = Math.min(a[0], b[0]), east = Math.max(a[0], b[0]), south = Math.min(a[1], b[1]), north = Math.max(a[1], b[1]);
    for (let index = mesh.offsets[base]; index < mesh.offsets[base + 1]; index++) {
      const { x, y, size } = mesh.tiles[index];
      const [left, bottom] = geographic(x, y);
      const [right, top] = geographic(x + size, y + size);
      const [l, btm] = project([left, bottom]), [r, t] = project([right, top]);
      if (l <= east + 1e-6 && r >= west - 1e-6 && btm <= north + 1e-6 && t >= south - 1e-6) boundary.add(index);
    }
  });
  return { columns, rows, spacing, rates, initial, geographic, mesh, lines, boundary };
}
type Grid = ReturnType<typeof gridFor>;

type Blocked = { id: string; cell: number; contact: number; otherwiseAt: number };
function arrivals(grid: Grid, duration: number, gates?: ReturnType<typeof barrierConnections>) {
  const { rates, initial, mesh } = grid;
  const times = new Float64Array(mesh.tiles.length).fill(Infinity);
  const queue = new ArrivalQueue();
  const blocked: Blocked[] = [];
  for (const cell of initial) { times[cell] = 0; queue.push({ cell, at: 0 }); }
  function travel(start: number, meters: number, direction: number) {
    let at = start;
    while (meters > 1e-7 && at < duration) {
      const index = Math.floor(at / STEP);
      const speed = rates[index][direction];
      const end = (index + 1) * STEP;
      const capacity = (end - at) * speed;
      if (meters <= capacity) return at + meters / speed;
      meters -= capacity; at = end;
    }
    return meters <= 1e-7 ? at : Infinity;
  }
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const { cell, at } = entry;
    if (at !== times[cell]) continue;
    const tile = mesh.tiles[cell];
    mesh.sides(tile, (next, d) => {
      if (next < 0 || times[next] <= at) return;
      const neighbor = mesh.tiles[next];
      const distance = tile.size === neighbor.size ? tile.size * mesh.unit :
        Math.hypot(tile.x + tile.size / 2 - neighbor.x - neighbor.size / 2, tile.y + tile.size / 2 - neighbor.y - neighbor.size / 2) * mesh.unit;
      const finish = travel(at, distance, d);
      const barriers = gates?.between(cell, next);
      let stopped = false;
      for (const gate of barriers ?? []) {
        const contact = travel(at, distance * gate.t, d);
        if (contact >= gate.ready && contact <= duration) {
          blocked.push({ id: gate.id, cell: next, contact, otherwiseAt: finish });
          stopped = true;
        }
      }
      if (!stopped && finish < times[next] && finish <= duration) {
        times[next] = finish;
        queue.push({ cell: next, at: finish });
      }
    });
  }
  return { times, blocked };
}

function insideRing(point: XY, ring: XY[]) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
    if ((ay > point[1]) !== (by > point[1]) && point[0] < ax + (bx - ax) * (point[1] - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

function polygonAt(grid: Grid, times: Float64Array, minute: number) {
  const { mesh } = grid;
  const width = mesh.width + 1;
  const edges = new Map<number, Map<number, number>>();
  function edge(x: number, y: number, d: number, distance: number) {
    const from = y * width + x, to = (y + dy[d] * distance) * width + x + dx[d] * distance;
    const outgoing = edges.get(from) ?? new Map<number, number>();
    outgoing.set(d, to); edges.set(from, outgoing);
  }
  for (let cell = 0; cell < times.length; cell++) {
    if (times[cell] > minute) continue;
    const tile = mesh.tiles[cell];
    mesh.sides(tile, (other, direction, start, end) => {
      if (other >= 0 && times[other] <= minute) return;
      const { x, y, size } = tile;
      if (direction === 0) edge(x + size, start, 1, end - start);
      if (direction === 1) edge(end, y + size, 2, end - start);
      if (direction === 2) edge(x, end, 3, end - start);
      if (direction === 3) edge(start, y, 0, end - start);
    });
  }
  const shells: { rings: XY[][]; area: number }[] = [], holes: XY[][] = [];
  const decode = (id: number): XY => [id % width, Math.floor(id / width)];
  while (edges.size) {
    const start = edges.keys().next().value!;
    const ring = [decode(start)];
    let node = start;
    let direction = edges.get(node)!.keys().next().value!;
    do {
      const outgoing = edges.get(node)!;
      const next = outgoing.get(direction)!;
      outgoing.delete(direction);
      if (!outgoing.size) edges.delete(node);
      node = next;
      ring.push(decode(node));
      if (node === start) break;
      const targets = edges.get(node)!;
      direction = [1, 0, 3, 2].map((turn) => (direction + turn) % 4).find((bearing) => targets.has(bearing))!;
    } while (true);
    const signed = ring.slice(1).reduce((sum, next, index) => sum + cross(ring[index], next), 0);
    if (signed > 0) shells.push({ rings: [ring], area: signed });
    else if (signed < 0) holes.push(ring);
  }
  for (const hole of holes) {
    const a = hole[0], b = hole[1], side = delta(b, a);
    const interior: XY = [(a[0] + b[0]) / 2 + side[1] * .25, (a[1] + b[1]) / 2 - side[0] * .25];
    const enclosing = shells.filter(({ rings }) => insideRing(interior, rings[0])).sort((a, b) => a.area - b.area)[0];
    enclosing?.rings.push(hole);
  }
  return multiPolygon(shells.map(({ rings }) => rings.map((ring) => ring.map(([x,y]) => grid.geographic(x,y)))));
}

function snapshots(grid: Grid, input: InterventionInput, times: Float64Array) {
  const initial = { minute: 0, shape: input.seed, acres: area(input.seed) / SQUARE_METERS_PER_ACRE };
  const frames: { minute: number; shape: ReplayShape; acres: number }[] = [initial];
  const changedSamples = new Set<number>();
  for (const arrival of times) if (Number.isFinite(arrival)) changedSamples.add(Math.ceil(arrival / STEP) * STEP);
  let coveredAt = 0;
  for (const cell of grid.boundary) coveredAt = Math.max(coveredAt, times[cell]);
  for (let minute = STEP; minute <= input.duration; minute += STEP) {
    // The first grid frame retains the exact seed. Later unchanged cell sets can reuse it.
    if (minute > STEP && !changedSamples.has(minute)) {
      frames.push({ ...frames.at(-1)!, minute });
      continue;
    }
    const raster = polygonAt(grid, times, minute);
    const shape = minute >= coveredAt ? (booleanValid(raster) ? raster : union(featureCollection([raster, raster]))) :
      union(featureCollection([raster, input.seed]));
    if (!shape) throw new Error('The modeled perimeter could not be polygonized.');
    frames.push({ minute, shape, acres: area(shape) / SQUARE_METERS_PER_ACRE });
  }
  return frames;
}

export function simulateIntervention(input: InterventionInput) {
  if (input.duration < STEP || input.duration > DAY_HORIZON_MINUTES || input.duration % STEP || input.weather.length < input.duration / STEP) throw new Error('Invalid intervention clock.');
  const grid = gridFor(input);
  const gates = barrierConnections(grid.mesh, grid.lines);
  const { times: baselineTimes } = arrivals(grid, input.duration);
  const baseline = snapshots(grid, input, baselineTimes);
  const spread = input.barriers.length ? arrivals(grid, input.duration, gates) : { times: baselineTimes, blocked: [] };
  const intervention = spread.times.every((time, index) => time === baselineTimes[index]) ? baseline : snapshots(grid, input, spread.times);
  const target = input.location && [unwrap(input.location[0], input.origin.lng), input.location[1]];
  const contact = (frames: typeof baseline) => target ? frames.find((frame) => booleanPointInPolygon(target, frame.shape))?.minute ?? null : null;
  const baselineContact = contact(baseline), interventionContact = contact(intervention);
  const lines = input.barriers.map((entry) => {
    const geometry = lineString(entry.geometry.coordinates.map(([lng, lat]) => [unwrap(lng, input.origin.lng), lat]));
    const blocked = spread.blocked.filter(({ id, cell, otherwiseAt }) => id === entry.id && spread.times[cell] > otherwiseAt + 1e-7);
    const crossingAt = spread.blocked.reduce((earliest, edge) => edge.id === entry.id ? Math.min(earliest, edge.contact) : earliest, Infinity);
    const stoppedAt = blocked.reduce((earliest, edge) => Math.min(earliest, edge.contact), Infinity);
    const bypassedAt = blocked.reduce((earliest, edge) => Math.min(earliest, spread.times[edge.cell]), Infinity);
    const first = (frames: typeof baseline) => frames.find((frame) => booleanIntersects(geometry, frame.shape))?.minute ?? null;
    const interventionMinute = Math.min(first(intervention) ?? Infinity, Math.ceil(crossingAt / STEP) * STEP);
    return { id: entry.id, represented: gates.represented.has(entry.id), readyMinute: entry.readyMinute, lengthMeters: length(geometry, { units: 'meters' }),
      baseline: first(baseline), intervention: Number.isFinite(interventionMinute) ? interventionMinute : null, blockedAt: Number.isFinite(stoppedAt) ? stoppedAt : null,
      bypassedAt: Number.isFinite(bypassedAt) ? bypassedAt : null };
  });
  return { baseline, intervention, baselineContact, interventionContact, lines, localCellMeters: grid.mesh.unit,
    cellMeters: grid.spacing, cells: grid.rows * grid.columns, modeledCells: grid.mesh.tiles.length, assumptions: BARRIER_ASSUMPTION };
}
export type InterventionResult = ReturnType<typeof simulateIntervention>;
export function interventionComparison(result: InterventionResult, minute: number) {
  const baseline = result.baseline[minute / STEP], intervention = result.intervention[minute / STEP];
  if (!baseline || !intervention) throw new Error('Select a modeled sample inside the intervention timeline.');
  const differenceAcres = baseline.acres - intervention.acres;
  const active = result.lines.filter((line) => line.readyMinute <= minute);
  return { minute, activeBarrierCount: active.length, activeLengthMeters: active.reduce((sum, line) => sum + line.lengthMeters, 0), baselineAcres: baseline.acres, interventionAcres: intervention.acres, differenceAcres,
    reductionPercent: baseline.acres > 0 ? differenceAcres / baseline.acres * 100 : 0,
    iou: baseline.acres > 0 ? intervention.acres / baseline.acres : 1,
    baselineContact: result.baselineContact, interventionContact: result.interventionContact,
    contactDelayMinutes: result.baselineContact === null || result.interventionContact === null ? null : result.interventionContact - result.baselineContact,
    lineContacts: result.lines, cellMeters: result.cellMeters, localCellMeters: result.localCellMeters, cells: result.cells, assumptions: result.assumptions };
}



export function lineOutcome(line: InterventionResult['lines'][number], minute: number) {
  if (line.bypassedAt !== null && line.bypassedAt <= minute) return 'Blocked direct spread, then bypassed';
  if (line.blockedAt !== null && line.blockedAt <= minute) return 'Blocked direct spread';
  if (line.intervention !== null && line.intervention <= minute) return 'Reached · no measurable effect';
  return 'Fire has not reached the line';
}
