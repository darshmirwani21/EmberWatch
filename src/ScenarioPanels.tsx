import { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp, CloudSun, Crosshair, ExternalLink, Flag, Plus, Trash2 } from 'lucide-react';
import { DAY_HORIZON_MINUTES, RESPONDER_HORIZON_MINUTES } from '../shared/simulationTime';
import type { ControlLine, Coordinate, Mode, OfficialAlert, Point, Scenario, SourceResult, Weather, Wind } from '../shared/contracts';
import { contactLabel, downwind, lineReference, type analyzeLine, type Snapshot } from '../shared/engine';
import { api, decimal, Disclosure, Section, Slider, timeLabel } from './ui';
import { Guidance } from './Preparedness';

export function ScenarioControls({ scenario, snapshot, change, setIgnition, setPoint, setOrigin, mode, dataLabel, importedWeather, archivedWind, selected, mobile, leadWithShift, onImport }: {
  scenario: Scenario; snapshot: Snapshot; change: (scenario: Scenario) => void; setIgnition: () => void; setPoint: () => void; setOrigin: () => void;
  mode: Mode; dataLabel: string; importedWeather?: Weather; archivedWind?: string; selected?: Point; onImport: (weather: Weather) => void;
  mobile: boolean; leadWithShift: boolean;
}) {
  const shift = scenario.shift;
  const activeShift = shift && snapshot.minute >= shift.minute ? shift : undefined;
  const editInitialWind = (wind: Wind) => change({ ...scenario, wind });
  const editShiftWind = (wind: Wind) => { if (shift) change({ ...scenario, shift: { ...shift, wind } }); };
  const shiftControls = <Section title="Wind Shift Lab" action={<label className="switch"><input aria-label="Enable wind shift" type="checkbox" checked={Boolean(shift)}
    onChange={() => change({ ...scenario, shift: shift ? undefined : { minute: Math.min(35, scenario.durationMinutes), wind: { fromDeg: 180, speedMph: 32 } } })}/><span/></label>}>
    {shift ? <>
      <Slider label="Shift at minute" value={shift.minute} max={scenario.durationMinutes} step={5} suffix=" min" change={(minute) => change({ ...scenario, shift: { ...shift, minute } })}/>
      {activeShift ? <WindControls prefix="Initial " wind={scenario.wind} change={editInitialWind}/>
        : <WindControls prefix="Shifted " wind={shift.wind} change={editShiftWind}/>}
    </> : <p className="muted">Enable a change in wind to test how future growth responds.</p>}
  </Section>;
  return <>
    {leadWithShift && shiftControls}
    <Section title={mode === 'responder' ? 'Operations Lab' : 'Scenario Simulator'}>
      <div className="button-row">
        <button onClick={setIgnition}><Crosshair size={16}/>Place ignition</button>
        {mode !== 'business' && <button onClick={mode === 'civilian' ? setPoint : setOrigin}>{mode === 'civilian' ? 'Select location' : 'Example origin'}</button>}
      </div>
      <div className="source-input"><span className="tag">{dataLabel}</span></div>
      {importedWeather && <small className="muted">Initial wind and humidity from Open-Meteo · valid {timeLabel(importedWeather.validAt)}</small>}
      {archivedWind && <small className="muted">{archivedWind} · illustrative wind</small>}
      {shift && <p className="muted">Editing {activeShift ? 'shifted' : 'initial'} wind at minute {snapshot.minute}.</p>}
      {mobile && <div className="mobile-compass" aria-label="Wind direction compass">
        <div aria-hidden="true"><small>N</small><span style={{ transform: 'rotate(' + downwind(snapshot.activeWind) + 'deg)' }}>↑</span></div>
        <span>Wind direction<strong>{snapshot.activeWind.fromDeg}° FROM · {Number(downwind(snapshot.activeWind).toFixed(1))}° TOWARD</strong></span>
      </div>}
      <WindControls wind={snapshot.activeWind} change={activeShift ? editShiftWind : editInitialWind} />
      <Slider label="Relative humidity" value={scenario.humidity} max={100} suffix="%" change={(humidity) => change({ ...scenario, humidity })}/>
      <Slider label="Fuel dryness" value={Math.round(scenario.dryness * 100)} max={100} suffix="%" change={(n) => change({ ...scenario, dryness: n / 100 })}/>
      <Slider label="Horizon" value={scenario.durationMinutes} min={5} max={mode === 'responder' ? RESPONDER_HORIZON_MINUTES : DAY_HORIZON_MINUTES} step={5} suffix=" min"
        change={(durationMinutes) => change({ ...scenario, durationMinutes, shift: shift ? { ...shift, minute: Math.min(shift.minute, durationMinutes) } : undefined })}/>
    </Section>
    {!leadWithShift && shiftControls}
    <Section title="Current weather" action={<CloudSun size={16}/>}><WeatherPanel key={[scenario.ignition.lat, scenario.ignition.lng, selected?.lat, selected?.lng].join(',')}
      point={scenario.ignition} selected={selected} onImport={onImport}/></Section>
  </>;
}
function WindControls({ wind, change, prefix = '' }: { wind: Wind; change: (wind: Wind) => void; prefix?: string }) {
  return <>
    <Slider label={prefix ? prefix + 'wind speed' : 'Wind speed'} value={wind.speedMph} max={100} suffix=" mph" change={(speedMph) => change({ ...wind, speedMph })}/>
    <Slider label={prefix ? prefix + 'wind from' : 'Wind from'} value={wind.fromDeg} max={359} suffix="°" change={(fromDeg) => change({ ...wind, fromDeg })}/>
  </>;
}

