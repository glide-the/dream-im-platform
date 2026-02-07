import { IconEnvelope, IconTable, IconCalendar, IconTasks, IconDatabase } from "../Icons";
import type { QuickActionCardItem } from "./const";

interface QuickActionCardProps {
  item: QuickActionCardItem;
  onClick: (prompt: string) => void;
}

function CardIcon({ icon }: { icon: QuickActionCardItem["icon"] }) {
  if (icon === "envelope") return <IconEnvelope className="h-5 w-5" />;
  if (icon === "table") return <IconTable className="h-5 w-5" />;
  if (icon === "calendar" || icon === "calendarAlt") return <IconCalendar className="h-5 w-5" />;
  if (icon === "tasks") return <IconTasks className="h-5 w-5" />;
  if (icon === "database") return <IconDatabase className="h-5 w-5" />;
  return <IconEnvelope className="h-5 w-5" />;
}

export default function QuickActionCard({ item, onClick }: QuickActionCardProps) {
  return (
    <button
      onClick={() => onClick(item.prompt)}
      className="group w-full rounded-2xl border border-border bg-[var(--color-glass-surface)] p-5 text-left shadow-subtle backdrop-blur-md transition-all duration-300 hover:-translate-y-[3px] hover:border-accent-orange hover:shadow-medium"
    >
      <div className="flex gap-4">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${item.color} transition-transform duration-300 group-hover:scale-110`}>
          <CardIcon icon={item.icon} />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{item.title}</h3>
          <p className="mt-1 text-sm text-text-tertiary line-clamp-2">{item.description}</p>
        </div>
      </div>
    </button>
  );
}
