/**
 * Config Tests for Memory Plugin
 *
 * Tests the model configuration and dimension validation including:
 * - OpenAI embedding models
 * - VoyageAI voyage-4 family models
 */

import { describe, expect, test } from "vitest";
import { vectorDimsForModel, memoryConfigSchema } from "./config.js";

describe("vectorDimsForModel", () => {
  describe("OpenAI models", () => {
    test("text-embedding-3-small returns 1536 dimensions", () => {
      expect(vectorDimsForModel("text-embedding-3-small")).toBe(1536);
    });

    test("text-embedding-3-large returns 3072 dimensions", () => {
      expect(vectorDimsForModel("text-embedding-3-large")).toBe(3072);
    });
  });

  describe("VoyageAI voyage-4 family", () => {
    test("voyage-4 returns 1024 dimensions", () => {
      expect(vectorDimsForModel("voyage-4")).toBe(1024);
    });

    test("voyage-4-lite returns 1024 dimensions", () => {
      expect(vectorDimsForModel("voyage-4-lite")).toBe(1024);
    });

    test("voyage-4-large returns 1024 dimensions", () => {
      expect(vectorDimsForModel("voyage-4-large")).toBe(1024);
    });
  });

  describe("unsupported models", () => {
    test("throws error for unknown model", () => {
      expect(() => vectorDimsForModel("unknown-model")).toThrow(
        "Unsupported embedding model: unknown-model",
      );
    });
  });
});

describe("memoryConfigSchema", () => {
  describe("VoyageAI voyage-4 family model validation", () => {
    test("accepts voyage-4 as model", () => {
      const config = memoryConfigSchema.parse({
        embedding: {
          apiKey: "test-key",
          model: "voyage-4",
        },
      });
      expect(config.embedding.model).toBe("voyage-4");
    });

    test("accepts voyage-4-lite as model", () => {
      const config = memoryConfigSchema.parse({
        embedding: {
          apiKey: "test-key",
          model: "voyage-4-lite",
        },
      });
      expect(config.embedding.model).toBe("voyage-4-lite");
    });

    test("accepts voyage-4-large as model", () => {
      const config = memoryConfigSchema.parse({
        embedding: {
          apiKey: "test-key",
          model: "voyage-4-large",
        },
      });
      expect(config.embedding.model).toBe("voyage-4-large");
    });
  });
});
