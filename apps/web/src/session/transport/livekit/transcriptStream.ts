/** Text-stream topic livekit-agents publishes agent transcriptions on. */
export const TRANSCRIPTION_TOPIC = "lk.transcription";
/** Stream attribute carrying the transcript segment id (stable across a turn). */
export const SEGMENT_ID_ATTRIBUTE = "lk.segment_id";

/**
 * Fold one `lk.transcription` text stream (agents publishes it as a delta stream:
 * each chunk extends the segment) into a growing line. `onText` fires with the
 * accumulated text on every chunk (`final: false`) and once more when the stream
 * closes (`final: true`).
 */
export async function readTranscriptStream(
  chunks: AsyncIterable<string>,
  onText: (text: string, final: boolean) => void,
): Promise<void> {
  let text = "";
  for await (const chunk of chunks) {
    text += chunk;
    onText(text, false);
  }
  onText(text, true);
}
