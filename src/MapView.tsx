import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import maplibre, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import { Crosshair, Layers3, List, LocateFixed, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Coordinate, Point } from '../shared/contracts';
import { coordinate } from '../shared/engine';

const nationalMap = (service: string, maxzoom: number): StyleSpecification => ({
  version: 8,
  sources: { nationalMap: {
    type: 'raster', tileSize: 256, maxzoom,
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/' + service + '/MapServer/tile/{z}/{y}/{x}'],
    attribution: '<a href="https://apps.nationalmap.gov/services/" target="_blank" rel="noopener">USGS The National Map</a>',
  } },
  layers: [{ id: 'national-map', type: 'raster', source: 'nationalMap', paint: { 'raster-fade-duration': 130 } }],
});
const basemapLabels = { streets: 'Streets · OpenFreeMap', dark: 'Dark · OpenFreeMap', terrain: 'Terrain · USGS', hybrid: 'Hybrid · USGS / OpenFreeMap' };

const basemapStyles = {
  streets: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  terrain: nationalMap('USGSTopo', 16),
  hybrid: 'https://tiles.openfreemap.org/styles/liberty',
};
type BasemapStyle = keyof typeof basemapStyles;
const defaultBasemap: BasemapStyle = 'terrain';
const offlineStyle: StyleSpecification = {
  version: 8, sources: {}, layers: [{ id: 'offline', type: 'background', paint: { 'background-color': '#172332' } }],
};
type Overlay = Feature<Geometry, { kind: string; color: string; soft?: boolean; candidateId?: string; selected?: boolean }>;
export const collection = (features: Overlay[]): FeatureCollection<Geometry, Overlay['properties']> => ({ type: 'FeatureCollection', features });
export type { Overlay };
type Props = {
  overlays: Overlay[]; point: Point; camera: number; title: string; mode: string; centerOnIgnition: () => void;
  fictional: boolean;
  historical?: boolean;
  historicalStatus?: string;
  viewport?: 'scenario' | 'history';
  mobile: boolean; expanded: boolean; onExpand: () => void; onMapTools: () => void;
  legend?: ReactNode;
  drawing?: boolean;
  drawingToolbar?: ReactNode;
  focusCandidate?: Coordinate[];
  onCandidate?: (id: string) => void;
  onPick: (p: Coordinate) => void; wind?: { from: number; toward: number; mph: number };
  layers: { key: string; label: string; enabled: boolean; toggle: () => void }[];
};
const candidateLayers = ['candidate-geometric', 'candidate-nemotron'];
const styles = ['grid', 'proximity', 'comparison', 'future', 'fire', 'observed', 'history-baseline', 'history-branch', 'property', 'asset', 'asset-overlap', 'route', 'line', 'line-planned', 'line-overlap',
  ...candidateLayers, 'draft', 'wind', 'vertex', 'point', 'origin', 'ignition', 'hit'];
