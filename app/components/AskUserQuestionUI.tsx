"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { IconCheck, IconX } from "./Icons";

/**
 * Question field type definitions
 * Based on common ask_user tool patterns
 */
export interface QuestionField {
  /** Field identifier */
  id?: string;
  /** Question/label text */
  question?: string;
  label?: string;
  /** Field type */
  type?: "text" | "textarea" | "select" | "checkbox" | "radio" | "number";
  /** Options for select/radio fields */
  options?: string[] | { value: string; label: string }[];
  /** Whether this field is required */
  required?: boolean;
  /** Default value */
  default?: string | number | boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Description/help text */
  description?: string;
}

/**
 * AskUserQuestion tool input structure
 * The input can be:
 * 1. { questions: QuestionField[] } - Array of question fields
 * 2. { question: string } - Single text question
 * 3. { message: string, options?: string[] } - Message with optional choices
 * 4. Other variations with text/prompt fields
 */
export interface AskUserQuestionInput {
  questions?: QuestionField[];
  question?: string;
  message?: string;
  text?: string;
  prompt?: string;
  options?: string[];
  choices?: string[];
  default?: string;
}

interface AskUserQuestionUIProps {
  /** The tool input parameters */
  input: AskUserQuestionInput;
  /** Tool call ID */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Whether this is currently processing */
  isProcessing?: boolean;
  /** Callback when user submits answers */
  onSubmit: (answers: Record<string, unknown>) => void;
  /** Callback when user cancels/rejects */
  onCancel: () => void;
}

/**
 * Component for rendering an interactive AskUserQuestion tool UI
 * Supports various question formats and renders appropriate form controls
 */
