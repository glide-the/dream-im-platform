// [Input] Independent Admin Session and live Admin membership/RBAC.
// [Output] Protected Refine workspace navigation.
// [Pos] Admin layout; authorization is repeated by every server API.
// [Sync] 2026-09-17: require the independent Admin management session rather than a Dream OAuth identity.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getAdminIdentity,
} from "@/lib/admin/session";
import AdminNavigation from "./_components/AdminNavigation";

export default async function AdminWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  let identity = null;
  try {
    identity = await getAdminIdentity(new Headers(requestHeaders));
  } catch {
    identity = null;
  }
  if (!identity) redirect("/admin/login");

  return (
    <div className="min-h-[100dvh] bg-bg-primary text-text-primary">
      <AdminNavigation
        identity={{
          name: identity.displayName ?? identity.email,
          roles: identity.roles,
          permissions: identity.permissions,
        }}
      />
      <main className="min-w-0 lg:pl-[264px]">
        <div className="admin-page-frame mx-auto w-full max-w-[1600px] px-5 py-9 sm:px-8 lg:px-12 lg:py-14 xl:px-16">
          {children}
        </div>
      </main>
    </div>
  );
}
