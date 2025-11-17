import { apiClient } from "./api";
import { ChatOpenAI } from "@langchain/openai";

// Keep ModelSize for backward compatibility, but allow any string
export type ModelSize = "small" | "medium" | "large" | string;

export function getLLM(alias: ModelSize | string): ChatOpenAI {
  return new ChatOpenAI({
    model: alias,
    configuration: {
      apiKey: "dummy-api-key",
      baseURL: apiClient.baseURL + "/llm",
      fetch: async (url, init) => {
        url = new URL(url.toString());
        return apiClient.fetch(url.pathname, init);
      },
    },
  });
}
