/**
 * Colours for object drawings. The scanner names an object's colour (see
 * lib/vision/object-color.ts); each name has one swatch, and one drawing colour
 * that stays readable on the black cards: dark colours are lifted, so a black
 * object is drawn in light grey and a brown one in a light brown.
 */

const SWATCH: Record<string, string> = {
  black: "#1f1f1f",
  white: "#f2f2f2",
  silver: "#c0c0c0",
  gray: "#808080",
  brown: "#8b5a2b",
  beige: "#e8dcc0",
  gold: "#d4a017",
  pink: "#ec4899",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#8b5cf6",
};

const DRAWING: Record<string, string> = {
  black: "#b5b5b5",
  white: "#ffffff",
  silver: "#d4d4d4",
  gray: "#a3a3a3",
  brown: "#c8925e",
  beige: "#eadfc4",
  gold: "#e6b93a",
  pink: "#f472b6",
  red: "#f87171",
  orange: "#fb923c",
  yellow: "#facc15",
  green: "#4ade80",
  teal: "#2dd4bf",
  blue: "#60a5fa",
  purple: "#a78bfa",
};

/** A colour name the scanner gives. */
export const isColorName = (name: string) => Object.hasOwn(SWATCH, name);

/** The swatch for a colour name (a neutral grey if the name is unknown). */
export const swatch = (name: string | null | undefined) => (name && SWATCH[name]) || "#808080";

/** The colour an object of this colour is drawn in (white if the name is unknown). */
export const drawingColor = (name: string | null | undefined) => (name && DRAWING[name]) || "#ffffff";

/**
 * Recolours a white line-art PNG (data URL) into `color`, keeping its
 * transparency. Browser only.
 */
export async function tintArt(art: string, color: string): Promise<string> {
  // onload, not decode(): decode() never settles while the tab is in the background.
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not read the drawing"));
    el.src = art;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  // Keep the drawing's alpha, replace its colour.
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
