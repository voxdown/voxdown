/**
 * After each test, a turn of the event loop. The test runner sends its progress to the main
 * process and gives each message 60 seconds to be answered, but the answer is read only when the
 * worker gets back to its event loop. Tests that never wait (the corpus's, 95 to 130 seconds on a
 * CI runner) ran one after another without getting back to it, so on a slow runner every test
 * passed and the run still failed: `[vitest-worker]: Timeout calling "onTaskUpdate"`.
 *
 * `setImmediate` (Node's own, as fake timers may stand in for the global one) runs after the event
 * loop has read what came in, which a `setTimeout` does not.
 */
import { setImmediate } from "node:timers";
import { afterEach } from "vitest";

afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
