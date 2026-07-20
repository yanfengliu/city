import {
  CHILD_AGE_SPAN,
  CHILD_MIN_AGE,
  CITIZEN_FAMILY_NAMES,
  CITIZEN_GIVEN_NAMES,
  CITIZEN_LIFE_EVENT_LIMIT,
  CITIZEN_PRIMARY_MEMBER_ID,
  CITIZEN_PROFILE_VERSION,
  PRIMARY_ADULT_AGE_SPAN,
  PRIMARY_ADULT_MIN_AGE,
  SCHOOL_START_AGE,
  SECOND_ADULT_AGE_SPAN,
  SECOND_ADULT_MIN_AGE,
  SENIOR_AGE_SPAN,
  SENIOR_MIN_AGE,
  TEEN_AGE_SPAN,
  TEEN_MIN_AGE,
} from './constants/citizens';
import { PEOPLE_PER_CITIZEN } from './constants/zoning';
import type { CitySim } from './city';
import type {
  CitizenActivity,
  CitizenComponent,
  CitizenEducation,
  CitizenLifeComponent,
  CitizenLifeEvent,
  CitizenLifeStage,
  CitizenMemberProfile,
  CitizenMemberRole,
  CitizenProfile,
  CityWorld,
  LeisureVenueType,
  ZoneType,
} from './types';

type LifeEventInput = Omit<CitizenLifeEvent, 'tick' | 'placeGeneration'> & {
  placeGeneration?: number;
};

const LIFE_STAGES = new Set<CitizenLifeStage>(['child', 'teen', 'adult', 'senior']);
const EDUCATION_LEVELS = new Set<CitizenEducation>([
  'none',
  'primary',
  'secondary',
  'trade',
  'university',
]);
const MEMBER_ROLES = new Set<CitizenMemberRole>([
  'child',
  'student',
  'jobSeeker',
  'commercialWorker',
  'industrialWorker',
  'caregiver',
  'retired',
]);
const LIFE_EVENT_KINDS = new Set<CitizenLifeEvent['kind']>([
  'movedIn',
  'hired',
  'jobLost',
  'outingDeparted',
  'stranded',
]);
const CITIZEN_ACTIVITIES = new Set<CitizenActivity>(['work', 'shop', 'leisure', 'rest']);

