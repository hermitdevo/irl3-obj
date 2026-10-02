"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import objectDrawing from "@/assets/effect.png";
import objectPhoto from "@/assets/right-photo.png";
import { ObjectCreate } from "@/components/library/object-create";
import { SideVisual } from "@/components/layout/side-visual";
import { SplitPage } from "@/components/layout/split-page";

/**
 * Scanning a new object into the library, beside the pink banana.
 */
export function NewObject() {
  const router = useRouter();
  const [camera, setCamera] = useState(false);
  return (
    <SplitPage camera={camera} visual={<SideVisual photo={objectPhoto} drawing={objectDrawing} />}>
      <ObjectCreate
        label="Object Library"
        onCamera={setCamera}
        onBack={() => router.push("/library")}
        onSaved={() => router.push("/library")}
      />
    </SplitPage>
  );
}
