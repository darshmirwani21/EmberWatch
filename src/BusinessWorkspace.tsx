import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Crosshair, DraftingCompass, Leaf, Wind } from 'lucide-react';
import { center } from '@turf/turf';
import type { Coordinate, Point, SourceResult } from '../shared/contracts';
import { AIR_QUALITY_URL, businessAssetSchema, MAX_BUSINESS_ASSETS, MAX_DECLARED_VALUE, PROPERTY_BOUNDARY, SMOKE_LIMITATION, SMOKE_RESEARCH_URL,
  VALUE_LIMITATION, type AirQualityForecast, type BusinessAsset } from '../shared/businessContracts';
import { businessPolygon, measureBusinessExposure, verifiedBusinessAsset } from '../shared/businessExposure';
import { contactLabel } from '../shared/engine';
import { vineyardAssets, vineyardDemo } from '../shared/vineyardDemo';
import { api, decimal, Section, timeLabel, useLocal } from './ui';

const categoryOptions = [PROPERTY_BOUNDARY, 'Vineyard block', 'Building', 'Equipment', 'Other'];
export const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

export function useBusinessRegistry() {
  const [stored, setStored] = useLocal<BusinessAsset[]>('emberwatch.business.assets.v1', []);
  const [demoAssets, setDemoAssets] = useState<BusinessAsset[]>();
  const [selectedId, select] = useState<string>();
  const [draft, setDraft] = useState<Coordinate[]>([]);
  const [pendingGeometry, setPendingGeometry] = useState<BusinessAsset['geometry']>();
  const [error, setError] = useState<string>();
  const saved = useMemo(() => {
    if (!Array.isArray(stored)) return [];
    const unique = new Map<string, BusinessAsset>();
    for (const entry of stored.slice(0, MAX_BUSINESS_ASSETS)) {
      const parsed = businessAssetSchema.safeParse(entry);
      if (!parsed.success) continue;
      try { unique.set(parsed.data.id, verifiedBusinessAsset(parsed.data)); } catch { /* An invalid saved outline is omitted. */ }
    }
    return [...unique.values()];
  }, [stored]);
  const assets = demoAssets ?? saved;
  const selected = assets.find((asset) => asset.id === selectedId);
  const store = (next: BusinessAsset[]) => { if (demoAssets) setDemoAssets(next); else setStored(next); };
  function resetDraft() { setDraft([]); setPendingGeometry(undefined); setError(undefined); }
  function start() { select(undefined); resetDraft(); }
  function finish() {
    try { setPendingGeometry(businessPolygon(draft)); setDraft([]); setError(undefined); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The polygon could not be saved.'); return false; }
  }
  function save(input: { name: string; category: string; declaredValue?: number }) {
    const geometry = pendingGeometry ?? selected?.geometry;
    if (!geometry || (!selected && assets.length >= MAX_BUSINESS_ASSETS)) return;
    try {
      const id = selected?.id ?? (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
      const asset = verifiedBusinessAsset({ id, ...input, geometry, fictional: Boolean(demoAssets) });
      store(selected ? assets.map((entry) => entry.id === id ? asset : entry) : [...assets, asset]);
      select(id);
      resetDraft();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The asset could not be registered.'); }
  }
  return {
    assets, selected, select: (id: string) => { resetDraft(); select(id); }, draft, setDraft,
    pendingGeometry, error, setError, resetDraft, start, finish, save,
    fictional: Boolean(demoAssets),
    openDemo: () => { setDemoAssets(vineyardAssets); select(vineyardAssets[1].id); resetDraft(); },
    openSaved: () => { setDemoAssets(undefined); select(undefined); resetDraft(); },
    remove: () => { if (selected) { store(assets.filter((asset) => asset.id !== selected.id)); select(undefined); resetDraft(); } },
  };
}
export type BusinessRegistry = ReturnType<typeof useBusinessRegistry>;

function AssetDetails({ asset, fictional, save }: {
  asset?: BusinessAsset; fictional: boolean; save: BusinessRegistry['save'];
}) {
  const [name, setName] = useState(asset?.name ?? '');
  const [category, setCategory] = useState(asset?.category ?? 'Vineyard block');
  const [value, setValue] = useState(asset?.declaredValue?.toString() ?? '');
  return <form className="business-asset-form" onSubmit={(event) => {
    event.preventDefault();
    save({ name, category, declaredValue: category.trim() === PROPERTY_BOUNDARY || value.trim() === '' ? undefined : Number(value) });
  }}>
    <label className="field">Asset name<input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)}/></label>
    <label className="field">Asset category<input required maxLength={50} list="business-asset-types" value={category} onChange={(event) => setCategory(event.target.value)}/></label>
    <datalist id="business-asset-types">{categoryOptions.map((option) => <option key={option} value={option}/>)}</datalist>
    {category.trim() !== PROPERTY_BOUNDARY && <label className="field">{fictional ? 'Fictional declared value (USD)' : 'Declared value (USD, optional)'}
      <input type="number" min={0} max={MAX_DECLARED_VALUE} step=".01" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)}/></label>}
    <button className="primary" type="submit">{asset ? 'Save asset details' : 'Register asset'}</button>
  </form>;
}

