import { IconChecklist, IconSearch, IconSparkles, IconUsers } from "../Icons";
import type { QuickActionCardItem } from "./const";

interface QuickActionCardProps {
  item: QuickActionCardItem;
  onClick: (prompt: string) => void;
}

function CardIcon({ icon }: { icon: QuickActionCardItem["icon"] }) {
  if (icon === "search") return <IconSearch className="h-5 w-5" />;
  if (icon === "users") return <IconUsers className="h-5 w-5" />;
  if (icon === "checklist") return <IconChecklist className="h-5 w-5" />;
  return <IconSparkles className="h-5 w-5" />;
}

export default function QuickActionCard({ item, onClick }: QuickActionCardProps) {
  return (
    <button
      onClick={() => onClick(item.prompt)}
      className="group w-full rounded-2xl border border-[var(--neutral-border)] bg-white/80 p-5 text-left shadow-subtle transition duration-300 hover:-translate-y-1 hover:shadow-md"
    >
      <div className="flex gap-4">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${item.color}`}>
          <CardIcon icon={item.icon} />
        </div>
        <div>
          <h3 className="font-semibold text-[var(--luxury-charcoal)]">{item.title}</h3>
          <p className="mt-1 text-sm text-text-tertiary">{item.description}</p>
        </div>
      </div>
    </button>
  );
}
