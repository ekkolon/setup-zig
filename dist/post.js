import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  cacheStore,
  getState,
  message,
  record,
  saveBuildCache,
  warning
} from "./chunk-QPYXBJAQ.js";

// src/post.ts
import path from "node:path";
async function run() {
  const saved = getState("build-cache");
  if (!saved) return;
  const state = JSON.parse(saved);
  if (!record(state) || typeof state.directory !== "string" || typeof state.key !== "string" || typeof state.maxBytes !== "number" || !Number.isSafeInteger(state.maxBytes) || state.maxBytes < 1 || typeof state.readOnly !== "boolean" || state.hit !== void 0 && typeof state.hit !== "string")
    throw new Error("Invalid build cache state.");
  const root = path.join(process.env.RUNNER_TEMP ?? "", "setup-zig-v1");
  await saveBuildCache(state, root, cacheStore(true, state.readOnly));
}
run().catch((error) => warning(`Could not save Zig cache: ${message(error)}`));
