/**
 * Tagged Types Utility
 * Minimal runtime type checking with discriminated unions
 * 
 * Reference: cgoinglove/better-chatbot src/lib/tag.ts
 */

const DEFAULT_KEY = "__$ref__" as const;

export type Tagged<TTag extends string, TData> = TData & {
  [DEFAULT_KEY]: TTag;
};

class TagBuilder<TData, TTag extends string> {
  constructor(private tagValue: TTag) {}

  /**
   * Check if a value has this tag
   */
  isMaybe = (value: unknown): value is Tagged<TTag, TData> => {
    return (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      DEFAULT_KEY in value &&
      (value as Record<string, unknown>)[DEFAULT_KEY] === this.tagValue
    );
  };

  /**
   * Create a tagged value
   */
  create = (data: TData): Tagged<TTag, TData> => {
    return {
      ...data,
      [DEFAULT_KEY]: this.tagValue,
    } as Tagged<TTag, TData>;
  };

  /**
   * Unwrap a tagged value to get the original data
   */
  unwrap = (value: Tagged<TTag, TData>): TData => {
    const { [DEFAULT_KEY]: _, ...data } = value;
    return data as TData;
  };
}

/**
 * Create a tag builder for a specific type
 * 
 * @example
 * const MyTag = tag<{ name: string }>('my-tag');
 * const tagged = MyTag.create({ name: 'test' });
 * if (MyTag.isMaybe(value)) {
 *   // value is typed as Tagged<'my-tag', { name: string }>
 * }
 */
export function tag<TData>(tagName: string) {
  return Object.freeze(new TagBuilder<TData, typeof tagName>(tagName));
}
