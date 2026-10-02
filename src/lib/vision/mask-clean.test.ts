import { describe, expect, it } from "vitest";
import { cleanMask } from "./mask-clean";

const S = 40;
const at = (m: Uint8Array, x: number, y: number) => m[y * S + x];

/** A filled square from (a, a) to (b, b). */
function square(m: Uint8Array, a: number, b: number) {
  for (let y = a; y <= b; y++) for (let x = a; x <= b; x++) m[y * S + x] = 255;
}

describe("cleanMask", () => {
  it("keeps the largest piece, drops specks, fills holes", () => {
    const m = new Uint8Array(S * S);
    square(m, 5, 30);
    m[15 * S + 15] = 0; // a hole
    m[16 * S + 16] = 0;
    m[2 * S + 37] = 255; // a speck far away
    square(m, 34, 36); // a small separate piece
    const out = cleanMask(m, S);
    expect(at(out, 15, 15)).toBe(255);
    expect(at(out, 16, 16)).toBe(255);
    expect(at(out, 37, 2)).toBe(0);
    expect(at(out, 35, 35)).toBe(0);
    expect(at(out, 18, 18)).toBe(255);
    expect(at(out, 0, 0)).toBe(0);
  });

  it("smooths a ragged edge", () => {
    const m = new Uint8Array(S * S);
    square(m, 10, 29);
    m[10 * S + 31] = 255; // a one-pixel spike off the side
    m[10 * S + 30] = 255;
    const out = cleanMask(m, S);
    expect(at(out, 31, 10)).toBe(0);
  });

  it("leaves an empty mask empty", () => {
    expect(cleanMask(new Uint8Array(S * S), S).every((v) => v === 0)).toBe(true);
  });
});