const lineLayers = new Set(['grid','proximity','comparison','future','fire','observed','history-baseline','history-branch','property','asset','asset-overlap','route','line','line-planned','line-overlap',...candidateLayers,'draft','wind']);
const lineDash = (kind: string) => {
  if (kind === 'candidate-nemotron') return [1, 2];
  if (kind === 'candidate-geometric' || kind === 'future') return [4, 2];
  if (kind === 'grid') return [1, 5];
  return ['proximity', 'route', 'draft', 'line-planned', 'property', 'history-baseline', 'history-branch'].includes(kind) ? [2, 2] : [1, 0];
};
const initialZoom = () => window.matchMedia('(max-width: 780px)').matches ? 12.1 : 12.7;
const fillOpacity: Record<string, number> = { fire: .28, proximity: .055, comparison: .12, observed: .24, 'history-baseline': .11, 'history-branch': .11, asset: .13, 'asset-overlap': .55 };
function addOverlays(map: maplibre.Map, features: Overlay[]) {
  if (map.getSource('ember')) return;
  map.addSource('ember', { type: 'geojson', data: collection(features) });
  for (const kind of styles) {
    const filter: ['==', ['get', string], string] = ['==', ['get', 'kind'], kind];
    if (kind in fillOpacity) {
      map.addLayer({ id: kind + '-fill', source: 'ember', type: 'fill', filter, paint: {
        'fill-color': ['get', 'color'], 'fill-opacity': fillOpacity[kind],
      } });
    }
    if (lineLayers.has(kind)) {
      const candidate = candidateLayers.includes(kind);
      const assetOutline = kind === 'asset' || kind === 'property';
      const dash = lineDash(kind);
      const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
      if (candidate || assetOutline || ['route', 'line', 'line-planned', 'line-overlap', 'draft', 'wind'].includes(kind)) {
        map.addLayer({ id: kind + '-casing', source: 'ember', type: 'line', filter, layout, paint: {
          'line-color': '#172332', 'line-width': candidate ? ['case', ['==', ['get', 'selected'], true], 8, 5] : kind === 'line-overlap' ? 7 : 4.5,
          'line-opacity': .8, 'line-dasharray': dash,
        } });
      }
      map.addLayer({ id: kind, source: 'ember', type: 'line', filter, layout, paint: {
        'line-color': ['get', 'color'], 'line-width': candidate ? ['case', ['==', ['get', 'selected'], true], 5.5, 3.2]
          : assetOutline ? ['case', ['==', ['get', 'selected'], true], 3.5, 2]
          : kind === 'line-overlap' ? 4 : kind === 'grid' || kind === 'proximity' ? 1 : 2.4,
        'line-dasharray': dash,
        'line-opacity': ['case', ['==', ['get', 'soft'], true], .55, .95],
      } });
    } else {
      map.addLayer({ id: kind, source: 'ember', type: 'circle', filter, paint: {
        'circle-radius': kind === 'ignition' || kind === 'point' ? 7 : 4, 'circle-color': ['get', 'color'],
        'circle-stroke-width': 2, 'circle-stroke-color': '#0e1723',
      } });
    }
  }
}
function grid(point: Point): Overlay[] {
  const lines: Overlay[] = [];
  const lat = Math.round(point.lat * 100) / 100;
  const lng = Math.round(point.lng * 100) / 100;
  for (let i = -12; i <= 12; i++) {
    const offset = i / 100;
    for (const coordinates of [
      [[lng + offset, lat - .12], [lng + offset, lat + .12]],
      [[lng - .12, lat + offset], [lng + .12, lat + offset]],
    ]) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { kind: 'grid', color: '#334659' } });
  }
  return lines;
}
export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibre.Map | null>(null);
  const changeStyle = useRef<(style: BasemapStyle) => void>(() => {});
  const latest = useRef(props);
  latest.current = props;
  const [basemap, setBasemap] = useState<'loading' | 'online' | 'grid' | 'canvas'>('loading');
  const [mapStyle, setMapStyle] = useState<BasemapStyle>(defaultBasemap);
  const [showLayers, setShowLayers] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);
  const view = useRef({ context: props.viewport ?? 'scenario', camera: props.camera });
  const savedView = useRef<{ center: maplibre.LngLat; zoom: number; camera: number } | undefined>(undefined);
  const [keyboard, setKeyboard] = useState(false);
  const data = basemap === 'online' || basemap === 'loading' ? props.overlays : [...grid(props.point), ...props.overlays];

  useEffect(() => {
    if (!container.current) return;
    let map: maplibre.Map;
    if (!window.WebGL2RenderingContext || !navigator.onLine) {
      setBasemap('canvas');
      return;
    }
    try {
      map = new maplibre.Map({ container: container.current, style: basemapStyles[defaultBasemap], center: coordinate(latest.current.point),
        zoom: initialZoom(), minZoom: 2, maxZoom: 19, renderWorldCopies: true,
        attributionControl: { compact: true }, maxPitch: 0, dragRotate: false, pixelRatio: window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio });
    } catch { setBasemap('canvas'); return; }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.doubleClickZoom.disable();
    map.addControl(new maplibre.ScaleControl({ maxWidth: 105, unit: 'metric' }), 'bottom-left');
    let fallback = false;
    let tileFailures = 0;
    let timer: number;
    const fallbackToGrid = () => {
      if (fallback) return;
      fallback = true;
      window.clearTimeout(timer);
      map.setStyle(offlineStyle, { diff: false });
      setBasemap('grid');
    };
    const waitForStyle = () => window.setTimeout(() => { if (!map.isStyleLoaded()) fallbackToGrid(); }, 8500);
    timer = waitForStyle();
    changeStyle.current = (style) => {
      window.clearTimeout(timer);
      setMapStyle(style);
      setBasemap('loading');
      fallback = false;
      tileFailures = 0;
      timer = waitForStyle();
      map.setStyle(basemapStyles[style], { diff: false, transformStyle: style === 'hybrid' ? (_, labels) => {
        const imagery = nationalMap('USGSImageryOnly', 19);
        return { ...labels, sources: { ...labels.sources, ...imagery.sources }, layers: [...imagery.layers,
          ...labels.layers.flatMap((layer) => layer.type === 'symbol' && ['place', 'transportation_name', 'waterway', 'water_name'].includes(layer['source-layer'] ?? '') ? [{
            ...layer, paint: { ...layer.paint, 'text-color': '#f8fafc', 'text-halo-color': '#15232d', 'text-halo-width': 1.25 },
          }] : [])] };
      } : undefined });
    };
    const onOffline = () => fallbackToGrid();
    window.addEventListener('offline', onOffline);
    map.on('error', () => {
      if (!map.isStyleLoaded() || ++tileFailures >= 4) fallbackToGrid();
    });
    map.on('style.load', () => {
      window.clearTimeout(timer);
      const active = latest.current;
      addOverlays(map, fallback ? [...grid(active.point), ...active.overlays] : active.overlays);
      if (!fallback) setBasemap('online');
    });
    const pointers = new Set<number>();
    let gesture: { x: number; y: number; moved: boolean } | undefined;
    const down = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      if (pointers.size === 1) gesture = { x: event.clientX, y: event.clientY, moved: false };
      else if (gesture) gesture.moved = true;
    };
    const move = (event: PointerEvent) => {
      if (gesture && pointers.has(event.pointerId) && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true;
    };
    const up = (event: PointerEvent) => { move(event); pointers.delete(event.pointerId); if (event.type === 'pointercancel' && gesture) gesture.moved = true; };
    const surface = map.getCanvasContainer();
    surface.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    map.on('click', (event) => {
      const current = latest.current;
      if (current.drawing && gesture?.moved) return;
      const layers = candidateLayers.filter((id) => map.getLayer(id));
      if (current.mode === 'Explore' && current.onCandidate && layers.length) {
        const { x, y } = event.point;
        const match = map.queryRenderedFeatures([[x - 10, y - 10], [x + 10, y + 10]], { layers })[0]?.properties.candidateId;
        if (typeof match === 'string') { current.onCandidate(match); return; }
      }
      const { lat, lng } = event.lngLat.wrap();
      current.onPick([lng, lat]);
    });
    map.on('zoom', () => setZoom(map.getZoom()));
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('offline', onOffline);
      resize.disconnect();
      surface.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      map.remove();
      mapRef.current = null;
      changeStyle.current = () => {};
    };
  }, []);

  useEffect(() => {
    (mapRef.current?.getSource('ember') as GeoJSONSource | undefined)?.setData(collection(data));
  }, [data]);
  useEffect(() => {
    const map = mapRef.current;
    const context = props.viewport ?? 'scenario';
    const previous = view.current;
    view.current = { context, camera: props.camera };
    if (!map) return;
    if (previous.context === 'scenario' && context === 'history') {
      map.stop();
      savedView.current = { center: map.getCenter(), zoom: map.getZoom(), camera: previous.camera };
    }
    if (previous.context === 'history' && context === 'scenario' && savedView.current) {
      if (savedView.current.camera === props.camera) map.jumpTo(savedView.current);
      else map.jumpTo({ center: coordinate(props.point), zoom: initialZoom() });
      savedView.current = undefined;
    } else if (previous.context !== context || previous.camera !== props.camera) {
      map.jumpTo({ center: coordinate(props.point), zoom: initialZoom() });
    }
  }, [props.camera, props.viewport]);
  useEffect(() => {
    if (!props.focusCandidate?.length || !mapRef.current) return;
    const bounds = props.focusCandidate.reduce((value, coordinate) => value.extend(coordinate), new maplibre.LngLatBounds());
    mapRef.current.fitBounds(bounds, { padding: 65, maxZoom: 16, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  }, [props.focusCandidate]);
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = props.mode === 'Explore' ? 'grab' : 'crosshair';
  }, [props.mode]);

  const changeZoom = (delta: number) => {
    if (mapRef.current) mapRef.current.zoomTo(mapRef.current.getZoom() + delta);
    else setZoom((value) => Math.min(19, Math.max(2, value + delta)));
  };
  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' || (event.target as HTMLElement).closest('button,input,select')) return;
    event.preventDefault();
    const center = mapRef.current?.getCenter().wrap();
    props.onPick(center ? [center.lng, center.lat] : coordinate(props.point));
  }
  return <section className="map-panel" aria-label="Scenario map" onKeyDown={handleKeys}
    onFocus={(event) => { if ((event.target as HTMLElement).matches('canvas')) setKeyboard(true); }}
    onBlur={() => setKeyboard(false)}>
    <div className="map-mount" ref={container} />
    {basemap === 'canvas' && <CanvasMap props={props} data={data} zoom={zoom} setZoom={setZoom} />}
    <div className="map-heading"><span className="map-marker"><LocateFixed size={17} /></span><div><strong>{props.title}</strong>
      <small><span>{basemap === 'online' ? basemapLabels[mapStyle].toUpperCase() : basemap === 'loading' ? 'LOADING BASEMAP' : 'OFFLINE GEOGRAPHIC GRID'}</span>
        {props.historicalStatus ? <span className="map-history-status"> · {props.historicalStatus}</span> :
        <span className="map-provenance"> · {props.historical ? 'HISTORICAL REPLAY' : props.fictional ? 'FICTIONAL' : 'HYPOTHETICAL'}</span>}</small></div></div>
    <div className="map-controls">
      {props.mobile && <button aria-label={props.expanded ? 'Return to workspace' : 'Expand map'} aria-pressed={props.expanded} onClick={props.onExpand}>
        {props.expanded ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
      </button>}
      <button aria-label="Zoom in" onClick={() => changeZoom(1)}><Plus size={19} /></button>
      <button aria-label="Zoom out" onClick={() => changeZoom(-1)}><Minus size={19} /></button>
      <button aria-label="Center on ignition" onClick={props.centerOnIgnition}><Crosshair size={18} /></button>
      <button aria-label="Map layers" aria-expanded={showLayers} onClick={() => { setShowLegend(false); setShowLayers(!showLayers); }}><Layers3 size={18} /></button>
    </div>
    {props.legend && <button className="map-legend-button" aria-label="Map legend" aria-expanded={showLegend}
      onClick={() => { setShowLayers(false); setShowLegend(!showLegend); }}><List size={16}/></button>}
    {props.legend && showLegend && <div className="map-legend-popover">{props.legend}</div>}
    {showLayers && <div className="layer-menu"><strong>Map layers</strong>
      <label className="basemap-choice">Basemap
        <select value={mapStyle} disabled={basemap === 'canvas'} onChange={(event) => changeStyle.current(event.target.value as BasemapStyle)}>
          <option value="streets">Streets &amp; land cover</option><option value="dark">Dark</option>
          <option value="terrain">Detailed Terrain (USGS)</option><option value="hybrid">Aerial / Satellite Hybrid (USGS)</option>
        </select>
      </label>
      {basemap === 'grid' && <button onClick={() => changeStyle.current(mapStyle)}>Retry basemap</button>}
      {props.layers.map((layer) => <label key={layer.key}><input type="checkbox" checked={layer.enabled} onChange={layer.toggle} />{layer.label}</label>)}</div>}
    {props.mobile ? (props.mode === 'Explore' && <button className="mobile-map-mode" onClick={props.onMapTools} aria-label="Map interaction tools"><Crosshair size={16}/>Explore</button>)
      : <div className={'map-mode' + (props.mode === 'Explore' ? ' explore' : '')}><Crosshair size={14} />{props.mode === 'Explore'
        ? keyboard ? 'Explore · Arrow keys pan' : 'Explore' : props.mode + ' · Click the map or press Enter at center'}</div>}
    {props.drawingToolbar}
    {props.wind && <div className="map-wind" role="group" aria-label="Wind at current simulation time">
      {props.wind.mph > 0 && <span aria-hidden="true" style={{ transform: 'rotate(' + props.wind.toward + 'deg)' }}>↑</span>}
      <div><b>{props.wind.mph > 0 ? props.wind.mph + ' mph' : 'Calm'}</b>
        {props.wind.mph > 0 && <small>FROM {props.wind.from}° · TOWARD {props.wind.toward}°</small>}
      </div>
    </div>}
  </section>;
}

