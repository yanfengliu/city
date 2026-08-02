import type { CitySimConfig } from '../sim/city';

export const CITY_WORKER_SIM_FLAGS: Readonly<Omit<CitySimConfig, 'seed'>> = Object.freeze({
  fieldsEnabled: true,
  utilitiesEnabled: true,
  highwayEnabled: true,
});
