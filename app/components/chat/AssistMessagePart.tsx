"use client";

import { memo, useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";
import type { UseChatHelpers } from "@ai-sdk/react";
import { useCopy } from "../../hooks/useCopy";
import type { ChatMetadata } from "../../lib/chat-schema";
import type { SessionResultData } from "./SessionResultCard";

// ── Inline SVG Icons ─────────────────────────────────────────────
function IconCopy({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

function IconCheck({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

function IconRefreshCw({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    );
}

function IconTrash2({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
    );
}

function IconLoader({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
        </svg>
    );
}

function IconEllipsis({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
        </svg>
    );
}

// ── Types ─────────────────────────────────────────────────────────

interface AssistMessagePartProps {
    /** The text part of the assistant message */
    part: { type: "text"; text: string };
    /** Whether this is the last part of the last message */
    isLast?: boolean;
    /** Whether the chat is currently loading/streaming */
    isLoading?: boolean;
    /** The parent message object */
    message: UIMessage;
    /** The previous message (usually user message, used for retry) */
    prevMessage?: UIMessage;
    /** Whether to show action buttons */
    showActions: boolean;
    /** Whether the message is in error state */
    isError?: boolean;
    /** Whether the view is read-only (disables destructive actions) */
    readonly?: boolean;
    /** Setter for the messages array, used for delete */
    setMessages?: UseChatHelpers<UIMessage>["setMessages"];
    /** Send a message (used for retry/regenerate) */
    sendMessage?: UseChatHelpers<UIMessage>["sendMessage"];
    /** Session result data (duration, turns, cost, etc.) */
    sessionResult?: SessionResultData | null;
}

// ── Component ─────────────────────────────────────────────────────

export const AssistMessagePart = memo(function AssistMessagePart({
    part,
    showActions,
    message,
    prevMessage,
    isError,
    setMessages,
    readonly,
    sendMessage,
    isLoading: isStreamLoading,
    sessionResult,
}: AssistMessagePartProps) {
    const { copied, copy } = useCopy();
    const [isRetrying, setIsRetrying] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const metadata = message.metadata as ChatMetadata | undefined;

    // ── Retry handler ──
    // Removes this assistant message and re-sends the previous user message
    const handleRetry = useCallback(async () => {
        if (!setMessages || !sendMessage || !prevMessage) return;
        setIsRetrying(true);

        try {
            // Remove all messages from this assistant message onward
            setMessages((messages) => {
                const index = messages.findIndex((m) => m.id === message.id);
                if (index !== -1) {
                    return messages.slice(0, index);
                }
                return messages;
            });

            // Re-send the previous user message to regenerate the response
            await sendMessage(prevMessage);
        } catch {
            // Ignore errors — the chat system handles them
        } finally {
            setIsRetrying(false);
        }
    }, [setMessages, sendMessage, message.id, prevMessage]);

    // ── Delete handler ──
    const handleDelete = useCallback(async () => {
        if (!setMessages) return;

        const ok = window.confirm("确认删除此消息？");
        if (!ok) return;

        setIsDeleting(true);
        setMessages((messages) => {
            const index = messages.findIndex((m) => m.id === message.id);
            if (index !== -1) {
                return messages.filter((_, i) => i !== index);
            }
            return messages;
        });
    }, [setMessages, message.id]);

    // ── Metadata summary ──
    const metadataSummary = useMemo(() => {
        if (!metadata) return null;

        const parts: string[] = [];
        if (metadata.chatModel) {
            parts.push(`${metadata.chatModel.provider} / ${metadata.chatModel.model}`);
        }
        if (metadata.usage) {
            const { inputTokens, outputTokens, totalTokens } = metadata.usage;
            if (inputTokens != null) parts.push(`Input: ${inputTokens.toLocaleString()}`);
            if (outputTokens != null) parts.push(`Output: ${outputTokens.toLocaleString()}`);
            const total = totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0));
            if (total > 0) parts.push(`Total: ${total.toLocaleString()}`);
        }
        if (metadata.toolCount != null && metadata.toolCount > 0) {
            parts.push(`${metadata.toolCount} tools`);
        }

        return parts.length > 0 ? parts : null;
    }, [metadata]);

    const stepsCount = useMemo(() => {
        return message.parts.filter((p) => p.type !== "step-start").length;
    }, [message.parts]);

    return (
        <div
            className={[
                "group/assist-msg flex flex-col gap-2",
                isRetrying && "animate-pulse",
                isError && "opacity-50",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {/* ── Markdown content ── */}
            <div
                className={[
                    "prose prose-sm max-w-none text-[14px] leading-[1.7] text-text-primary",
                    "[&_a]:text-accent-orange [&_a]:underline",
                    "[&_li::marker]:text-accent-orange",
                    "[&_strong]:font-semibold",
                    "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2",
                    "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1",
                    "[&_p]:my-1.5",
                    isError && "border border-danger rounded-lg p-2",
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>

            {/* ── Action bar (visible on hover) ── */}
            {showActions && (
                <div className="flex w-full items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/assist-msg:opacity-100">
                    {/* Copy */}
                    <ActionButton
                        title="复制"
                        onClick={() => copy(part.text)}
                    >
                        {copied ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                    </ActionButton>

                    {!readonly && (
                        <>
                            {/* Retry / Regenerate */}
                            {prevMessage && sendMessage && (
                                <ActionButton
                                    title="重新生成"
                                    onClick={handleRetry}
                                    disabled={isRetrying || isStreamLoading}
                                >
                                    {isRetrying ? (
                                        <IconLoader className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <IconRefreshCw className="h-3.5 w-3.5" />
                                    )}
                                </ActionButton>
                            )}

                            {/* Delete */}
                            <ActionButton
                                title="删除消息"
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className="hover:text-danger"
                            >
                                {isDeleting ? (
                                    <IconLoader className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <IconTrash2 className="h-3.5 w-3.5" />
                                )}
                            </ActionButton>
                        </>
                    )}

                    {/* Metadata info */}
                    {(metadataSummary || sessionResult) && (
                        <MetadataTooltip
                            metadata={metadata!}
                            metadataSummary={metadataSummary}
                            stepsCount={stepsCount}
                            sessionResult={sessionResult}
                        />
                    )}
                </div>
            )}
        </div>
    );
},
    // Custom equality function for React.memo
    (prev, next) => {
        if (prev.part.text !== next.part.text) return false;
        if (prev.isError !== next.isError) return false;
        if (prev.isLast !== next.isLast) return false;
        if (prev.showActions !== next.showActions) return false;
        if (prev.isLoading !== next.isLoading) return false;
        if (prev.message.id !== next.message.id) return false;
        if (prev.readonly !== next.readonly) return false;
        return true;
    });

AssistMessagePart.displayName = "AssistMessagePart";

// ── Sub-components ────────────────────────────────────────────────

/** Small ghost-style action button */
function ActionButton({
    title,
    onClick,
    disabled,
    className,
    children,
}: {
    title: string;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            disabled={disabled}
            className={[
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors",
                "hover:bg-bg-secondary hover:text-text-primary",
                "disabled:pointer-events-none disabled:opacity-40",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </button>
    );
}

/** Metadata hover tooltip showing model, usage, steps, session result */
function MetadataTooltip({
    metadata,
    metadataSummary,
    stepsCount,
    sessionResult,
}: {
    metadata: ChatMetadata;
    metadataSummary: string[] | null;
    stepsCount: number;
    sessionResult?: SessionResultData | null;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="relative ml-auto">
            <button
                type="button"
                title="消息详情"
                onMouseEnter={() => setIsOpen(true)}
                onMouseLeave={() => setIsOpen(false)}
                onClick={() => setIsOpen((v) => !v)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
            >
                <IconEllipsis className="h-3.5 w-3.5" />
            </button>

            {isOpen && (
                <div
                    className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-lg border border-border bg-bg-surface p-4 shadow-medium"
                    onMouseEnter={() => setIsOpen(true)}
                    onMouseLeave={() => setIsOpen(false)}
                >
                    <div className="space-y-3">
                        {/* Model info */}
                        {metadata.chatModel && (
                            <>
                                <div className="space-y-1.5">
                                    <h4 className="text-xs font-semibold text-text-primary">Model</h4>
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-secondary text-[10px] font-semibold text-text-secondary">
                                            {metadata.chatModel.provider.slice(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-text-primary">
                                                {metadata.chatModel.provider}
                                            </div>
                                            <div className="truncate text-xs text-text-tertiary">
                                                {metadata.chatModel.model}
                                                {metadata.toolCount != null && metadata.toolCount > 0 && (
                                                    <span className="ml-2">• {metadata.toolCount} tools</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <hr className="border-border" />
                            </>
                        )}

                        {/* Token usage */}
                        {metadata?.usage && (
                            <>
                                <div className="space-y-2">
                                    <h4 className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                                        Token Usage
                                        <span className="text-xs font-normal text-text-tertiary">
                                            {stepsCount} Steps
                                        </span>
                                    </h4>
                                    <p className="text-[11px] text-text-tertiary">
                                        High input token usage may occur when many tools are available.
                                    </p>
                                    <div className="space-y-1.5">
                                        <TokenRow
                                            label="Input"
                                            value={metadata.usage.inputTokens}
                                        />
                                        <TokenRow
                                            label="Output"
                                            value={metadata.usage.outputTokens}
                                        />
                                        <TokenRow
                                            label="Total"
                                            value={
                                                metadata.usage.totalTokens ??
                                                (((metadata.usage.inputTokens ?? 0) +
                                                    (metadata.usage.outputTokens ?? 0)) || undefined)
                                            }
                                            highlight
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Session result */}
                        {sessionResult && (
                            <>
                                <hr className="border-border" />
                                <div className="space-y-2">
                                    <h4 className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                                        {sessionResult.isError ? "⚠️" : "📊"}
                                        <span>{sessionResult.isError ? "会话异常结束" : "会话统计"}</span>
                                    </h4>
                                    <div className="space-y-1.5">
                                        {sessionResult.usage && (
                                            <>
                                                <TokenRow label="Session Input" value={sessionResult.usage.input_tokens} />
                                                <TokenRow label="Session Output" value={sessionResult.usage.output_tokens} />
                                            </>
                                        )}
                                        {sessionResult.durationMs != null && (
                                            <MetricRow label="耗时" value={formatDuration(sessionResult.durationMs)} />
                                        )}
                                        {sessionResult.numTurns != null && (
                                            <MetricRow label="轮次" value={String(sessionResult.numTurns)} />
                                        )}
                                        {sessionResult.totalCostUsd != null && (
                                            <MetricRow
                                                label="费用"
                                                value={`$${sessionResult.totalCostUsd.toFixed(4)}`}
                                                highlight
                                            />
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Single token usage row */
function TokenRow({
    label,
    value,
    highlight,
}: {
    label: string;
    value?: number;
    highlight?: boolean;
}) {
    if (value == null || value === 0) return null;

    return (
        <div
            className={[
                "flex items-center justify-between rounded-md px-2 py-1",
                highlight
                    ? "border border-accent-orange/20 bg-accent-orange-light"
                    : "bg-bg-secondary",
            ].join(" ")}
        >
            <span
                className={[
                    "text-xs",
                    highlight ? "font-medium text-accent-orange" : "text-text-tertiary",
                ].join(" ")}
            >
                {label}
            </span>
            <span
                className={[
                    "font-mono text-xs",
                    highlight ? "font-bold text-accent-orange" : "font-medium text-text-primary",
                ].join(" ")}
            >
                {value.toLocaleString()}
            </span>
        </div>
    );
}

/** Format duration from ms to human-readable */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)} 秒`;
}

/** Single metric row (non-token, e.g. duration/turns/cost) */
function MetricRow({
    label,
    value,
    highlight,
}: {
    label: string;
    value: string;
    highlight?: boolean;
}) {
    return (
        <div
            className={[
                "flex items-center justify-between rounded-md px-2 py-1",
                highlight
                    ? "border border-accent-orange/20 bg-accent-orange-light"
                    : "bg-bg-secondary",
            ].join(" ")}
        >
            <span
                className={[
                    "text-xs",
                    highlight ? "font-medium text-accent-orange" : "text-text-tertiary",
                ].join(" ")}
            >
                {label}
            </span>
            <span
                className={[
                    "text-xs",
                    highlight ? "font-bold text-accent-orange" : "font-medium text-text-primary",
                ].join(" ")}
            >
                {value}
            </span>
        </div>
    );
}

export default AssistMessagePart;
