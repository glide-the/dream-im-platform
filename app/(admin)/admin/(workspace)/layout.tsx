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
    <div className="min-h-[100dvh] bg-bg-primary text-text-primary lg:flex">
      <AdminNavigation
        identity={{
          name: identity.displayName ?? identity.email,
          roles: identity.roles,
          permissions: identity.permissions,
        }}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          {children}
        </div>
      </main>
    </div>
  );
}
