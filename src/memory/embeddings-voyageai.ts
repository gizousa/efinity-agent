import { VoyageAIClient } from "voyageai";

import { requireApiKey, resolveApiKeyForProvider } from "../agents/model-auth.js";
import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";

export type VoyageAiEmbeddingClient = {
  apiKey: string;
  model: string;
  client: VoyageAIClient;
};

export const DEFAULT_VOYAGEAI_EMBEDDING_MODEL = "voyage-4";

const VOYAGEAI_MODELS = new Set([
  "voyage-4",
  "voyage-4-lite",
  "voyage-4-large",
  // Legacy models
  "voyage-3",
  "voyage-3-lite",
  "voyage-3-large",
  "voyage-code-3",
  "voyage-finance-2",
  "voyage-multilingual-2",
  "voyage-law-2",
  "voyage-large-2",
  "voyage-code-2",
]);

export function isVoyageAiModel(model: string): boolean {
  return VOYAGEAI_MODELS.has(model) || model.startsWith("voyage-");
}

export function normalizeVoyageAiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_VOYAGEAI_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("voyageai/")) {
    return trimmed.slice("voyageai/".length);
  }
  if (trimmed.startsWith("voyage/")) {
    return trimmed.slice("voyage/".length);
  }
  return trimmed;
}

export async function createVoyageAiEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: VoyageAiEmbeddingClient }> {
  const client = await resolveVoyageAiEmbeddingClient(options);

  const embedQuery = async (text: string): Promise<number[]> => {
    if (!text.trim()) {
      return [];
    }
    const result = await client.client.embed({
      model: client.model,
      input: [text],
      inputType: "query",
    });
    return result.data?.[0]?.embedding ?? [];
  };

  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) {
      return [];
    }
    const result = await client.client.embed({
      model: client.model,
      input: texts,
      inputType: "document",
    });
    return texts.map((_, index) => result.data?.[index]?.embedding ?? []);
  };

  return {
    provider: {
      id: "voyageai",
      model: client.model,
      embedQuery,
      embedBatch,
    },
    client,
  };
}

function resolveRemoteApiKey(remoteApiKey?: string): string | undefined {
  const trimmed = remoteApiKey?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "VOYAGE_API_KEY") {
    return process.env.VOYAGE_API_KEY?.trim();
  }
  return trimmed;
}

export async function resolveVoyageAiEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<VoyageAiEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = resolveRemoteApiKey(remote?.apiKey);

  const apiKey = remoteApiKey
    ? remoteApiKey
    : requireApiKey(
        await resolveApiKeyForProvider({
          provider: "voyageai",
          cfg: options.config,
          agentDir: options.agentDir,
        }),
        "voyageai",
      );

  const model = normalizeVoyageAiModel(options.model);
  const client = new VoyageAIClient({ apiKey });

  return { apiKey, model, client };
}
