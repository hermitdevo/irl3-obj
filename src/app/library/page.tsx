import type { Metadata } from "next";
import { LocalLibrary } from "@/components/library/local-library";

export const metadata: Metadata = { title: "Object Library · IRL3 Objects" };

export default function LibraryPage() {
  // Full width, not boxed: the grid uses the whole page.
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <LocalLibrary />
    </div>
  );
}
