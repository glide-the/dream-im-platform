import AdminNavigation from "./_components/AdminNavigation";

export default function AdminWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-bg-primary text-text-primary lg:flex">
      <AdminNavigation />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          {children}
        </div>
      </main>
    </div>
  );
}
