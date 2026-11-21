import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="section">{title && <div className="section-head"><h2>{title}</h2>{action}</div>}{children}</section>;
}
export function Slider({ label, value, min = 0, max, step = 1, suffix, change }: {
  label: string; value: number; min?: number; max: number; step?: number; suffix: string; change: (value: number) => void;
}) {
  return <label className="slider"><span>{label}</span><output aria-hidden="true">{value}{suffix}</output>
    <input aria-label={label} aria-valuetext={value + suffix} type="range" min={min} max={max} step={step} value={value}
      onChange={(event) => change(+event.target.value)} /></label>;
}
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return <details className="disclosure"><summary>{title}<ChevronDown size={15}/></summary>{children}</details>;
}
export function useLocal<T,>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T ?? fallback; } catch { return fallback; }
  });
  return [value, (next: T) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session state remains usable. */ }
  }] as const;
}
export const decimal = (n: number, digits = 1) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const timeLabel = (iso: string) => new Date(iso).toLocaleString();
export const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiBase + '/api/' + path, {
    signal, cache: 'no-store',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'API request failed.');
  return data as T;
}
