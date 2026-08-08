import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AIProviderRegistry from "@/components/admin/AIProviderRegistry";

export default function ProvidersPage() {
  return <AdminModulePage eyebrow="AI supply chain / providers" title="Provider" description="cc-switch 同构 Provider 卡片注册表；外部调用只使用 Gateway Key 与稳定模型 alias。" status="代理供应链" tabs={modelTabs}><AIProviderRegistry /></AdminModulePage>;
}
