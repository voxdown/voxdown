/** Exit codes, and an error the user can act on. */

/** Done, problems found, and the command couldn't run. */
export const OK = 0;
export const PROBLEMS = 1;
export const ERROR = 2;

/** An error the user can act on, shown as one line. */
export class Failure extends Error {
  constructor(
    message: string,
    readonly code: number = ERROR,
  ) {
    super(message);
  }
}
