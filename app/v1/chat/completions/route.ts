import { handleOpenAIChatCompletions } from "../../../lib/gateway/openai-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handleOpenAIChatCompletions;
