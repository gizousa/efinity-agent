/**
 * VoyageAI voyage-4 Family Live Integration Tests
 *
 * Tests real API calls to VoyageAI embedding endpoints using the official SDK.
 * Requires VOYAGE_API_KEY environment variable.
 *
 * Run with: VOYAGE_API_KEY=your-key pnpm test:live src/memory/embeddings-voyageai.live.test.ts
 */

import { describe, expect, test } from "vitest";
import { VoyageAIClient } from "voyageai";
import { vectorDimsForModel } from "../../extensions/memory-lancedb/config.js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? "";
const HAS_VOYAGE_KEY = Boolean(process.env.VOYAGE_API_KEY);
const liveEnabled =
  HAS_VOYAGE_KEY && (process.env.CLAWDBOT_LIVE_TEST === "1" || process.env.LIVE === "1");
const describeLive = liveEnabled ? describe : describe.skip;

describeLive("VoyageAI voyage-4 family live tests", () => {
  const client = new VoyageAIClient({ apiKey: VOYAGE_API_KEY });

  describe("voyage-4", () => {
    test("returns embedding with correct dimensions", async () => {
      const result = await client.embed({
        model: "voyage-4",
        input: ["Hello, world!"],
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].embedding).toBeInstanceOf(Array);
      expect(result.data[0].embedding.length).toBe(vectorDimsForModel("voyage-4"));
      expect(result.model).toBe("voyage-4");
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    }, 30000);

    test("handles multilingual input", async () => {
      const result = await client.embed({
        model: "voyage-4",
        input: ["Hello world. Bonjour le monde. Hola mundo."],
      });

      expect(result.data[0].embedding.length).toBe(1024);
    }, 30000);

    test("supports query input type", async () => {
      const result = await client.embed({
        model: "voyage-4",
        input: ["What is the meaning of life?"],
        inputType: "query",
      });

      expect(result.data[0].embedding.length).toBe(1024);
    }, 30000);
  });

  describe("voyage-4-lite", () => {
    test("returns embedding with correct dimensions", async () => {
      const result = await client.embed({
        model: "voyage-4-lite",
        input: ["Hello, world!"],
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].embedding).toBeInstanceOf(Array);
      expect(result.data[0].embedding.length).toBe(vectorDimsForModel("voyage-4-lite"));
      expect(result.model).toBe("voyage-4-lite");
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    }, 30000);

    test("handles batch input", async () => {
      const result = await client.embed({
        model: "voyage-4-lite",
        input: ["First text", "Second text", "Third text"],
        inputType: "document",
      });

      expect(result.data).toHaveLength(3);
      for (const item of result.data) {
        expect(item.embedding.length).toBe(1024);
      }
    }, 30000);
  });

  describe("voyage-4-large", () => {
    test("returns embedding with correct dimensions", async () => {
      const result = await client.embed({
        model: "voyage-4-large",
        input: ["Hello, world!"],
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].embedding).toBeInstanceOf(Array);
      expect(result.data[0].embedding.length).toBe(vectorDimsForModel("voyage-4-large"));
      expect(result.model).toBe("voyage-4-large");
      expect(result.usage?.totalTokens).toBeGreaterThan(0);
    }, 30000);

    test("embedding values are valid floats", async () => {
      const result = await client.embed({
        model: "voyage-4-large",
        input: ["The quick brown fox jumps over the lazy dog."],
      });

      const embedding = result.data[0].embedding;
      for (const value of embedding) {
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value)).toBe(true);
      }
    }, 30000);
  });

  describe("cross-model compatibility", () => {
    test("all voyage-4 models return same dimension count", async () => {
      const [v4, v4Lite, v4Large] = await Promise.all([
        client.embed({ model: "voyage-4", input: ["test"] }),
        client.embed({ model: "voyage-4-lite", input: ["test"] }),
        client.embed({ model: "voyage-4-large", input: ["test"] }),
      ]);

      expect(v4.data[0].embedding.length).toBe(1024);
      expect(v4Lite.data[0].embedding.length).toBe(1024);
      expect(v4Large.data[0].embedding.length).toBe(1024);
    }, 60000);
  });
});
