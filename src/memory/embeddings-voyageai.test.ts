/**
 * VoyageAI Embedding Provider Unit Tests
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agents/model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn(),
  requireApiKey: (auth: { apiKey?: string; mode?: string }, provider: string) => {
    if (auth?.apiKey) {
      return auth.apiKey;
    }
    throw new Error(`No API key resolved for provider "${provider}" (auth mode: ${auth?.mode}).`);
  },
}));

vi.mock("voyageai", () => ({
  VoyageAIClient: vi.fn().mockImplementation(() => ({
    embed: vi.fn().mockResolvedValue({
      data: [{ embedding: Array(1024).fill(0.1) }],
      model: "voyage-4",
      usage: { totalTokens: 10 },
    }),
  })),
}));

describe("VoyageAI embedding provider", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("normalizes voyage model names correctly", async () => {
    const { normalizeVoyageAiModel } = await import("./embeddings-voyageai.js");

    expect(normalizeVoyageAiModel("voyage-4")).toBe("voyage-4");
    expect(normalizeVoyageAiModel("voyage-4-lite")).toBe("voyage-4-lite");
    expect(normalizeVoyageAiModel("voyage-4-large")).toBe("voyage-4-large");
    expect(normalizeVoyageAiModel("voyageai/voyage-4")).toBe("voyage-4");
    expect(normalizeVoyageAiModel("voyage/voyage-4-lite")).toBe("voyage-4-lite");
    expect(normalizeVoyageAiModel("")).toBe("voyage-4");
    expect(normalizeVoyageAiModel("  ")).toBe("voyage-4");
  });

  it("detects voyage models correctly", async () => {
    const { isVoyageAiModel } = await import("./embeddings-voyageai.js");

    expect(isVoyageAiModel("voyage-4")).toBe(true);
    expect(isVoyageAiModel("voyage-4-lite")).toBe(true);
    expect(isVoyageAiModel("voyage-4-large")).toBe(true);
    expect(isVoyageAiModel("voyage-3")).toBe(true);
    expect(isVoyageAiModel("voyage-code-3")).toBe(true);
    expect(isVoyageAiModel("voyage-unknown-new")).toBe(true);
    expect(isVoyageAiModel("text-embedding-3-small")).toBe(false);
    expect(isVoyageAiModel("gemini-embedding-001")).toBe(false);
  });

  it("creates provider with correct model", async () => {
    const { createVoyageAiEmbeddingProvider } = await import("./embeddings-voyageai.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "voyage-test-key",
      mode: "api-key",
      source: "test",
    });

    const result = await createVoyageAiEmbeddingProvider({
      config: {} as never,
      provider: "voyageai",
      model: "voyage-4-large",
      fallback: "none",
    });

    expect(result.provider.id).toBe("voyageai");
    expect(result.provider.model).toBe("voyage-4-large");
    expect(result.client.model).toBe("voyage-4-large");
  });

  it("uses default model when empty", async () => {
    const { createVoyageAiEmbeddingProvider, DEFAULT_VOYAGEAI_EMBEDDING_MODEL } =
      await import("./embeddings-voyageai.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "voyage-test-key",
      mode: "api-key",
      source: "test",
    });

    const result = await createVoyageAiEmbeddingProvider({
      config: {} as never,
      provider: "voyageai",
      model: "",
      fallback: "none",
    });

    expect(result.provider.model).toBe(DEFAULT_VOYAGEAI_EMBEDDING_MODEL);
  });

  it("uses remote apiKey when provided", async () => {
    const { createVoyageAiEmbeddingProvider } = await import("./embeddings-voyageai.js");
    const authModule = await import("../agents/model-auth.js");

    const result = await createVoyageAiEmbeddingProvider({
      config: {} as never,
      provider: "voyageai",
      model: "voyage-4",
      fallback: "none",
      remote: {
        apiKey: "remote-voyage-key",
      },
    });

    expect(authModule.resolveApiKeyForProvider).not.toHaveBeenCalled();
    expect(result.client.apiKey).toBe("remote-voyage-key");
  });

  it("resolves VOYAGE_API_KEY env var shorthand", async () => {
    const originalEnv = process.env.VOYAGE_API_KEY;
    process.env.VOYAGE_API_KEY = "env-voyage-key";

    try {
      const { createVoyageAiEmbeddingProvider } = await import("./embeddings-voyageai.js");

      const result = await createVoyageAiEmbeddingProvider({
        config: {} as never,
        provider: "voyageai",
        model: "voyage-4",
        fallback: "none",
        remote: {
          apiKey: "VOYAGE_API_KEY",
        },
      });

      expect(result.client.apiKey).toBe("env-voyage-key");
    } finally {
      if (originalEnv !== undefined) {
        process.env.VOYAGE_API_KEY = originalEnv;
      } else {
        delete process.env.VOYAGE_API_KEY;
      }
    }
  });

  it("returns empty array for empty text", async () => {
    const { createVoyageAiEmbeddingProvider } = await import("./embeddings-voyageai.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "voyage-test-key",
      mode: "api-key",
      source: "test",
    });

    const result = await createVoyageAiEmbeddingProvider({
      config: {} as never,
      provider: "voyageai",
      model: "voyage-4",
      fallback: "none",
    });

    const embedding = await result.provider.embedQuery("   ");
    expect(embedding).toEqual([]);
  });

  it("returns empty array for empty batch", async () => {
    const { createVoyageAiEmbeddingProvider } = await import("./embeddings-voyageai.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "voyage-test-key",
      mode: "api-key",
      source: "test",
    });

    const result = await createVoyageAiEmbeddingProvider({
      config: {} as never,
      provider: "voyageai",
      model: "voyage-4",
      fallback: "none",
    });

    const embeddings = await result.provider.embedBatch([]);
    expect(embeddings).toEqual([]);
  });
});
