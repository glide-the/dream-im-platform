import { z } from "zod";

export const anthropicMessageSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    max_tokens: z.number().int().positive().max(1_000_000),
    messages: z.array(z.unknown()).min(1).max(100_000),
    stream: z.boolean().optional().default(false),
  })
  .passthrough();

export const anthropicCountTokensSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    messages: z.array(z.unknown()).min(1).max(100_000),
  })
  .passthrough();

export const openAIChatCompletionSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    messages: z.array(z.unknown()).min(1).max(100_000),
    stream: z.boolean().optional().default(false),
    max_completion_tokens: z.number().int().positive().max(1_000_000).nullish(),
    max_tokens: z.number().int().positive().max(1_000_000).nullish(),
    n: z.number().int().min(1).max(8).nullish(),
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
