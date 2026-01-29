import { createId, stableHash } from "./id";
import { CustomerCard } from "./types";

const titles = [
  "采购负责人",
  "业务拓展经理",
  "销售总监",
  "BD 经理",
  "渠道负责人",
  "项目经理"
];

const tags = ["高潜", "重点跟进", "新线索", "需验证", "已联系"]; 

const insights = [
  "近期完成新一轮融资，扩建销售团队。",
  "公开活动中提到关注数字化销售流程。",
  "公司正在推进渠道合作，适合切入联合方案。",
  "正筹备新产品线发布，需求可能集中在获客。",
  "近期在招聘销售岗位，可能需要效率工具。"
];

export function buildCustomerCard(queryText: string): {
  card: CustomerCard;
  debug: { name?: string; company?: string };
} {
  const normalized = queryText.trim();
  const parts = normalized.split(/\s+/).filter(Boolean);
  let name = "";
  let company = "";
  if (parts.length >= 2) {
    name = parts[parts.length - 1];
    company = parts.slice(0, -1).join(" ");
  } else if (parts.length === 1) {
    name = parts[0];
  }

  const hash = stableHash(normalized || "ai4sales");
  const title = titles[hash % titles.length];
  const selectedTags = [tags[hash % tags.length]];
  const insight = insights[hash % insights.length];
  const confidence = normalized.length > 2 ? 0.72 : 0.45;

  const phoneSeed = (hash % 9000) + 1000;
  const phone = `+86 13${(hash % 90).toString().padStart(2, "0")}****${
    phoneSeed.toString().slice(-4)
  }`;

  const card: CustomerCard = {
    structured_fields: {
      name: name || "",
      company: company || "",
      title,
      phones: [phone],
      tags: selectedTags,
      decision_chain: []
    },
    profile_markdown: `- ${insight}\n- 建议补充决策链与联系方式，确认需求优先级。`,
    confidence,
    sources: [
      { label: "公开信息汇总" },
      { label: "企业官网/招聘信息" }
    ]
  };

  return { card, debug: { name, company } };
}

export function createAttachment(input: {
  name: string;
  type: string;
  size: number;
}) {
  return {
    id: createId("att"),
    name: input.name,
    type: input.type,
    size: input.size
  };
}