export function BusinessAssetsPanel({ registry, draw, drawing, finish, cancel, undo, focus, launchDemo, mobile }: {
  registry: BusinessRegistry; draw: () => void; drawing: boolean; finish: () => void; cancel: () => void;
  undo: () => void; focus: () => void; launchDemo: () => void; mobile: boolean;
}) {
  const r = registry;
  return <>
    <Section title="Asset registry" action={<DraftingCompass size={17}/>}>
      <div className="business-actions">
        <button onClick={draw} disabled={drawing || r.assets.length >= MAX_BUSINESS_ASSETS}>Draw asset polygon</button>
        {r.fictional ? <button onClick={r.openSaved} disabled={drawing}>My assets</button> : <button onClick={launchDemo} disabled={drawing}>Load fictional vineyard demo</button>}
      </div>
      {r.fictional && <p className="muted">Fictional Napa–Sonoma drill. All sample outlines, declared values and fire inputs are fictional.</p>}
      {!r.fictional && <p className="muted">The registry stays in this browser. Draw a property boundary for reference and separate polygons for the assets you want to measure.</p>}
      {r.assets.length >= MAX_BUSINESS_ASSETS && <p className="muted">The registry holds up to {MAX_BUSINESS_ASSETS} polygons.</p>}
      {drawing && !mobile && <><p className="notice">{r.draft.length} corners · select points on the map.</p>
        <div className="button-row"><button onClick={undo} disabled={!r.draft.length}>Undo corner</button><button onClick={cancel}>Cancel drawing</button>
          <button onClick={finish} disabled={r.draft.length < 3}>Finish polygon</button></div></>}
      {r.error && <p className="notice error" role="alert">{r.error}</p>}
      {r.assets.length > 0 && <div className="business-asset-list">{r.assets.map((asset) => <button key={asset.id} aria-pressed={asset.id === r.selected?.id}
        onClick={() => r.select(asset.id)}><span><strong>{asset.name}</strong><small>{asset.category} · {decimal(asset.areaAcres, 2)} ac
        {asset.declaredValue !== undefined ? ' · ' + (asset.fictional ? 'Fictional ' : '') + dollars(asset.declaredValue) : ''}</small></span></button>)}</div>}
    </Section>
    {!drawing && (r.pendingGeometry || r.selected) && <Section title={r.selected ? 'Asset details' : 'Register polygon'}>
      <AssetDetails key={r.selected?.id ?? 'new'} asset={r.selected} fictional={r.fictional} save={r.save}/>
      {r.selected && <div className="button-row"><button onClick={focus}><Crosshair size={16}/>Zoom to asset</button><button onClick={r.remove}>Delete asset</button></div>}
    </Section>}
  </>;
}

