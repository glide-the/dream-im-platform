"use client";

import { useState } from "react";
import { IconEdit, IconChevronDown, IconChevronUp } from "../Icons";
import type { Customer } from "../../lib/types";

interface BasicInfoSectionProps {
  customer: Customer;
  isEditing: boolean;
  isCollapsed: boolean;
  onToggleEdit: () => void;
  onToggleCollapse: () => void;
  onSave: (data: Partial<Customer>) => Promise<void>;
}

export default function BasicInfoSection({
  customer,
  isEditing,
  isCollapsed,
  onToggleEdit,
  onToggleCollapse,
  onSave
}: BasicInfoSectionProps) {
  // 本地编辑状态
  const [localData, setLocalData] = useState({
    phones: (customer.phones ?? []).join(", "),
    emails: (customer.emails ?? []).join(", "),
    wechat: customer.wechat ?? "",
    address: customer.address ?? "",
    tags: (customer.tags ?? []).join(", ")
  });

  async function handleSave() {
    await onSave({
      phones: localData.phones ? localData.phones.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
      emails: localData.emails ? localData.emails.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
      wechat: localData.wechat || undefined,
      address: localData.address || undefined,
      tags: localData.tags ? localData.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean) : []
    });
  }

  function handleCancel() {
    // 重置为原始数据
    setLocalData({
      phones: (customer.phones ?? []).join(", "),
      emails: (customer.emails ?? []).join(", "),
      wechat: customer.wechat ?? "",
      address: customer.address ?? "",
      tags: (customer.tags ?? []).join(", ")
    });
    onToggleEdit();
  }

  const fields = [
    { key: "phones", label: "手机号" },
    { key: "emails", label: "邮箱" },
    { key: "wechat", label: "微信" },
    { key: "address", label: "地址" },
    { key: "tags", label: "标签" }
  ];

  return (
    <div className="rounded-2xl border border-border bg-bg-surface shadow-subtle">
      <div
        className="flex cursor-pointer items-center justify-between border-b border-border px-4 py-3"
        onClick={onToggleCollapse}
      >
        <h3 className="text-sm font-semibold text-text-primary">基础信息</h3>
        <div className="flex items-center gap-4">
          {isEditing ? (
            <div className="flex items-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave();
                }}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white shadow-accent"
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
          <div className="space-y-3">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <label className="text-xs font-semibold text-text-tertiary">
                  {field.label}
                </label>

                {isEditing ? (
                  <input
                    className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none"
                    value={localData[field.key as keyof typeof localData]}
                    onChange={(e) => setLocalData(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={`请输入${field.label}`}
                  />
                ) : (
                  <div className="rounded-lg bg-bg-primary px-3 py-2 text-sm text-text-primary">
                    {localData[field.key as keyof typeof localData] || "-"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
