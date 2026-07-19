/** Schema tag for the compact profile stored on each household component. */
export const CITIZEN_PROFILE_VERSION = 1 as const;
/** Household-local id of the one worker represented by the employment slot. */
export const CITIZEN_PRIMARY_MEMBER_ID = 0;

/** Newest events retained per household; older entries fall off the front. */
export const CITIZEN_LIFE_EVENT_LIMIT = 8;

/** Age bands used by deterministic household composition generation. */
export const PRIMARY_ADULT_MIN_AGE = 25;
export const PRIMARY_ADULT_AGE_SPAN = 35;
export const SECOND_ADULT_MIN_AGE = 22;
export const SECOND_ADULT_AGE_SPAN = 41;
export const CHILD_MIN_AGE = 4;
export const CHILD_AGE_SPAN = 9;
export const SCHOOL_START_AGE = 6;
export const TEEN_MIN_AGE = 13;
export const TEEN_AGE_SPAN = 5;
export const SENIOR_MIN_AGE = 65;
export const SENIOR_AGE_SPAN = 20;

/** Stable, deliberately compact name pools for generated residents. */
export const CITIZEN_GIVEN_NAMES = [
  'Alex',
  'Amara',
  'Ben',
  'Chloe',
  'Diego',
  'Eli',
  'Fatima',
  'Grace',
  'Hana',
  'Isaac',
  'Jules',
  'Kai',
  'Leila',
  'Mateo',
  'Nia',
  'Owen',
  'Priya',
  'Quinn',
  'Ravi',
  'Sofia',
  'Theo',
  'Uma',
  'Victor',
  'Willow',
] as const;

export const CITIZEN_FAMILY_NAMES = [
  'Adams',
  'Bennett',
  'Chen',
  'Diaz',
  'Evans',
  'Foster',
  'Garcia',
  'Hassan',
  'Ito',
  'Johnson',
  'Kaur',
  'Lewis',
  'Martinez',
  'Nguyen',
  'Okafor',
  'Patel',
  'Reed',
  'Singh',
  'Turner',
  'Williams',
] as const;