type Load<T> = { pending: boolean; data?: SourceResult<T>; error?: string };
function useSource<T>(source: 'weather' | 'alerts') {
  const [state, setState] = useState<Load<T>>({ pending: false });
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const clear = () => { active.current?.abort(); setState({ pending: false }); };
  async function load(point: Point) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ pending: true });
    try {
      const data = await api<SourceResult<T>>(source, point, controller.signal);
      if (!controller.signal.aborted) setState({ pending: false, data });
    } catch {
      if (!controller.signal.aborted) setState({ pending: false, error: 'The local source API is unreachable.' });
    }
  }
  return { ...state, load, clear };
}
function WeatherPanel({ point, selected, onImport }: { point: Point; selected?: Point; onImport: (weather: Weather) => void }) {
  const [useSelected, setUseSelected] = useState(false);
  const weather = useSource<Weather>('weather');
  const { data } = weather;
  const current = data?.status === 'ok' ? data.data : null;
  const usable = current && current.speedMph <= 100;
  return <>
    {selected && <label className="check"><input type="checkbox" checked={useSelected} onChange={(event) => {
      setUseSelected(event.target.checked); weather.clear();
    }}/>Share selected point for weather lookup</label>}
    <button className="full" onClick={() => void weather.load(useSelected && selected ? selected : point)} disabled={weather.pending}>
      {weather.pending ? 'Retrieving weather…' : useSelected && selected ? 'Fetch at selected point' : 'Fetch at ignition'}</button>
    {(weather.error || data?.status === 'unavailable') && <p className="notice error">{weather.error || (data?.status === 'unavailable' && data.reason)}</p>}
    {data && current && <div className="source-card">
      <span className="tag cyan">CURRENT WEATHER</span>
      <strong>{current.temperatureF} °F · {current.humidity}% humidity</strong>
      <span>{current.speedMph} mph from {current.fromDeg}°</span>
      <small>Valid {timeLabel(current.validAt)} · Retrieved {timeLabel(data.retrievedAt)}</small>
      <a href={data.url} target="_blank" rel="noreferrer">{data.source}</a>
      <button disabled={!usable} onClick={() => onImport(current)}>Use wind and humidity</button>
      {!usable && <small>Wind speed exceeds the scenario input range.</small>}
    </div>}
  </>;
}

