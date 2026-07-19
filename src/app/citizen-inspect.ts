import type {
  CitizenActivityPlace,
  CitizenDetail,
  CitizenPlace,
} from '../protocol/messages';
import { TICKS_PER_DAY } from '../sim/constants/map';
import type { CitizenLifeEvent, CitizenMemberProfile } from '../sim/types';
import type {
  InspectAction,
  InspectData,
  InspectSection,
} from '../ui/inspect-panel';

/** Happiness bands, worst to best. Thresholds are the lower bound of each band. */
const MOOD_BANDS: ReadonlyArray<{ atLeast: number; word: string }> = [
  { atLeast: 0.8, word: 'thriving' },
  { atLeast: 0.6, word: 'content' },
  { atLeast: 0.4, word: 'coping' },
  { atLeast: 0.2, word: 'unhappy' },
  { atLeast: 0, word: 'miserable' },
];

const LIFE_STAGE_LABELS = {
  child: 'Child',
  teen: 'Teen',
  adult: 'Adult',
  senior: 'Senior',
} as const;

const EDUCATION_LABELS = {
  none: 'No formal education',
  primary: 'Primary education',
  secondary: 'Secondary education',
  trade: 'Trade education',
  university: 'University education',
} as const;

const ROLE_LABELS = {
  child: 'Child',
  student: 'Student',
  jobSeeker: 'Job seeker',
  commercialWorker: 'Commercial worker',
  industrialWorker: 'Industrial worker',
  caregiver: 'Caregiver',
  retired: 'Retired',
} as const;

const ZONE_LABELS = {
  R: 'Residential',
  C: 'Commercial',
  I: 'Industrial',
} as const;

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
  const abandoned = place.abandoned ? ' (abandoned)' : '';
  return `${ZONE_LABELS[place.zone]} level ${place.level} at (${place.x}, ${place.y})${abandoned}`;
}

function activityPlaceLabel(
  place: CitizenActivityPlace | null | undefined,
  fallback: string,
): string {
  return place ? `${place.label} at (${place.x}, ${place.y})` : fallback;
}

/**
 * The factors actually moving the household score, strongest first. Ties
 * retain the simulation model's own order, keeping the wording deterministic.
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
      return `${sign}${points} ${factor.label}`;
    });
}

function memberSummary(
  member: CitizenMemberProfile,
  detail: CitizenDetail,
): string {
  const markers: string[] = [];
  if (member.id === detail.selectedMemberId) markers.push('selected');
  if (member.id === detail.activeTravellerMemberId) {
    markers.push(detail.agent ? 'active traveller' : 'activity representative');
  }
  const marker = markers.length > 0 ? ` (${markers.join(', ')})` : '';
  return `${member.givenName}, ${member.age} — ${LIFE_STAGE_LABELS[member.lifeStage]} · ${ROLE_LABELS[member.role]} · ${EDUCATION_LABELS[member.education]}${marker}`;
}

function travelMode(detail: CitizenDetail): string {
  if (!detail.agent) return 'No walker or car is active';
  return detail.agent.kind === 'vehicle' ? 'Driving' : 'Walking';
}

function eventMember(detail: CitizenDetail, memberId: number): string {
  return (
    detail.profile.members.find((member) => member.id === memberId)?.givenName ??
    `Household member ${memberId}`
  );
}

function eventSentence(detail: CitizenDetail, event: CitizenLifeEvent): string {
  const name = eventMember(detail, event.memberId);
  // String normalization also lets an in-development save carrying the brief
  // pre-release `outing` spelling remain readable after `outingDeparted` lands.
  const kind: string = event.kind;
  switch (kind) {
    case 'movedIn':
      return `${name} moved into the city.`;
    case 'hired':
      return `${name} started a new job.`;
    case 'jobLost':
      return `${name} lost their job.`;
    case 'outing':
    case 'outingDeparted':
      if (event.activity === 'shop') return `${name} left home to go shopping.`;
      if (event.activity === 'leisure') return `${name} left home for leisure.`;
      if (event.activity === 'work') return `${name} left home for work.`;
      if (event.activity === 'rest') return `${name} began a rest activity at home.`;
      return `${name} left home for an outing.`;
    case 'stranded': {
      const activity = event.activity ? ` ${event.activity}` : '';
      return `${name} could not find a route for their${activity} trip.`;
    }
    default:
      return `${name} had an unrecognized life event (${kind}).`;
  }
}

function eventLine(detail: CitizenDetail, event: CitizenLifeEvent): string {
  const day = Math.floor(event.tick / TICKS_PER_DAY) + 1;
  return `Day ${day} · tick ${event.tick} — ${eventSentence(detail, event)}`;
}

function selectedSection(detail: CitizenDetail): InspectSection {
  const member = detail.selectedMember;
  const representative = detail.activeTraveller.givenName;
  const relation = detail.agent
    ? member.id === detail.activeTravellerMemberId
      ? `${member.givenName} is the active traveller for the household's current activity.`
      : `${representative} is the active traveller; ${member.givenName} remains selected.`
    : member.id === detail.activeTravellerMemberId
      ? `${member.givenName} represents the household's current activity; nobody is travelling.`
      : `${representative} represents the current activity; ${member.givenName} remains selected and nobody is travelling.`;
  return {
    heading: 'Selected resident',
    lines: [
      `Age ${member.age} · ${LIFE_STAGE_LABELS[member.lifeStage]}`,
      `${ROLE_LABELS[member.role]} · ${EDUCATION_LABELS[member.education]}`,
      relation,
    ],
  };
}

function activitySection(detail: CitizenDetail): InspectSection {
  const lines = [
    `Household now: ${detail.status}`,
    `Travel mode: ${travelMode(detail)}`,
  ];
  if (detail.agent) lines.push(`Current map position: (${detail.x}, ${detail.y})`);
  lines.push(detail.agent
    ? `One household trip is simulated at a time; ${detail.activeTraveller.givenName} represents this activity.`
    : `Household activities are simulated one at a time; ${detail.activeTraveller.givenName} represents this one.`);
  return { heading: 'Current activity', lines };
}

function placesSection(detail: CitizenDetail): InspectSection {
  const destination = detail.destinationPlace
    ? activityPlaceLabel(detail.destinationPlace, 'No active destination')
    : placeLabel(detail.destination, 'No active destination');
  return {
    heading: 'Places & commute',
    lines: [
      'Map markers: cyan home / orange work / magenta current destination or venue',
      `Home: ${placeLabel(detail.home, 'No home — the household lost its residence')}`,
      `Work: ${placeLabel(detail.work, 'No workplace assigned')}`,
      `Destination: ${destination}`,
      `Activity venue: ${activityPlaceLabel(detail.activityPlace, 'No active outing venue')}`,
      detail.commuteCells === null
        ? 'Commute: none — no workplace is assigned'
        : `Commute: ${detail.commuteCells} cells each way`,
    ],
  };
}

function lifeSection(detail: CitizenDetail): InspectSection {
  const lines =
    detail.lifeEvents.length === 0
      ? ['No recorded life events yet.']
      : [...detail.lifeEvents].reverse().map((event) => eventLine(detail, event));
  return { heading: 'Recent life', lines };
}

/**
 * Turns one household query into a person-led inspector. Identity and history
 * are persistent, while the wording explicitly preserves the current sim
 * boundary: the household owns one trip and one happiness score at a time.
 */
