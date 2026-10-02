/**
 * The split pages (Scan the World, new object): content on the left, a visual
 * on the right. While a camera is on, the left column is filled edge to edge
 * (the whole screen under the header on phones) and nothing scrolls. The left <section> stays the same element either way, so what
 * it holds keeps its state.
 */
export function SplitPage({
  camera,
  visual,
  children,
}: {
  camera: boolean;
  visual: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`-my-8 grid grid-cols-1 md:grid-cols-12 ${
        camera ? "h-[calc(100dvh-var(--header-height))] overflow-hidden" : "min-h-[calc(100dvh-var(--header-height))]"
      }`}
    >
      <section
        className={
          camera
            ? "fixed inset-x-0 top-[var(--header-height)] bottom-0 z-10 touch-none md:relative md:inset-auto md:z-auto md:col-span-5 md:h-full md:min-h-0 lg:col-span-4"
            : "flex min-w-0 flex-col px-4 py-8 sm:px-6 md:col-span-5 lg:col-span-4 lg:px-8"
        }
      >
        {children}
      </section>
      {visual}
    </div>
  );
}
