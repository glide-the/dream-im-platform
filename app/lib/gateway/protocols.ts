import { z } from "zod";

const anthropicContentBlockSchema = z.object({
  type: z.string().min(1),
}).passthrough();
const anthropicMessageItemSchema = z.object({
  // Claude Code 2.1.220 emits message-level system control entries when it
  // calls /v1/messages?beta=true. Anthropic-compatible providers such as
  // DeepSeek accept this Claude Code shape; cross-protocol adapters normalize
  // these entries into the OpenAI system prefix.
  role: z.enum(["user", "assistant", "system"]),
  content: z.union([z.string(), z.array(anthropicContentBlockSchema)]),
}).strict();
const anthropicToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()),
}).passthrough();

const openAIMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool", "function"]),
  content: z.unknown().optional().nullable(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  function_call: z.unknown().optional(),
  refusal: z.string().optional().nullable(),
  audio: z.unknown().optional(),
}).strict();
const openAIToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }).strict(),
}).strict();

export const anthropicMessageSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    max_tokens: z.number().int().positive().max(1_000_000),
    messages: z.array(anthropicMessageItemSchema).min(1).max(100_000),
    stream: z.boolean().optional().default(false),
    system: z.union([z.string(), z.array(anthropicContentBlockSchema)]).optional(),
    tools: z.array(anthropicToolSchema).optional(),
    tool_choice: z.object({ type: z.enum(["auto", "any", "tool", "none"]), name: z.string().optional(), disable_parallel_tool_use: z.boolean().optional() }).strict().optional(),
    stop_sequences: z.array(z.string()).max(64).optional(),
    temperature: z.number().min(0).max(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const anthropicCountTokensSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    messages: z.array(anthropicMessageItemSchema).min(1).max(100_000),
    system: z.union([z.string(), z.array(anthropicContentBlockSchema)]).optional(),
    tools: z.array(anthropicToolSchema).optional(),
  })
  .passthrough();

export const openAIChatCompletionSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    messages: z.array(openAIMessageSchema).min(1).max(100_000),
    stream: z.boolean().optional().default(false),
    max_completion_tokens: z.number().int().positive().max(1_000_000).nullish(),
    max_tokens: z.number().int().positive().max(1_000_000).nullish(),
    n: z.number().int().min(1).max(8).nullish(),
    tools: z.array(openAIToolSchema).optional(),
    tool_choice: z.union([z.enum(["none", "auto", "required"]), z.object({ type: z.literal("function"), function: z.object({ name: z.string().min(1) }).strict() }).strict()]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: z.union([z.string(), z.array(z.string()).max(4)]).nullish(),
    response_format: z.record(z.string(), z.unknown()).optional(),
    stream_options: z.object({ include_usage: z.boolean().optional() }).passthrough().optional(),
    parallel_tool_calls: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((body, context) => {
    if (body.max_completion_tokens != null && body.max_tokens != null) {
      context.addIssue({
        code: "custom",
        path: ["max_completion_tokens"],
        message: "max_completion_tokens and max_tokens cannot both be set",
      });
    }
  });

export type AnthropicMessageBody = z.infer<typeof anthropicMessageSchema>;
export type AnthropicCountTokensBody = z.infer<
  typeof anthropicCountTokensSchema
>;
export type OpenAIChatCompletionBody = z.infer<
  typeof openAIChatCompletionSchema
>;
