// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InspectPanel,
  type InspectData,
  type InspectSection,
} from '../../src/ui/inspect-panel';

/**
 * The rendered behaviour of the inspector, in a real DOM.
 *
 * These exist because the panel re-renders twice a second while a subject is
 * open, and every rule that matters is about what a refresh must NOT disturb:
 * the player's open/closed choices, their keyboard focus, and the identity of
 * the nodes underneath both. None of that shows up in the rendered text, which
 * is why the pure-function contracts next door cannot see it.
 */

function section(overrides: Partial<InspectSection> = {}): InspectSection {
  return { id: 'growth', heading: 'Growth', lines: ['line one'], ...overrides };
}

function data(overrides: Partial<InspectData> = {}): InspectData {
  return {
    subjectKey: 'building:1:0',
    title: 'Home — Level 1',
    lines: ['line one'],
    sections: [section()],
    abandoned: false,
    ...overrides,
  };
}

let container: HTMLElement;
let panel: InspectPanel;
let onClose: () => void;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('div');
  document.body.appendChild(container);
  onClose = vi.fn();
  panel = new InspectPanel(container, onClose);
});

function root(): HTMLElement {
  return container.querySelector<HTMLElement>('[aria-label="Selection details"]')!;
}

function headers(): HTMLButtonElement[] {
  return [...root().querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
}

function headerFor(heading: string): HTMLButtonElement {
  const match = headers().find((button) => button.textContent?.includes(heading));
  if (!match) throw new Error(`no section header for ${heading}`);
  return match;
}

function bodyOf(header: HTMLButtonElement): HTMLElement {
  return header.nextElementSibling as HTMLElement;
}

describe('expanding and collapsing', () => {
  it('opens by default and closes on a click, hiding the body', () => {
    panel.show(data());
    const header = headerFor('Growth');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(bodyOf(header).style.display).toBe('flex');

    header.click();

    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(bodyOf(header).style.display).toBe('none');
  });

  it('honours a section that asks to start closed, and opens it on click', () => {
    panel.show(data({ sections: [section({ startCollapsed: true })] }));
    const header = headerFor('Growth');
    expect(header.getAttribute('aria-expanded')).toBe('false');

    header.click();

    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps a section the player closed closed across live refreshes', () => {
    panel.show(data());
    headerFor('Growth').click();

    // The live cadence: same subject, moved numbers, several times over.
    for (let tick = 0; tick < 5; tick++) {
      panel.show(data({ sections: [section({ lines: [`line ${tick}`] })] }));
      expect(headerFor('Growth').getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('keeps a section the player OPENED open across refreshes', () => {
    panel.show(data({ sections: [section({ startCollapsed: true })] }));
    headerFor('Growth').click();

    panel.show(data({ sections: [section({ startCollapsed: true, lines: ['moved'] })] }));

    expect(headerFor('Growth').getAttribute('aria-expanded')).toBe('true');
  });

  it('resets to the section defaults when a different subject is inspected', () => {
    panel.show(data());
    headerFor('Growth').click();
    expect(headerFor('Growth').getAttribute('aria-expanded')).toBe('false');

    panel.show(data({ subjectKey: 'building:2:0' }));

    expect(headerFor('Growth').getAttribute('aria-expanded')).toBe('true');
  });

  it('forgets the player-s choices once the panel is closed', () => {
    panel.show(data());
    headerFor('Growth').click();

    panel.hide();
    panel.show(data());

    expect(headerFor('Growth').getAttribute('aria-expanded')).toBe('true');
  });

  it('keys the choice on the section id, so a live count in the heading cannot reset it', () => {
    panel.show(data({ sections: [section({ id: 'members', heading: 'Members (3)' })] }));
    headerFor('Members (3)').click();

    panel.show(data({ sections: [section({ id: 'members', heading: 'Members (2)' })] }));

    expect(headerFor('Members (2)').getAttribute('aria-expanded')).toBe('false');
  });

  it('renders a pinned section with no control and leaves it open', () => {
    panel.show(data({ sections: [section({ collapsible: false, summary: 'gist' })] }));
    const header = headerFor('Growth');

    expect(header.disabled).toBe(true);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    header.click();
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the summary only while the section is closed', () => {
    panel.show(data({ sections: [section({ summary: '36 / 36 people' })] }));
    const header = headerFor('Growth');
    const summary = header.lastElementChild as HTMLElement;
    expect(summary.textContent).toBe('36 / 36 people');
    // Open: the body already says it, so the header must not repeat it.
    expect(summary.style.display).toBe('none');

    header.click();

    expect(summary.style.display).toBe('inline');
  });
});

describe('what a refresh must not disturb', () => {
  it('keeps keyboard focus on a section header', () => {
    panel.show(data({
      sections: [section({ id: 'a', heading: 'A' }), section({ id: 'b', heading: 'B' })],
    }));
    const header = headerFor('A');
    header.focus();
    expect(document.activeElement).toBe(header);

    for (let tick = 0; tick < 3; tick++) {
      panel.show(data({
        sections: [
          section({ id: 'a', heading: 'A', lines: [`a${tick}`] }),
          section({ id: 'b', heading: 'B', lines: [`b${tick}`] }),
        ],
      }));
    }

    // Re-appending an in-place node detaches it, which blurs it — so an
    // in-order section must not be touched at all.
    expect(document.activeElement).toBe(header);
  });

  it('reuses the same nodes instead of rebuilding the section', () => {
    panel.show(data());
    const before = headerFor('Growth');

    panel.show(data({ sections: [section({ lines: ['changed'] })] }));

    expect(headerFor('Growth')).toBe(before);
    expect(bodyOf(before).textContent).toContain('changed');
  });
});

describe('reconciling the section list', () => {
  it('drops sections that are no longer present', () => {
    panel.show(data({
      sections: [section({ id: 'a', heading: 'A' }), section({ id: 'b', heading: 'B' })],
    }));
    expect(headers()).toHaveLength(2);

    panel.show(data({ sections: [section({ id: 'a', heading: 'A' })] }));

    expect(headers()).toHaveLength(1);
    expect(headers()[0].textContent).toContain('A');
  });

  it('puts a reordered section in its new place', () => {
    const a = section({ id: 'a', heading: 'A' });
    const b = section({ id: 'b', heading: 'B' });
    panel.show(data({ sections: [a, b] }));
    expect(headers().map((h) => h.textContent?.replace(/[▼▶]/, ''))).toEqual(['A', 'B']);

    panel.show(data({ sections: [b, a] }));

    expect(headers().map((h) => h.textContent?.replace(/[▼▶]/, ''))).toEqual(['B', 'A']);
  });

  it('inserts a section that appears later without disturbing the others', () => {
    panel.show(data({ sections: [section({ id: 'a', heading: 'A' })] }));
    const a = headerFor('A');

    panel.show(data({
      sections: [section({ id: 'a', heading: 'A' }), section({ id: 'b', heading: 'B' })],
    }));

    expect(headerFor('A')).toBe(a);
    expect(headers()).toHaveLength(2);
  });

  it('switches between flat lines and sections without leaving either behind', () => {
    panel.show(data({ sections: undefined, lines: ['flat one', 'flat two'] }));
    expect(headers()).toHaveLength(0);
    expect(root().textContent).toContain('flat one');

    panel.show(data({ subjectKey: 'building:9:0' }));

    expect(headers()).toHaveLength(1);
    expect(root().textContent).not.toContain('flat one');

    panel.show(data({ subjectKey: 'building:9:0', sections: undefined, lines: ['back to flat'] }));

    expect(headers()).toHaveLength(0);
    expect(root().textContent).toContain('back to flat');
  });
});

describe('meters and chrome', () => {
  it('fills the headline bar to the meter value and reports it to assistive tech', () => {
    panel.show(data({
      meter: { label: 'Occupancy', value: 0.25, caption: '3 / 12 people' },
    }));

    const bar = root().querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(bar.getAttribute('aria-valuetext')).toBe('3 / 12 people');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('25%');
  });

  it('clamps a meter outside 0..1 rather than overflowing its track', () => {
    panel.show(data({ meter: { label: 'Load', value: 3, caption: 'over' } }));
    const over = root().querySelector('[role="progressbar"]')!.firstElementChild as HTMLElement;
    expect(over.style.width).toBe('100%');

    panel.show(data({ meter: { label: 'Load', value: -1, caption: 'under' } }));
    const under = root().querySelector('[role="progressbar"]')!.firstElementChild as HTMLElement;
    expect(under.style.width).toBe('0%');
  });

  it('renders section meters inside the section body', () => {
    panel.show(data({
      sections: [section({ meters: [{ label: 'Toward level 2', value: 0.5, caption: '45 / 90' }] })],
    }));

    const bars = bodyOf(headerFor('Growth')).querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('aria-label')).toBe('Toward level 2');
  });

  it('shows the abandoned badge and the subtitle only when they apply', () => {
    // Asserted on `display`, not on textContent: the badge node always CARRIES
    // the word, and jsdom's textContent reads hidden nodes too — so a text
    // assertion here would pass no matter what the panel did.
    const badge = () =>
      [...root().children].find((child) => child.textContent === 'Abandoned') as HTMLElement;
    const subtitle = () => root().children[1] as HTMLElement;

    panel.show(data({ abandoned: true, subtitle: 'Residential · 2×2 cells at (1, 2)' }));
    expect(badge().style.display).toBe('block');
    expect(subtitle().style.display).toBe('block');
    expect(subtitle().textContent).toBe('Residential · 2×2 cells at (1, 2)');

    panel.show(data({ subjectKey: 'building:3:0' }));

    expect(badge().style.display).toBe('none');
    expect(subtitle().style.display).toBe('none');
  });

  it('runs an action, and reuses its button across refreshes so a click cannot miss', () => {
    const onClick = vi.fn();
    panel.show(data({ actions: [{ label: 'Meet a resident', onClick }] }));
    const button = [...root().querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Meet a resident',
    )!;

    panel.show(data({ actions: [{ label: 'Meet a resident', onClick }] }));
    const after = [...root().querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Meet a resident',
    )!;
    expect(after).toBe(button);

    after.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('closes through the header control', () => {
    panel.show(data());
    const close = [...root().querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Close inspector',
    )!;

    close.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
