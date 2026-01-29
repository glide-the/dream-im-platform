"use client";

import { useState } from "react";
import { IconEdit, IconX, IconCheck } from "../Icons";
import { formatRelativeTime } from "../../lib/format";

type Customer = {
  id: string;
  name?: string;
  company?: string;
  title?: string;
  tags?: string[];
};

interface ProfileCardProps {
  customer: Customer;
  isEditing: boolean;
  onToggleEdit: () => void;
  onSave: (data: Partial<Customer>) => Promise<void>;
}

export default function ProfileCard({
  customer,
  isEditing,
  onToggleEdit,
  onSave
}: ProfileCardProps) {
  const [localName, setLocalName] = useState(customer.name ?? "");
  const [localCompany, setLocalCompany] = useState(customer.company ?? "");
  const [localTitle, setLocalTitle] = useState(customer.title ?? "");
  const [localTags, setLocalTags] = useState((customer.tags ?? []).join(", "));

  function handleSave() {
    onSave({
      name: localName || undefined,
      company: localCompany || undefined,
      title: localTitle || undefined,
      tags: localTags ? localTags.split(/[,，]/).map(s => s.trim()).filter(Boolean) : []
    });
  }

  function handleCancel() {
    setLocalName(customer.name ?? "");
    setLocalCompany(customer.company ?? "");
    setLocalTitle(customer.title ?? "");
    setLocalTags((customer.tags ?? []).join(", "));
    onToggleEdit();
  }

  const tags = localTags ? localTags.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
  const hasContact = false;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-subtle">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-text-tertiary">姓名</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  placeholder="请输入姓名"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-text-tertiary">公司</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                  value={localCompany}
                  onChange={(e) => setLocalCompany(e.target.value)}
                  placeholder="请输入公司名称"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-text-tertiary">职位</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                  value={localTitle}
                  onChange={(e) => setLocalTitle(e.target.value)}
                  placeholder="请输入职位"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-text-tertiary">标签</label>
                <input
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                  value={localTags}
                  onChange={(e) => setLocalTags(e.target.value)}
                  placeholder="请输入标签，用逗号分隔"
                />
              </div>
            </div>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold text-text-primary">
                {customer.name || "未命名客户"}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {[customer.company, customer.title].filter(Boolean).join(" · ") || "暂无公司职位信息"}
              </p>
            </>
          )}
        </div>

        <div className="ml-3 flex gap-2">
          {isEditing ? (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white shadow-accent"
              >
                保存
              </button>
              <button
                onClick={handleCancel}
                className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-surface"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={onToggleEdit}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-accent hover:bg-accent-light"
            >
              <IconEdit className="h-3 w-3" />
              编辑
            </button>
          )}
        </div>
      </div>

      {!isEditing && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex-1">
              {tags.length > 0 && (
                <div className="flex gap-2">
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

            {hasContact && (
              <span className="rounded-full bg-bg-secondary px-3 py-1 text-xs font-semibold text-text-secondary">
                有联系方式
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-text-tertiary">
              最近更新：{formatRelativeTime(customer.updated_at)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
