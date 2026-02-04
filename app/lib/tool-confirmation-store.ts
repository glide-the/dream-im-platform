// app/lib/tool-confirmation-store.ts
// In-memory store for pending tool confirmations
// This implements the "event = asyncio.Event()" pattern from the Claude Agent SDK

/**
 * Tool confirmation result from the user
 */
export interface ToolConfirmationResult {
    approved: boolean;
    reason?: string;
    /** User's answers for AskUserQuestion tool */
    answers?: Record<string, unknown>;
}

/**
 * Pending tool confirmation entry
 */
interface PendingConfirmation {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    createdAt: number;
    resolve: (result: ToolConfirmationResult) => void;
    reject: (error: Error) => void;
}

/**
 * In-memory store for pending tool confirmations
 * Key: toolCallId
 * Value: PendingConfirmation
 * 
 * Note: This is a simple in-memory store. In production with multiple
 * server instances, you would need Redis or similar for shared state.
 */
const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * Default timeout for tool confirmations (5 minutes)
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Create a pending tool confirmation and return a Promise that resolves
 * when the user approves/rejects.
 * 
 * This implements the "await event.wait()" pattern from the documentation.
 */
export function createPendingToolConfirmation(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ToolConfirmationResult> {
    return new Promise((resolve, reject) => {
        // Store the pending confirmation
        pendingConfirmations.set(toolCallId, {
            toolCallId,
            toolName,
            input,
            createdAt: Date.now(),
            resolve,
            reject,
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
            const pending = pendingConfirmations.get(toolCallId);
            if (pending) {
                pendingConfirmations.delete(toolCallId);
                reject(new Error(`Tool confirmation timeout for ${toolCallId}`));
            }
        }, timeoutMs);

        // Clean up timeout when resolved
        const originalResolve = resolve;
        const originalReject = reject;

        pendingConfirmations.set(toolCallId, {
            toolCallId,
            toolName,
            input,
            createdAt: Date.now(),
            resolve: (result) => {
                clearTimeout(timeoutId);
                pendingConfirmations.delete(toolCallId);
                originalResolve(result);
            },
            reject: (error) => {
                clearTimeout(timeoutId);
                pendingConfirmations.delete(toolCallId);
                originalReject(error);
            },
        });
    });
}

/**
 * Get a pending tool confirmation by toolCallId
 */
export function getPendingToolConfirmation(toolCallId: string): PendingConfirmation | undefined {
    return pendingConfirmations.get(toolCallId);
}

/**
 * Resolve a pending tool confirmation with the user's decision.
 * 
 * This implements the "event.set()" pattern from the documentation.
 */
export function resolvePendingToolConfirmation(
    toolCallId: string,
    result: ToolConfirmationResult
): boolean {
    const pending = pendingConfirmations.get(toolCallId);
    if (!pending) {
        return false;
    }

    pending.resolve(result);
    return true;
}

/**
 * Reject a pending tool confirmation with an error
 */
export function rejectPendingToolConfirmation(
    toolCallId: string,
    error: Error
): boolean {
    const pending = pendingConfirmations.get(toolCallId);
    if (!pending) {
        return false;
    }

    pending.reject(error);
    return true;
}

/**
 * Check if a tool confirmation is pending
 */
export function hasPendingToolConfirmation(toolCallId: string): boolean {
    return pendingConfirmations.has(toolCallId);
}

/**
 * Get all pending tool confirmations (for debugging/monitoring)
 */
export function getAllPendingConfirmations(): Array<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    createdAt: number;
}> {
    return Array.from(pendingConfirmations.values()).map((p) => ({
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        input: p.input,
        createdAt: p.createdAt,
    }));
}
