import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManagedHttpAiProvider, stopManagedHttpProviders } from "../src/services/ai/providers/managedHttp";

async function getFreePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

describe("managed http ai provider", () => {
  it("auto-starts the configured local provider before generation", async () => {
    const port = await getFreePort();
    const endpoint = `http://127.0.0.1:${port}/generate`;
    const provider = new ManagedHttpAiProvider(endpoint, undefined, {
      command: process.execPath,
      args: [path.join(process.cwd(), "test/fixtures/lazy-http-provider-server.mjs"), String(port)],
      healthUrl: `http://127.0.0.1:${port}/health`,
      startupTimeoutMs: 5000,
      idleMs: 10
    });

    const out = await provider.generateImage({
      prompt: "lazy",
      width: 64,
      height: 64
    });

    expect(out.mime).toContain("image/png");
    expect(out.bytes.length).toBeGreaterThan(0);
  });

  it("stops auto-started providers during cleanup", async () => {
    const port = await getFreePort();
    const endpoint = `http://127.0.0.1:${port}/generate`;
    const provider = new ManagedHttpAiProvider(endpoint, undefined, {
      command: process.execPath,
      args: [path.join(process.cwd(), "test/fixtures/lazy-http-provider-server.mjs"), String(port)],
      healthUrl: `http://127.0.0.1:${port}/health`,
      startupTimeoutMs: 5000,
      idleMs: 0
    });

    await provider.generateImage({
      prompt: "cleanup",
      width: 64,
      height: 64
    });

    let health = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
    expect(health?.ok).toBe(true);

    stopManagedHttpProviders();
    await new Promise((resolve) => setTimeout(resolve, 100));
    health = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
    expect(health).toBeUndefined();
  });

  it("calls the configured cancel endpoint when generation is aborted", async () => {
    const port = await getFreePort();
    const endpoint = `http://127.0.0.1:${port}/generate`;
    const provider = new ManagedHttpAiProvider(endpoint, undefined, {
      command: process.execPath,
      args: [path.join(process.cwd(), "test/fixtures/lazy-http-provider-server.mjs"), String(port)],
      healthUrl: `http://127.0.0.1:${port}/health`,
      cancelUrl: `http://127.0.0.1:${port}/cancel`,
      startupTimeoutMs: 5000,
      idleMs: 0
    });

    const controller = new AbortController();
    const pending = provider.generateImage(
      {
        prompt: "slow",
        width: 64,
        height: 64
      },
      controller.signal
    );
    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toBeTruthy();
    const canceled = await fetch(`http://127.0.0.1:${port}/canceled`).then((res) => res.json());
    expect(canceled).toEqual({ canceled: true });
    stopManagedHttpProviders();
  });
});
