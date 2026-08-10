import AdminPageHeader from "./AdminPageHeader";
import AdminSectionTabs from "./AdminSectionTabs";

export default function AdminModulePage({
  eyebrow,
  title,
  description,
  status,
  tabs,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  status?: string;
  tabs?: Array<{ label: string; href: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <AdminPageHeader eyebrow={eyebrow} title={title} description={description} status={status} />
      {tabs ? <AdminSectionTabs label={`${title}子导航`} items={tabs} /> : null}
      {children}
    </div>
  );
}

export const storyTabs = [
  { label: "工作区", href: "/admin/story/workspaces" },
  { label: "剧本", href: "/admin/story/stories" },
];

export const modelTabs = [
  { label: "Provider", href: "/admin/models/providers" },
  { label: "Models", href: "/admin/models/models" },
  { label: "Pricing", href: "/admin/models/pricing" },
];

export const billingTabs = [
  { label: "使用记录", href: "/admin/billing/usage" },
  { label: "账户余额", href: "/admin/billing/accounts" },
  { label: "交易账本", href: "/admin/billing/ledger" },
  { label: "计费报表", href: "/admin/billing/reports" },
];

export const subscriptionTabs = [
  { label: "套餐", href: "/admin/subscriptions/plans" },
  { label: "版本", href: "/admin/subscriptions/versions" },
  { label: "权益", href: "/admin/subscriptions/entitlements" },
  { label: "用户订阅", href: "/admin/subscriptions/users" },
  { label: "Token 流水", href: "/admin/subscriptions/token-ledger" },
];

export const gatewayTabs = [
  { label: "请求日志", href: "/admin/gateway/requests" },
  { label: "Gateway Key", href: "/admin/gateway/keys" },
  { label: "限流策略", href: "/admin/gateway/rate-limits" },
];

export const userResourceTabs = [
  { label: "平台用户", href: "/admin/resources/users" },
];

export const accessTabs = [
  { label: "管理员", href: "/admin/access/admins" },
  { label: "角色", href: "/admin/access/roles" },
  { label: "权限", href: "/admin/access/permissions" },
];

export const systemTabs = [
  { label: "系统设置", href: "/admin/system/settings" },
  { label: "审计日志", href: "/admin/system/audit" },
];
