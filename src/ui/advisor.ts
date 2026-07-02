/** A prioritized advisory computed by the app layer. */
export interface Advisory {
  /** Stable problem-type key — drives first-time tutorials. */
  id: string;
  text: string;
  /** World cell to fly to when the row is clicked. */
  target?: { x: number; y: number };
}

/** First-time, step-by-step guidance per problem type. */
const TUTORIALS: Record<string, string[]> = {
  firstRoad: [
    'Pick the Road tool in the toolbar.',
    'Click on grass and drag to draw a street, then release.',
    'Everything in the city grows along roads.',
  ],
  firstZones: [
    'Pick Zone R and drag a rectangle beside your road (within 2 cells).',
    'Do the same with Zone C (shops) and Zone I (factories) — a bit away from homes.',
    'Buildings appear on their own when the matching demand bar (top left) is green.',
  ],
  noPower: [
    'Pick Coal ⚡ ($800, strong but pollutes) or Wind ⚡ ($300, clean but small) and click an empty spot.',
    'Pick Line and drag from the plant toward your buildings — lines may cross roads.',
    'Anything within the glowing reach shown while placing connects. Verify with the Power ⚡ overlay: red = no power.',
  ],
  unpowered: [
    'Open the Power ⚡ overlay — red buildings have no power.',
    'Drag a Line from any yellow (line/plant) or green (powered) area toward the red ones.',
    'Power chains between neighboring buildings, so closing gaps fixes whole streets.',
  ],
  noWater: [
    'Pick Pump 💧 and click a land cell RIGHT NEXT to water.',
    'Pick Pipe and drag from the pump to your streets — pipes run under roads and buildings.',
    'Verify with the Water 💧 overlay: red = no water.',
  ],
  unwatered: [
    'Open the Water 💧 overlay — red buildings have no water.',
    'Drag Pipes from the blue network toward the red buildings (within the glowing reach).',
  ],
  abandoned: [
    'Click a grey building with Select to see what it lacks (power / water).',
    'Fix the missing utility or heavy pollution nearby.',
    'Healthy buildings recover by themselves shortly — no need to bulldoze.',
  ],
  disconnected: [
    'Some citizens took jobs they cannot drive to.',
    'Connect your districts: every road should reach the same network.',
    'The ⚠ counter stops climbing once routes exist.',
  ],
  broke: [
    'While broke, only power and water purchases are allowed.',
    'Income arrives every budget cycle from taxed buildings — grow population and jobs.',
    'Avoid new spending until the treasury is positive again.',
  ],
  demandR: ['Drag Zone R rectangles near roads — homes only grow within 2 cells of a road.'],
  demandC: ['Drag Zone C near roads. Shops employ citizens and like being near homes.'],
  demandI: ['Drag Zone I near roads, away from homes — factories pollute their surroundings.'],
  unemployed: ['Zone Commercial or Industrial so citizens have somewhere to work.'],
};

const SEEN_KEY = 'city.tutorialSeen.v1';

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Bottom-right advisor panel: persistent, scrollable, per-row dismissable.
 * Rows with a target fly the camera to the problem when clicked; the first
 * time a problem type appears, its row expands with step-by-step guidance
 * until the player confirms with "Got it".
 */
export class AdvisorPanel {
  private readonly root: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly listEl: HTMLDivElement;
  private readonly collapseButton: HTMLButtonElement;
  private advisories: Advisory[] = [];
  private readonly dismissed = new Set<string>();
  private readonly tutorialSeen = loadSeen();
  private collapsed = false;

