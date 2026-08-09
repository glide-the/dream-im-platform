import { permanentRedirect } from "next/navigation";

export default function ModelPermissionsPage() {
  permanentRedirect(
    "/admin/gateway/rate-limits#user-model-permissions-manager",
  );
}
