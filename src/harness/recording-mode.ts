const PLAYTEST_RECORDING_PARAM = 'record';

/** Normal game/dev sessions stay lean; replay capture is an explicit playtest mode. */
export function playtestRecordingRequested(search: string): boolean {
  return new URLSearchParams(search).get(PLAYTEST_RECORDING_PARAM) === '1';
}
