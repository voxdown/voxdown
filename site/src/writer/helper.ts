/**
 * The Writer's side of `vxd connect`: the helper on the writer's own computer that lets the page
 * use the AIs and voice services there. It opens the Writer with `#pair=127.0.0.1:port:key`; the
 * key is kept in this browser (it changes each time the helper starts), and every request
 * carries it. Only an address on this computer is taken, so a link can't send a story anywhere
 * else.
 */

export type Pairing = { address: string; token: string };

const KEY = "voxdown-writer-helper";

/** An AI or voice service the helper found. */
export type Found = { id: string; label: string; kind?: string; note?: string };

export type Hello = {
  version: string;
  /** Where audiobooks are made. */
  folder: string;
  ais: Found[];
  speech: Found[];
};

/** The pairing in an address's fragment, if it has one: only ever this computer. */
export function pairingIn(hash: string): Pairing | undefined {
  const match = /^#pair=((?:127\.0\.0\.1|localhost):\d{1,5}):([A-Za-z0-9_-]{16,})$/.exec(hash);
  return match ? { address: match[1] as string, token: match[2] as string } : undefined;
}

export function keepPairing(pairing: Pairing): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pairing));
  } catch {}
}

export function keptPairing(): Pairing | undefined {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as Pairing | null;
    return kept && pairingIn(`#pair=${kept.address}:${kept.token}`) ? kept : undefined;
  } catch {
    return undefined;
  }
}

export function forgetPairing(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** A request to the helper. Chrome and Firefox ask, once, to let the page reach this computer. */
async function call(pairing: Pairing, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`http://${pairing.address}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${pairing.token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    // Chrome's Local Network Access: a request to an app on this computer says so.
    targetAddressSpace: "loopback",
  } as RequestInit);
  if (!response.ok) {
    let said = "";
    try {
      said = ((await response.json()) as { error?: string }).error ?? "";
    } catch {}
    throw new HelperError(
      response.status === 401
        ? "The helper was started again since: run vxd connect again to connect the Writer."
        : said || `The helper answered ${response.status}.`,
      response.status === 401,
    );
  }
  return response;
}

export class HelperError extends Error {
  constructor(
    message: string,
    /** The key is no longer good: the writer must connect again. */
    readonly unpaired = false,
  ) {
    super(message);
  }
}

/** What the helper has: its AIs and voice services. */
export async function hello(pairing: Pairing, signal?: AbortSignal): Promise<Hello> {
  try {
    const response = await call(pairing, "/v1/hello", signal ? { signal } : {});
    return (await response.json()) as Hello;
  } catch (error) {
    if (error instanceof HelperError) throw error;
    throw new HelperError(
      "The helper isn't answering: is vxd connect still running? (Your browser may also have been asked, and refused, to let this page reach apps on your computer.)",
    );
  }
}

/** A character's words said in a voice, to hear it before choosing it. */
export async function listen(
  pairing: Pairing,
  body: { with: string; voice: string; words: string; language?: string },
  signal?: AbortSignal,
): Promise<Blob> {
  try {
    const response = await call(pairing, "/v1/listen", {
      method: "POST",
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    return await response.blob();
  } catch (error) {
    if (error instanceof HelperError || (error as Error).name === "AbortError") throw error;
    throw new HelperError("The helper isn't answering: is vxd connect still running?");
  }
}

/** Asks the helper to do something, each event it sends passed on as it comes. */
export async function work(
  pairing: Pairing,
  path: "/v1/tag" | "/v1/audiobook",
  body: Record<string, unknown>,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await call(pairing, path, {
      method: "POST",
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof HelperError || (error as Error).name === "AbortError") throw error;
    throw new HelperError("The helper isn't answering: is vxd connect still running?");
  }
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "error") throw new HelperError(String(event.error));
      onEvent(event);
    }
    if (done) break;
  }
}
