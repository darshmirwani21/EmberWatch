export const DAY_HORIZON_MINUTES = 24 * 60;
export const EXTENDED_PLAYBACK_THRESHOLD_MINUTES = 4 * 60;
export const playbackStride = (speed: number) => speed >= 60 ? 3 : speed >= 24 ? 2 : 1;
export const elapsedClock = (minute: number) => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
