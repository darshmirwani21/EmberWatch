import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Bell, BriefcaseBusiness, ClipboardList, Crosshair, Ellipsis, Flame, History, Info, Radio, Route, Shield, Sparkles, Wind, X } from 'lucide-react';
import type { Mode } from '../shared/contracts';

const mobileQuery = '(max-width: 780px)';
export function useMobileWorkspace() {
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(mobileQuery);
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

export function MobileHeader({ alerts, presets, recenter }: { alerts: () => void; presets: () => void; recenter: () => void }) {
  return <header className="mobile-header">
    <div className="brand"><span className="brand-icon"><Flame size={18}/></span><strong>Ember<span>Watch</span></strong></div>
    <button aria-label="Recenter map" onClick={recenter}><Crosshair size={19}/></button>
    <button aria-label="Notifications" onClick={alerts}><Bell size={20}/></button>
    <button aria-label="Scenario presets" onClick={presets}><Ellipsis size={19}/></button>
  </header>;
}

export function MobileNavigation({ mode, select }: { mode: Mode; select: (mode: Mode) => void }) {
  return <nav className="mobile-nav" aria-label="Primary navigation">
    <button aria-current={mode === 'civilian' ? 'page' : undefined} onClick={() => select('civilian')}><Shield size={22}/>Civilian</button>
    <button aria-current={mode === 'business' ? 'page' : undefined} onClick={() => select('business')}><BriefcaseBusiness size={22}/>Business</button>
    <button aria-current={mode === 'responder' ? 'page' : undefined} onClick={() => select('responder')}><Radio size={22}/>Responders</button>
  </nav>;
}

export function MobileTools({ mode, scenario, preparedness, alerts, insights, lines, replay, replayActive, intelligence, assets, exposure, smoke }: {
  mode: Mode; scenario: () => void; preparedness: () => void; alerts: () => void; insights: () => void;
  lines: () => void; replay: () => void; replayActive: boolean; intelligence: () => void;
  assets: () => void; exposure: () => void; smoke: () => void;
}) {
  return <section className="mobile-tools" aria-label={mode === 'civilian' ? 'Civilian tools' : mode === 'business' ? 'Business tools' : 'Responder tools'}>
    {mode === 'civilian'
      ? <><button onClick={scenario}><Flame size={18}/>Scenario</button><button onClick={preparedness}><ClipboardList size={18}/>Preparedness</button>
        <button onClick={alerts}><Bell size={18}/>Alerts</button><button onClick={insights}><Info size={18}/>Insights</button></>
      : mode === 'business' ? <><button onClick={scenario}><Flame size={18}/>Scenario</button>
        <button onClick={assets}><BriefcaseBusiness size={18}/>Assets</button><button onClick={exposure}><Crosshair size={18}/>Exposure</button>
        <button onClick={smoke}><Wind size={18}/>Smoke</button></>
      : <><button onClick={lines}><Route size={18}/>Fireline tools</button><button onClick={intelligence} className="fireline-shortcut"><Sparkles size={18}/>Fireline Intelligence</button>
        <button onClick={scenario}><Wind size={18}/>Wind shift</button>
        <button onClick={replay} aria-pressed={replayActive}><History size={18}/>Historical Replay</button><button onClick={insights}><Info size={18}/>Analysis</button></>}
  </section>;
}

export function trackDialogViewport(dialog: HTMLDialogElement) {
  const viewport = window.visualViewport;
  const update = () => {
    if (!viewport) return;
    dialog.style.setProperty('--visible-height', Math.round(viewport.height) + 'px');
    dialog.style.setProperty('--keyboard-inset', Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) + 'px');
  };
  update();
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  return () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
  };
}

export function MobileSheet({ title, open, close, children, compact }: { title: string; open: boolean; close: () => void; children: ReactNode; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<number | null>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { element.close(); return; }
    element.showModal();
    element.querySelector<HTMLElement>('.sheet-close')?.focus({ preventScroll: true });
    const restoreViewport = trackDialogViewport(element);
    return () => { restoreViewport(); element.close(); };
  }, [open]);
  return <dialog ref={dialog} className={'mobile-sheet' + (compact ? ' compact-sheet' : '')} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <header className="sheet-header">
      <div className="sheet-grab" aria-hidden="true" onPointerDown={(event) => {
        start.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerUp={(event) => {
        if (start.current !== null && event.clientY - start.current > 48) close();
        start.current = null;
      }} onPointerCancel={() => { start.current = null; }}><span/></div>
      <h2 id={titleId}>{title}</h2>
      <button className="sheet-close" aria-label="Close sheet" onClick={close}><X size={20}/></button>
    </header>
    <div className="sheet-content" key={title}>{children}</div>
  </dialog>;
}

export function MobileMapActions({ label, detail, cancel, undo, finish, canFinish, vertices, finishLabel = 'Finish' }: {
  label: string; detail?: string; cancel: () => void; undo?: () => void;
  finish?: () => void; canFinish?: boolean; vertices?: () => void; finishLabel?: string;
}) {
  return <div className="map-action-dock">
    <div><strong>{label}</strong>{detail && <small>{detail}</small>}</div>
    <div className="button-row">
      {vertices && <button onClick={vertices}>Vertices</button>}
      {undo && <button onClick={undo}>Undo</button>}
      <button onClick={cancel}>Cancel</button>
      {finish && <button className="primary" disabled={!canFinish} onClick={finish}>{finishLabel}</button>}
    </div>
  </div>;
}
