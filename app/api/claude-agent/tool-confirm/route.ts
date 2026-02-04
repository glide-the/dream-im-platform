// app/api/claude-agent/tool-confirm/route.ts
// API endpoint for tool confirmation responses
// This implements the "POST /submit" pattern from the Claude Agent SDK interactive tools flow

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    getPendingToolConfirmation,
    resolvePendingToolConfirmation
} from "../../../lib/tool-confirmation-store";

/**
 * Request body schema for tool confirmation
 */
const toolConfirmRequestSchema = z.object({
    /** The tool call ID to confirm/reject */
    toolCallId: z.string(),
    /** Whether the user approved the tool execution */
    approved: z.boolean(),
    /** Optional reason for rejection */
    reason: z.string().optional(),
    /** User's answers for AskUserQuestion tool */
    answers: z.record(z.string(), z.any()).optional(),
});

export type ToolConfirmRequest = z.infer<typeof toolConfirmRequestSchema>;

/**
 * POST /api/claude-agent/tool-confirm
 * 
 * Receives tool confirmation/rejection from the frontend.
 * This resolves the pending Promise in the tool handler, allowing
 * the agent to continue processing.
 */
export async function POST(req: NextRequest) {
    try {
        const json = await req.json();
        const parsed = toolConfirmRequestSchema.safeParse(json);

        if (!parsed.success) {
            return NextResponse.json(
                { error: `Invalid request body: ${parsed.error.message}` },
                { status: 400 }
            );
        }

        const { toolCallId, approved, reason, answers } = parsed.data;

        // Check if there's a pending confirmation for this tool call
        const pending = getPendingToolConfirmation(toolCallId);
        if (!pending) {
            return NextResponse.json(
                { error: `No pending confirmation found for toolCallId: ${toolCallId}` },
                { status: 404 }
            );
        }

        // Resolve the pending confirmation
        resolvePendingToolConfirmation(toolCallId, { approved, reason, answers });

        return NextResponse.json({
            success: true,
            toolCallId,
            approved,
        });
    } catch (error) {
        console.error("[Tool Confirm API] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 }
        );
    }
}
