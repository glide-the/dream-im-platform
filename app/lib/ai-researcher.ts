import { query, Options } from "@anthropic-ai/claude-agent-sdk";
import { CustomerCard } from "./types";

const DEFAULT_MAX_BUDGET_USD = Number(process.env.MAX_BUDGET_USD) || 0.5;
const DEFAULT_MAX_TURNS = Number(process.env.MAX_TURNS) || 10;
const TIMEOUT_MS = 120000;

const CUSTOMER_CARD_SCHEMA = {
  type: "object",
  properties: {
    structured_fields: {
      type: "object",
      properties: {
        name: { type: "string", description: "客户姓名" },
        company: { type: "string", description: "公司或单位名称" },
        title: { type: "string", description: "职位" },
        phones: {
          type: "array",
          items: { type: "string" },
          description: "手机号列表"
        },
        emails: {
          type: "array",
          items: { type: "string" },
          description: "邮箱列表"
        },
        wechat: { type: "string", description: "微信号" },
        address: { type: "string", description: "地址" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "客户标签（如：高潜、重点跟进、新线索等）"
        }
      },
      required: ["name", "company"]
    },
    profile_markdown: {
      type: "string",
      description: "非结构化补充信息，使用Markdown格式，包括：公开背景、近期动态、业务需求点、关系线索等"
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "置信度分数（0-1之间），表示信息的可靠程度"
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "来源描述" },
          url: { type: "string", description: "来源URL（可选）" }
        },
        required: ["label"]
      },
      description: "信息来源列表"
    }
  },
  required: ["structured_fields", "profile_markdown"],
  additionalProperties: false
};

const SYSTEM_PROMPT = `你是一个专业的B2B销售客户信息研究助手。你的任务是通过Exa搜索工具，快速收集并整理客户信息。

## 可用工具

你可以使用以下Exa MCP工具：
- **web_search_exa**: 高质量网页搜索，返回相关网页内容
- **company_research**: 专门用于公司信息研究
- **linkedin_search**: 搜索LinkedIn上的人物和公司信息

## 工作流程（高效模式）

1. **理解查询**: 分析用户输入的公司名和姓名
2. **智能搜索**:
   - 优先使用 company_research 工具搜索公司信息
   - 使用 linkedin_search 搜索人物职位和背景
   - 使用 web_search_exa 补充其他信息
3. **提取信息**: 从搜索结果中直接提取结构化信息
4. **生成卡片**: 立即输出格式化的 CustomerCard

## 搜索策略（精简高效）

- **第一步**: 使用 company_research 搜索公司基本信息
- **第二步**: 使用 linkedin_search 搜索人物职位和背景
- **第三步**（可选）: 使用 web_search_exa 补充联系方式等信息
- **限制**: 最多 2-3 次搜索，避免过度抓取
- **优先级**: Exa工具已经返回高质量内容，无需额外抓取

## 输出要求

1. **结构化字段**: 填写姓名、公司、职位（必填），其他字段尽力而为
2. **非结构化信息**: 简洁的 Markdown 格式补充（2-3 段即可）
3. **置信度**: 根据信息来源快速评估（0-1）
4. **来源标注**: 记录主要信息来源

## 效率优先原则

- ⚡ **速度优先**: 在 3-5 轮内完成任务
- ✅ **够用即可**: 不追求完美，有基本信息即可返回
- 🚫 **避免过度**: 不要进行超过 3 次的搜索
- 📝 **简洁输出**: profile_markdown 保持简洁（200-500 字）

## 注意事项

- 如果某些字段无法找到，直接留空
- 不要编造信息，只返回可靠来源的数据
- 联系方式需要谨慎处理，避免泄露个人隐私
- Exa工具返回的内容质量高，优先使用这些结果`;

