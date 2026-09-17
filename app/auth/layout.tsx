// [Input] Login/authorization page content.
// [Output] Shared accessible authentication frame using existing Admin design tokens.
// [Pos] Admin-owned authentication UI, separate from management permission layout.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-[100dvh] items-center justify-center bg-bg-surface px-5 py-12 text-text-primary"><section className="w-full max-w-[420px]"><p className="mb-10 font-display text-3xl font-semibold tracking-tight">Ink Memory</p>{children}</section></main>;
}
