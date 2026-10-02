/**
 * Precomputes the text side of the object-kind classifier: one MobileCLIP-S0
 * text embedding per entry of OBJECT_KINDS ("a photo of a <kind>"), so the
 * browser only ever runs the small vision model.
 *
 * Output: public/models/object-kinds.bin — int8, one row of DIM values per
 * kind (normalized vector x 127), in OBJECT_KINDS order — and object-kinds.json
 * with the model, template, dimension and the kinds list it was built from.
 *
 *   npm run kinds
 */
import { writeFileSync } from "fs";
import { AutoTokenizer, CLIPTextModelWithProjection } from "@huggingface/transformers";
import { KIND_MODEL, KIND_TEMPLATE, OBJECT_KINDS } from "../src/lib/objects/object-kinds";

async function main() {
  const tokenizer = await AutoTokenizer.from_pretrained(KIND_MODEL);
  const text = await CLIPTextModelWithProjection.from_pretrained(KIND_MODEL, { dtype: "fp32" });
  const inputs = tokenizer(
    OBJECT_KINDS.map((k) => KIND_TEMPLATE.replace("{}", k)),
    { padding: "max_length", truncation: true },
  );
  const rows = (await text(inputs)).text_embeds.normalize().tolist() as number[][];
  const dim = rows[0].length;
  const out = new Int8Array(rows.length * dim);
  rows.forEach((r, i) => r.forEach((v, j) => (out[i * dim + j] = Math.max(-127, Math.min(127, Math.round(v * 127))))));
  writeFileSync("public/models/object-kinds.bin", Buffer.from(out.buffer));
  writeFileSync(
    "public/models/object-kinds.json",
    JSON.stringify({ model: KIND_MODEL, template: KIND_TEMPLATE, dim, kinds: OBJECT_KINDS }, null, 1) + "\n",
  );
  console.log(`${rows.length} kinds x ${dim} -> ${out.length} bytes`);
}

main();
