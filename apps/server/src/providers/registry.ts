import type { ChatProvider } from "./types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";

const openai = new OpenAICompatibleProvider({
  id: "openai",
  label: "OpenAI",
  defaultModels: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
  defaultBaseUrl: "https://api.openai.com/v1",
});
const deepseek = new OpenAICompatibleProvider({
  id: "deepseek",
  label: "DeepSeek",
  defaultModels: ["deepseek-chat", "deepseek-reasoner"],
  defaultBaseUrl: "https://api.deepseek.com/v1",
});
const ollama = new OpenAICompatibleProvider({
  id: "ollama",
  label: "Ollama (local)",
  defaultModels: ["llama3.1", "qwen2.5", "gemma2"],
  defaultBaseUrl: "http://localhost:11434/v1",
});
const custom = new OpenAICompatibleProvider({
  id: "custom",
  label: "Custom OpenAI-compatible",
  defaultModels: ["custom-model"],
});
const anthropic = new AnthropicProvider();
const mock = new MockProvider();

const providers: Record<string, ChatProvider> = {
  openai,
  deepseek,
  ollama,
  custom,
  anthropic,
  mock,
};

export function getProvider(id: string): ChatProvider | undefined {
  return providers[id];
}
export function listProviders(): ChatProvider[] {
  return Object.values(providers);
}
