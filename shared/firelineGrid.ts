export type XY = [number, number];
export type GridLine = { id: string; ready: number; points: XY[] };
type Tile = { x: number; y: number; size: number };

export const dx = [1, 0, -1, 0];
export const dy = [0, 1, 0, -1];
export const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
export const delta = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];

// Parameters of the shared portion of a segment inside a rectangle.
function interval(a: XY, b: XY, x: number, y: number, size: number) {
  let start = 0, end = 1;
  for (const axis of [0, 1]) {
    const lower = axis ? y : x;
    const step = b[axis] - a[axis];
    if (!step) { if (a[axis] < lower || a[axis] > lower + size) return null; continue; }
    const t = (lower - a[axis]) / step, u = (lower + size - a[axis]) / step;
    start = Math.max(start, Math.min(t, u));
    end = Math.min(end, Math.max(t, u));
  }
  return start <= end ? [start, end] : null;
}

export function firelineMesh(columns: number, rows: number, spacing: number, origin: XY, lines: GridLine[]) {
  const [x0, y0] = origin;
  const patch = new Set<number>();
  function visit(a: XY, b: XY, collect: (cell: number) => void) {
    const left = Math.max(0, Math.floor((Math.min(a[0], b[0]) - x0) / spacing) - 1);
    const right = Math.min(columns - 1, Math.floor((Math.max(a[0], b[0]) - x0) / spacing) + 1);
    const bottom = Math.max(0, Math.floor((Math.min(a[1], b[1]) - y0) / spacing) - 1);
    const top = Math.min(rows - 1, Math.floor((Math.max(a[1], b[1]) - y0) / spacing) + 1);
    for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) {
      const pad = spacing * .12;
      if (interval(a, b, x0 + x * spacing - pad, y0 + y * spacing - pad, spacing + 2 * pad)) collect(y * columns + x);
    }
  }
  for (const { points } of lines) for (let i = 1; i < points.length; i++) visit(points[i - 1], points[i], (cell) => patch.add(cell));

  // Keep the regional grid. Only tiles adjacent to the actual segments are split.
  const divisions = patch.size ? Math.max(1, Math.min(15, Math.max(3, Math.ceil(spacing / 25)),
    Math.floor(Math.sqrt(1 + 36_000 / patch.size)))) : 1;
  const unit = spacing / divisions;
  const width = columns * divisions;
  const height = rows * divisions;
  const tiles: Tile[] = [];
  const offsets = new Int32Array(columns * rows + 1);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const cell = row * columns + col;
    offsets[cell] = tiles.length;
    const size = patch.has(cell) ? 1 : divisions;
    for (let y = 0; y < divisions; y += size) for (let x = 0; x < divisions; x += size) {
      tiles.push({ x: col * divisions + x, y: row * divisions + y, size });
    }
  }
  offsets[offsets.length - 1] = tiles.length;
  function tileAt(x: number, y: number) {
    if (x < 0 || x >= width || y < 0 || y >= height) return -1;
    const cell = Math.floor(y / divisions) * columns + Math.floor(x / divisions);
    const index = offsets[cell];
    return tiles[index].size === divisions ? index : index + (y % divisions) * divisions + x % divisions;
  }
  function center({ x, y, size }: Tile): XY { return [x0 + (x + size / 2) * unit, y0 + (y + size / 2) * unit]; }

  // Each pair shares a positive-length side. Touching only at corners cannot propagate.
  function sides(tile: Tile, visit: (other: number, d: number, start: number, end: number) => void) {
    const { x, y, size } = tile;
    for (let d = 0; d < 4; d++) {
      const vertical = d % 2 === 0;
      const fixed = vertical ? (d === 0 ? x + size : x - 1) : (d === 1 ? y + size : y - 1);
      const limit = (vertical ? y : x) + size;
      for (let start = vertical ? y : x; start < limit;) {
        const other = vertical ? tileAt(fixed, start) : tileAt(start, fixed);
        const neighbor = tiles[other];
        const end = neighbor ? Math.min(limit, (vertical ? neighbor.y : neighbor.x) + neighbor.size) : limit;
        visit(other, d, start, end); start = end;
      }
    }
  }
  return { tiles, offsets, visit, tileAt, width, unit, center, sides };
}
type Mesh = ReturnType<typeof firelineMesh>;

