import { describe, expect, it } from "vitest";
import { normalizeCode, ROOM_ALPHABET, ROOM_CODE } from "./room";

describe("room codes", () => {
  it("accept 3 unambiguous letters, typed loosely", () => {
    expect(ROOM_CODE.test("KZB")).toBe(true);
    expect(ROOM_CODE.test(normalizeCode(" k-z b "))).toBe(true);
    expect(ROOM_CODE.test("KZBA")).toBe(false);
    expect(ROOM_CODE.test("OIL")).toBe(false); // confusable letters aren't used
    expect(ROOM_ALPHABET).not.toMatch(/[OIL0-9]/);
  });
});
