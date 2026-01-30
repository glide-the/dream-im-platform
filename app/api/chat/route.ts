// app/api/chat/route.ts
// Reference: cgoinglove/better-chatbot src/app/api/chat/route.ts
import { NextRequest } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UIMessage,
} from "ai";
import {
  createAgentRunner,
  SimpleClaudeAgentSDKClient,
  type AgentStreamingCallbacks,
} from "../../lib/claude-agent-kit/server";
import {
  createConversation,
  updateConversation,
  getConversationById,
} from "../../lib/db";
import { createId } from "../../lib/id";
import type { Conversation } from "../../lib/types";

export const runtime = "nodejs";

const DEFAULT_MAX_TURNS = Number(process.env.MAX_TURNS) || 10;

// Request body format aligned with AI SDK's DefaultChatTransport
// The transport sends: { id, messages, trigger, messageId, ...body }
type ChatRequestBody = {
  id: string;                    // Chat/conversation ID
  messages: UIMessage[];          // All messages including the new user message
  trigger?: "submit-message" | "regenerate-message";
  messageId?: string;
  // Custom body fields from our transport configuration
  customerId?: string;
};

// Helper type for message parts - supports both text parts and reasoning parts
type MessagePart = {
  type: "text" | "reasoning" | "step-start";
  text?: string;
  state?: "done" | "streaming";
};

// Extract text content from UIMessage parts
function extractTextFromParts(parts: UIMessage["parts"]): string {
  if (!parts || !Array.isArray(parts)) return "";
  
  return parts
    .filter((part): part is { type: "text"; text: string } => 
      part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("");
}

// Convert UIMessage parts to our storage format
function convertToStorageParts(parts: UIMessage["parts"]): MessagePart[] {
  if (!parts || !Array.isArray(parts)) return [];
  
  return parts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text,
        state: "done" as const,
      };
    }
    if (part.type === "reasoning") {
      return {
        type: "reasoning" as const,
        text: (part as { type: "reasoning"; text: string }).text,
        state: "done" as const,
      };
    }
    // Handle other part types as needed
    return {
      type: part.type as "text" | "reasoning" | "step-start",
      text: (part as { text?: string }).text,
      state: "done" as const,
    };
  });
}

function badRequest(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;

  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return badRequest("Invalid request body");
  }

  // Get the last message from the messages array
  const messages = body.messages;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return badRequest("Empty message");
  }

  // Get the latest user message
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return badRequest("Last message must be from user");
  }

  // Extract text content from the message parts
  const messageText = extractTextFromParts(lastMessage.parts);
  if (!messageText.trim()) {
    return badRequest("Empty message content");
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY is not configured. Please set it in .env.local",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const customerId = body.customerId ?? null;
  const now = new Date().toISOString();

  // Use the ID from the request (from DefaultChatTransport) or create a new one
  const conversationId = body.id || createId("conv");

  // Check if conversation exists
  const existingConversation = await getConversationById(conversationId);

  // Store the original messages for context
  const originalMessages = messages;

  // Create streaming response using ai SDK (following better-chatbot pattern)
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Create Claude Agent Runner
      const sdkClient = new SimpleClaudeAgentSDKClient();
      const agentRunner = createAgentRunner(sdkClient);

      let fullText = "";
      const assistantMessageId = lastMessage.id 
        ? `${lastMessage.id}-response` 
        : createId("msg");
      let hasStarted = false;

      // Collect parts for the response message
      const responseParts: MessagePart[] = [];

      // Set up callbacks to stream to UI
      const callbacks: AgentStreamingCallbacks = {
        onTextDelta: async (delta: string) => {
          // Send text-start on first delta
          if (!hasStarted) {
            // Send step-start event
            writer.write({
              type: "step-start",
              id: assistantMessageId,
            } as unknown as Parameters<typeof writer.write>[0]);
            
            writer.write({
              type: "text-start",
              id: assistantMessageId,
            });
            hasStarted = true;
          }

          fullText += delta;
          writer.write({
            type: "text-delta",
            id: assistantMessageId,
            delta: delta,
          });
        },
        onTextDone: async () => {
          // Send text-end
          if (hasStarted) {
            writer.write({
              type: "text-end",
              id: assistantMessageId,
            });
          }

          // Add the text part to response parts
          if (fullText) {
            responseParts.push({
              type: "text",
              text: fullText,
              state: "done",
            });
          }
        },
        onError: async (error: Error) => {
          writer.write({
            type: "error",
            errorText: error.message,
          });
        },
      };

      try {
        // Run the agent
        await agentRunner.runStreaming(
          {
            threadId: conversationId,
            userMessage: messageText,
            maxTurns: DEFAULT_MAX_TURNS,
            allowedTools: [], // Disable tools for now
          },
          callbacks
        );

        // Finish the message
        writer.write({
          type: "finish",
          finishReason: "stop",
        });
      } catch (error) {
        console.error("Agent run error:", error);
        writer.write({
          type: "error",
          errorText:
            error instanceof Error ? error.message : "Unknown error occurred",
        });
      }
    },

    // onFinish callback - save messages to database (following better-chatbot pattern)
    onFinish: async ({ responseMessage }) => {
      try {
        // Convert the user message parts for storage
        const userMessageParts = convertToStorageParts(lastMessage.parts);
        
        // Convert the response message parts for storage
        const assistantMessageParts = responseMessage.parts 
          ? convertToStorageParts(responseMessage.parts)
          : [{ type: "text" as const, text: extractTextFromParts(responseMessage.parts), state: "done" as const }];

        // Build the messages array for storage
        const storedMessages = [
          ...((existingConversation?.messages || []).map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            parts: (m as unknown as { parts?: MessagePart[] }).parts,
            created_at: m.created_at,
          }))),
          {
            id: lastMessage.id || createId("msg"),
            role: "user" as const,
            content: messageText,
            parts: userMessageParts,
            created_at: now,
          },
          {
            id: responseMessage.id || createId("msg"),
            role: "assistant" as const,
            content: extractTextFromParts(responseMessage.parts),
            parts: assistantMessageParts,
            created_at: new Date().toISOString(),
          },
        ];

        const conversationData: Conversation = {
          id: conversationId,
          title: existingConversation?.title ?? "与 AI 的对话",
          status: "pending",
          created_at: existingConversation?.created_at ?? now,
          updated_at: new Date().toISOString(),
          messages: storedMessages,
          attachments: existingConversation?.attachments,
          context_customer_ids: existingConversation?.context_customer_ids ??
            (customerId ? [customerId] : []),
          ai_outputs: existingConversation?.ai_outputs,
          linked_customer_id:
            existingConversation?.linked_customer_id ?? customerId ?? undefined,
        };

        if (existingConversation) {
          await updateConversation(conversationData);
        } else {
          await createConversation(conversationData);
        }

        console.log(`[Chat API] Conversation ${conversationId} saved with ${storedMessages.length} messages`);
      } catch (error) {
        console.error("[Chat API] Failed to save conversation:", error);
      }
    },

    onError: (error) => {
      console.error("[Chat API] Stream error:", error);
      return error instanceof Error ? error.message : "Unknown error";
    },

    // Pass original messages for context
    originalMessages: originalMessages,
  });

  // Return streaming response
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "X-Conversation-Id": conversationId,
    },
  });
}
