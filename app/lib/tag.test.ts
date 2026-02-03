/**
 * Tests for tag.ts utility
 */
import { describe, it, expect } from "vitest";
import { tag } from "./tag";

describe("tag utility", () => {
  it("should create a tagged value", () => {
    const MyTag = tag<{ name: string }>("my-tag");
    const tagged = MyTag.create({ name: "test" });
    
    expect(tagged.name).toBe("test");
    expect(tagged.__$ref__).toBe("my-tag");
  });

  it("should check if a value has a tag using isMaybe", () => {
    const MyTag = tag<{ name: string }>("my-tag");
    const tagged = MyTag.create({ name: "test" });
    
    expect(MyTag.isMaybe(tagged)).toBe(true);
    expect(MyTag.isMaybe({ name: "test" })).toBe(false);
    expect(MyTag.isMaybe(null)).toBe(false);
    expect(MyTag.isMaybe(undefined)).toBe(false);
    expect(MyTag.isMaybe("string")).toBe(false);
    expect(MyTag.isMaybe(123)).toBe(false);
  });

  it("should distinguish between different tags", () => {
    const TagA = tag<{ value: number }>("tag-a");
    const TagB = tag<{ value: number }>("tag-b");
    
    const taggedA = TagA.create({ value: 1 });
    const taggedB = TagB.create({ value: 2 });
    
    expect(TagA.isMaybe(taggedA)).toBe(true);
    expect(TagA.isMaybe(taggedB)).toBe(false);
    expect(TagB.isMaybe(taggedA)).toBe(false);
    expect(TagB.isMaybe(taggedB)).toBe(true);
  });

  it("should unwrap a tagged value", () => {
    const MyTag = tag<{ name: string; count: number }>("my-tag");
    const tagged = MyTag.create({ name: "test", count: 42 });
    const unwrapped = MyTag.unwrap(tagged);
    
    expect(unwrapped).toEqual({ name: "test", count: 42 });
    expect("__$ref__" in unwrapped).toBe(false);
  });
});