/** Small integer avalanche used only for identity; it never touches world RNG. */
function mix(value: number): number {
  let mixed = value | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function identityWord(
  seed: number,
  citizen: number,
  generation: number,
  home: number,
  salt: number,
): number {
  return mix(
    mix(seed) ^
      Math.imul(citizen + 1, 0x9e3779b1) ^
      Math.imul(generation + 1, 0x85ebca6b) ^
      Math.imul(home + 1, 0xc2b2ae35) ^
      salt,
  );
}

function adultEducation(word: number): CitizenEducation {
  return (['secondary', 'trade', 'university'] as const)[word % 3];
}

function member(
  id: number,
  givenName: string,
  age: number,
  lifeStage: CitizenLifeStage,
  education: CitizenEducation,
  role: CitizenMemberRole,
): CitizenMemberProfile {
  return { id, givenName, age, lifeStage, education, role };
}

/**
 * A pure, stable three-person roster. Profile creation consumes zero world RNG
 * draws, so adding identity cannot perturb growth, trips, or replay outcomes.
 */
export function createCitizenProfile(
  seed: number,
  citizen: number,
  generation: number,
  home: number,
): CitizenProfile {
  const root = identityWord(seed, citizen, generation, home, 0x6d2b79f5);
  const familyName = CITIZEN_FAMILY_NAMES[root % CITIZEN_FAMILY_NAMES.length];
  const firstName = root % CITIZEN_GIVEN_NAMES.length;
  // Seven is coprime to the 24-name pool, guaranteeing three distinct names.
  const nameAt = (id: number): string =>
    CITIZEN_GIVEN_NAMES[(firstName + id * 7) % CITIZEN_GIVEN_NAMES.length];
  const wordAt = (salt: number): number =>
    identityWord(seed, citizen, generation, home, salt);

  const primary = member(
    CITIZEN_PRIMARY_MEMBER_ID,
    nameAt(0),
    PRIMARY_ADULT_MIN_AGE + (wordAt(1) % PRIMARY_ADULT_AGE_SPAN),
    'adult',
    adultEducation(wordAt(2)),
    'jobSeeker',
  );
  const adult = (): CitizenMemberProfile =>
    member(
      1,
      nameAt(1),
      SECOND_ADULT_MIN_AGE + (wordAt(3) % SECOND_ADULT_AGE_SPAN),
      'adult',
      adultEducation(wordAt(4)),
      'caregiver',
    );
  const teen = (): CitizenMemberProfile =>
    member(
      1,
      nameAt(1),
      TEEN_MIN_AGE + (wordAt(5) % TEEN_AGE_SPAN),
      'teen',
      'secondary',
      'student',
    );
  const child = (id: number): CitizenMemberProfile => {
    const age = CHILD_MIN_AGE + (wordAt(6 + id) % CHILD_AGE_SPAN);
    return member(
      id,
      nameAt(id),
      age,
      'child',
      age < SCHOOL_START_AGE ? 'none' : 'primary',
      'child',
    );
  };
  const senior = (id: number): CitizenMemberProfile =>
    member(
      id,
      nameAt(id),
      SENIOR_MIN_AGE + (wordAt(9 + id) % SENIOR_AGE_SPAN),
      'senior',
      adultEducation(wordAt(12 + id)),
      'retired',
    );

  const composition = wordAt(15) % 4;
  const second = composition === 0 || composition === 2 ? adult() : teen();
  const third = composition === 0 || composition === 1 ? child(2) : senior(2);
  const members = [primary, second, third];
  if (members.length !== PEOPLE_PER_CITIZEN) {
    throw new Error(
      `citizen profile created ${members.length} members but PEOPLE_PER_CITIZEN is ${PEOPLE_PER_CITIZEN}`,
    );
  }
  return {
    version: CITIZEN_PROFILE_VERSION,
    householdName: `${familyName} household`,
    members,
    primaryWorkerMemberId: primary.id,
  };
}

/** True only for the complete v1 shape; malformed data falls back safely. */
export function hasStoredCitizenProfile(
  profile: unknown,
): profile is CitizenProfile {
  if (typeof profile !== 'object' || profile === null) return false;
  const value = profile as Partial<CitizenProfile>;
  if (value.version !== CITIZEN_PROFILE_VERSION) return false;
  if (typeof value.householdName !== 'string' || value.householdName.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(value.members) || value.members.length !== PEOPLE_PER_CITIZEN) {
    return false;
  }
  if (value.primaryWorkerMemberId !== CITIZEN_PRIMARY_MEMBER_ID) return false;

  for (let index = 0; index < value.members.length; index++) {
    const candidateMember: unknown = value.members[index];
    if (typeof candidateMember !== 'object' || candidateMember === null) return false;
    const entry = candidateMember as Partial<CitizenMemberProfile>;
    if (entry.id !== index) return false;
    if (typeof entry.givenName !== 'string' || entry.givenName.trim().length === 0) return false;
    if (!Number.isInteger(entry.age) || entry.age! < 0) return false;
    if (!LIFE_STAGES.has(entry.lifeStage as CitizenLifeStage)) return false;
    if (!EDUCATION_LEVELS.has(entry.education as CitizenEducation)) return false;
    if (!MEMBER_ROLES.has(entry.role as CitizenMemberRole)) return false;
  }
  return true;
}

/** Detached copy for query/protocol surfaces that must not expose ECS storage. */
export function copyCitizenProfile(profile: CitizenProfile): CitizenProfile {
  return {
    version: profile.version,
    householdName: profile.householdName,
    primaryWorkerMemberId: profile.primaryWorkerMemberId,
    members: profile.members.map((entry) => ({ ...entry })),
  };
}

export function validCitizenMemberId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < PEOPLE_PER_CITIZEN;
}

/**
 * One canonical compatibility rule for paths saved before `memberId` existed.
 * A current household traveller wins; a recycled owner id may not contribute.
 */
