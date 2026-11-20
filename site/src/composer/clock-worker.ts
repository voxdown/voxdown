/** A steady tick for the audio scheduler; worker timers keep time when the tab is in the background. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ run: boolean; interval?: number }>) => void) | null;
  postMessage: (message: number) => void;
};
let timer: ReturnType<typeof setInterval> | undefined;
scope.onmessage = (event) => {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (event.data.run) timer = setInterval(() => scope.postMessage(0), event.data.interval ?? 25);
};
