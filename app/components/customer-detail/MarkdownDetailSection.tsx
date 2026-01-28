"use client";

import { useState } from "react";
import CollapsibleSection from "../CollapsibleSection";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownDetailSectionProps {
  isEditMode: boolean;
  content: string;
  onContentChange: (value: string) => void;
}

export default function MarkdownDetailSection({
  isEditMode,
  content,
  onContentChange
}: MarkdownDetailSectionProps) {
  const [isPreview, setIsPreview] = useState(!isEditMode);

  return (
    <CollapsibleSection title="详情信息" defaultCollapsed={false}>
      {isEditMode ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-tertiary">
              {isPreview ? "预览模式" : "编辑模式"}
            </span>
            <button
              onClick={() => setIsPreview(!isPreview)}
              className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-accent/90"
            >
              {isPreview ? "编辑" : "预览"}
            </button>
          </div>

          {isPreview ? (
            <div className="prose prose-sm max-w-none rounded-lg bg-bg-primary p-4 text-text-secondary">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || "暂无补充信息"}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-text-tertiary">
                支持 Markdown 语法：段落、列表、引用等
              </p>
              <textarea
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none"
                rows={6}
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                placeholder="输入客户补充信息，支持 Markdown 格式..."
              />
            </div>
          )}
        </div>
      ) : (
        <div className="prose prose-sm max-w-none rounded-lg bg-bg-primary p-4 text-text-secondary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content || "暂无补充信息"}
          </ReactMarkdown>
        </div>
      )}
    </CollapsibleSection>
  );
}