export function resolvePedestrianMemberId(
  w: CityWorld,
  citizenId: number,
  citizenGeneration: number,
  pathMemberId: unknown,
): number {
  if (validCitizenMemberId(pathMemberId)) return pathMemberId;
  if (
    w.isAlive(citizenId) &&
    w.getEntityGeneration(citizenId) === citizenGeneration
  ) {
    const traveller = w.getComponent(citizenId, 'citizen')?.travellerMemberId;
    if (validCitizenMemberId(traveller)) return traveller;
  }
  return CITIZEN_PRIMARY_MEMBER_ID;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * Copies only the valid, structured-clone-safe biography shape. The brief
 * pre-release `outing` spelling is normalized instead of discarding a real
 * legacy event; malformed entries are omitted rather than crashing a tick.
 */
export function sanitizeCitizenLifeEvents(value: unknown): CitizenLifeEvent[] {
  if (!Array.isArray(value)) return [];
  const events: CitizenLifeEvent[] = [];
  for (let index = value.length - 1; index >= 0; index--) {
    const candidate: unknown = value[index];
    if (typeof candidate !== 'object' || candidate === null) continue;
    const input = candidate as Record<string, unknown>;
    const rawKind = input.kind === 'outing' ? 'outingDeparted' : input.kind;
    if (!LIFE_EVENT_KINDS.has(rawKind as CitizenLifeEvent['kind'])) continue;
    if (!nonNegativeInteger(input.tick) || !validCitizenMemberId(input.memberId)) continue;

    const event: CitizenLifeEvent = {
      kind: rawKind as CitizenLifeEvent['kind'],
      tick: input.tick,
      memberId: input.memberId,
    };
    if (nonNegativeInteger(input.place)) event.place = input.place;
    if (event.place !== undefined && nonNegativeInteger(input.placeGeneration)) {
      event.placeGeneration = input.placeGeneration;
    }
    if (CITIZEN_ACTIVITIES.has(input.activity as CitizenActivity)) {
      event.activity = input.activity as CitizenActivity;
    }
    events.push(event);
    if (events.length === CITIZEN_LIFE_EVENT_LIMIT) break;
  }
  return events.reverse();
}

export interface CitizenLifeHistory {
  events: CitizenLifeEvent[];
  historyComplete: boolean;
  historyStartTick: number | null;
  historyTruncated: boolean;
}

/** Read-only, bounded biography view with conservative malformed-save provenance. */
export function citizenLifeHistory(life: CitizenLifeComponent | undefined): CitizenLifeHistory {
  const rawEvents = Array.isArray(life?.events) ? life.events : [];
  const events = sanitizeCitizenLifeEvents(rawEvents);
  const retainedMoveIn = events.some((entry) => entry.kind === 'movedIn');
  const recordedFromMoveIn =
    typeof life?.historyComplete === 'boolean'
      ? life.historyComplete
      : retainedMoveIn;
  const historyTruncated =
    life?.historyTruncated === true ||
    (life !== undefined && !Array.isArray(life.events)) ||
    rawEvents.length !== events.length ||
    (recordedFromMoveIn && !retainedMoveIn);
  return {
    events,
    historyComplete: recordedFromMoveIn && retainedMoveIn && !historyTruncated,
    historyStartTick: events[0]?.tick ?? null,
    historyTruncated,
  };
}

/** Stored profile, or a pure fallback for snapshots saved before profiles existed. */
export function profileForCitizen(
  sim: CitySim,
  citizenId: number,
  citizen: CitizenComponent,
): CitizenProfile {
  const stored = sim.world.getComponent(citizenId, 'citizenProfile');
  if (hasStoredCitizenProfile(stored)) return stored;
  const fallback = createCitizenProfile(
    sim.seed,
    citizenId,
    sim.world.getEntityGeneration(citizenId),
    citizen.home,
  );
  const workplace = citizen.work === null
    ? undefined
    : sim.world.getComponent(citizen.work, 'building');
  const workZone = workplace?.zone === 'C' || workplace?.zone === 'I'
    ? workplace.zone
    : null;
  return withWorkerRole(fallback, workZone);
}

/** Writes the rare profile component, adding it on a legacy household's first real change. */
export function storeCitizenProfile(
  w: CityWorld,
  citizenId: number,
  profile: CitizenProfile,
): void {
  if (w.getComponent(citizenId, 'citizenProfile')) {
    w.setComponent(citizenId, 'citizenProfile', profile);
  } else {
    w.addComponent(citizenId, 'citizenProfile', profile);
  }
}

/** Which named person owns a trip; the choice is stable and needs no RNG. */
export function travellerForActivity(
  profile: CitizenProfile,
  activity: CitizenActivity,
): number {
  if (activity === 'work') return profile.primaryWorkerMemberId;
  if (activity === 'shop') {
    const otherAdult = profile.members.find(
      (entry) =>
        entry.id !== profile.primaryWorkerMemberId && entry.lifeStage === 'adult',
    );
    return otherAdult?.id ?? profile.primaryWorkerMemberId;
  }
  if (activity === 'leisure') {
    let youngest = profile.members[0];
    for (const entry of profile.members) {
      if (entry.age < youngest.age || (entry.age === youngest.age && entry.id < youngest.id)) {
        youngest = entry;
      }
    }
    return youngest.id;
  }
  const senior = profile.members.find((entry) => entry.lifeStage === 'senior');
  return senior?.id ?? profile.primaryWorkerMemberId;
}

/**
 * Youthful households seek the larger play space of a park. Otherwise a
 * community garden is the quieter default; in mixed young/senior households,
 * the child or teen gives the shared outing its character.
 */
export function leisureVenuePreference(profile: CitizenProfile): LeisureVenueType {
  return profile.members.some(
    (entry) => entry.lifeStage === 'child' || entry.lifeStage === 'teen',
  )
    ? 'park'
    : 'garden';
}

/** Stable representative for the particular green venue a household chose. */
export function travellerForLeisureVenue(
  profile: CitizenProfile,
  venue: LeisureVenueType,
): number {
  if (venue === 'park') return travellerForActivity(profile, 'leisure');

  let oldestSenior: CitizenMemberProfile | undefined;
  let oldestAdult: CitizenMemberProfile | undefined;
  for (const entry of profile.members) {
    if (entry.lifeStage === 'senior') {
      if (
        !oldestSenior ||
        entry.age > oldestSenior.age ||
        (entry.age === oldestSenior.age && entry.id < oldestSenior.id)
      ) {
        oldestSenior = entry;
      }
    } else if (entry.lifeStage === 'adult') {
      if (
        !oldestAdult ||
        entry.age > oldestAdult.age ||
        (entry.age === oldestAdult.age && entry.id < oldestAdult.id)
      ) {
        oldestAdult = entry;
      }
    }
  }
  return oldestSenior?.id ?? oldestAdult?.id ?? travellerForActivity(profile, 'leisure');
}

/** Returns a copy with the household's one worker role synchronized to its job. */
export function withWorkerRole(
  profile: CitizenProfile,
  zone: Exclude<ZoneType, 'R'> | null,
): CitizenProfile {
  const role: CitizenMemberRole =
    zone === 'C' ? 'commercialWorker' : zone === 'I' ? 'industrialWorker' : 'jobSeeker';
  return {
    ...profile,
    members: profile.members.map((entry) =>
      entry.id === profile.primaryWorkerMemberId ? { ...entry, role } : entry,
    ),
  };
}

/** Appends one event while retaining only the newest bounded trail. */
export function appendCitizenLifeEvent(
  w: CityWorld,
  citizenId: number,
  event: LifeEventInput,
): void {
  if (!w.getComponent(citizenId, 'citizen')) return;
  const placeGeneration =
    event.placeGeneration ??
    (event.place !== undefined && w.isAlive(event.place)
      ? w.getEntityGeneration(event.place)
      : undefined);
  const complete: CitizenLifeEvent = {
    ...event,
    tick: w.tick,
    ...(placeGeneration === undefined ? {} : { placeGeneration }),
  };
  const life = w.getComponent(citizenId, 'citizenLife');
  const prior = citizenLifeHistory(life);
  const combined = [...prior.events, complete];
  const events = combined.slice(-CITIZEN_LIFE_EVENT_LIMIT);
  const historyTruncated =
    prior.historyTruncated || combined.length > CITIZEN_LIFE_EVENT_LIMIT;
  const recordedFromMoveIn =
    prior.historyComplete ||
    (prior.events.length === 0 && !prior.historyTruncated && complete.kind === 'movedIn');
  const historyComplete =
    recordedFromMoveIn &&
    !historyTruncated &&
    events.some((entry) => entry.kind === 'movedIn');
  const historyStartTick = events[0]?.tick;
  if (!life) {
    w.addComponent(citizenId, 'citizenLife', {
      events,
      historyComplete,
      ...(historyStartTick === undefined ? {} : { historyStartTick }),
      historyTruncated,
    });
    return;
  }
  w.patchComponent(citizenId, 'citizenLife', (component) => {
    component.events = events;
    component.historyComplete = historyComplete;
    component.historyStartTick = historyStartTick;
    component.historyTruncated = historyTruncated;
  });
}
