import type { WorkerToClient } from '../protocol/messages';

export type CommandSubmissionMessage = Extract<
  WorkerToClient,
  { type: 'commandSubmissionResult' }
>;

/** Correlates async queue-admission results with the latest player command. */
export class CommandFeedback {
  private latestId = 0;
  submission: CommandSubmissionMessage | null = null;

  dispatch(): number {
    this.submission = null;
    return ++this.latestId;
  }

  receive(submission: CommandSubmissionMessage): boolean {
    if (submission.id !== this.latestId) return false;
    this.submission = submission;
    return true;
  }
}
