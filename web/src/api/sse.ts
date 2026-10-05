/**
 * Minimal Server-Sent Events parser.
 *
 * Pure string processing (no DOM/fetch), shared by the typed generation
 * client and unit-tested independently. Mirrors the SSE framing used by
 * `/api/generate/stream`: blocks separated by a blank line, with optional
 * `id:` / `event:` / `data:` fields.
 */

export type SseEvent = {
  event: string;
  data: string;
  id?: string;
};

export class SseParser {
  private buffer = "";

  /**
   * Feed a decoded chunk and drain any complete events from the buffer.
   * CRLF is normalised to LF before framing.
   */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: SseEvent[] = [];

    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);

      if (!block.trim()) continue;

      let event = "message";
      let data = "";
      let id: string | undefined;

      for (const line of block.split("\n")) {
        if (line.startsWith("id:")) {
          id = line.slice(3).trim();
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += (data ? "\n" : "") + line.slice(5).trim();
        }
      }

      // SSE events without a data payload carry nothing useful here.
      if (!data) continue;

      events.push({ event, data, id });
    }

    return events;
  }
}
