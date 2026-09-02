import { readFileSync, readdirSync } from 'fs';
import { describe, expect, it } from 'vitest';

const scripts = readdirSync('scripts').filter((name) => name.endsWith('.mjs'));

function read(name: string): string {
  return readFileSync(`scripts/${name}`, 'utf8').replaceAll('\r\n', '\n');
}

/** The argument text of `call(` at `from`, balanced across nested parens. */
function argumentsAt(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(from, i);
    }
  }
  return source.slice(from);
}

describe('browser driver contracts', () => {
  /**
   * A browser tab does not necessarily boot at a usable size. An automation or
   * preview tab can come up one pixel wide, and at `window.innerWidth === 1`
   * every screen-to-world ray lands in the same column: a drag across the map
   * places a single cell, and the screenshot that would have shown you why is
   * itself one pixel wide. Nothing errors — the run simply produces a nonsense
   * result that looks like a product defect.
   *
   * So a driver names its viewport rather than inheriting one.
   */
  it('gives every browser page an explicit viewport, never the tab default', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const name of scripts) {
      const source = read(name);
      // A page opened from a context inherits that context's viewport, so a
      // bare `context.newPage()` is fine exactly when the context named one.
      const contextSized = [...source.matchAll(/newContext\(/g)].some((match) =>
        argumentsAt(source, match.index + 'newContext'.length).includes('viewport'),
      );
      for (const call of ['newPage(', 'newContext(']) {
        let at = source.indexOf(call);
        while (at >= 0) {
          checked++;
          const args = argumentsAt(source, at + call.length - 1);
          const sized = args.includes('viewport') || (call === 'newPage(' && contextSized);
          if (!sized) offenders.push(`scripts/${name}: ${call}${args})`);
          at = source.indexOf(call, at + 1);
        }
      }
    }
    expect(checked, 'no browser pages found to check — this gate would pass vacuously')
      .toBeGreaterThan(0);
    expect(
      offenders,
      'a page with no explicit viewport can boot one pixel wide, which collapses every ' +
        'pick to one column and makes the driver report its own bug as a product failure',
    ).toEqual([]);
  });

  /**
   * The value you set is not evidence of the value that applied. Between
   * `camera.position.set(...)` and the shutter sit a control loop and its
   * clamps: MapControls refuses to go closer than its `minDistance` or lower
   * than its `maxPolarAngle`, and CityScene re-pins `controls.target.y` to the
   * terrain every frame, shifting the camera by the same delta to preserve the
   * angle. A log that records the requested position therefore agrees with
   * itself while the frame was taken from somewhere else entirely — which is
   * how a sweep logged a camera 0.36 above the ground and photographed the
   * underside of the map.
   *
   * Read the state back at capture time and record it beside the artifact, and
   * confirm a clamp did not quietly eat the request.
   */
  it('records the camera the frame was actually taken from, after the settle', () => {
    const sweep = read('visual-sweep.mjs');

    // The clamps are ergonomics for play, not physics — an inspection frame
    // must lift them or every "close-up" is silently a minDistance view.
    expect(sweep).toContain('scene.controls.minDistance =');
    expect(sweep).toContain('scene.controls.maxPolarAngle =');

    // The readback must sit after the aim AND after the settle wait, so it
    // reports where the control loop left the camera rather than where the
    // script asked it to go.
    const aim = sweep.indexOf('scene.camera.position.set(');
    const readback = sweep.indexOf('cameraY:');
    expect(aim, 'the sweep must aim the camera').toBeGreaterThan(-1);
    expect(
      readback,
      'the sweep must read the camera position back and record it with the frame',
    ).toBeGreaterThan(aim);
    expect(
      sweep.slice(aim, readback),
      'no settle between aiming the camera and reading it back, so the recorded position is ' +
        'the one that was requested rather than the one the frame was taken from',
    ).toContain('waitForTimeout');
    // The clearance claim needs the ground under the camera, not just its height.
    expect(sweep).toContain('groundUnderCamera');
  });
});
