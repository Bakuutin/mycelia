import { apiClient } from "./api";
import { ChatOpenAI } from "@langchain/openai";

export type ModelSize = "small" | "medium" | "large";

export function getLLM(alias: ModelSize): ChatOpenAI {
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