export function BusinessExposurePanel({ exposure, minute, fictional, compact }: {
  exposure: ReturnType<typeof measureBusinessExposure>; minute: number; fictional: boolean; compact?: boolean;
}) {
  return <Section title="Modeled asset exposure" action={<Building2 size={17}/>}>
    {fictional && <span className="business-provenance">Fictional assets and scenario inputs</span>}
    {!exposure.rows.length ? <p className="muted">Register an asset polygon to measure its overlap with the simulated footprint.</p> : <>
      <div className="business-stat-row">
        <div><small>Unique acreage in footprint</small><strong>{decimal(exposure.affectedAcres, 2)} ac</strong></div>
        <div><small>First modeled contact</small><strong>{contactLabel(exposure.firstContact)}</strong></div>
      </div>
      <div className="business-value"><small>{fictional ? 'Fictional declared value in footprint' : 'Declared value in footprint'} · minute {minute}</small>
        <strong>{exposure.declaredValueInFootprint === null ? 'Unavailable' : dollars(exposure.declaredValueInFootprint)}</strong>
        {exposure.unvaluedAffected > 0 && <small>{exposure.unvaluedAffected} affected {exposure.unvaluedAffected === 1 ? 'asset has' : 'assets have'} no declared value.</small>}
      </div>
      <p className="muted">{VALUE_LIMITATION} Property boundaries are reference outlines. Acreage counts overlapping ground once. Declare each asset’s value once.</p>
      {!compact && <ul className="business-exposure-list">{exposure.rows.map((row) => <li key={row.asset.id}>
        <strong>{row.asset.name}{row.asset.fictional ? ' · fictional' : ''}</strong>
        <small>{decimal(row.affectedAcres, 2)} / {decimal(row.asset.areaAcres, 2)} ac · {contactLabel(row.firstContact)}</small>
        <small>{row.declaredValueInFootprint === null ? 'Declared value unavailable' : dollars(row.declaredValueInFootprint) + ' declared in footprint'}</small>
      </li>)}</ul>}
    </>}
  </Section>;
}

export function VineyardSmokePanel({ ignition, asset }: { ignition: Point; asset?: BusinessAsset }) {
  const [forecast, setForecast] = useState<SourceResult<AirQualityForecast>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(undefined); setForecast(undefined);
    const position = asset && center({ type: 'Feature', geometry: asset.geometry, properties: {} }).geometry.coordinates;
    const point = position ? { lng: Number(position[0].toFixed(2)), lat: Number(position[1].toFixed(2)) } : ignition;
    try {
      const reply = await api<SourceResult<AirQualityForecast>>('air-quality', point, controller.signal);
      if (!controller.signal.aborted) setForecast(reply);
    } catch {
      if (!controller.signal.aborted) setError('The air-quality service is unreachable.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <Section title="Vineyard smoke monitoring" action={<Wind size={17}/>}>
    <p className="muted">{asset ? 'Fetch sends an approximate location for the selected asset to the forecast provider.' : 'Fetch uses the scenario ignition area for the regional forecast.'}</p>
    <button onClick={() => void load()} disabled={busy}>{busy ? 'Loading regional forecast…' : 'Fetch regional forecast'}</button>
    {error && <p className="notice error" role="status">{error}</p>}
    {forecast?.status === 'unavailable' && <p className="notice error" role="status">{forecast.reason}</p>}
    {forecast?.status === 'ok' && <>
      <div className="business-air-meta"><strong>Regional PM2.5 forecast</strong>
        <small>Regional model grid. This forecast is independent of the hypothetical fire.</small>
        <small>Retrieved {timeLabel(forecast.retrievedAt)} · forecast grid {forecast.data.grid.lat.toFixed(2)}°, {forecast.data.grid.lng.toFixed(2)}°</small>
        <small>{forecast.data.wind ? <>Regional weather wind {forecast.data.wind.speedMph} mph FROM {forecast.data.wind.fromDeg}° · valid {timeLabel(forecast.data.wind.validAt)}</> : 'Regional weather wind unavailable'}</small>
      </div>
      <ol className="business-forecast">{forecast.data.hours.map((sample) => <li key={sample.validAt}><time dateTime={sample.validAt}>{timeLabel(sample.validAt)}</time>
        <strong>{sample.pm25 === null ? 'Unavailable' : decimal(sample.pm25, 1) + ' µg/m³'}</strong></li>)}</ol>
    </>}
    <p className="muted">{SMOKE_LIMITATION}</p>
    <a href={AIR_QUALITY_URL} target="_blank" rel="noreferrer">Open-Meteo / CAMS Global forecast</a>
    <a href={SMOKE_RESEARCH_URL} target="_blank" rel="noreferrer">UC ANR vineyard smoke research</a>
  </Section>;
}

export function BusinessDemoButton({ launch }: { launch: () => void }) {
  return <Section title="Vineyard demonstration" action={<Leaf size={17}/>}>
    <p className="muted">Explore a fictional Napa–Sonoma estate and a simulated wind shift.</p>
    <button onClick={launch}>{vineyardDemo.title}</button>
  </Section>;
}