export function AskUserQuestionUI({
  input,
  toolCallId,
  toolName,
  isProcessing = false,
  onSubmit,
  onCancel,
}: AskUserQuestionUIProps) {
  // Parse the questions from input
  const questions = useMemo<QuestionField[]>(() => {
    // Multiple questions format
    if (input.questions && Array.isArray(input.questions)) {
      return input.questions.map((q, i) => ({
        id: q.id || `q${i}`,
        question: q.question || q.label || `问题 ${i + 1}`,
        type: q.type || "text",
        options: q.options,
        required: q.required ?? true,
        default: q.default,
        placeholder: q.placeholder,
        description: q.description,
      }));
    }

    // Single question format
    const questionText =
      input.question || input.message || input.text || input.prompt;
    if (questionText) {
      // If options/choices provided, make it a select/radio
      const options = input.options || input.choices;
      return [
        {
          id: "answer",
          question: questionText,
          type: options && options.length > 0 ? "radio" : "text",
          options: options,
          required: true,
          default: input.default,
        },
      ];
    }

    // Fallback: treat all input keys as potential fields
    return Object.entries(input)
      .filter(([key]) => !["questions", "options", "choices", "default"].includes(key))
      .map(([key, value]) => ({
        id: key,
        question: String(value),
        type: "text" as const,
        required: true,
      }));
  }, [input]);

  // Form state
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    questions.forEach((q) => {
      if (q.default !== undefined) {
        initial[q.id || "answer"] = q.default;
      } else if (q.type === "checkbox") {
        initial[q.id || "answer"] = false;
      } else {
        initial[q.id || "answer"] = "";
      }
    });
    return initial;
  });

  // Handle field change
  const handleChange = useCallback(
    (fieldId: string, value: unknown) => {
      setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    },
    []
  );

  // Handle form submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit(answers);
    },
    [answers, onSubmit]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Enter to submit
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSubmit(answers);
      }
      // Cmd/Ctrl + Escape to cancel
      if ((e.metaKey || e.ctrlKey) && e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [answers, onSubmit, onCancel]);

  // Check if form is valid
  const isValid = useMemo(() => {
    return questions.every((q) => {
      if (!q.required) return true;
      const val = answers[q.id || "answer"];
      if (val === undefined || val === null || val === "") return false;
      return true;
    });
  }, [questions, answers]);

  return (
    <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-lg">❓</span>
          <h3 className="font-medium text-text-primary">请回答以下问题</h3>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          AI 需要您的输入来继续执行
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {questions.map((q, idx) => {
          const fieldId = q.id || `q${idx}`;
          const value = answers[fieldId];

          return (
            <div key={fieldId} className="space-y-2">
              {/* Label */}
              <label
                htmlFor={fieldId}
                className="block text-sm font-medium text-text-primary"
              >
                {q.question}
                {q.required && <span className="text-red-500 ml-1">*</span>}
              </label>

              {/* Description */}
              {q.description && (
                <p className="text-xs text-text-tertiary">{q.description}</p>
              )}

              {/* Field based on type */}
              {q.type === "textarea" ? (
                <textarea
                  id={fieldId}
                  value={String(value || "")}
                  onChange={(e) => handleChange(fieldId, e.target.value)}
                  placeholder={q.placeholder}
                  rows={4}
                  className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent
                    placeholder:text-text-tertiary resize-none"
                  required={q.required}
                  disabled={isProcessing}
                />
              ) : q.type === "select" && q.options ? (
                <select
                  id={fieldId}
                  value={String(value || "")}
                  onChange={(e) => handleChange(fieldId, e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                  required={q.required}
                  disabled={isProcessing}
                >
                  <option value="">请选择...</option>
                  {q.options.map((opt) => {
                    const optValue = typeof opt === "string" ? opt : opt.value;
                    const optLabel = typeof opt === "string" ? opt : opt.label;
                    return (
                      <option key={optValue} value={optValue}>
                        {optLabel}
                      </option>
                    );
                  })}
                </select>
              ) : q.type === "radio" && q.options ? (
                <div className="space-y-2">
                  {q.options.map((opt) => {
                    const optValue = typeof opt === "string" ? opt : opt.value;
                    const optLabel = typeof opt === "string" ? opt : opt.label;
                    return (
                      <label
                        key={optValue}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name={fieldId}
                          value={optValue}
                          checked={value === optValue}
                          onChange={(e) =>
                            handleChange(fieldId, e.target.value)
                          }
                          className="w-4 h-4 text-accent border-border focus:ring-accent"
                          disabled={isProcessing}
                        />
                        <span className="text-sm text-text-primary">
                          {optLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : q.type === "checkbox" ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    id={fieldId}
                    checked={Boolean(value)}
                    onChange={(e) => handleChange(fieldId, e.target.checked)}
                    className="w-4 h-4 text-accent border-border rounded focus:ring-accent"
                    disabled={isProcessing}
                  />
                  <span className="text-sm text-text-primary">是</span>
                </label>
              ) : q.type === "number" ? (
                <input
                  type="number"
                  id={fieldId}
                  value={String(value || "")}
                  onChange={(e) =>
                    handleChange(
                      fieldId,
                      e.target.value === "" ? "" : Number(e.target.value)
                    )
                  }
                  placeholder={q.placeholder}
                  className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent
                    placeholder:text-text-tertiary"
                  required={q.required}
                  disabled={isProcessing}
                />
              ) : (
                <input
                  type="text"
                  id={fieldId}
                  value={String(value || "")}
                  onChange={(e) => handleChange(fieldId, e.target.value)}
                  placeholder={q.placeholder}
                  className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent
                    placeholder:text-text-tertiary"
                  required={q.required}
                  disabled={isProcessing}
                />
              )}
            </div>
          );
        })}

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={isProcessing || !isValid}
            className="flex-1 flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5
              text-sm font-semibold text-white shadow-sm
              hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            <IconCheck className="h-4 w-4" />
            提交
            <span className="text-white/70 text-xs ml-1">⌘↵</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="flex-1 flex items-center justify-center gap-2 rounded-full border border-border
              bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-secondary
              hover:bg-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            <IconX className="h-4 w-4" />
            取消
            <span className="text-text-tertiary text-xs ml-1">⌘⎋</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default AskUserQuestionUI;
