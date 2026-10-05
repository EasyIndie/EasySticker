import { describe, it, expect } from "vitest";
import { SseParser } from "../web/src/api/sse";

describe("SseParser", () => {
  it("parses a single event with data", () => {
    const parser = new SseParser();
    expect(parser.push('event: sticker\ndata: {"label":"01"}\n\n')).toEqual([
      { event: "sticker", data: '{"label":"01"}', id: undefined }
    ]);
  });

  it("defaults missing event name to message", () => {
    const parser = new SseParser();
    expect(parser.push('data: hello\n\n')).toEqual([
      { event: "message", data: "hello", id: undefined }
    ]);
  });

  it("joins multiple data lines with newline", () => {
    const parser = new SseParser();
    expect(parser.push('event: done\ndata: a\ndata: b\n\n')).toEqual([
      { event: "done", data: "a\nb", id: undefined }
    ]);
  });

  it("normalises CRLF framing", () => {
    const parser = new SseParser();
    expect(parser.push('event: progress\ndata: 1\r\n\r\n')).toEqual([
      { event: "progress", data: "1", id: undefined }
    ]);
  });

  it("extracts numeric id", () => {
    const parser = new SseParser();
    expect(parser.push('id: 7\nevent: start\ndata: {"count":8}\n\n')).toEqual([
      { event: "start", data: '{"count":8}', id: "7" }
    ]);
  });

  it("accumulates partial chunks until a blank line", () => {
    const parser = new SseParser();
    expect(parser.push('event: extra\ndata: {"ke')).toEqual([]);
    expect(parser.push('y":"cover"}\n\n')).toEqual([
      { event: "extra", data: '{"key":"cover"}', id: undefined }
    ]);
  });

  it("skips blocks with no data", () => {
    const parser = new SseParser();
    expect(parser.push('event: progress\n\n')).toEqual([]);
    expect(parser.push('data: ok\n\n')).toEqual([
      { event: "message", data: "ok", id: undefined }
    ]);
  });
});
