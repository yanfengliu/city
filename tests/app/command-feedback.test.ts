import { describe, expect, it } from 'vitest';
import {
  CommandFeedback,
  type CommandSubmissionMessage,
} from '../../src/app/command-feedback';

const result = (id: number, accepted: boolean): CommandSubmissionMessage => ({
  type: 'commandSubmissionResult',
  id,
  name: 'placePipe',
  accepted,
  message: accepted ? 'Accepted' : 'Validation failed',
  tick: id,
});

describe('CommandFeedback', () => {
  it('ignores an older rejection after a newer same-name command is dispatched', () => {
    const feedback = new CommandFeedback();
    const first = feedback.dispatch();
    const second = feedback.dispatch();

    expect(feedback.receive(result(first, false))).toBe(false);
    expect(feedback.submission).toBeNull();
    expect(feedback.receive(result(second, true))).toBe(true);
    expect(feedback.submission).toEqual(result(second, true));
  });
});