export function AlertsPanel({ ignition, selected, onDrill }: { ignition: Point; selected?: Point; onDrill: () => void }) {
  const [useSelected, setUseSelected] = useState(false);
  const alerts = useSource<OfficialAlert[]>('alerts');
  const data = alerts.data;
  return <>
    <Section title="HomeWatch Alerts">
      <p className="muted">Active National Weather Service alerts are checked when you click below. For local evacuation orders, use the official resources.</p>
      {selected && <label className="check"><input type="checkbox" checked={useSelected} onChange={(event) => {
        setUseSelected(event.target.checked); alerts.clear();
      }}/>Share the selected point with this request to NWS</label>}
      <button className="full" onClick={() => void alerts.load(useSelected && selected ? selected : ignition)} disabled={alerts.pending}>
        {alerts.pending ? 'Retrieving alerts…' : useSelected && selected ? 'Check at selected point' : 'Check at ignition'}</button>
      <div aria-live="polite">
        {(alerts.error || data?.status === 'unavailable') && <p className="notice error">{alerts.error || (data?.status === 'unavailable' && data.reason)}</p>}
        {data?.status === 'ok' && <>
          <p className="muted">NWS · Retrieved {timeLabel(data.retrievedAt)}</p>
          {!data.data.length && <p className="notice">No matching active NWS records at retrieval.</p>}
          {data.data.map((alert) => <article className="source-card" key={alert.url}>
            <span className="tag cyan">OFFICIAL ALERT</span><a href={alert.url} target="_blank" rel="noreferrer">{alert.title} <ExternalLink size={12}/></a>
            <p>{alert.scope} · {alert.severity}</p><small>Issued {timeLabel(alert.issuedAt)}</small><small>Effective {timeLabel(alert.effectiveAt)}</small>
            <small>Expires {timeLabel(alert.expiresAt)}</small></article>)}
        </>}
      </div>
    </Section>
    <Section title="Practice notification">
      <button className="full" onClick={onDrill}><Flag size={16}/>Preview drill notification</button>
      <p className="muted">The preview appears inside EmberWatch. Open your local alert service below to enroll in real notifications.</p>
    </Section>
    <Section title="Official resources"><Guidance/></Section>
  </>;
}