  constructor(
    container: HTMLElement,
    private readonly onFocus: (target: { x: number; y: number }) => void,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;bottom:14px;right:14px;width:360px;max-width:46vw;color:#fff;' +
      'background:rgba(10,20,30,.82);border:1px solid rgba(143,224,255,.25);border-radius:8px;' +
      'font-size:12.5px;z-index:10;user-select:none;display:none;overflow:hidden';

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(83,193,232,.12);' +
      'font-weight:bold;cursor:pointer';
    const title = document.createElement('span');
    title.textContent = '💡 Advisor';
    this.countEl = document.createElement('span');
    this.countEl.style.cssText = 'color:#8fb3c9;font-weight:normal;font-size:11px;flex:1';
    this.collapseButton = document.createElement('button');
    this.collapseButton.style.cssText =
      'background:none;border:none;color:#8fe0ff;cursor:pointer;font-size:13px;padding:0 2px';
    header.appendChild(title);
    header.appendChild(this.countEl);
    header.appendChild(this.collapseButton);
    header.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });

    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'max-height:240px;overflow-y:auto;padding:4px 0';

    this.root.appendChild(header);
    this.root.appendChild(this.listEl);
    container.appendChild(this.root);
  }

  /** Replaces the advisory list (already prioritized). */
  update(advisories: Advisory[]): void {
    const changed =
      advisories.length !== this.advisories.length ||
      advisories.some((a, i) => a.text !== this.advisories[i]?.text);
    this.advisories = advisories;
    for (const text of this.dismissed) {
      if (!advisories.some((a) => a.text === text)) this.dismissed.delete(text);
    }
    if (changed) this.render();
  }

  /** Currently visible advisory texts (exposed for the automation text state). */
  current(): readonly string[] {
    return this.advisories.filter((a) => !this.dismissed.has(a.text)).map((a) => a.text);
  }

  private markTutorialSeen(id: string): void {
    this.tutorialSeen.add(id);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...this.tutorialSeen]));
    } catch {
      /* private mode — tutorial just shows again next session */
    }
  }

  private render(): void {
    const visible = this.advisories.filter((a) => !this.dismissed.has(a.text));
    if (visible.length === 0) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = 'block';
    this.countEl.textContent = `${visible.length} item${visible.length === 1 ? '' : 's'}`;
    this.collapseButton.textContent = this.collapsed ? '▸' : '▾';
    this.listEl.style.display = this.collapsed ? 'none' : 'block';
    if (this.collapsed) return;

    this.listEl.textContent = '';
    for (const advisory of visible) this.listEl.appendChild(this.buildRow(advisory));
  }

  private buildRow(advisory: Advisory): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.06)';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:flex-start;gap:6px;line-height:1.35';
    const message = document.createElement('span');
    message.textContent = advisory.target ? `${advisory.text} 📍` : advisory.text;
    message.style.flex = '1';
    if (advisory.target) {
      message.style.cursor = 'pointer';
      message.title = 'Click to jump to the problem';
      const target = advisory.target;
      message.addEventListener('click', () => this.onFocus(target));
    }
    const dismiss = document.createElement('button');
    dismiss.textContent = '×';
    dismiss.title = 'Dismiss (returns if the situation changes)';
    dismiss.style.cssText =
      'background:none;border:none;color:#8fb3c9;cursor:pointer;font-size:14px;padding:0 2px;line-height:1';
    dismiss.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dismissed.add(advisory.text);
      this.render();
    });
    top.appendChild(message);
    top.appendChild(dismiss);
    row.appendChild(top);

    const steps = TUTORIALS[advisory.id];
    if (steps && !this.tutorialSeen.has(advisory.id)) {
      const list = document.createElement('ol');
      list.style.cssText =
        'margin:6px 0 2px;padding-left:18px;color:#cfe6f2;line-height:1.45;font-size:12px';
      for (const step of steps) {
        const item = document.createElement('li');
        item.textContent = step;
        list.appendChild(item);
      }
      const gotIt = document.createElement('button');
      gotIt.textContent = 'Got it ✓';
      gotIt.style.cssText =
        'margin:2px 0 3px;background:#2b3d4f;color:#8fe0ff;border:1px solid #4a6076;' +
        'border-radius:4px;padding:2px 10px;cursor:pointer;font-size:12px';
      gotIt.addEventListener('click', (event) => {
        event.stopPropagation();
        this.markTutorialSeen(advisory.id);
        this.render();
      });
      row.appendChild(list);
      row.appendChild(gotIt);
    }
    return row;
  }
}