// Return the last crossing along this connector, including collinear overlap.
function crossing(start: XY, end: XY, a: XY, b: XY) {
  const step = delta(end, start), segment = delta(b, a), offset = delta(a, start);
  const denominator = cross(step, segment);
  const epsilon = 1e-7;
  if (Math.abs(denominator) > epsilon) {
    const t = cross(offset, segment) / denominator, u = cross(offset, step) / denominator;
    return t >= -epsilon && t <= 1 + epsilon && u >= -epsilon && u <= 1 + epsilon ? Math.max(0, Math.min(1, t)) : undefined;
  }
  if (Math.abs(cross(offset, step)) > epsilon) return undefined;
  const axis = Math.abs(step[0]) > Math.abs(step[1]) ? 0 : 1;
  const left = offset[axis] / step[axis], right = (b[axis] - start[axis]) / step[axis];
  return Math.max(left, right) >= 0 && Math.min(left, right) <= 1 ? Math.min(1, Math.max(left, right)) : undefined;
}

type Gate = { id: string; ready: number; t: number };
export function barrierConnections(mesh: Mesh, lines: GridLine[]) {
  const gates = new Map<number, Gate[]>();
  const key = (from: number, to: number) => from * mesh.tiles.length + to;
  function add(from: number, to: number, gate: Gate) {
    const index = key(from, to), list = gates.get(index);
    if (list) {
      const previous = list.find(({ id }) => id === gate.id);
      if (previous) previous.t = Math.max(previous.t, gate.t);
      else list.push(gate);
    } else gates.set(index, [gate]);
  }
  for (const line of lines) {
    let hit = false;
    let nearest: { from: number; to: number; distance: number } | undefined;
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1], b = line.points[i];
      const segment = delta(b, a);
      if (!segment[0] && !segment[1]) continue;
      const unique = new Set<number>();
      mesh.visit(a, b, (base) => {
        for (let from = mesh.offsets[base]; from < mesh.offsets[base + 1]; from++) {
          const tile = mesh.tiles[from], start = mesh.center(tile);
          mesh.sides(tile, (to) => {
            if (to < 0) return;
            const pair = key(Math.min(from, to), Math.max(from, to));
            if (unique.has(pair)) return;
            unique.add(pair);
            const end = mesh.center(mesh.tiles[to]);
            const forward = crossing(start, end, a, b);
            if (forward !== undefined) {
              hit = true;
              add(from, to, { id: line.id, ready: line.ready, t: forward });
              add(to, from, { id: line.id, ready: line.ready, t: crossing(end, start, a, b) ?? 1 - forward });
              return;
            }
            // Very small segments can fall wholly between connectors. Use one nearby
            // edge perpendicular to the line, never masking the cell that contains it.
            const [u, v] = delta(end, start);
            const connectorLength = Math.hypot(u, v);
            const alignment = Math.abs(cross([u, v], segment)) / (connectorLength * Math.hypot(...segment));
            const separation = Math.hypot((a[0] + b[0] - start[0] - end[0]) / 2, (a[1] + b[1] - start[1] - end[1]) / 2);
            const distance = separation + (1 - alignment) * mesh.unit;
            if (alignment >= .5 && separation <= mesh.unit && (!nearest || distance < nearest.distance)) nearest = { from, to, distance };
          });
        }
      });
    }
    if (!hit && nearest) {
      add(nearest.from, nearest.to, { id: line.id, ready: line.ready, t: .5 });
      add(nearest.to, nearest.from, { id: line.id, ready: line.ready, t: .5 });
    }
  }
  return { between: (from: number, to: number) => gates.get(key(from, to)),
    represented: new Set([...gates.values()].flatMap((gates) => gates.map(({ id }) => id))) };
}
