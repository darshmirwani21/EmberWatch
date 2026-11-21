import { useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import type { Coordinate, Point } from '../shared/contracts';
import { geometryAt, type Snapshot } from '../shared/engine';
import { Disclosure, Section, useLocal } from './ui';

export type Place = { id: string; name: string; point: Point };
export type PlanKey = 'A' | 'B';
export type Plans = Record<PlanKey, Coordinate[]>;
export const emptyPlans: Plans = { A: [], B: [] };
const readiness = ['Meeting place', 'Transport', 'Household and pet needs', 'Local alert enrollment', 'Essential supplies and medications', 'Household communication'];

export function Guidance() {
  return <div className="official-links">
    <a href="https://www.fire.ca.gov/readyforwildfire/" target="_blank" rel="noreferrer">CAL FIRE preparedness</a>
    <a href="https://www.fire.ca.gov/incidents/" target="_blank" rel="noreferrer">CAL FIRE incidents</a>
    <a href="https://quickmap.dot.ca.gov/" target="_blank" rel="noreferrer">Caltrans QuickMap</a>
    <a href="https://www.weather.gov/alerts" target="_blank" rel="noreferrer">National Weather Service alerts</a>
    <a href="https://ready.lacounty.gov/emergency-notifications/" target="_blank" rel="noreferrer">Los Angeles County emergency alerts</a>
    <a href="https://socoemergency.org/emergency/" target="_blank" rel="noreferrer">Sonoma County emergency information</a>
  </div>;
}

export function Preparedness({ point, places, plans, selectedPlan, snapshot, pendingPlan, demoPlans, onUseSaved, onPlace, onSave, onDelete, onDraw, onRemove, onClear, onAddCoordinate }: {
  point?: Point; places: Place[]; plans: Plans; selectedPlan?: PlanKey; snapshot: Snapshot; pendingPlan: boolean;
  demoPlans: boolean; onUseSaved: () => void;
  onPlace: (point?: Point) => void; onSave: (name: string) => void; onDelete: (id: string) => void;
  onDraw: (plan: PlanKey) => void; onRemove: (plan: PlanKey) => void; onClear: (plan: PlanKey) => void; onAddCoordinate: (plan: PlanKey, p: Coordinate) => void;
}) {
  const [name, setName] = useState('');
  const [checked, setChecked] = useLocal<string[]>('emberwatch.checklist', []);
  const [contacts, setContacts] = useLocal<string>('emberwatch.contacts', '');
  const [rehearsal, setRehearsal] = useState(true);
  const [coordinateText, setCoordinateText] = useState('');
  const [coordinateError, setCoordinateError] = useState('');
  const [routePlan, setRoutePlan] = useState<PlanKey>('A');
  function exportContacts() {
    const url = URL.createObjectURL(new Blob([contacts], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'emberwatch-emergency-contacts.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <Section title="HomeWatch">
      <p className="muted">Saved places and contacts are stored on this device.</p>
      <button className="full" onClick={() => onPlace()}><MapPin size={16}/>Select location on map</button>
      {point && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(''); } }}>
        <input aria-label="Place nickname" value={name} placeholder="Place nickname" maxLength={40} required onChange={(event) => setName(event.target.value)}/>
        <button aria-label="Save selected place" type="submit"><Plus size={17}/></button></form>}
      {places.map((place) => <div key={place.id} className="saved-row">
        <button onClick={() => onPlace(place.point)}><MapPin size={15}/>{place.name}</button>
        <button aria-label={'Delete ' + place.name} onClick={() => onDelete(place.id)}><Trash2 size={15}/></button></div>)}
    </Section>
    <Section title="Plan A / Plan B">
      <p className="muted">Schematic sketches. Place your start, any waypoints, then your meeting point.</p>
      {demoPlans && <><p className="notice">Fictional demo sketches. Edits apply to this session.</p><button onClick={onUseSaved}>Use my saved sketches</button></>}
      <label className="check"><input type="checkbox" checked={rehearsal} onChange={(event) => setRehearsal(event.target.checked)}/>Rehearse at timeline position</label>
      {(['A','B'] as const).map((id) => {
        const count = plans[id].length;
        return <div className="plan-card" key={id}><strong><i style={{ backgroundColor: id === 'A' ? '#62dbc7' : '#a78bfa' }}/>Plan {id}</strong>
          <p>{count ? count + ' map point' + (count === 1 ? '' : 's') : 'No points yet'}</p>
          {rehearsal && count >= 2 && <p className="rehearsal">{geometryAt(snapshot, plans[id]).overlap ? 'Practice path intersects the modeled footprint.' : 'No geometric overlap at this snapshot.'}</p>}
          <div className="button-row"><button onClick={() => onDraw(id)}>{pendingPlan && selectedPlan === id ? 'Finish sketch' : 'Add map points'}</button>
            <button onClick={() => onRemove(id)} disabled={!count}>Undo</button><button onClick={() => onClear(id)} disabled={!count}>Clear</button></div></div>;
      })}
      <Disclosure title="Enter coordinates manually"><div className="form-stack">
        <label className="field">Sketch<select value={routePlan} onChange={(event) => setRoutePlan(event.target.value as PlanKey)}><option value="A">Plan A</option><option value="B">Plan B</option></select></label>
        <form onSubmit={(event) => {
          event.preventDefault();
          const pieces = coordinateText.trim().split(/\s*,\s*/);
          const [lat, lng] = pieces.map(Number);
          const coordinate = pieces.length === 2 && pieces.every(Boolean) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 84 && Math.abs(lng) <= 180;
          if (!coordinate) { setCoordinateError('Enter latitude, longitude in decimal degrees.'); return; }
          onManual([lng, lat], routePlan);
        }}>
          <label className="field">Latitude, longitude<input value={coordinateText} onChange={(event) => setCoordinateText(event.target.value)} placeholder="34.142, -118.542"/></label>
          <button className="full" type="submit">Add waypoint or meeting point</button>
          {coordinateError && <p role="alert">{coordinateError}</p>}
        </form></div></Disclosure>
    </Section>
    <Section title="Household readiness">
      {readiness.map((item) => <label key={item} className="check"><input type="checkbox" checked={checked.includes(item)}
        onChange={() => setChecked(checked.includes(item) ? checked.filter((s) => s !== item) : [...checked, item])}/>{item}</label>)}
      <Disclosure title="Emergency contacts"><label className="field">Device-local contacts<textarea value={contacts} maxLength={3000} rows={3}
        placeholder="Names and numbers" onChange={(event) => setContacts(event.target.value)}/></label>
        <div className="button-row"><button disabled={!contacts} onClick={exportContacts}>Export text</button><button disabled={!contacts} onClick={() => setContacts('')}>Clear contacts</button></div></Disclosure>
      <Disclosure title="Official resources"><Guidance/></Disclosure>
    </Section>
  </>;

  function onManual(p: Coordinate, plan: PlanKey) {
    // The App owns all route edits, including keyboard-entered coordinates.
    onAddCoordinate(plan, p);
    setCoordinateText('');
    setCoordinateError('');
  }
}
