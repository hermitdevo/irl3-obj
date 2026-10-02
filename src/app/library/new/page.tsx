import type { Metadata } from "next";
import { NewObject } from "@/components/library/new-object";

export const metadata: Metadata = { title: "New object · IRL3 Objects" };

export default function NewObjectPage() {
  return <NewObject />;
}