export function citizenInspectData(
  detail: CitizenDetail,
  actions?: InspectAction[],
): InspectData {
  const percent = Math.round(Math.min(Math.max(detail.happiness, 0), 1) * 100);
  const reasons = topReasons(detail);
  const sections: InspectSection[] = [
    selectedSection(detail),
    activitySection(detail),
    {
      heading: `Household members (${detail.profile.members.length})`,
      lines: detail.profile.members.map((member) => memberSummary(member, detail)),
    },
    placesSection(detail),
  ];

  if (reasons.length > 0) {
    sections.push({ heading: 'Household happiness reasons', lines: reasons });
  }
  sections.push(lifeSection(detail));
  const provenanceLines: string[] = [];
  if (detail.profileSource === 'legacyFallback') {
    provenanceLines.push('Names were reconstructed deterministically from this legacy save.');
  }
  if (detail.historyTruncated) {
    provenanceLines.push(
      detail.historyStartTick === null || detail.historyStartTick === undefined
        ? 'Older or malformed life events are unavailable.'
        : `Only the newest valid life events are retained; earlier history before tick ${detail.historyStartTick} is unavailable.`,
    );
  } else if (detail.historyComplete === false) {
    provenanceLines.push(
      detail.historyStartTick === null || detail.historyStartTick === undefined
        ? 'Life events from before this save was upgraded are unavailable.'
        : `Life events before tick ${detail.historyStartTick} are unavailable.`,
    );
  }
  if (provenanceLines.length > 0) {
    sections.unshift({
      heading: 'Record provenance',
      lines: provenanceLines,
    });
  }

  return {
    subjectKey: `citizen:${detail.entity}:${detail.generation}:${detail.selectedMemberId}`,
    title: `${detail.selectedMember.givenName} — ${detail.profile.householdName}`,
    // A flat copy remains useful to text-mode inspection and focused tests;
    // InspectPanel uses sections when present to provide visual hierarchy.
    lines: sections.flatMap((section) => section.lines),
    sections,
    actions,
    abandoned: detail.home?.abandoned ?? true,
    meter: {
      label: 'Household happiness',
      value: detail.happiness,
      caption: `${percent}% — ${moodWord(detail.happiness)}`,
    },
  };
}
