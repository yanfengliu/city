export const PERFORMANCE_FIXTURE_SHA256 =
  '2f4823cfb03bd38deea97a3b6aae0491c1ca97b9aa6b60c1c8e582285190c7ec';
export const PERFORMANCE_FIXTURE_SEED = 12_345;
// Post-advance projection under the daily-routine clock (2026-08-17): tick
// 1203 is early evening, so the workload is the homeward vehicle rush with
// few walkers on screen. The save itself is unchanged; only shipping replay
// behavior moved. If the render benchmark needs a walker-heavy scene again,
// re-cut the fixture at a busier clock moment via the reviewed override.
export const PERFORMANCE_FIXTURE_POST_ADVANCE_STATE = Object.freeze({
  tick: 1203,
  populationPeople: 936,
  buildingCount: 453,
  vehiclesOnScreen: 77,
  pedestriansOnScreen: 2,
});
