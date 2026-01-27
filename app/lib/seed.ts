import { DbShape } from "./types";

const now = new Date();

function iso(minutesAgo: number) {
  return new Date(now.getTime() - minutesAgo * 60 * 1000).toISOString();
}

function daysAgo(days: number, hour = 9, minute = 0) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export function seedData(): DbShape {
  return {
    customers: [
      {
        id: "cus_seed_zhangsan",
        name: "张三",
        company: "XX 科技",
        title: "采购负责人",
        phones: ["+86 13800002233"],
        emails: ["zhangsan@xxtech.com"],
        wechat: "zhangsan_xx",
        address: "上海市浦东新区张江高科",
        tags: ["高潜"],
        profile_markdown:
          "- 近期完成 B 轮融资，正在扩建渠道体系。\n- 采购流程偏重数据安全与合规。\n- 建议从智能外呼与线索评分切入。",
        created_at: daysAgo(0, 9, 12),
        updated_at: daysAgo(0, 9, 12),
        source: "ai_search",
        last_verified_at: daysAgo(0, 9, 12)
      },
      {
        id: "cus_seed_lina",
        name: "李娜",
        company: "云启资本",
        title: "投资总监",
        phones: ["+86 13900006688"],
        emails: ["lina@yunqi-capital.com"],
        wechat: "lina_cap",
        address: "北京市朝阳区国贸",
        tags: ["重点跟进"],
        profile_markdown:
          "- 关注 SaaS 增长模型与企业服务效率。\n- 最近在公开活动中提到 AI+销售的投入方向。",
        created_at: daysAgo(1, 18, 30),
        updated_at: daysAgo(1, 18, 30),
        source: "ai_search",
        last_verified_at: daysAgo(1, 18, 30)
      },
      {
        id: "cus_seed_wanghao",
        name: "王浩",
        company: "星云工业",
        title: "BD 经理",
        phones: [],
        emails: [],
        wechat: "",
        address: "杭州市滨江区",
        tags: ["新线索"],
        profile_markdown:
          "- 关注供应链数字化，近期新成立事业部。\n- 需补齐联系方式并确认决策链。",
        created_at: daysAgo(2, 14, 20),
        updated_at: daysAgo(1, 9, 0),
        source: "manual"
      }
    ],
    todos: [
      {
        id: "todo_seed_1",
        title: "跟进 XX 科技决策链",
        description: "准备 ROI 方案，周三会议前发送",
        priority: "P0",
        status: "open",
        created_at: iso(120),
        updated_at: iso(120)
      },
      {
        id: "todo_seed_2",
        title: "完善云启资本联系方式",
        description: "补充微信与邮箱，更新备注标签",
        priority: "P1",
        status: "open",
        created_at: daysAgo(1, 10, 0),
        updated_at: daysAgo(1, 10, 0)
      },
      {
        id: "todo_seed_3",
        title: "整理王浩客户档案",
        description: "补齐地址与公司介绍，标记来源",
        priority: "P2",
        status: "done",
        created_at: daysAgo(3, 16, 0),
        updated_at: daysAgo(2, 12, 30)
      }
    ],
    conversations: [
      {
        id: "conv_seed_1",
        title: "【XX 科技】张三 客户信息检索",
        status: "pending",
        created_at: iso(140),
        updated_at: iso(140),
        messages: [
          {
            id: "msg_seed_1",
            role: "user",
            content: "XX 科技 张三",
            created_at: iso(141)
          },
          {
            id: "msg_seed_2",
            role: "assistant",
            content:
              "已整理客户资料卡片，请确认后入库。",
            created_at: iso(140)
          }
        ],
        ai_outputs: {
          customer_card: {
            structured_fields: {
              name: "张三",
              company: "XX 科技",
              title: "采购负责人",
              phones: ["+86 13800002233"]
            },
            profile_markdown:
              "近期完成 B 轮融资，正在扩建渠道体系。建议从智能外呼切入。",
            confidence: 0.72,
            sources: [{ label: "公开报道摘要" }]
          }
        }
      },
      {
        id: "conv_seed_2",
        title: "【云启资本】李娜 联系方式补全",
        status: "confirmed",
        created_at: daysAgo(1, 18, 35),
        updated_at: daysAgo(1, 18, 35),
        messages: [
          {
            id: "msg_seed_3",
            role: "user",
            content: "云启资本 李娜",
            created_at: daysAgo(1, 18, 34)
          },
          {
            id: "msg_seed_4",
            role: "assistant",
            content: "已生成联系方式补全建议。",
            created_at: daysAgo(1, 18, 35)
          }
        ],
        ai_outputs: {
          customer_card: {
            structured_fields: {
              name: "李娜",
              company: "云启资本",
              title: "投资总监",
              phones: ["+86 13900006688"],
              emails: ["lina@yunqi-capital.com"]
            },
            profile_markdown:
              "近期公开分享提到关注 AI 销售工具，建议补充微信后安排回访。",
            confidence: 0.76,
            sources: [{ label: "公开活动信息" }]
          }
        },
        linked_customer_id: "cus_seed_lina"
      }
    ]
  };
}
