"use client";

import { useMemo } from "react";
import type { WorkspaceFile } from "../../hooks/useWorkspaceFiles";

interface FileTreeViewProps {
  files: WorkspaceFile[];
  onDelete: (filePath: string) => void;
  onMove: (filePath: string) => void;
}

interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  updatedAt: string;
  children: FileNode[];
}

function buildTree(files: WorkspaceFile[]): FileNode[] {
  const root: FileNode = {
    name: "",
    path: "",
    type: "dir",
    size: 0,
    updatedAt: "",
    children: [],
  };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let current = root;
    segments.forEach((segment, index) => {
      const existing = current.children.find((child) => child.name === segment);
      const isLeaf = index === segments.length - 1;
      if (existing) {
        current = existing;
        return;
      }
      const newNode: FileNode = {
        name: segment,
        path: segments.slice(0, index + 1).join("/"),
        type: isLeaf ? file.type : "dir",
        size: isLeaf ? file.size : 0,
        updatedAt: isLeaf ? file.updatedAt : "",
        children: [],
      };
      current.children.push(newNode);
      current = newNode;
    });
  }

  return root.children;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function FileNodeRow({
  node,
  onDelete,
  onMove,
  depth = 0,
}: {
  node: FileNode;
  onDelete: (path: string) => void;
  onMove: (path: string) => void;
  depth?: number;
}) {
  const isDirectory = node.type === "dir";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-[#111827] px-3 py-2 text-xs text-slate-200">
        <div className="flex items-center gap-2" style={{ paddingLeft: depth * 12 }}>
          <span className="text-[#34D399]">{isDirectory ? "📁" : "📄"}</span>
          <span className="max-w-[140px] truncate">{node.name}</span>
          {!isDirectory && <span className="text-slate-400">{formatFileSize(node.size)}</span>}
        </div>
        {!isDirectory && (
          <div className="flex items-center gap-2 text-[10px]">
            <button
              onClick={() => onMove(node.path)}
              className="rounded bg-[#1F2937] px-2 py-1 text-[#F97316] hover:text-orange-300"
            >
              移动
            </button>
            <button
              onClick={() => onDelete(node.path)}
              className="rounded bg-[#1F2937] px-2 py-1 text-red-300 hover:text-red-200"
            >
              删除
            </button>
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="space-y-2">
          {sortNodes(node.children).map((child) => (
            <FileNodeRow key={child.path} node={child} onDelete={onDelete} onMove={onMove} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTreeView({ files, onDelete, onMove }: FileTreeViewProps) {
  const tree = useMemo(() => sortNodes(buildTree(files)), [files]);

  if (tree.length === 0) {
    return <p className="text-xs text-slate-400">当前 workspace 还没有文件。</p>;
  }

  return (
    <div className="space-y-3">
      {tree.map((node) => (
        <FileNodeRow key={node.path} node={node} onDelete={onDelete} onMove={onMove} />
      ))}
    </div>
  );
}
