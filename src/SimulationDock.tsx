import { EXTENDED_PLAYBACK_THRESHOLD_MINUTES, elapsedClock } from '../shared/simulationTime';
import { Pause, Play, SkipBack, Sparkles, Wind } from 'lucide-react';
import type { ReactNode } from 'react';
import { STEP, type Snapshot } from '../shared/engine';
import type { Wind as WindReading } from '../shared/contracts';

type Marker = { kind: 'shift' | 'completion' | 'contact'; minute: number; label: string };
type HistoricalClock = {
  value: number; label: string; wind?: WindReading; humidity?: number; actions: ReactNode;
  fastPlayback?: boolean;
  step: number;
};
type Props = {
  mobile: boolean; duration: number; waiting?: boolean; clockFormat?: boolean; playing: boolean; speed: number; markers: Marker[];
  metrics: [string, string]; toggle: () => void; restart: () => void; setSpeed: (speed: number) => void;
  scrub: (minute: number) => void; showMetrics: () => void; analyze: () => void;
} & ({ snapshot: Snapshot; historical?: undefined } | { snapshot?: undefined; historical: HistoricalClock });

export function SimulationDock({ mobile, snapshot, historical, duration, waiting, clockFormat, playing, speed, markers, metrics, toggle, restart, setSpeed, scrub, showMetrics, analyze }: Props) {
  const shift = markers.find((marker) => marker.kind === 'shift');
  const wind = historical ? historical.wind : snapshot!.activeWind;
  const value = historical?.value ?? snapshot!.minute;
  const extended = historical?.fastPlayback ?? duration > EXTENDED_PLAYBACK_THRESHOLD_MINUTES;
  const clock = (minute: number) => Math.floor(minute / 60) + 'h ' + String(minute % 60).padStart(2, '0') + 'm';
  const timeLabel = extended ? clock(value) + ' / ' + clock(duration) : value + ' / ' + duration + ' min';
  const label = historical?.label ?? (clockFormat && extended ? elapsedClock(value) + ' / ' + elapsedClock(duration) : timeLabel);
  const reading = wind ? wind.speedMph + ' mph FROM ' + wind.fromDeg + '°' : 'Wind unavailable';
  return <section className={mobile ? 'timeline simulation-dock' : 'timeline'} aria-label="Simulation timeline">
    <div className="timeline-left">
      <button className="play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} disabled={duration === 0 || waiting}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <button aria-label="Restart timeline" onClick={restart}><SkipBack size={17}/></button>
      <label className="speed"><span className="sr-only">Playback speed</span><select value={speed} onChange={(event) => setSpeed(+event.target.value)}>
        <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
        {extended && <><option value={12}>12×</option><option value={24}>24×</option><option value={60}>60×</option></>}
      </select></label>
    </div>
    <div className="timeline-track">
      <div className="timeline-meta"><strong>Timeline</strong><span>{label}</span>
        {shift && <span className="shift-event"><Wind size={14}/>Shift at {shift.minute} min</span>}
      </div>
      <div className="track"><input aria-label={historical ? 'Historical timeline' : 'Simulation minute'} aria-valuetext={historical || extended ? label : undefined}
        type="range" min={0} max={Math.max(duration, 1)} step={historical?.step ?? STEP}
        disabled={duration === 0} value={value} onChange={(event) => scrub(+event.target.value)}/>
        {markers.map((marker) => <span key={marker.label} className={marker.kind + '-marker'} style={{ left: marker.minute / duration * 100 + '%' }} title={marker.label}/>)}
      </div>
    </div>
    <div className="timeline-end" aria-label={historical ? 'Historical playback weather' : undefined}><Wind size={16}/><span>{reading}</span>
      {historical && <span>{historical.humidity === undefined ? 'Humidity unavailable' : historical.humidity + '% RH'}</span>}
    </div>
    {mobile && <div className="dock-status">
      <button className="dock-metrics" aria-label={historical ? 'Replay controls' : 'Open scenario metrics'} onClick={showMetrics}><span>{metrics[0]}</span><span>{metrics[1]}</span></button>
      <button className="dock-agent" aria-label="Analyze with Nemotron" title="Ask Nemotron" onClick={analyze}><Sparkles size={19}/></button>
    </div>}
    {historical && <div className="replay-dock-actions">{historical.actions}</div>}
  </section>;
}

