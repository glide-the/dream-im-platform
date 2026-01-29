"use client";

import { useState } from "react";
import { IconPaperclip, IconImage, IconCamera, IconSend, IconX } from "./Icons";

export interface Attachment {
  name: string;
  type: string;
  size: number;
}

export interface ContextCustomer {
  id: string;
  name?: string;
  company?: string;
}

interface AIInputDockProps {
  contextCustomerId?: string;
  contextCustomers?: ContextCustomer[];
  onSendMessage: (message: string, attachments?: Attachment[], customerIds?: string[]) => void;
  onAddContextCustomer?: () => void;
  onRemoveContextCustomer?: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}

export default function AIInputDock({
  contextCustomerId,
  contextCustomers = [],
  onSendMessage,
  onAddContextCustomer,
  onRemoveContextCustomer,
  placeholder = "输入公司 + 姓名…",
  disabled = false,
  loading = false
}: AIInputDockProps) {
  const [query, setQuery] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  function handleAttachment(files?: FileList | null) {
    if (!files) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      newAttachments.push({
        name: file.name,
        type: file.type,
        size: file.size
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSend() {
    if (!query.trim() && attachments.length === 0) return;

    const customerIds = contextCustomers.map((c) => c.id);
    if (contextCustomerId) {
      customerIds.push(contextCustomerId);
    }

    onSendMessage(query, attachments, customerIds);
    setQuery("");
    setAttachments([]);
  }

  return (
    <div className="rounded-2xl border border-border bg-bg-primary p-4">
      {/* 上下文选择区 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* 文件/相册/拍照按钮 */}
        <div className="flex items-center gap-2">
          {[IconPaperclip, IconImage, IconCamera].map((Icon, idx) => (
            <label
              key={idx}
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-border bg-bg-surface text-text-secondary"
            >
              <Icon className="h-4 w-4" />
              <input
                type="file"
                className="hidden"
                onChange={(event) => handleAttachment(event.target.files)}
                disabled={disabled}
              />
            </label>
          ))}
        </div>

        {/* @客户按钮 */}
        {onAddContextCustomer && (
          <button
            className="rounded-full bg-accent-light px-3 py-1 text-xs font-semibold text-accent"
            onClick={onAddContextCustomer}
            disabled={disabled}
          >
            @客户
          </button>
        )}

        {/* 已选择的上下文客户 */}
        {contextCustomers.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px] text-text-tertiary">
            {contextCustomers.map((customer) => (
              <button
                key={customer.id}
                className="rounded-full border border-border bg-bg-surface px-2 py-1"
                onClick={() => onRemoveContextCustomer?.(customer.id)}
                disabled={disabled}
              >
                @{customer.name ?? "客户"} · 取消
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 附件展示 */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((file, index) => (
            <button
              key={`${file.name}-${index}`}
              className="rounded-full border border-border bg-bg-surface px-3 py-1 text-[11px] text-text-secondary"
              onClick={() => removeAttachment(index)}
              disabled={disabled}
            >
              {file.name}
              <IconX className="ml-1 inline h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {/* 输入框和发送按钮 */}
      <div className="flex items-center gap-2">
        <textarea
          className="min-h-[44px] flex-1 rounded-2xl border border-border bg-bg-surface px-4 py-2 text-sm text-text-primary"
          rows={2}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="grid h-11 w-11 place-items-center rounded-full bg-accent text-white shadow-accent disabled:opacity-50"
          onClick={handleSend}
          disabled={loading || disabled || (!query.trim() && attachments.length === 0)}
        >
          <IconSend className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
