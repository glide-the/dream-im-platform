"use client";

import { useEffect } from "react";

export default function Toast({
  message,
  onClose
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2800);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-full bg-text-primary px-4 py-2 text-xs font-semibold text-white shadow-medium">
      {message}
    </div>
  );
}