function CanvasMap({ props, data, zoom, setZoom }: { props: Props; data: Overlay[]; zoom: number; setZoom: (value: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [center, setCenter] = useState(props.point);
  const drag = useRef<{ x: number; y: number; point: Point; moved: boolean } | null>(null);
  const scale = 512 * 2 ** zoom / 360;
  const clampedLat = (lat: number) => Math.max(-84, Math.min(84, lat));
  const worldY = (lat: number) => Math.asinh(Math.tan(clampedLat(lat) * Math.PI / 180)) * 180 / Math.PI;
  const latitude = (y: number) => clampedLat(Math.atan(Math.sinh(y * Math.PI / 180)) * 180 / Math.PI);
  const longitude = (x: number) => ((x + 180) % 360 + 360) % 360 - 180;
  const canvasView = useRef({ context: props.viewport ?? 'scenario', camera: props.camera });
  const saved = useRef<{ center: Point; zoom: number; camera: number } | undefined>(undefined);
  useEffect(() => {
    const context = props.viewport ?? 'scenario';
    const previous = canvasView.current;
    canvasView.current = { context, camera: props.camera };
    if (previous.context === 'scenario' && context === 'history') saved.current = { center, zoom, camera: previous.camera };
    if (previous.context === 'history' && context === 'scenario' && saved.current) {
      const prior = saved.current;
      setCenter(prior.camera === props.camera ? prior.center : props.point);
      setZoom(prior.camera === props.camera ? prior.zoom : initialZoom());
      saved.current = undefined;
    } else if (previous.context !== context || previous.camera !== props.camera) { setCenter(props.point); setZoom(initialZoom()); }
  }, [props.camera, props.viewport]);
  useEffect(() => {
    const coordinates = props.focusCandidate;
    const rect = canvas.current?.getBoundingClientRect();
    if (!coordinates?.length || !rect) return;
    const xs = coordinates.map(([lng]) => lng);
    const ys = coordinates.map(([, lat]) => worldY(lat));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const dx = Math.max(...xs) - x;
    const dy = Math.max(...ys) - y;
    const fit = Math.min((rect.width - 100) / Math.max(dx, .0001), (rect.height - 100) / Math.max(dy, .0001));
    setCenter({ lng: x + dx / 2, lat: latitude(y + dy / 2) });
    setZoom(Math.max(2, Math.min(16, Math.log2(fit * 360 / 512))));
  }, [props.focusCandidate]);
  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext('2d');
    if (!node || !ctx) return;
    const draw = () => {
      const { width, height } = node.getBoundingClientRect();
      const dpr = window.devicePixelRatio;
      node.width = width * dpr;
      node.height = height * dpr;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#172332';
      ctx.fillRect(0, 0, width, height);
      const xy = ([lng, lat]: number[]): [number, number] =>
        [width / 2 + longitude(lng - center.lng) * scale, height / 2 - (worldY(lat) - worldY(center.lat)) * scale];
      for (const kind of styles) for (const f of data) {
        if (f.properties.kind !== kind) continue;
        const g = f.geometry;
        ctx.strokeStyle = f.properties.color;
        ctx.fillStyle = f.properties.color;
        ctx.lineWidth = candidateLayers.includes(kind) ? (f.properties.selected ? 5 : 3)
          : kind === 'line-overlap' ? 4 : kind === 'grid' || kind === 'proximity' ? 1 : 2;
        const dash = lineDash(kind);
        ctx.setLineDash(dash[1] ? dash.map((value) => value * 2) : []);
        ctx.beginPath();
        if (g.type === 'Point') {
          const [x, y] = xy(g.coordinates);
          ctx.arc(x, y, kind === 'ignition' ? 7 : 5, 0, 2 * Math.PI);
          ctx.fill();
          continue;
        }
        const trace = (points: number[][]) => points.forEach((p, i) => i ? ctx.lineTo(...xy(p)) : ctx.moveTo(...xy(p)));
        if (g.type === 'LineString') trace(g.coordinates);
        else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
          const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
          for (const polygon of polygons) for (const ring of polygon) { trace(ring); ctx.closePath(); }
          ctx.globalAlpha = fillOpacity[kind] ?? 0;
          ctx.fill('evenodd');
          ctx.globalAlpha = 1;
        } else continue;
        ctx.stroke();
      }
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(node);
    return () => resize.disconnect();
  }, [center, data, scale]);
  return <canvas className="offline-canvas" ref={canvas} tabIndex={0} aria-label="Offline geographic grid" onKeyDown={(event) => {
    if (event.key === 'Enter') { event.stopPropagation(); props.onPick(coordinate(center)); }
    const dx = Number(event.key === 'ArrowRight') - Number(event.key === 'ArrowLeft');
    const dy = Number(event.key === 'ArrowUp') - Number(event.key === 'ArrowDown');
    if (dx || dy) { event.preventDefault(); setCenter({ lng: longitude(center.lng + dx * 45 / scale), lat: latitude(worldY(center.lat) + dy * 45 / scale) }); }
  }} onPointerDown={(event) => {
    if (!event.isPrimary) { if (drag.current) drag.current.moved = true; return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, point: center, moved: false };
  }} onPointerMove={(event) => {
    const anchor = drag.current;
    if (!anchor || !event.isPrimary) return;
    const dx = event.clientX - anchor.x;
    const dy = event.clientY - anchor.y;
    if (Math.hypot(dx, dy) < 4) return;
    anchor.moved = true;
    setCenter({ lng: longitude(anchor.point.lng - dx / scale), lat: latitude(worldY(anchor.point.lat) + dy / scale) });
  }} onPointerUp={(event) => {
    if (!event.isPrimary) return;
    const anchor = drag.current;
    drag.current = null;
    if (!anchor || anchor.moved || Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) >= 4) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (props.mode === 'Explore' && props.onCandidate) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const xy = ([lng, lat]: number[]) => [rect.width / 2 + longitude(lng - center.lng) * scale,
        rect.height / 2 - (worldY(lat) - worldY(center.lat)) * scale];
      let closest = 11;
      let match: string | undefined;
      for (const feature of data) {
        const id = feature.properties.candidateId;
        if (feature.geometry.type !== 'LineString' || !id) continue;
        const points = feature.geometry.coordinates.map(xy);
        for (let i = 1; i < points.length; i++) {
          const [ax, ay] = points[i - 1];
          const dx = points[i][0] - ax;
          const dy = points[i][1] - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
          const pixels = Math.hypot(x - ax - t * dx, y - ay - t * dy);
          if (pixels < closest) { closest = pixels; match = id; }
        }
      }
      if (match) { props.onCandidate(match); return; }
    }
    props.onPick([longitude(anchor.point.lng + (event.clientX - rect.left - rect.width / 2) / scale),
      latitude(worldY(anchor.point.lat) - (event.clientY - rect.top - rect.height / 2) / scale)]);
  }} onPointerCancel={() => { drag.current = null; }} />;
}
