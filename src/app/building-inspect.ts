import type {
  BuildingDetail,
  GrowableBuildingDetail,
  PowerPlantDetail,
  ServiceBuildingDetail,
  WaterPumpDetail,
} from '../protocol/messages';
import { UTILITY_BRIDGE_RADIUS } from '../sim/constants/utilities';
import type { ServiceType, ZoneType } from '../sim/types';
import type {
  InspectAction,
  InspectData,
  InspectMeter,
  InspectSection,
} from '../ui/inspect-panel';

/**
 * One placement's worker detail, rendered as a person-readable panel whose
 * sections are tailored to what the thing actually is. A home talks about who
 * lives there and what would let it grow; a school talks about the children
 * walking to it; a plant talks about capacity against the city's draw.
 *
 * Every number arrives pre-computed from the sim (see `sim/building-detail.ts`)
 * — this layer only chooses wording, grouping, and which section starts open.
 */

const ZONE_TITLES: Record<ZoneType, string> = {
  R: 'Home',
  C: 'Shop',
  I: 'Factory',
};

const ZONE_KIND_WORDS: Record<ZoneType, string> = {
  R: 'Residential',
  C: 'Commercial',
  I: 'Industrial',
};

const SERVICE_TITLES: Record<ServiceType, string> = {
  fireStation: 'Fire station',
  police: 'Police station',
  clinic: 'Clinic',
  school: 'School',
  park: 'Park',
  garden: 'Community garden',
};

const PLANT_TITLES = {
  coal: 'Coal power plant',
  wind: 'Wind turbine',
} as const;

