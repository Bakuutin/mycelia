import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "bson";
import { tracer, meter } from "@/lib/telemetry.ts";

const llmRequestCounter = meter.createCounter("llm_requests_total", {
  description: "Total number of LLM requests",
});

const llmRequestDuration = meter.createHistogram("llm_request_duration_seconds", {
  description: "Duration of LLM requests",
  unit: "s",
});

const llmErrorsCounter = meter.createCounter("llm_errors_total", {
  description: "Total number of LLM errors",
});

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "function"]),
  content: z.string(),
  name: z.string().optional(),
});

const chatCompletionRequestSchema = z.object({
  action: z.literal("completions"),
  model: z.string(),
  messages: z.array(messageSchema),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  max_tokens: z.number().int().positive().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
});

const llmRequestSchema = z.discriminatedUnion("action", [
  chatCompletionRequestSchema,
]);

type LLMRequest = z.infer<typeof llmRequestSchema>;
type LLMResponse = any | Response;

type Model = {
  _id: ObjectId;
  alias: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
};

export class LLMResource implements Resource<LLMRequest, LLMResponse> {
  code = "tech.mycelia.llm";
  description = "LLM chat completions";
  schemas: {
    request: z.ZodType<LLMRequest>;
    response: z.ZodType<LLMResponse>;
  } = {
    request: llmRequestSchema as z.ZodType<LLMRequest>,
    response: z.any() as z.ZodType<LLMResponse>,
  };

  async getModel(model: string): Promise<Model | null> {
    const rootDb = await getRootDB();
    const modelsCollection = rootDb.collection("llm_models");
    return await modelsCollection.findOne({ alias: model }) as Model | null;
  }

  async use(input: LLMRequest, auth: Auth): Promise<LLMResponse> {
    const startTime = performance.now();
    const span = tracer.startSpan("llm_resource_use", {
      attributes: {
        "llm.action": input.action,
        "llm.model": input.model,
      },
    });

    try {
      llmRequestCounter.add(1, { action: input.action, model: input.model });
      
      switch (input.action) {
        case "completions": {
          const { action, ...body } = input;
          
          const model = await this.getModel(input.model);
          if (!model) {
            llmErrorsCounter.add(1, { error_type: "model_not_found", model: input.model });
            span.setStatus({ code: 2, message: `Model ${input.model} not found` });
            throw new Error(`Model ${input.model} not found`);
          }
          
          span.setAttributes({
            "llm.model_alias": model.alias,
            "llm.model_name": model.name,
            "llm.provider": model.provider,
            "llm.has_api_key": !!model.apiKey,
          });
          
          const requestBody = {
            ...body,
            model: model.name,
          };
          
          const proxyResponse = await fetch(model.baseUrl.replace(/\/$/, '') + '/chat/completions', {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${model.apiKey}`,
            },
            body: JSON.stringify({
              ...requestBody,
              model: model.name,
            }),
          });

          span.setAttributes({
            "llm.response_status": proxyResponse.status,
            "llm.response_ok": proxyResponse.ok,
          });

          if (!proxyResponse.ok) {
            const errorBody = await proxyResponse.text();
            llmErrorsCounter.add(1, { 
              error_type: "api_error", 
              model: input.model,
              status_code: proxyResponse.status.toString()
            });
            span.setStatus({ code: 2, message: `API error: ${proxyResponse.status}` });
            throw new Error(`Failed to get model ${input.model}: ${errorBody}`);
          }
          
          // Check if streaming is requested
          if (input.stream) {
            span.setStatus({ code: 1 }); // Success
            return new Response(proxyResponse.body, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              },
            });
          }
          
          const responseText = await proxyResponse.text();
          
          try {
            const jsonResponse = JSON.parse(responseText);
            span.setStatus({ code: 1 }); // Success
            return jsonResponse;
          } catch (parseError) {
            llmErrorsCounter.add(1, { 
              error_type: "json_parse_error", 
              model: input.model 
            });
            const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parse error';
            span.setStatus({ code: 2, message: `JSON parse error: ${errorMessage}` });
            throw new Error(`Invalid JSON response from model: ${errorMessage}`);
          }
        }
        default:
          llmErrorsCounter.add(1, { error_type: "unknown_action", action: input.action });
          span.setStatus({ code: 2, message: "Unknown action" });
          throw new Error("Unknown action");
      }
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      const duration = (performance.now() - startTime) / 1000;
      llmRequestDuration.record(duration, { 
        action: input.action, 
        model: input.model 
      });
      span.setAttributes({ "llm.duration_seconds": duration });
      span.end();
    }
  }

  extractActions(input: LLMRequest) {
    return [{
      path: ["llm", "chat"],
      actions: [input.action],
    }, {
      path: ["llm", "models", input.model],
      actions: [input.action],
    }];
  }
}

export async function getLLMResource(
  auth: Auth,
): Promise<(input: LLMRequest) => Promise<LLMResponse>> {
  return auth.getResource("tech.mycelia.llm");
}
