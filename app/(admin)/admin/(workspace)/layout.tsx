import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_SESSION_COOKIE,
  getAdminIdentityFromToken,
} from "@/lib/admin/session";
import AdminNavigation from "./_components/AdminNavigation";

export default async function AdminWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  let identity = null;
  try {
    identity = await getAdminIdentityFromToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    );
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
