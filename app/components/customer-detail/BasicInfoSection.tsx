"use client";

import CollapsibleSection from "../CollapsibleSection";

interface BasicInfoSectionProps {
  isEditMode: boolean;
  form: {
    name: string;
    company: string;
    title: string;
    phones: string;
    emails: string;
    wechat: string;
    address: string;
    tags: string;
  };
  onFormChange: (field: string, value: string) => void;
}

export default function BasicInfoSection({
  isEditMode,
  form,
  onFormChange
}: BasicInfoSectionProps) {
  const fields = [
    { key: "name", label: "姓名", required: true },
    { key: "company", label: "公司" },
    { key: "title", label: "职位" },
    { key: "phones", label: "手机号" },
    { key: "emails", label: "邮箱" },
    { key: "wechat", label: "微信" },
    { key: "address", label: "地址" },
    { key: "tags", label: "标签" }
  ];

  return (
    <CollapsibleSection title="基础信息" defaultCollapsed={false}>
      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1">
            <label className="text-xs font-semibold text-text-tertiary">
              {field.label}
              {field.required && <span className="text-red-500">*</span>}
            </label>

            {isEditMode ? (
              <input
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none"
                value={form[field.key as keyof typeof form]}
                onChange={(e) => onFormChange(field.key, e.target.value)}
                placeholder={`请输入${field.label}`}
              />
            ) : (
              <div className="rounded-lg bg-bg-primary px-3 py-2 text-sm text-text-primary">
                {form[field.key as keyof typeof form] || "-"}
              </div>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
