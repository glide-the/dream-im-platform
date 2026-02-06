export interface QuickActionCardData {
  icon: string;
  title: string;
  description: string;
  prompt: string;
  color: string;
}

export const QUICK_ACTION_CARDS: QuickActionCardData[] = [
  {
    icon: "✉️",
    title: "Create Email Draft",
    description: "Generate professional email drafts with AI assistance",
    prompt: "帮我起草一封商务邮件",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: "📊",
    title: "Competitor Pricing Research",
    description: "Analyze competitor pricing strategies and market trends",
    prompt: "分析竞品定价策略",
    color: "bg-green-50 text-green-600",
  },
  {
    icon: "📅",
    title: "Meeting Preparation",
    description: "Prepare meeting agendas and talking points",
    prompt: "帮我准备会议要点",
    color: "bg-purple-50 text-purple-600",
  },
  {
    icon: "📝",
    title: "Create Issue",
    description: "Create and organize tasks for your projects",
    prompt: "创建一个新的待办任务",
    color: "bg-orange-50 text-orange-600",
  },
  {
    icon: "🗓️",
    title: "Next Week's Schedule",
    description: "Plan and optimize your upcoming schedule",
    prompt: "规划下周的工作安排",
    color: "bg-pink-50 text-pink-600",
  },
  {
    icon: "🔍",
    title: "Optimize Queries",
    description: "Optimize database queries and improve performance",
    prompt: "优化数据库查询性能",
    color: "bg-amber-50 text-amber-600",
  },
];
