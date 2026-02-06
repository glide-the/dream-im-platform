"use client";

import { useMemo } from "react";
import { useConversations } from "../../lib/queries";
import type { Conversation } from "../../lib/types";

interface SidebarProps {
  open: boolean;
  desktopCollapsed?: boolean;
  activeConversationId?: string | null;
  onSelectConversation: (conversation: Conversation) => void;
  onNewChat: () => void;
  onClose: () => void;
}

export default function Sidebar({
  open,
  desktopCollapsed = false,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onClose,
}: SidebarProps) {
  const { data, isLoading } = useConversations({ page: 1, pageSize: 10, sort: "updated_at", order: "desc" });
  const conversations = useMemo(() => data?.data ?? [], [data?.data]);

  return (
    <>
      <div className={`fixed inset-0 z-30 bg-black/30 md:hidden ${open ? "block" : "hidden"}`} onClick={onClose} />
      <aside
        className={`fixed left-0 top-0 z-40 h-full w-[280px] border-r border-[var(--neutral-border)] bg-white px-5 py-6 transition-all duration-300 md:static md:z-auto ${open ? "translate-x-0" : "-translate-x-full"} ${desktopCollapsed ? "md:w-0 md:translate-x-0 md:overflow-hidden md:border-r-0 md:px-0 md:py-0" : "md:w-[280px] md:translate-x-0"}`}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">对话</h2>
          <button
            type="button"
            onClick={onNewChat}
            className="relative text-sm font-semibold text-accent-orange after:absolute after:-bottom-1 after:left-1/2 after:h-[2px] after:w-0 after:bg-accent-orange after:content-[''] hover:after:animate-underlineExpand"
          >
            + New Chat
          </button>
        </div>

        <div className="space-y-2 text-sm">
          {isLoading && <p className="text-xs text-text-tertiary">加载中...</p>}
          {!isLoading && conversations.length === 0 && (
            <p className="text-xs text-text-tertiary">暂无对话记录</p>
          )}
          {conversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelectConversation(conversation)}
                className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors ${isActive ? "bg-[#F0F0F0]" : "hover:bg-[#F5F5F5]"}`}
              >
                <span
                  className={`mt-1 h-6 w-0.5 ${isActive ? "bg-accent-orange" : "bg-accent-orange/80"} ${isActive ? "animate-breathe" : ""}`}
                  aria-hidden="true"
                />
                <span className="line-clamp-2 text-[14px] leading-[1.6] text-text-secondary">{conversation.title}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
