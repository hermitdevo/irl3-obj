import Image, { type StaticImageData } from "next/image";
import { DriftLayer } from "./drift-layer";

/** Shown on the visual, bottom right. */
export const APP_VERSION = "V0.01";

/** How far (px) the line drawing drifts toward the pointer. */
const DRIFT = 10;

/**
 * The visual on the right of the split pages (desktop and tablet only): the
 * photo, tinted with the page colour, and a line drawing of the same object
 * over it that drifts a few pixels with the pointer. Pairs with a left column
 * of md:col-span-5 lg:col-span-4 in a 12-column grid.
 */
export function SideVisual({
  photo,
  drawing,
  showDrawing = true,
}: {
  photo: StaticImageData;
  drawing: StaticImageData;
  /** False shows the plain photo; the tint and drawing fade in when it turns true. */
  showDrawing?: boolean;
}) {
  const fade = `transition-opacity duration-700 ease-out ${showDrawing ? "opacity-100" : "opacity-0"}`;
  return (
    <aside className="relative hidden md:col-span-7 md:block lg:col-span-8">
      <div className="sticky top-[var(--header-height)] h-[calc(100vh-var(--header-height))] overflow-hidden">
        <div className="relative h-full w-full">
          <Image src={photo} alt="" fill priority sizes="(min-width: 1024px) 66vw, 58vw" className="object-cover" />
          <div aria-hidden className={`absolute inset-0 bg-background/40 ${fade}`} />
          {/* Same size as the photo, so it lines up with the object under it. */}
          <div className={`absolute inset-0 ${fade}`}>
            <DriftLayer amount={DRIFT} className="absolute inset-0">
              <Image src={drawing} alt="" fill sizes="(min-width: 1024px) 66vw, 58vw" className="object-cover" />
            </DriftLayer>
          </div>
          <div aria-hidden className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
          <span className="absolute right-5 bottom-4 text-xs font-medium tracking-wider text-white/60">
            {APP_VERSION}
          </span>
        </div>
      </div>
    </aside>
  );
}
