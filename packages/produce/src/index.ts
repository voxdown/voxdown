/**
 * @voxdown/produce: a VoxDown story made into an audiobook, with the voice service the writer
 * chooses. `productionScript` turns a story into plain data any tool can read; an `Adapter` turns
 * a line into sound (ElevenLabs, OpenAI-compatible speech such as Kokoro, Azure, or one of your
 * own); `produce` makes every line, joins each chapter with the same pacing whatever the service,
 * and says when each line is heard. `@voxdown/produce/node` writes the files: WAV, MP3 and M4B.
 */
export {
  type Adapter,
  AdapterError,
  type Capabilities,
  type Clip,
  type SpeakRequest,
  type Voice,
  type WordTime,
  failure,
  fromBase64,
} from "./adapter";
export { type ElevenLabsOptions, elevenlabs, wordsFromAlignment } from "./adapters/elevenlabs";
export { createStudioProject, studioContent } from "./adapters/elevenlabs-studio";
export {
  type OpenAiSpeechOptions,
  PRESETS,
  instructionsFor,
  openaiSpeech,
} from "./adapters/openai-speech";
export { type AzureOptions, azure } from "./adapters/azure";
export {
  type Sound,
  fromPcm16,
  fromWav,
  joined,
  lengthMs,
  leveled,
  loudness,
  peak,
  resample,
  silence,
  toPcm16,
  toWav,
  trimmed,
} from "./audio";
export { type Casting, castVoices, genderOf, speakersOf, voiceId } from "./casting";
export {
  type ChapterMade,
  type ChapterSink,
  type ClipStore,
  type Cue,
  type Left,
  type ProduceOptions,
  type Progress,
  ROOM,
  estimate,
  memoryStore,
  pieces,
  plan,
  produce,
} from "./render";
export {
  type Chapter,
  type LineKind,
  type Next,
  type ProductionLine,
  type ProductionScript,
  hashOf,
  pauseMs,
  plain,
  productionScript,
} from "./script";
export { GAPS, chapterSsml, lineSsml, ssmlDocument, styleFor, xml } from "./ssml";
