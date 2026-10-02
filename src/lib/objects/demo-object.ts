import { swatch } from "@/lib/art/object-palette";
import type { LibraryObject } from "./object-library";

/**
 * IRL3's pink banana: a demo object in everyone's library (drawn from a real
 * photo by the line-art engine).
 */
export const DEMO_OBJECT: LibraryObject = {
  id: "demo-pink-banana",
  kind: "banana",
  colorName: "pink",
  color: swatch("pink"),
  art: "/objects/pink-banana.png",
  createdAt: 0,
  demo: true,
};
