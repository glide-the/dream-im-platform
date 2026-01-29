"use client";

import { useState } from "react";
import { IconEdit, IconChevronDown, IconChevronUp } from "../Icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Customer = {
  id: string;
  profile_markdown?: string;
};

interface MarkdownDetailSectionProps {
  customer: Customer;
  isEditing: boolean;
  isCollapsed: boolean;
  onToggleEdit: () => void;
  onToggleCollapse: () => void;
  onSave: (data: Partial<Customer>) => Promise<void>;
}

export default function MarkdownDetailSection({
  customer,
  isEditing,
  isCollapsed,
  onToggleEdit,
  onToggleCollapse,
  onSave
}: MarkdownDetailSectionProps) {
  const [localContent, setLocalContent] = useState(customer.profile_markdown ?? "");
  const [showPreview, setShowPreview] = useState(false);

  function handleSave() {
    onSave({
      profile_markdown: localContent || undefined
    });
  }

  function handleCancel() {
    setLocalContent(customer.profile_markdown ?? "");
    setShowPreview(false);
    onToggleEdit();
  }

  function handleTogglePreview() {
    setShowPreview(!showPreview);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-subtle">
      <div
        className="flex cursor-pointer items-center justify-between border-b border-border px-4 py-3"
        onClick={onToggleCollapse}
      >
        <h3 className="text-sm font-semibold text-text-primary">详情信息</h3>
        <div className="flex items-center gap-4">
          {isEditing ? (
            <div className="flex items-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePreview();
                }}
                className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-surface"
              >
                {showPreview ? "编辑" : "预览"}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave();
                }}
                className="ml-2 rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white shadow-accent"
              >
                保存
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancel();
                }}
                className="ml-2 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-surface"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleEdit();
              }}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-accent hover:bg-accent-light"
            >
              <IconEdit className="h-3 w-3" />
              编辑
            </button>
          )}
          {isCollapsed ? (
            <IconChevronDown className="h-4 w-4 text-text-secondary" />
          ) : (
            <IconChevronUp className="h-4 w-4 text-text-secondary" />
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-4">
          {isEditing ? (
            <div className="space-y-2">
              {!showPreview ? (
                <div className="space-y-2">
                  <p className="text-xs text-text-tertiary">
                    支持 Markdown 语法：段落、列表、引用等
                  </p>
                  <textarea
                    className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none"
                    rows={6}
                    value={localContent}
                    onChange={(e) => setLocalContent(e.target.value)}
                    placeholder="输入客户补充信息，支持 Markdown 格式..."
                  />
                </div>
              ) : (
                <div className="prose prose-sm max-w-none rounded-lg bg-bg-primary p-4 text-text-secondary">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {localContent || "暂无补充信息"}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          ) : (
            <div className="prose prose-sm max-w-none rounded-lg bg-bg-primary p-4 text-text-secondary">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {customer.profile_markdown || "暂无补充信息"}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
