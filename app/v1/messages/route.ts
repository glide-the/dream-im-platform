import { handleAnthropicMessages } from "../../lib/gateway/anthropic-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handleAnthropicMessages;
