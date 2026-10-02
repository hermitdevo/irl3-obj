import { getProfile } from "@/lib/scan/profile";

type OnnxWasmEnv = { wasmPaths?: unknown; numThreads?: number };

let done = false;

/**
 * Points ONNX Runtime at our own copy of its WebAssembly build on phones (the
 * light profile), whose memory may grow to 1 GB instead of 4 GB: iOS reserves
 * the whole ceiling up front and fails once a tab has been reloaded a few
 * times (see scripts/copy-vendor.mjs). Call it right after importing
 * @huggingface/transformers and before loading any model.
 */
export function configureOnnx(env: { backends: { onnx: { wasm?: OnnxWasmEnv } } }) {
  if (done) return;
  done = true;
  const wasm = env.backends.onnx.wasm;
  if (!wasm || getProfile().kind !== "light") return;
  // Old Safari without WebGPU gets the plain build; everything else the asyncify one.
  const base = typeof wasm.wasmPaths === "object" && wasm.wasmPaths ? (wasm.wasmPaths as { mjs?: string }).mjs : "";
  const name =
    base && !String(base).includes(".asyncify") ? "ort-wasm-simd-threaded" : "ort-wasm-simd-threaded.asyncify";
  wasm.wasmPaths = { mjs: `/vendor/ort/${name}.mjs`, wasm: `/vendor/ort/${name}.wasm` };
  wasm.numThreads = 1;
}
