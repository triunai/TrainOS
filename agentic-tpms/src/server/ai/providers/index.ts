import { anthropicChat } from "./anthropic";
import { openAiCompatibleChat } from "./openai-compatible";
import type { CallOptions, ChatRequest, ChatResult, ProviderCredential, ProviderId } from "./types";

export * from "./types";
export { setFetchForTests, resetFetch } from "./http";
export { EMBEDDING_DIMENSIONS, openAiEmbeddings, type EmbeddingsResult } from "./embeddings";
export type { OpenAiFamily } from "./openai-compatible";

/** The single dispatch from a provider id to its adapter. Exhaustive: a new id is a compile error here. */
export function callChat(
  provider: ProviderId,
  credential: ProviderCredential,
  req: ChatRequest,
  opts: CallOptions = {},
): Promise<ChatResult> {
  switch (provider) {
    case "anthropic":
      return anthropicChat(credential, req, opts);
    case "openrouter":
    case "deepseek":
    case "gemini":
    case "openai-compatible":
      return openAiCompatibleChat(provider, credential, req, opts);
    default: {
      const unreachable: never = provider;
      throw new Error(`Unknown provider: ${String(unreachable)}`);
    }
  }
}
