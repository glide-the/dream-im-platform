"use client";

export interface SessionResultData {
  type: "session_result";
  subtype?: string;
  result?: string;
  isError?: boolean;
  durationMs?: number;
  numTurns?: number;
  totalCostUsd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function SessionResultCard({ data }: { data: SessionResultData }) {
  const { usage, durationMs, numTurns, totalCostUsd, isError } = data;

  return (
    <div className="mx-auto my-3 w-full max-w-md rounded-lg border border-border/60 bg-bg-secondary/40 px-4 py-3 text-sm">
      <div className="mb-2 flex items-center gap-2 text-text-primary">
        <span>{isError ? "⚠️" : "📊"}</span>
        <span className="font-semibold">{isError ? "会话异常结束" : "会话完成"}</span>
      </div>
      <div className="space-y-1 text-xs text-text-secondary">
        {usage && (
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary">Token 消耗：</span>
            <span>
              {formatTokens(usage.input_tokens ?? 0)} 入 / {formatTokens(usage.output_tokens ?? 0)} 出
            </span>
          </div>
        )}
        {durationMs != null && (
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary">耗时：</span>
            <span>{formatDuration(durationMs)}</span>
          </div>
        )}
        {numTurns != null && (
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary">轮次：</span>
            <span>{numTurns}</span>
          </div>
        )}
        {totalCostUsd != null && (
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary">费用：</span>
            <span>${totalCostUsd.toFixed(4)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
