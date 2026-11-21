import { useEffect, useState } from 'react';
import { History, Wind } from 'lucide-react';
import type { Wind as WindInput } from '../shared/contracts';
import { sectorLabels, type WindArchive } from '../shared/windHistory';
import { decimal, Disclosure, Section, timeLabel } from './ui';

const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function WindHistory({ apply }: { apply: (wind: WindInput, label: string) => void }) {
  const [archive, setArchive] = useState<WindArchive>();
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');
  const [period, setPeriod] = useState('all');
  useEffect(() => {
    const controller = new AbortController();
    void fetch(import.meta.env.BASE_URL + 'data/sierra-era5.json', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Missing archive');
      const archive = await response.json() as WindArchive;
      if (archive.model !== 'ERA5' || archive.months?.length !== 12 || !archive.all?.observations) throw new Error('Invalid archive');
      setArchive(archive);
      setStatus('ready');
    }).catch(() => { if (!controller.signal.aborted) setStatus('unavailable'); });
    return () => controller.abort();
  }, []);
  const summary = archive && (period === 'all' ? archive.all :
    period in archive.seasons ? archive.seasons[period as keyof WindArchive['seasons']] : archive.months[Number(period)]);
  const periodLabel = period === 'all' ? 'all months' : months[Number(period)] ?? period;
  const directional = summary?.sectors.reduce((a, b) => a + b, 0) ?? 0;
  const maxSector = Math.max(1, ...(summary?.sectors ?? []));
  return <Section title="Wind History" action={<History size={16}/>}>
    {status === 'loading' && <p className="notice">Loading the cached historical summary…</p>}
    {status === 'unavailable' && <p className="notice">Historical dataset unavailable. Run the archive build before using this view.</p>}
    {archive && summary && <>
      <div><span className="tag cyan">HISTORICAL REANALYSIS</span><h3>{archive.region}</h3><p className="muted">ERA5 · complete calendar years 2006–2025</p></div>
      <label className="field">Historical period<select value={period} onChange={(event) => setPeriod(event.target.value)}>
        <option value="all">All months</option><optgroup label="Seasons"><option value="DJF">Winter · Dec–Feb</option><option value="MAM">Spring · Mar–May</option>
          <option value="JJA">Summer · Jun–Aug</option><option value="SON">Autumn · Sep–Nov</option></optgroup>
        <optgroup label="Months">{months.map((month, i) => <option key={month} value={i}>{month}</option>)}</optgroup></select></label>
      <div className="rose" role="img" aria-label={'Wind rose of FROM sectors: ' + sectorLabels.map((label, i) => label + ' ' + summary.sectors[i] + ' hours').join(', ')}>
        {[25,50,75].map((size) => <i className="rose-circle" key={size} style={{ width: size + '%', height: size + '%' }}/>)}
        {sectorLabels.map((label, i) => <div className="rose-bearing" key={label} style={{ transform: 'rotate(' + i * 45 + 'deg)' }}>
          <span style={{ height: summary.sectors[i] / maxSector * 69 + 'px' }}/><b style={{ transform: 'rotate(' + -i * 45 + 'deg)' }}>{label}</b>
        </div>)}
      </div>
      <div className="wind-sectors">{sectorLabels.map((label, i) => <span key={label}>{label}<b>{directional ? decimal(summary.sectors[i] * 100 / directional, 1) : '0.0'}%</b></span>)}</div>
      <div className="line-stats">
        <strong><Wind size={15}/> Speed distribution</strong>
        <span>P10 {summary.p10 ?? '—'} · Median {summary.median ?? '—'} · P90 {summary.p90 ?? '—'} mph</span>
        <span>Mean FROM {summary.meanFrom === null ? 'indeterminate' : summary.meanFrom + '°'} · Resultant {summary.concentration ?? '—'}</span>
        <small>{summary.observations.toLocaleString()} valid hours · {summary.calm.toLocaleString()} calm</small>
      </div>
      <button className="full" disabled={summary.median === null || summary.meanFrom === null} onClick={() => {
        if (summary.median === null || summary.meanFrom === null) return;
        apply({ speedMph: summary.median, fromDeg: summary.meanFrom }, 'ERA5 · Sierra Foothills · ' + periodLabel + ' · 2006–2025');
      }}>Use historical wind in scenario</button>
      <p className="muted">Copies the median speed and circular mean FROM direction as illustrative inputs.</p>
      <Disclosure title="Source and resolution">
        <p>Requested {archive.requested.lat.toFixed(3)}, {archive.requested.lng.toFixed(3)}. Returned grid {archive.sampled.lat.toFixed(3)}, {archive.sampled.lng.toFixed(3)}.</p>
        <p>{archive.missing.toLocaleString()} missing of {archive.expected.toLocaleString()} possible UTC hours. Retrieved {timeLabel(archive.retrievedAt)}.</p>
        <p>ERA5 is modeled reanalysis. A roughly 25 km grid smooths local terrain. The rose shows proportions among non-calm hours, with calm defined as under 1 mph. These are regional historical conditions.</p>
        <a href={archive.source} target="_blank" rel="noreferrer">Open-Meteo archive methodology</a>
      </Disclosure>
    </>}
  </Section>;
}
