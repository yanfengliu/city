import type { SaveMeta } from '../protocol/messages';

const SAVE_KEY = 'city.save.v1';
const PENDING_LOAD_KEY = 'city.pendingLoad';

export interface SaveFile {
  meta: SaveMeta;
  snapshot: unknown;
}

export function writeSave(file: SaveFile): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false; // quota or privacy mode
  }
}

export function readSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    if (!parsed || typeof parsed !== 'object' || parsed.meta?.saveVersion !== 1) return null;
    // A tampered/corrupt seed would rebuild the sim over NaN-seeded terrain.
    if (!Number.isFinite(parsed.meta.seed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  return readSave() !== null;
}

/** Load works via page reload: flag the intent, reload, apply on fresh boot. */
export function requestLoadOnNextBoot(): void {
  localStorage.setItem(PENDING_LOAD_KEY, '1');
}

export function consumePendingLoad(): boolean {
  const pending = localStorage.getItem(PENDING_LOAD_KEY) === '1';
  if (pending) localStorage.removeItem(PENDING_LOAD_KEY);
  return pending;
}
