// app/api/chat/route.ts
import { NextRequest } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import {
  createAgentRunner,
  SimpleClaudeAgentSDKClient,
  type AgentStreamingCallbacks,
} from "../../lib/claude-agent-kit/server";
import {
  createConversation,
  updateConversation,
  listConversations,
} from "../../lib/db";
import { createId } from "../../lib/id";
import type { Conversation, ConversationMessage } from "../../lib/types";

export const runtime = "nodejs";

const DEFAULT_MAX_TURNS = Number(process.env.MAX_TURNS) || 10;

type ChatRequestBody = {
  conversationId?: string;
  message: string;
  customerId?: string;
};

function badRequest(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody | null = null;

  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return badRequest("Invalid request body");
  }

  const message = body?.message?.trim();
  if (!message) {
    return badRequest("Empty message");
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

  // Handle conversation - create new or load existing
  let conversationId = body.conversationId;
  let existingMessages: ConversationMessage[] = [];

  if (!conversationId) {
    // Create new conversation
    conversationId = createId("conv");

    const conversation: Conversation = {
      id: conversationId,
      title: "与 AI 的对话",
      status: "pending",
      created_at: now,
      updated_at: now,
      messages: [
        {
          id: createId("msg"),
          role: "user",
          content: message,
          created_at: now,
        },
      ],
      attachments: undefined,
      context_customer_ids: customerId ? [customerId] : [],
      ai_outputs: undefined,
      linked_customer_id: customerId ?? undefined,
    };

    await createConversation(conversation);
  } else {
    // Load existing conversation messages
    const result = await listConversations({
      page: 1,
      pageSize: 100,
      status: undefined,
      search: undefined,
    });
    const existingConversation = result.data.find(
      (c) => c.id === conversationId
    );
    if (existingConversation) {
      existingMessages = existingConversation.messages;
    }

    // Add user message to existing conversation
    const userMessage: ConversationMessage = {
      id: createId("msg"),
      role: "user",
      content: message,
      created_at: now,
    };

    const updatedConversation: Conversation = {
      id: conversationId,
      title: existingConversation?.title ?? "与 AI 的对话",
      status: "pending",
      created_at: existingConversation?.created_at ?? now,
      updated_at: now,
      messages: [...existingMessages, userMessage],
      attachments: existingConversation?.attachments,
      context_customer_ids: existingConversation?.context_customer_ids ??
        (customerId ? [customerId] : []),
      ai_outputs: existingConversation?.ai_outputs,
      linked_customer_id:
        existingConversation?.linked_customer_id ?? customerId ?? undefined,
    };

    await updateConversation(updatedConversation);
    existingMessages = updatedConversation.messages;
  }

  // Create streaming response using ai SDK
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Create Claude Agent Runner
      const sdkClient = new SimpleClaudeAgentSDKClient();
      const agentRunner = createAgentRunner(sdkClient);

      let fullText = "";
      const assistantMessageId = createId("msg");
      let hasStarted = false;

      // Set up callbacks to stream to UI
      const callbacks: AgentStreamingCallbacks = {
        onTextDelta: async (delta: string) => {
          // Send text-start on first delta
          if (!hasStarted) {
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

          // Save assistant message to conversation
          const assistantMessage: ConversationMessage = {
            id: assistantMessageId,
            role: "assistant",
            content: fullText,
            created_at: new Date().toISOString(),
          };

          const updatedMessages = [...existingMessages, assistantMessage];
          const finalConversation: Conversation = {
            id: conversationId!,
            title: "与 AI 的对话",
            status: "pending",
            created_at: now,
            updated_at: new Date().toISOString(),
            messages: updatedMessages,
            attachments: undefined,
            context_customer_ids: customerId ? [customerId] : [],
            ai_outputs: undefined,
            linked_customer_id: customerId ?? undefined,
          };

          await updateConversation(finalConversation);
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
            threadId: conversationId!,
            userMessage: message,
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
  });

  // Return streaming response
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "X-Conversation-Id": conversationId,
    },
  });
}
