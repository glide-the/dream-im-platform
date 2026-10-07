// [Input] Protected Admin workspace and routing domain DTOs.
// [Output] Independent same-model routing strategy business page.
// [Pos] Routing menu entry; API repeats Session/RBAC on every request.
import AdminModulePage from "@/components/admin/AdminModulePage";
import RoutingPolicyManager from "@/components/admin/RoutingPolicyManager";
export default function RoutingPage() {
  return <AdminModulePage eyebrow="Provider routing" title="路由策略" description="为同一模型选择多个 Provider，管理分流和后备顺序。"><RoutingPolicyManager /></AdminModulePage>;
}
