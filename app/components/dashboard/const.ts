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
    title: "撰写跟进邮件",
    description: "针对潜在客户生成一封专业的销售跟进邮件。",
    prompt: "帮我写一封简洁有力的客户跟进邮件，包含明确的行动号召。",
    color: "bg-red-100 text-red-500",
  },
  {
    icon: "table",
    title: "竞品价格调研",
    description: "汇总竞品定价策略与市场定位亮点。",
    prompt: "调研竞品定价信息，总结我们报价方案的优化机会。",
    color: "bg-green-100 text-green-600",
  },
  {
    icon: "calendar",
    title: "会议准备",
    description: "整理会议要点、潜在风险与讨论提纲。",
    prompt: "帮我准备即将到来的会议，整理相关议题和讨论要点。",
    color: "bg-blue-100 text-blue-500",
  },
  {
    icon: "tasks",
    title: "创建任务",
    description: "将笔记转化为结构化任务，包含负责人和后续行动。",
    prompt: "根据我的笔记创建一个任务，包含负责人、影响范围和时间节点。",
    color: "bg-gray-100 text-gray-800",
  },
  {
    icon: "calendarAlt",
    title: "下周日程规划",
    description: "围绕会议、跟进和深度工作安排下周计划。",
    prompt: "下周哪天最忙？什么时候有空闲时间？",
    color: "bg-yellow-100 text-yellow-600",
  },
  {
    icon: "database",
    title: "优化查询",
    description: "分析并优化数据库查询性能与索引策略。",
    prompt: "分析当前查询，找出可以添加索引或优化的机会。",
    color: "bg-green-100 text-green-600",
  },
];
