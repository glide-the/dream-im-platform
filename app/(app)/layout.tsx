import BottomNav from "../components/BottomNav";
import FloatingAIButton from "../components/FloatingAIButton";

export default function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        {children}
      </div>
      <BottomNav />
      <FloatingAIButton />
    </div>
  );
}
