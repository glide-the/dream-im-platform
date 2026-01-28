"use client";

import { formatRelativeTime } from "../../lib/format";

interface ProfileCardProps {
  name?: string;
  company?: string;
  title?: string;
  tags?: string[];
  updated_at: string;
  hasContact?: boolean;
}

export default function ProfileCard({
  name,
  company,
  title,
  tags = [],
  updated_at,
  hasContact = false
}: ProfileCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-subtle">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h2 className="font-display text-xl font-semibold text-text-primary">
            {name || "未命名客户"}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {[company, title].filter(Boolean).join(" · ") || "暂无公司职位信息"}
          </p>
        </div>

        {tags.length > 0 && (
          <div className="ml-3 flex gap-2">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-accent-light px-3 py-1 text-xs font-semibold text-accent"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-text-tertiary">
          最近更新：{formatRelativeTime(updated_at)}
        </p>

        {hasContact && (
          <span className="rounded-full bg-bg-secondary px-3 py-1 text-xs font-semibold text-text-secondary">
            有联系方式
          </span>
        )}
      </div>
    </div>
  );
}
