export interface QuickActionCardItem {
  icon: "sparkles" | "search" | "users" | "checklist";
  title: string;
  description: string;
  prompt: string;
  color: string;
}

export const QUICK_ACTION_CARDS: QuickActionCardItem[] = [
  {
    icon: "sparkles",
    title: "Create Email Draft",
    description: "Generate a polished sales follow-up email tailored to your lead.",
    prompt: "Draft a follow-up email for my lead with clear CTA and concise tone.",
    color: "bg-amber-100 text-amber-700",
  },
  {
    icon: "search",
    title: "Competitor Pricing Research",
    description: "Summarize competitor pricing and positioning highlights.",
    prompt: "Research competitor pricing and summarize opportunities for our offer.",
    color: "bg-blue-100 text-blue-700",
  },
  {
    icon: "users",
    title: "Meeting Preparation",
    description: "Build a practical prep brief with talking points and risks.",
    prompt: "Prepare me for tomorrow's customer meeting with agenda and objections.",
    color: "bg-emerald-100 text-emerald-700",
  },
  {
    icon: "checklist",
    title: "Create Issue",
    description: "Turn notes into a structured issue with owner and next actions.",
    prompt: "Create an issue from my notes and include owner, impact, and timeline.",
    color: "bg-rose-100 text-rose-700",
  },
  {
    icon: "sparkles",
    title: "Next Week's Schedule",
    description: "Plan next week around meetings, follow-ups, and deep work.",
    prompt: "Draft my next week's schedule balancing sales calls and follow-ups.",
    color: "bg-violet-100 text-violet-700",
  },
  {
    icon: "search",
    title: "Optimize Queries",
    description: "Improve prompt quality for better AI output consistency.",
    prompt: "Optimize this prompt to get more specific and actionable output.",
    color: "bg-sky-100 text-sky-700",
  },
];
