import AdminModulePage, { userResourceTabs } from "@/components/admin/AdminModulePage";
import StorageManager from "@/components/admin/StorageManager";

export default function StoragePage() {
  return <AdminModulePage eyebrow="Users and resources / storage" title="Storage / 资源" description="检查现有 Vercel Blob 或 S3/MinIO 配置，并沿用现有 Storage API 上传资源。控制台不复制文件到 PostgreSQL。" status="共享能力保留" tabs={userResourceTabs}><StorageManager /></AdminModulePage>;
}
