import type { SaveMeta } from '../protocol/messages';

const SAVE_KEY = 'city.save.v1';
const PENDING_LOAD_KEY = 'city.pendingLoad';

export interface SaveFile {
  meta: SaveMeta;
  snapshot: unknown;
}

/**
 * Save/load answer their callers with a boolean or null because the HUD only
 * needs "did it work". The reason a save failed or a stored city was rejected
 * still has to be recoverable though (AGENTS.md: error messages are a product
 * surface), so each distinct failure names itself on the console — the one
 * diagnostic channel this module has without reaching into the UI.
 */
function saveProblem(what: string): void {
  console.warn(`[save] ${what}`);
}

export function writeSave(file: SaveFile): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(file));
    return true;
  } catch (error) {
    saveProblem(
      `localStorage rejected the city (usually a full quota or private browsing): ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export function readSave(): SaveFile | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null; // no save yet — not a problem worth reporting
    const parsed = JSON.parse(raw) as SaveFile;
    if (!parsed || typeof parsed !== 'object') {
      saveProblem(`the save at "${SAVE_KEY}" is ${JSON.stringify(parsed)}, not an object`);
      return null;
    }
    if (parsed.meta?.saveVersion !== 1) {
      saveProblem(
        `the save at "${SAVE_KEY}" is version ${String(parsed.meta?.saveVersion)}; ` +
          'this build only loads version 1',
      );
      return null;
    }
    // A tampered/corrupt seed would rebuild the sim over NaN-seeded terrain.
    if (!Number.isFinite(parsed.meta.seed)) {
      saveProblem(`the save at "${SAVE_KEY}" has seed ${String(parsed.meta.seed)}, not a number`);
      return null;
    }
    return parsed;
  } catch (error) {
    saveProblem(
      `the save at "${SAVE_KEY}" (${raw?.length ?? 0} chars) could not be read: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
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
