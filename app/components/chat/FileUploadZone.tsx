"use client";

import { useCallback, useRef, useState } from "react";

interface FileUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  isUploading?: boolean;
}

export default function FileUploadZone({ onFilesSelected, isUploading }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      onFilesSelected(Array.from(files));
    },
    [onFilesSelected],
  );

  return (
    <div
      className={`rounded-xl border border-dashed p-4 text-sm transition-all ${isDragging ? "border-[#F97316] bg-[#1F2937]/90 shadow-[0_0_20px_rgba(249,115,22,0.35)]" : "border-[#374151] bg-[#1F2937]"} ${isUploading ? "opacity-70" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-white">拖拽文件到此处</p>
          <p className="text-xs text-slate-300">或点击上传至 workspace</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-[#F97316] px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-orange-500"
          disabled={isUploading}
        >
          选择文件
        </button>
      </div>
    </div>
  );
}
