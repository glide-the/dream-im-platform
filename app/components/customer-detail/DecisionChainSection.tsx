"use client";

import { useState } from "react";
import { IconPlus, IconTrash, IconChevronDown, IconChevronUp, IconEdit } from "../Icons";
import type { DecisionChainItem } from "../../lib/types";

type Customer = {
  id: string;
  decision_chain?: DecisionChainItem[];
};

interface DecisionChainSectionProps {
  customer: Customer;
  isEditing: boolean;
  onToggleEdit: () => void;
  onSave: (data: Partial<Customer>) => Promise<void>;
}

const emptyDecisionChainItem: DecisionChainItem = {
  name: "",
  contacts: {
    phones: [],
    emails: [],
    wechat: ""
  },
  age: "",
  personality: "",
  preferences: "",
  role_in_chain: ""
};

const roleOptions = [
  "决策者",
  "使用者",
  "影响者",
  "采购",
  "财务",
  "IT",
  "法务",
  "其他"
];

export default function DecisionChainSection({
  customer,
  isEditing,
  onToggleEdit,
  onSave
}: DecisionChainSectionProps) {
  const [localDecisionChain, setLocalDecisionChain] = useState<DecisionChainItem[]>(customer.decision_chain ?? []);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  function handleSave() {
    onSave({
      decision_chain: localDecisionChain
    });
  }

  function handleCancel() {
    setLocalDecisionChain(customer.decision_chain ?? []);
    setEditingIndex(null);
    onToggleEdit();
  }

  function handleAddItem() {
    const newItem = { ...emptyDecisionChainItem };
    setLocalDecisionChain([...localDecisionChain, newItem]);
    setEditingIndex(localDecisionChain.length);
  }

  function handleDeleteItem(index: number) {
    const newChain = localDecisionChain.filter((_, i) => i !== index);
    setLocalDecisionChain(newChain);
    if (editingIndex === index) {
      setEditingIndex(null);
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  }

  function handleItemChange(index: number, field: keyof DecisionChainItem, value: any) {
    const newChain = [...localDecisionChain];
    if (field === "contacts") {
      newChain[index] = {
        ...newChain[index],
        contacts: { ...newChain[index].contacts, ...value }
      };
    } else {
      newChain[index] = { ...newChain[index], [field]: value };
    }
    setLocalDecisionChain(newChain);
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const newChain = [...localDecisionChain];
    [newChain[index - 1], newChain[index]] = [newChain[index], newChain[index - 1]];
    setLocalDecisionChain(newChain);
    if (editingIndex === index) setEditingIndex(index - 1);
    else if (editingIndex === index - 1) setEditingIndex(index);
  }

  function handleMoveDown(index: number) {
    if (index === localDecisionChain.length - 1) return;
    const newChain = [...localDecisionChain];
    [newChain[index], newChain[index + 1]] = [newChain[index + 1], newChain[index]];
    setLocalDecisionChain(newChain);
    if (editingIndex === index) setEditingIndex(index + 1);
    else if (editingIndex === index + 1) setEditingIndex(index);
  }

  const hasItems = localDecisionChain.length > 0;

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-subtle">
      <div
        className="flex cursor-pointer items-center justify-between border-b border-border px-4 py-3"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h3 className="text-sm font-semibold text-text-primary">决策链</h3>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white"
            onClick={(e) => {
              e.stopPropagation();
              handleAddItem();
            }}
          >
            <IconPlus className="mr-1 inline h-3 w-3" />
            新增
          </button>
          {isCollapsed ? (
            <IconChevronDown className="h-4 w-4 text-text-secondary" />
          ) : (
            <IconChevronUp className="h-4 w-4 text-text-secondary" />
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-4">
          {!hasItems ? (
            <div className="py-8 text-center text-sm text-text-tertiary">
              暂无决策链信息
              <button
                className="ml-2 text-accent"
                onClick={handleAddItem}
              >
                + 新增
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {localDecisionChain.map((item, index) => {
                const isItemEditing = editingIndex === index;
                const title = item.name || "未命名联系人";
                const subtitle = [
                  item.role_in_chain,
                  item.contacts?.phones?.[0] || item.contacts?.emails?.[0] || item.contacts?.wechat
                ].filter(Boolean).join(" · ");

                return (
                  <div
                    key={index}
                    className="rounded-xl border border-border bg-bg-secondary"
                  >
                    {isItemEditing ? (
                      <div className="space-y-3 p-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-text-tertiary">
                              姓名 <span className="text-red-500">*</span>
                            </label>
                            <input
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.name}
                              onChange={(e) => handleItemChange(index, "name", e.target.value)}
                              placeholder="请输入姓名"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-text-tertiary">
                              角色
                            </label>
                            <select
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.role_in_chain || ""}
                              onChange={(e) => handleItemChange(index, "role_in_chain", e.target.value)}
                            >
                              <option value="">请选择</option>
                              {roleOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-text-tertiary">
                            联系方式
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.contacts?.phones?.join(", ") || ""}
                              onChange={(e) => handleItemChange(index, "contacts", {
                                ...item.contacts,
                                phones: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
                              })}
                              placeholder="手机号"
                            />
                            <input
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.contacts?.emails?.join(", ") || ""}
                              onChange={(e) => handleItemChange(index, "contacts", {
                                ...item.contacts,
                                emails: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
                              })}
                              placeholder="邮箱"
                            />
                            <input
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.contacts?.wechat || ""}
                              onChange={(e) => handleItemChange(index, "contacts", {
                                ...item.contacts,
                                wechat: e.target.value
                              })}
                              placeholder="微信"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-text-tertiary">
                              年龄
                            </label>
                            <input
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.age || ""}
                              onChange={(e) => handleItemChange(index, "age", e.target.value)}
                              placeholder="年龄"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-text-tertiary">
                              性格
                            </label>
                            <input
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.personality || ""}
                              onChange={(e) => handleItemChange(index, "personality", e.target.value)}
                              placeholder="性格特点"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-text-tertiary">
                              个人喜好
                            </label>
                            <input
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                              value={item.preferences || ""}
                              onChange={(e) => handleItemChange(index, "preferences", e.target.value)}
                              placeholder="个人喜好"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex gap-2">
                            <button
                              className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-primary"
                              onClick={() => setEditingIndex(null)}
                            >
                              完成
                            </button>
                            <button
                              className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-50"
                              onClick={() => handleDeleteItem(index)}
                            >
                              删除
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary disabled:opacity-30"
                              onClick={() => handleMoveUp(index)}
                              disabled={index === 0}
                            >
                              ↑
                            </button>
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary disabled:opacity-30"
                              onClick={() => handleMoveDown(index)}
                              disabled={index === localDecisionChain.length - 1}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-3">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-text-primary">{title}</p>
                          {subtitle && (
                            <p className="mt-1 text-xs text-text-secondary">{subtitle}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-primary"
                            onClick={() => setEditingIndex(index)}
                          >
                            <IconEdit className="h-3 w-3" />
                          </button>
                          <button
                            className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-50"
                            onClick={() => handleDeleteItem(index)}
                          >
                            <IconTrash className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
