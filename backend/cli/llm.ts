import { CliConfig, getUrl } from "./config.ts";
import { getJWT } from "./utils.ts";

interface Model {
  alias: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
}

async function fetchWithAuth(url: string, options: RequestInit, config: CliConfig) {
  const accessToken = await getJWT(config);
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}

export async function handleLLMAdd(
  config: CliConfig,
  options: {
    alias: string;
    name: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
  },
) {
  const response = await fetchWithAuth(
    getUrl("/api/resource/llm"),
    {
      method: "POST",
      body: JSON.stringify({
        action: "addModel",
        model: {
          alias: options.alias,
          name: options.name,
          provider: options.provider,
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
        },
      }),
    },
    config,
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to add model:", error);
    return;
  }

  console.log(`✓ Model "${options.alias}" added successfully`);
  console.log(`  Name: ${options.name}`);
  console.log(`  Provider: ${options.provider}`);
  console.log(`  Base URL: ${options.baseUrl}`);
}

export async function handleLLMList(config: CliConfig) {
  const response = await fetchWithAuth(
    getUrl("/api/resource/llm"),
    {
      method: "POST",
      body: JSON.stringify({ action: "listModels" }),
    },
    config,
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to list models:", error);
    return;
  }

  const models: Model[] = await response.json();

  if (models.length === 0) {
    console.log("No models configured");
    return;
  }

  console.log("Configured LLM models:\n");
  for (const model of models) {
    console.log(`  ${model.alias}`);
    console.log(`    Name: ${model.name}`);
    console.log(`    Provider: ${model.provider}`);
    console.log(`    Base URL: ${model.baseUrl}`);
    console.log("");
  }
}

export async function handleLLMTest(config: CliConfig, alias: string) {
  console.log(`Testing model "${alias}"...`);

  const response = await fetchWithAuth(
    getUrl("/llm/chat/completions"),
    {
      method: "POST",
      body: JSON.stringify({
        model: alias,
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 10,
      }),
    },
    config,
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("✗ Test failed:", error);
    return;
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || "No response";

  console.log(`✓ Model responded: "${content}"`);
}

export async function handleLLMRemove(config: CliConfig, alias: string) {
  const response = await fetchWithAuth(
    getUrl("/api/resource/llm"),
    {
      method: "POST",
      body: JSON.stringify({
        action: "removeModel",
        alias,
      }),
    },
    config,
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to remove model:", error);
    return;
  }

  console.log(`✓ Model "${alias}" removed`);
}

// Quick setup for Ollama remote server
export async function handleLLMOllamaSetup(
  config: CliConfig,
  serverUrl: string,
  options: { models?: string },
) {
  const models = options.models?.split(",").map((m) => m.trim()) || ["qwen2.5:7b"];
  const baseUrl = serverUrl.replace(/\/$/, "") + "/v1";

  console.log(`Setting up Ollama server at ${serverUrl}`);
  console.log(`Models to configure: ${models.join(", ")}`);
  console.log("");

  // First, verify server is accessible
  try {
    const tagsResponse = await fetch(`${serverUrl.replace(/\/$/, "")}/api/tags`);
    if (!tagsResponse.ok) {
      console.error("✗ Cannot reach Ollama server");
      return;
    }
    const tags = await tagsResponse.json();
    console.log(`✓ Ollama server accessible. Available models: ${tags.models?.map((m: any) => m.name).join(", ") || "none"}`);
  } catch (e) {
    console.error(`✗ Cannot connect to ${serverUrl}:`, e);
    return;
  }

  // Map models to aliases
  const aliasMap: Record<string, string> = {
    "small": models[0],
    "medium": models[1] || models[0],
    "large": models[2] || models[1] || models[0],
  };

  for (const [alias, name] of Object.entries(aliasMap)) {
    await handleLLMAdd(config, {
      alias,
      name,
      provider: "ollama",
      baseUrl,
      apiKey: "ollama",
    });
  }

  console.log("\n✓ Ollama setup complete!");
  console.log("  Test with: deno task cli llm test small");
}
