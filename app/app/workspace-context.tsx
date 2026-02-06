"use client";

import { createContext, useContext, useMemo, useState, type Dispatch, type SetStateAction } from "react";

type WorkspaceSessionContextValue = {
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
};

const WorkspaceSessionContext = createContext<WorkspaceSessionContextValue>({
  activeSessionId: null,
  setActiveSessionId: () => undefined,
});

export function WorkspaceSessionProvider({ children }: { children: React.ReactNode }) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const value = useMemo(
    () => ({ activeSessionId, setActiveSessionId }),
    [activeSessionId]
  );

  return (
    <WorkspaceSessionContext.Provider value={value}>
      {children}
    </WorkspaceSessionContext.Provider>
  );
}

export function useWorkspaceSession() {
  return useContext(WorkspaceSessionContext);
}
