import { useCallback, useState, useRef } from "react";

/**
 * Hook for clipboard copy with reset feedback
 * Reference: cgoinglove/better-chatbot src/hooks/use-copy.ts
 */
export function useCopy(resetDelay = 2000) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const copy = useCallback(
        (text: string) => {
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => setCopied(false), resetDelay);
            });
        },
        [resetDelay]
    );

    return { copied, copy };
}
