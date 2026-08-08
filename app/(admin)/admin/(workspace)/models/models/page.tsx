import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import AIModelRegistry from "@/components/admin/AIModelRegistry";

export default function ModelsPage() {
  return <AdminModulePage eyebrow="AI supply chain / models" title="Models" description="cc-switch 同构模型设置；稳定 alias 与上游型号解耦，配置使用独立页面。" status="模型路由" tabs={modelTabs}><AIModelRegistry /></AdminModulePage>;
}