function round(value: number, places = 0): string {
  return value.toFixed(places);
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : plural}`;
}

function tick(yes: boolean): string {
  return yes ? '✅' : '❌';
}

function footprintLine(detail: BuildingDetail): string {
  return `${detail.w}×${detail.h} cells at (${detail.x}, ${detail.y})`;
}

/** Ratio clamped to 0..1, with a zero denominator reading as empty rather than NaN. */
function ratio(value: number, of: number): number {
  return of > 0 ? Math.min(Math.max(value / of, 0), 1) : 0;
}

const OCCUPANCY_HEADINGS: Record<ZoneType, string> = {
  R: 'Residents',
  C: 'Jobs & shoppers',
  I: 'Jobs',
};

function occupancySection(detail: GrowableBuildingDetail): InspectSection {
  // No meter here: the headline bar above the sections already IS occupancy,
  // and repeating it turned the first screenful into the same fact three times.
  const lines: string[] = [];
  if (detail.zone === 'R') {
    lines.push(
      `${count(detail.people, 'resident')} in ${count(detail.households, 'household')}`,
      `Room for ${count(detail.peopleCapacity, 'person', 'people')} at this level`,
    );
    // "Everyone is home" is a lie about an empty building, so an empty one is
    // told it is empty instead.
    if (detail.households > 0) {
      lines.push(
        detail.householdsOut === 0
          ? 'Everyone is home right now'
          : `${count(detail.householdsOut, 'household')} out of the house right now`,
      );
    } else {
      lines.push('Nobody lives here yet');
    }
  } else {
    lines.push(`${count(detail.jobsFilled, 'job')} filled of ${detail.jobCapacity}`);
    if (detail.jobCapacity > detail.jobsFilled) {
      lines.push(`${count(detail.jobCapacity - detail.jobsFilled, 'vacancy', 'vacancies')} waiting for workers`);
    }
  }
  if (detail.zone === 'C') {
    lines.push(
      detail.present === 0
        ? 'Nobody is shopping here right now'
        : `${count(detail.present, 'household')} shopping here right now`,
    );
    lines.push(
      detail.inbound === 0
        ? 'No shoppers on their way'
        : `${count(detail.inbound, 'household')} walking here to shop`,
    );
  }
  const summary =
    detail.zone === 'R'
      ? `${detail.people} / ${detail.peopleCapacity} people`
      : `${detail.jobsFilled} / ${detail.jobCapacity} jobs`;
  // Headed by what the building HOLDS rather than by the word already on the
  // headline bar, so the first two rows of the panel are not the same label.
  return { id: 'occupancy', heading: OCCUPANCY_HEADINGS[detail.zone], summary, lines };
}

/** The sim's own answer to "why isn't this growing?", never a second opinion. */
function growthLines(detail: GrowableBuildingDetail): string[] {
  const { score } = detail;
  if (detail.abandoned) {
    return [
      score.value >= score.abandonAt
        ? `Desirability ${round(score.value, 1)} already clears the ${score.abandonAt} it needs`
        : `Desirability ${round(score.value, 1)} — needs ${score.abandonAt} to be used again`,
      `Recovering: ${score.recoverEvals} of ${score.recoverEvalsNeeded} good checks`,
      detail.zone === 'R'
        ? 'Power and water must both be connected before anyone moves back in'
        : 'Power and water must both be connected before it reopens',
    ];
  }
  const lines = [
    `Desirability ${round(score.value, 1)} (abandons below ${score.abandonAt})`,
  ];
  if (detail.growthBlocker === 'maxLevel') {
    lines.push(`Level ${detail.level} is the highest this building reaches`);
    return lines;
  }
  if (score.nextLevelAt !== null) {
    const short = score.nextLevelAt - score.value;
    lines.push(
      short > 0
        ? `Level ${detail.level + 1} needs ${round(score.nextLevelAt)} — ${round(short, 1)} short`
        : `Level ${detail.level + 1} threshold ${round(score.nextLevelAt)} is met`,
    );
  }
  // Missing utilities skip the whole level evaluation in the sim, so this has
  // to be said even when the score threshold is already met — otherwise the
  // panel shows a full bar on a building that will never advance.
  if (detail.growthBlocker === 'utilities') {
    lines.push(
      `Stalled: ${utilityGap(detail)} — nothing levels up until both are connected`,
    );
  } else if (detail.growthBlocker === 'education') {
    lines.push(
      detail.schoolCovered
        ? 'Held back: a covering school exists, but no child here has reached it lately'
        : 'Held back: no school covers this block',
    );
  } else if (detail.growthBlocker === 'none') {
    lines.push(`Levelling up: ${score.upEvals} of ${score.levelUpEvals} good checks`);
  }
  if (score.badEvals > 0) {
    lines.push(`Warning: ${score.badEvals} of ${score.abandonEvals} bad checks toward abandonment`);
  }
  return lines;
}

/** Which utility is missing, in words, for the growth and utilities sections. */
function utilityGap(detail: GrowableBuildingDetail): string {
  if (!detail.powered && !detail.watered) return 'no power and no water';
  return detail.powered ? 'no water' : 'no power';
}

function growthSection(detail: GrowableBuildingDetail): InspectSection {
  const { score } = detail;
  const meters: InspectMeter[] = [];
  // No progress bar while the level path is blocked outright: a full green bar
  // is a promise the sim will not keep.
  if (
    !detail.abandoned &&
    score.nextLevelAt !== null &&
    detail.growthBlocker !== 'utilities'
  ) {
    meters.push({
      label: `Toward level ${detail.level + 1}`,
      value: ratio(score.value, score.nextLevelAt),
      caption: `${round(score.value, 1)} / ${round(score.nextLevelAt)}`,
    });
  }
  if (detail.abandoned) {
    meters.push({
      label: 'Recovery',
      value: ratio(score.recoverEvals, score.recoverEvalsNeeded),
      caption: `${score.recoverEvals} / ${score.recoverEvalsNeeded} checks`,
    });
  }
  const summary = detail.abandoned
    ? 'Abandoned'
    : detail.growthBlocker === 'maxLevel'
      ? `Level ${detail.level} (max)`
      : detail.growthBlocker === 'utilities'
        ? `Level ${detail.level} — stalled`
        : `Level ${detail.level} → ${detail.level + 1}`;
  return {
    id: 'growth',
    heading: 'Growth',
    summary,
    lines: growthLines(detail),
    meters,
  };
}

/** What an unsupplied building of this kind actually loses. */
const UTILITY_LOSS: Record<ZoneType, string> = {
  R: 'before the residents leave',
  C: 'before the shop closes',
  I: 'before the factory closes',
};

function utilitiesSection(detail: GrowableBuildingDetail): InspectSection {
  const lines = [
    `${tick(detail.powered)} Power ${detail.powered ? 'connected' : 'not connected'}`,
    `${tick(detail.watered)} Water ${detail.watered ? 'connected' : 'not connected'}`,
    `Draws ${count(detail.utilityDemand, 'unit')} of power and the same of water`,
  ];
  const missing = !detail.powered || !detail.watered;
  // An already-abandoned building has nothing left to lose, so it gets the fix
  // without a countdown that has already run out.
  const atRisk = missing && !detail.abandoned;
  if (missing) {
    if (atRisk) {
      lines.push(
        `Unsupplied for ${detail.score.badUtilityEvals} of ${detail.score.utilityAbandonEvals} checks ${UTILITY_LOSS[detail.zone]}`,
      );
    }
    lines.push(
      `Run a power line or pipe within ${UTILITY_BRIDGE_RADIUS} cells of this building`,
    );
  }
  const meters: InspectMeter[] = atRisk
    ? [{
        label: 'Abandonment risk',
        value: ratio(detail.score.badUtilityEvals, detail.score.utilityAbandonEvals),
        caption: `${detail.score.badUtilityEvals} / ${detail.score.utilityAbandonEvals} checks`,
        worseWhenFull: true,
      }]
    : [];
  return {
    id: 'utilities',
    heading: 'Utilities',
    summary: missing
      ? `${!detail.powered ? '⚡' : ''}${!detail.watered ? '💧' : ''} missing`
      : 'Power and water OK',
    lines,
    meters,
  };
}

function servicesSection(detail: GrowableBuildingDetail): InspectSection {
  const met = detail.needs.filter((need) => need.covered).length;
  return {
    id: 'services',
    heading: 'Civic services',
    summary: `${met} of ${detail.needs.length} met`,
    startCollapsed: true,
    lines: [
      ...detail.needs.map((need) => `${tick(need.covered)} ${need.name}`),
      // Stated as the score's own coverage term rather than "8 points a need",
      // so this line cannot outlive a change to what a need is worth.
      `Worth ${detail.score.coverage} points of desirability here`,
    ],
  };
}

function neighbourhoodSection(detail: GrowableBuildingDetail): InspectSection {
  const lines = [
    `Land value ${round(detail.score.landValue)} (counts ×${detail.score.landValueWeight} here)`,
    `Pollution ${round(detail.pollution)} · noise ${round(detail.noise)}`,
    `${tick(detail.roadConnected)} Road ${detail.roadConnected ? 'adjacent' : 'no longer adjacent'}`,
  ];
  if (detail.zone === 'I') {
    lines.push(`Industrial land counts for little — a flat ${detail.score.base} points carries it instead`);
  } else {
    lines.push(`Tax ${detail.taxRate}% costs ${round(detail.score.taxPenalty, 1)} points of desirability`);
  }
  return {
    id: 'neighbourhood',
    heading: 'Neighbourhood',
    // Pollution rides the header because a poisoned block is the reason a home
    // stalls, and it must not be hidden behind a collapsed section.
    summary: `Land value ${round(detail.score.landValue)} · pollution ${round(detail.pollution)}`,
    startCollapsed: true,
    lines,
  };
}

function growableData(detail: GrowableBuildingDetail, actions?: InspectAction[]): InspectData {
  const sections = [
    occupancySection(detail),
    growthSection(detail),
    utilitiesSection(detail),
    servicesSection(detail),
    neighbourhoodSection(detail),
  ];
  const meter: InspectMeter =
    detail.zone === 'R'
      ? {
          label: 'Occupancy',
          value: ratio(detail.people, detail.peopleCapacity),
          caption: `${detail.people} / ${detail.peopleCapacity} people`,
        }
      : {
          label: 'Jobs filled',
          value: ratio(detail.jobsFilled, detail.jobCapacity),
          caption: `${detail.jobsFilled} / ${detail.jobCapacity}`,
        };
  return {
    subjectKey: `building:${detail.entity}:${detail.generation}`,
    title: `${ZONE_TITLES[detail.zone]} — Level ${detail.level}`,
    subtitle: `${ZONE_KIND_WORDS[detail.zone]} · ${footprintLine(detail)}`,
    sections,
    lines: sections.flatMap((section) => section.lines),
    actions,
    abandoned: detail.abandoned,
    meter,
  };
}

function serviceData(detail: ServiceBuildingDetail): InspectData {
  const sections: InspectSection[] = [
    {
      id: 'coverage',
      heading: 'Coverage',
      summary: `${detail.radius} cells`,
      lines: [
        `Reaches ${detail.radius} cells in every direction (shown on the map)`,
        `Serving ${count(detail.buildingsCovered, 'building')} and ${count(
          detail.peopleCovered,
          'resident',
        )}`,
      ],
    },
  ];
  if (detail.attendance) {
    const { walking, present } = detail.attendance;
    sections.push({
      id: 'attendance',
      heading: 'Attendance',
      summary: `${present + walking} children`,
      lines: [
        `${count(present, 'child', 'children')} in class right now`,
        `${count(walking, 'child', 'children')} still walking here`,
        'Only homes with a walkable route send children — coverage alone is not enough',
      ],
    });
  }
  if (detail.visitors !== null) {
    const { inbound, present } = detail.visitors;
    sections.push({
      id: 'visitors',
      heading: 'Visitors',
      summary: present + inbound === 0 ? 'Quiet' : `${present} here · ${inbound} walking`,
      lines: [
        present === 0
          ? 'Nobody is here right now'
          : `${count(present, 'household')} out here right now`,
        inbound === 0
          ? 'Nobody is on their way'
          : `${count(inbound, 'household')} walking here for an outing`,
        'Green space lifts happiness and land value; a second one nearby adds no extra credit',
      ],
    });
  }
  sections.push({
    id: 'costs',
    heading: 'Costs',
    summary: `$${detail.upkeep}/budget`,
    startCollapsed: true,
    lines: [`Built for $${detail.cost}`, `Upkeep $${detail.upkeep} every budget interval`],
  });
  return {
    subjectKey: `structure:${detail.entity}:${detail.generation}`,
    title: SERVICE_TITLES[detail.service],
    subtitle: `Civic service · ${footprintLine(detail)}`,
    sections,
    lines: sections.flatMap((section) => section.lines),
    abandoned: false,
  };
}

/** Shared power/water framing: this unit's capacity against the whole city's draw. */
function utilitySections(
  detail: PowerPlantDetail | WaterPumpDetail,
  unit: 'power' | 'water',
): InspectSection[] {
  const { supply, demand } = detail.city;
  const short = demand - supply;
  return [
    {
      id: 'output',
      heading: 'Output',
      summary: `${detail.capacity} units`,
      meters: [
        {
          label: `City ${unit} load`,
          value: ratio(demand, supply),
          caption: `${demand} / ${supply} units`,
          worseWhenFull: true,
        },
      ],
      lines: [
        `Supplies ${detail.capacity} units to its own connected network`,
        `City-wide: ${demand} units drawn against ${supply} installed`,
        short > 0
          ? `${short} units short city-wide — some network browns out`
          : 'Installed capacity covers the whole city',
        'Capacity is allocated per network, so a separated grid can still go dark',
      ],
    },
    {
      id: 'reach',
      heading: 'Reach',
      summary: `${detail.bridgeRadius} cells`,
      startCollapsed: true,
      lines: [
        unit === 'power'
          ? `Only this plant and its lines carry power — anything within ${detail.bridgeRadius} cells of them is served`
          : `Pipes carry water — anything within ${detail.bridgeRadius} cells of a connected pipe is served`,
        'Buildings do not pass supply on to their neighbours',
      ],
    },
    {
      id: 'costs',
      heading: 'Costs',
      summary: `$${detail.upkeep}/budget`,
      startCollapsed: true,
      lines: [`Built for $${detail.cost}`, `Upkeep $${detail.upkeep} every budget interval`],
    },
  ];
}

function powerPlantData(detail: PowerPlantDetail): InspectData {
  const sections = utilitySections(detail, 'power');
  sections.splice(1, 0, {
    id: 'emissions',
    heading: 'Emissions',
    summary: detail.pollution > 0 ? `${detail.pollution} pollution` : 'Clean',
    lines:
      detail.pollution > 0
        ? [
            `Adds ${detail.pollution} pollution around itself every cycle`,
            'Keep it downwind of homes — pollution sinks land value and happiness',
          ]
        : ['Emits nothing; the only cost is the small capacity'],
  });
  return {
    subjectKey: `plant:${detail.entity}:${detail.generation}`,
    title: PLANT_TITLES[detail.plant],
    subtitle: `Power · ${footprintLine(detail)}`,
    sections,
    lines: sections.flatMap((section) => section.lines),
    abandoned: false,
  };
}

function waterPumpData(detail: WaterPumpDetail): InspectData {
  const sections = utilitySections(detail, 'water');
  return {
    subjectKey: `pump:${detail.entity}:${detail.generation}`,
    title: 'Water pump',
    subtitle: `Water · ${footprintLine(detail)}`,
    sections,
    lines: sections.flatMap((section) => section.lines),
    abandoned: false,
  };
}

/** Turns one building query into a panel tailored to what was clicked. */
export function buildingInspectData(
  detail: BuildingDetail,
  actions?: InspectAction[],
): InspectData {
  switch (detail.kind) {
    case 'growable':
      return growableData(detail, actions);
    case 'service':
      return serviceData(detail);
    case 'powerPlant':
      return powerPlantData(detail);
    case 'waterPump':
      return waterPumpData(detail);
  }
}
