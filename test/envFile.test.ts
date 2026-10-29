import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeEnvValues } from "../src/lib/envFile";

function tmpEnv(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-env-"));
  return path.join(dir, ".env");
}

describe("writeEnvValues", () => {
  it("updates existing keys and appends new ones, preserving comments", () => {
    const file = tmpEnv();
    fs.writeFileSync(file, "# keep me\nFOO=bar\nAI_SEEDREAM_API_KEY=old\n");
    writeEnvValues({ AI_SEEDREAM_API_KEY: "new-key", AI_OPENAI_API_KEY: "abc" }, file);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("# keep me");
    expect(content).toContain("FOO=bar");
    expect(content).toContain("AI_SEEDREAM_API_KEY=new-key");
    expect(content).toContain("AI_OPENAI_API_KEY=abc");
    expect(content).not.toContain("old");
    delete process.env.AI_OPENAI_API_KEY;
  });

  it("creates the file when missing and syncs process.env", () => {
    const file = tmpEnv();
    writeEnvValues({ AI_TEST_KEY: "v" }, file);
    expect(fs.readFileSync(file, "utf-8")).toContain("AI_TEST_KEY=v");
    expect(process.env.AI_TEST_KEY).toBe("v");
    delete process.env.AI_TEST_KEY;
  });

  it("quotes values containing spaces", () => {
    const file = tmpEnv();
    writeEnvValues({ SOME_KEY: "a b" }, file);
    expect(fs.readFileSync(file, "utf-8")).toContain('SOME_KEY="a b"');
    delete process.env.SOME_KEY;
  });

  it("escapes backslashes and rejects newline injection", () => {
    const file = tmpEnv();
    writeEnvValues({ SOME_KEY: 'a\\"b' }, file);
    expect(fs.readFileSync(file, "utf-8")).toContain('SOME_KEY="a\\\\\\"b"');
    expect(() => writeEnvValues({ BAD_KEY: "a\nb" }, file)).toThrow(/newlines/);
    delete process.env.SOME_KEY;
  });
});