export function LinePanel({ lines, selectedId, draft, isDrawing, isEditing, stats, mobile, begin, finish, cancel, undo, select, edit, remove, update, editVertex }: {
  lines: ControlLine[]; selectedId?: string; draft: Coordinate[]; isDrawing: boolean; isEditing: boolean; stats: ReturnType<typeof analyzeLine> | null;
  mobile: boolean;
  begin: () => void; finish: () => void; cancel: () => void; undo: () => void; select: (id: string) => void; edit: () => void;
  remove: () => void; update: (line: ControlLine) => void; editVertex: (index: number) => void;
}) {
  const selected = lines.find((line) => line.id === selectedId);
  return <>
    <Section title="Proposed Control Lines">
      <p className="muted">Completed lines act as idealized barriers in the intervention. A blank completion time makes a line active when the branch starts.</p>
      {isDrawing || isEditing ? <>
        <p className="notice">{isDrawing ? draft.length + ' vertices · click the map to add' : 'Select a vertex, then click the map to move it.'}</p>
        <div className="button-row">
          <button onClick={finish} disabled={draft.length < 2}><Check size={15}/>Finish</button>
          <button onClick={undo} disabled={!draft.length}>{isDrawing ? 'Undo' : 'Reset edits'}</button><button onClick={cancel}>Cancel</button>
        </div>
        {isEditing && <div className="button-row vertex-list">{draft.map((_, index) =>
          <button key={index} aria-label={'Move vertex ' + (index + 1)} onClick={() => editVertex(index)}>{mobile ? 'Vertex ' : ''}{index + 1}</button>)}</div>}
      </> : <button className="full" onClick={begin} disabled={lines.length >= 8}><Plus size={16}/>Draw proposed line</button>}
      <div className="line-list">{lines.map((line) => <button className={line.id === selectedId ? 'selected' : ''} key={line.id} onClick={() => select(line.id)}>
        <i style={{ background: line.color }}/>{line.name}<ChevronUp size={13}/></button>)}</div>
      {!lines.length && <p className="muted">Draw a line with at least two distinct vertices.</p>}
    </Section>
    {selected && stats && !isDrawing && !isEditing && <Section title="Line details" action={<span className="tag">PROPOSED</span>}>
      <label className="field">Line name<input value={selected.name} maxLength={60} onBlur={() => { if (!selected.name.trim()) update({ ...selected, name: 'Proposed line' }); }}
        onChange={(event) => update({ ...selected, name: event.target.value })}/></label>
      <label className="field">Annotation type<select value={selected.type} onChange={(event) => update({ ...selected, type: event.target.value as ControlLine['type'] })}>
        {(['Handline example', 'Road example', 'Fuel break example', 'Other example'] as const).map((option) => <option key={option}>{option}</option>)}</select></label>
      <div className="paired">
        <label className="field">Assumed completion<input type="number" placeholder="Minute" min={0} max={RESPONDER_HORIZON_MINUTES} step={1} value={selected.completionMinute ?? ''}
          onChange={(event) => update({ ...selected, completionMinute: event.target.value === '' ? undefined : Math.round(Math.max(0, Math.min(RESPONDER_HORIZON_MINUTES, +event.target.value))) })}/></label>
        <label className="field">Color<input type="color" value={selected.color} onChange={(event) => update({ ...selected, color: event.target.value })}/></label>
      </div>
      <div className="button-row"><button onClick={edit}>Edit vertices</button><button onClick={remove}><Trash2 size={15}/>Delete line</button></div>
      <div className="line-stats"><span>{decimal(stats.km, 3)} km · {stats.segments} segments</span>
        <small>Investigation ID {lineReference(selected.id, lines.indexOf(selected))}</small>
        {stats.overlappedWithoutIntersection && <small>Earlier footprint overlap was sampled without a perimeter intersection.</small>}
        {!!stats.intersections.length && <Disclosure title="First intersection coordinates"><ul>{stats.intersections.map(([lng, lat]) =>
          <li key={lng + ',' + lat}>{lat.toFixed(5)}, {lng.toFixed(5)}</li>)}</ul></Disclosure>}</div>
    </Section>}
  </>;
}

export function ResponseGap({ contact }: { contact: ReturnType<typeof import('../shared/engine').pointContact> }) {
  const [values, setValues] = useState([0, 0, 0, 0]);
  const total = values.reduce((sum, n) => sum + n, 0);
  return <Disclosure title="Hypothetical response gap"><p className="muted">Enter assumed delays and travel for this exercise. Arrival has no bearing on modeled containment or personal safety.</p>
    <div className="paired">{['Call delay', 'Dispatch delay', 'Turnout delay', 'Travel estimate'].map((label, i) =>
      <label className="field" key={label}>{label} (min)<input type="number" min={0} max={DAY_HORIZON_MINUTES} value={values[i]}
        onChange={(event) => setValues(values.map((value, j) => j === i ? Math.max(0, Math.min(DAY_HORIZON_MINUTES, +event.target.value)) : value))}/></label>)}</div>
    <p>Assumed arrival at minute <strong>{total}</strong>.</p>
    <p>Modeled point contact · {contactLabel(contact)}</p>
    {contact && <p>{total < contact.from ? 'Assumed arrival precedes the sampled contact interval.' :
      total > contact.to ? 'Assumed arrival follows the sampled contact interval.' : 'Assumed arrival falls within the sampled contact interval.'}</p>}
  </Disclosure>;
}

