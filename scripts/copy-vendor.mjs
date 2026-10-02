// Copies browser-only vendor files into public/vendor.
//
// OpenCV.js is ~10 MB and its module object is "thenable", which breaks
// dynamic import(); serving it as a static script avoids both problems.
//
// The ONNX Runtime WebAssembly build is served from here for phones, with its
// memory ceiling lowered: the stock build declares a shared memory that may
// grow to 4 GB, and iOS Safari reserves all of it up front, which fails
// ("RangeError: Out of memory") once a tab has been reloaded a few times. Our
// models need far less than the 1 GB ceiling set here.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORT = "node_modules/onnxruntime-web/dist";
const PAGES_4GB = "maximum:65536,shared:!0";
const PAGES_1GB = "maximum:16384,shared:!0";

const copies = [["node_modules/@techstark/opencv-js/dist/opencv.js", "public/vendor/opencv.js"]];
for (const name of ["ort-wasm-simd-threaded.asyncify", "ort-wasm-simd-threaded"]) {
  copies.push([`${ORT}/${name}.wasm`, `public/vendor/ort/${name}.wasm`]);
}
const patched = [
  [`${ORT}/ort-wasm-simd-threaded.asyncify.mjs`, "public/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs"],
  [`${ORT}/ort-wasm-simd-threaded.mjs`, "public/vendor/ort/ort-wasm-simd-threaded.mjs"],
];

for (const [from, to] of copies) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
  console.log(`vendor: ${to}`);
}

for (const [from, to] of patched) {
  const source = readFileSync(join(root, from), "utf8");
  const count = source.split(PAGES_4GB).length - 1;
  if (count !== 1) throw new Error(`${from}: expected one 4 GB memory declaration, found ${count}`);
  writeFileSync(join(root, to), source.replace(PAGES_4GB, PAGES_1GB));
  console.log(`vendor: ${to} (memory ceiling 1 GB)`);
}
