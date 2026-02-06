export interface QuickActionCardItem {
  icon: "envelope" | "table" | "calendar" | "tasks" | "calendarAlt" | "database";
  title: string;
  description: string;
  prompt: string;
  color: string;
}

export const QUICK_ACTION_CARDS: QuickActionCardItem[] = [
  {
    icon: "envelope",
    title: "Create Email Draft",
    description: "Generate a polished sales follow-up email tailored to your lead.",
    prompt: "Draft a follow-up email for my lead with clear CTA and concise tone.",
    color: "bg-red-100 text-red-500",
  },
  {
    icon: "table",
    title: "Competitor Pricing Research",
    description: "Summarize competitor pricing and positioning highlights.",
    prompt: "Research competitor pricing and summarize opportunities for our offer.",
    color: "bg-green-100 text-green-600",
  },
  {
    icon: "calendar",
    title: "Meeting Preparation",
    description: "Build a practical prep brief with talking points and risks.",
    prompt: "Prepare for my upcoming meeting by getting relevant issues from linear.",
    color: "bg-blue-100 text-blue-500",
  },
  {
    icon: "tasks",
    title: "Create Issue",
    description: "Turn notes into a structured issue with owner and next actions.",
    prompt: "Create an issue from my notes and include owner, impact, and timeline.",
    color: "bg-gray-100 text-gray-800",
  },
  {
    icon: "calendarAlt",
    title: "Next Week's Schedule",
    description: "Plan next week around meetings, follow-ups, and deep work.",
    prompt: "What's my busiest day next week and when do I have free time?",
    color: "bg-yellow-100 text-yellow-600",
  },
  {
    icon: "database",
    title: "Optimize Queries",
    description: "Improve prompt quality for better AI output consistency.",
    prompt: "Explore opportunities to add indexes and make my queries more efficient.",
    color: "bg-green-100 text-green-600",
  },
];
