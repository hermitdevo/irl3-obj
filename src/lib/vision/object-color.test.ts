import { describe, expect, it } from "vitest";
import { colorName, toLab } from "./object-color";

const named = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return colorName(...toLab(r, g, b));
};

describe("colorName", () => {
  it.each([
    ["#ff0000", "red"],
    ["#b4202a", "red"],
    ["#dc143c", "red"],
    ["#8b0000", "red"],
    ["#ff8c00", "orange"],
    ["#f97316", "orange"],
    ["#ffd700", "yellow"],
    ["#22c55e", "green"],
    ["#14b8a6", "teal"],
    ["#2563eb", "blue"],
    ["#7c3aed", "purple"],
    ["#ff69b4", "pink"],
    ["#ff1493", "pink"],
    ["#c2307a", "pink"],
    ["#6b3e1f", "brown"],
    ["#111111", "black"],
    ["#f5f5f5", "white"],
    ["#808080", "gray"],
  ])("%s is %s", (hex, name) => {
    expect(named(hex)).toBe(name);
  });
});
