import AdminModulePage from "@/components/admin/AdminModulePage";
import StorageManager from "@/components/admin/StorageManager";

export default function StoragePage() {
  return <AdminModulePage eyebrow="Resource management / storage" title="文件存储" description="通过受管理员权限保护的 API 查询、上传、预览、下载与删除现有 Storage 对象；文件内容不进入 PostgreSQL。" status="权限与审计已启用"><StorageManager /></AdminModulePage>;
}
