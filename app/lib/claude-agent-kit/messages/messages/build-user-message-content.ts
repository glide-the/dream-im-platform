import type { AttachmentPayload, UserContentBlock } from "../types";

/** MIME types that can be rendered inline within chat transcripts. */
function decodeBase64Text(value: string): string {
  const globalWithAtob = globalThis as typeof globalThis & {
    atob?: (input: string) => string;
  };

  if (typeof globalWithAtob.atob === 'function') {
    return globalWithAtob.atob(value);
  }

  return Buffer.from(value, 'base64').toString('utf-8');
}

const INLINE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];


/**
 * Runtime context injected from the agent runner so the model
 * is aware of the execution environment.
 */
export interface RuntimeContext {
  /** Agent working directory (from AgentRunOptions.cwd) */
  cwd?: string;
  /** Model being used */
  model?: string;
  /** Maximum conversation turns */
  maxTurns?: number;
  /** Thread / session ID */
  threadId?: string;
  /** Whether this is a resumed conversation */
  resume?: boolean;
}

/**
 * Construct the content blocks for a user message.
 *
 * Combines the prompt text with any attachments into the order expected by Claude:
 * selection/context blocks first, followed by attachments, then the user's message.
 */
export function buildUserMessageContent(
  prompt: string,
  attachments: AttachmentPayload[] | undefined,
  runtimeContext?: RuntimeContext,
): UserContentBlock[] {
  const blocks: UserContentBlock[] = [];

  // Attach any user-supplied assets (images, documents, etc.).
  if (attachments) {
    for (const attachment of attachments) {
      try {
        const mediaType = attachment.mediaType;
        const base64Data = attachment.data;
        // Inline supported image types.
        if (INLINE_IMAGE_MIME_TYPES.includes(mediaType)) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data,
            },
          });
        } else if (mediaType === 'text/plain') {
          // Decode plain text files into inline document blocks.
          const decoded = decodeBase64Text(base64Data);
          blocks.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: decoded,
            },
            title: attachment.name,
          });
        } else if (mediaType === 'application/pdf') {
          // Preserve PDF files as base64 documents.
          blocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Data,
            },
            title: attachment.name,
          });
        } else {
          console.error(`Cannot process file: ${attachment.name}`);
        }
      } catch (error) {
        console.error('Error processing file:', error);
      }
    }
  }

  // Inject system environment context so the model is aware of the runtime.
  const now = new Date();
  const effectiveCwd = runtimeContext?.cwd ?? process.cwd();
  const envLines = [
    `Working directory (workspace): ${effectiveCwd}`,
    `Date: ${now.toISOString()} (${now.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })})`,
    `Platform: ${process.platform} ${process.arch}`,
    `Node.js: ${process.version}`,
    ...(runtimeContext?.model ? [`Model: ${runtimeContext.model}`] : []),
    ...(runtimeContext?.maxTurns != null ? [`Max turns: ${runtimeContext.maxTurns}`] : []),
    ...(runtimeContext?.threadId ? [`Thread ID: ${runtimeContext.threadId}`] : []),
    ...(runtimeContext?.resume ? ['Resumed conversation: yes'] : []),
  ];

  const workspaceGuide = [
    '',
    'Workspace layout:',
    '  files/   — User-uploaded files and working documents. Read/write freely.',
    '  logs/    — Execution logs. Write logs here for traceability.',
    '  skills/  — Reusable skill/prompt files. Files placed here are auto-synced',
    '             to .claude/skills/ for discovery by the SDK.',
    '',
    'Rules:',
    '- All file operations (read/write/create) MUST stay within the workspace directory.',
    '- Do NOT access paths outside the workspace root.',
    '- When creating output files, place them under files/ by default.',
    '- Use relative paths from the workspace root when possible.',
  ];

  blocks.push({
    type: 'text',
    text: `<system_environment>\n${envLines.join('\n')}\n${workspaceGuide.join('\n')}\n</system_environment>`,
  });

  // Always append the raw prompt text at the end.
  blocks.push({
    type: 'text',
    text: prompt,
  });

  return blocks;
}
