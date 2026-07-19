import type { CitizenDetail, CitizenPlace } from '../protocol/messages';
import type { InspectData } from '../ui/inspect-panel';

/**
 * Turns one household's sim detail into panel-ready strings. Pure, so the
 * wording is testable without a DOM (Vitest runs in the node environment here).
 *
 * The panel exists to answer "who is this person and how are they doing", so it
 * leads with the happiness score, then what they are doing right now, then the
 * places that anchor their life, and finally WHY the score is what it is —
 * a bare number would teach the player nothing (AGENTS.md: diagnostics are a
 * product surface).
 */

/** Happiness bands, worst to best. Thresholds are the lower bound of each band. */
const MOOD_BANDS: ReadonlyArray<{ atLeast: number; word: string }> = [
  { atLeast: 0.8, word: 'thriving' },
  { atLeast: 0.6, word: 'content' },
  { atLeast: 0.4, word: 'coping' },
  { atLeast: 0.2, word: 'unhappy' },
  { atLeast: 0, word: 'miserable' },
];

/** How many of the strongest contributing factors the panel lists. */
export const MAX_HAPPINESS_REASONS = 3;

export function moodWord(happiness: number): string {
  const value = Math.min(Math.max(happiness, 0), 1);
  for (const band of MOOD_BANDS) {
    if (value >= band.atLeast) return band.word;
  }
  return MOOD_BANDS[MOOD_BANDS.length - 1].word;
}

function placeLabel(place: CitizenPlace | null, fallback: string): string {
  if (!place) return fallback;
  const abandoned = place.abandoned ? ', abandoned' : '';
  return `(${place.x}, ${place.y}) — ${place.zone} level ${place.level}${abandoned}`;
}

/**
 * The factors actually moving the score, strongest first. Ties break on the
 * model's own fixed factor order, so the same household always reads the same.
 */
function topReasons(detail: CitizenDetail): string[] {
  return detail.breakdown.factors
    .map((factor, index) => ({ factor, index }))
    .filter(({ factor }) => factor.delta !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.factor.delta) - Math.abs(a.factor.delta) || a.index - b.index,
    )
    .slice(0, MAX_HAPPINESS_REASONS)
    .map(({ factor }) => {
      const sign = factor.delta > 0 ? '+' : '−';
      const points = Math.round(Math.abs(factor.delta) * 100);
      return `  ${sign}${points} ${factor.label}`;
    });
}

export function citizenInspectData(detail: CitizenDetail): InspectData {
  const percent = Math.round(Math.min(Math.max(detail.happiness, 0), 1) * 100);
  const lines: string[] = [detail.status];

  lines.push(`Lives at ${placeLabel(detail.home, 'nowhere — their home is gone')}`);
  lines.push(
    detail.work
      ? `Works at ${placeLabel(detail.work, '')}`
      : 'Works nowhere — no job yet',
  );
  if (detail.commuteCells !== null) {
    lines.push(`Commute: ${detail.commuteCells} cells each way`);
  }
  if (detail.destination) {
    lines.push(`Heading to ${placeLabel(detail.destination, '')}`);
  }
  if (detail.agent) {
    lines.push(detail.agent.kind === 'vehicle' ? 'Currently driving' : 'Currently walking');
  }

  const reasons = topReasons(detail);
  if (reasons.length > 0) {
    lines.push(reasons.length === 1 ? 'Biggest influence:' : 'Biggest influences:');
    lines.push(...reasons);
  }

  return {
    title: detail.home
      ? `Household of (${detail.home.x}, ${detail.home.y})`
      : 'Household with no home',
    lines,
    // Losing your home is the one condition worth flagging as an alarm.
    abandoned: detail.home?.abandoned ?? true,
    meter: {
      label: 'Happiness',
      value: detail.happiness,
      caption: `${percent}% — ${moodWord(detail.happiness)}`,
    },
  };
}
