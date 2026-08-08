import AdminModulePage, { modelTabs } from "@/components/admin/AdminModulePage";
import { ModelsResourceView } from "@/components/admin/AdminResourceViews";

export default function ModelsPage() {
  return <AdminModulePage eyebrow="AI supply chain / models" title="Models" description="稳定模型别名与上游型号解耦；Provider 通过真实可搜索关系选择器关联。" status="外键关联" tabs={modelTabs}><ModelsResourceView /></AdminModulePage>;
}
