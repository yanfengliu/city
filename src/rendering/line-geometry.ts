import { POLE_SPACING } from './constants';

/** Poles (sparse supports) and the wire spans strung between adjacent line cells. */
export interface LineGeometry {
  poleCells: number[];
  /** Cells `c` whose east neighbor `c+1` is also a line cell (a horizontal span). */
  eastSpans: number[];
  /** Cells `c` whose south neighbor `c+gridWidth` is also a line cell (a vertical span). */
  southSpans: number[];
}

/**
 * A power line is a set of conducting cells; the renderer turns it into a
 * transmission line — a wire strung along every orthogonal adjacency, with a
 * pole only where one is structurally needed: ends, corners, junctions, and
 * one every POLE_SPACING cells along a straight run (so a long line spans far
 * without a pole on every cell). Pure function of the cell set, so it is
 * deterministic regardless of message order.
 */
export function deriveLineGeometry(lineCells: number[], gridWidth: number): LineGeometry {
  const set = new Set(lineCells);
  const poleCells: number[] = [];
  const eastSpans: number[] = [];
  const southSpans: number[] = [];
  for (const c of lineCells) {
    const x = c % gridWidth;
    const east = x < gridWidth - 1 && set.has(c + 1);
    const west = x > 0 && set.has(c - 1);
    const north = c - gridWidth >= 0 && set.has(c - gridWidth);
    const south = set.has(c + gridWidth);
    if (east) eastSpans.push(c);
    if (south) southSpans.push(c);
    const degree = (east ? 1 : 0) + (west ? 1 : 0) + (north ? 1 : 0) + (south ? 1 : 0);
    let pole: boolean;
    if (degree === 2 && east && west) pole = x % POLE_SPACING === 0; // straight horizontal
    else if (degree === 2 && north && south) pole = Math.floor(c / gridWidth) % POLE_SPACING === 0; // straight vertical
    else pole = true; // end, corner, junction, or lone cell
    if (pole) poleCells.push(c);
  }
  return { poleCells, eastSpans, southSpans };
}
