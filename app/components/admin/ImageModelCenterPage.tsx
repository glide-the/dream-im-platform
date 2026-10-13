// [Input] Image-center section content and the shared Admin module shell.
// [Output] Independent Image model-center navigation aligned with AI chrome.
// [Pos] Presentation only; authorization and resource writes remain shared.
// [Sync] 2026-10-10: establish the independent Image model center.
// [Sync] 2026-10-10: limit this center to Provider/Models/Pricing; logs and billing own request records.

import AdminModulePage, { imageModelTabs } from "./AdminModulePage";
export default function ImageModelCenterPage({ children }: { children: React.ReactNode }) {
  return <AdminModulePage eyebrow="Image model center" title="Image 模型中心" description="管理 Codex 与 OpenAI 的图像服务、模型能力和平台价格。" tabs={imageModelTabs}>
    {children}
  </AdminModulePage>;
}