export async function researchCustomer(
  queryText: string,
  options?: {
    maxBudgetUsd?: number;
    maxTurns?: number;
    timeout?: number;
  }
): Promise<{ card: CustomerCard; debug: { name?: string; company?: string } }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
      "Please set it to use AI customer research feature."
    );
  }

  const maxBudgetUsd = options?.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
  const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;
  const timeout = options?.timeout ?? TIMEOUT_MS;

  const prompt = `请帮我研究并整理以下客户的完整信息：

查询内容：${queryText}

请使用Exa MCP工具（web_search_exa、company_research、linkedin_search），联网搜索相关信息，然后生成详细的客户资料卡片。`;

  const sdkOptions: Options = {
    systemPrompt: SYSTEM_PROMPT,
    allowedTools: ["web_search_exa", "company_research_exa", "people_search_exa"],
    mcpServers: {
      "exa": {
        "type": "http",
        "url": "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa,get_code_context_exa,deep_search_exa,crawling_exa,company_research_exa,people_search_exa,deep_researcher_start,deep_researcher_check"
      }
    },
    maxBudgetUsd,
    maxTurns,
    outputFormat: {
      type: "json_schema",
      schema: CUSTOMER_CARD_SCHEMA
    },
    permissionMode: "bypassPermissions"
  };

  try {
    let result: CustomerCard | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("AI research timeout")), timeout);
    });

    const researchPromise = (async () => {
      type DebugMessage = {
        type: string;
        subtype?: string;
        hasStructuredOutput: boolean;
        hasResult: boolean;
      };

      type ResultMessage = {
        type: string;
        subtype?: string;
        structured_output?: unknown;
        result?: string;
        errors?: string[];
      };

      const messages: DebugMessage[] = [];

      for await (const message of query({ prompt, options: sdkOptions })) {
        // 记录消息用于调试
        const resultMessage = message as ResultMessage;
        messages.push({
          type: message.type,
          subtype: resultMessage.subtype,
          hasStructuredOutput: !!resultMessage.structured_output,
          hasResult: !!resultMessage.result
        });

        console.log(`[AI Researcher] Message ${messages.length}:`, {
          type: message.type,
          subtype: resultMessage.subtype,
          hasStructuredOutput: !!resultMessage.structured_output,
          resultLength: resultMessage.result?.length || 0
        });

        // 处理成功结果 - 使用类型守卫
        if (message.type === "result") {
          if (resultMessage.subtype === "success") {
            // 优先使用 structured_output
            if (resultMessage.structured_output) {
              console.log("[AI Researcher] Found structured_output, returning result");
              console.log("\n=== AI Research Result (JSON) ===");
              console.log(JSON.stringify(resultMessage.structured_output, null, 2));
              console.log("=================================\n");
              return resultMessage.structured_output as CustomerCard;
            }

            // Fallback: 尝试从 result 字段解析 JSON
            if (resultMessage.result) {
              try {
                console.log("[AI Researcher] Attempting to parse result as JSON");
                const parsed = JSON.parse(resultMessage.result) as CustomerCard;
                console.log("[AI Researcher] Successfully parsed result, returning");
                console.log("\n=== AI Research Result (JSON) ===");
                console.log(JSON.stringify(parsed, null, 2));
                console.log("=================================\n");
                return parsed;
              } catch (e) {
                // 解析失败，继续等待其他消息
                console.warn("[AI Researcher] Failed to parse result as JSON:", e);
              }
            }
          } else {
            // 处理错误结果
            console.error("[AI Researcher] Error result received:", {
              subtype: resultMessage.subtype,
              errors: resultMessage.errors,
              message: resultMessage
            });
            const errorMsg = resultMessage.errors?.join(", ") || "Unknown error";
            throw new Error(`AI research failed: ${resultMessage.subtype} - ${errorMsg}`);
          }
        }
      }

      // 如果循环结束仍未找到结果，提供详细的错误信息
      const summary = messages.map(m => `${m.type}/${m.subtype || 'none'}`).join(", ");
      throw new Error(
        `No valid result returned. Received ${messages.length} messages: ${summary}`
      );
    })();

    result = await Promise.race([researchPromise, timeoutPromise]);

    const debug = {
      name: result.structured_fields.name,
      company: result.structured_fields.company
    };

    return { card: result, debug };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`AI research failed: ${error.message}`);
    }
    throw new Error("AI research failed: Unknown error");
  }
}

export function isAiResearchEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
