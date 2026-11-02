import { describe, expect, it } from "vitest";
import { normalizeCode, ROOM_ALPHABET, ROOM_CODE } from "./room";

describe("room codes", () => {
  it("accept 6 unambiguous characters, typed loosely", () => {
    expect(ROOM_CODE.test("53K27C")).toBe(true);
    expect(ROOM_CODE.test(normalizeCode(" 53k-27c "))).toBe(true);
    expect(ROOM_CODE.test("O0I1L5")).toBe(false); // confusable characters aren't used
    expect(ROOM_ALPHABET).not.toMatch(/[O0I1L]/);
  });
});
