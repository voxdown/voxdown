/**
 * Sending a book to ElevenLabs Studio: a project made from the production script, a chapter for
 * each chapter, a block for each paragraph and heading, and each speech in its character's voice
 * (with its direction as an audio tag on the models that take them). The writer listens, changes
 * and converts it in Studio, and can publish from there: the way to stores that take only books
 * made in ElevenLabs.
 *
 * API: https://elevenlabs.io/docs/api-reference/studio/add-project
 */
import { failure } from "../adapter";
import type { ProductionScript } from "../script";

type Node = { type: "tts_node"; voice_id: string; text: string };
type Block = { sub_type: string; nodes: Node[] };
type StudioChapter = { name: string; blocks: Block[] };

/** The script as Studio's content: chapters, blocks and voiced nodes. */
export function studioContent(
  script: ProductionScript,
  voices: Record<string, string>,
  options: { tags?: boolean } = {},
): StudioChapter[] {
  const voiceOf = (speaker: string | null) => {
    const name = speaker ?? script.narrator;
    const found =
      voices[name] ??
      Object.entries(voices).find(([other]) => other.toLowerCase() === name.toLowerCase())?.[1];
    if (!found) throw new Error(`No voice is cast for ${name}.`);
    return found;
  };
  const chapters: StudioChapter[] = [];
  for (const chapter of script.chapters) {
    const blocks: Block[] = [];
    let block: Block | undefined;
    for (const line of script.lines) {
      if (line.chapter !== chapter.number) continue;
      if (line.kind === "speech") {
        const subType = line.heading
          ? line.heading <= 1
            ? "h1"
            : line.heading === 2
              ? "h2"
              : "h3"
          : "p";
        if (!block || block.sub_type !== subType) {
          block = { sub_type: subType, nodes: [] };
          blocks.push(block);
        }
        const tag =
          options.tags && line.direction ? `[${line.direction.replace(/[[\]]/g, "")}] ` : "";
        block.nodes.push({
          type: "tts_node",
          voice_id: voiceOf(line.speaker),
          text: tag + line.text,
        });
      } else if (line.kind === "vocal" && options.tags) {
        if (!block) {
          block = { sub_type: "p", nodes: [] };
          blocks.push(block);
        }
        block.nodes.push({
          type: "tts_node",
          voice_id: voiceOf(line.speaker),
          text: `[${line.text}]`,
        });
      }
      // A paragraph, heading, scene or chapter ends the block.
      if (line.next !== "part" && line.next !== "line") block = undefined;
    }
    if (blocks.length) chapters.push({ name: chapter.title, blocks });
  }
  return chapters;
}

/** A Studio project made from the script; its id, and where to open it. */
export async function createStudioProject(
  script: ProductionScript,
  voices: Record<string, string>,
  options: {
    key: string;
    /** `eleven_v4` (the default) or another of ElevenLabs' models. */
    model?: string;
    base?: string;
    fetch?: typeof fetch;
  },
): Promise<{ projectId: string; url: string }> {
  const model = options.model ?? "eleven_v4";
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = (options.base ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const form = new FormData();
  form.set("name", script.title);
  form.set("title", script.title);
  if (script.author) form.set("author", script.author);
  if (script.language) form.set("language", script.language.slice(0, 2).toLowerCase());
  form.set("default_model_id", model);
  const narrator = voices[script.narrator];
  if (narrator) {
    form.set("default_title_voice_id", narrator);
    form.set("default_paragraph_voice_id", narrator);
  }
  form.set("source_type", "book");
  form.set("volume_normalization", "true");
  form.set(
    "from_content_json",
    JSON.stringify(studioContent(script, voices, { tags: /^eleven_v[34]/.test(model) })),
  );
  const response = await call(`${base}/v1/studio/projects`, {
    method: "POST",
    headers: { "xi-api-key": options.key },
    body: form,
  });
  if (!response.ok) throw await failure("ElevenLabs Studio", response);
  const data = (await response.json()) as { project?: { project_id?: string } };
  const projectId = data.project?.project_id;
  if (!projectId) throw new Error("ElevenLabs Studio made no project");
  return { projectId, url: `https://elevenlabs.io/app/studio/${projectId}` };
}
