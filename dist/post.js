import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  createCacheStore,
  getErrorMessage,
  getState,
  isRecord,
  saveBuildCache,
  warning
} from "./chunk-72S36MPG.js";

// src/post.ts
import path from "node:path";
function isBuildCacheState(value) {
  return isRecord(value) && typeof value.directory === "string" && typeof value.key === "string" && typeof value.maxBytes === "number" && Number.isSafeInteger(value.maxBytes) && value.maxBytes >= 1 && typeof value.readOnly === "boolean" && (value.hit === void 0 || typeof value.hit === "string");
}
async function run() {
  const saved = getState("build-cache");
  if (!saved) {
    return;
  }
  const state = JSON.parse(saved);
  if (!isBuildCacheState(state)) {
    throw new Error("Invalid build cache state.");
  }
  const root = path.join(process.env.RUNNER_TEMP ?? "", "setup-zig-v1");
  await saveBuildCache(state, root, createCacheStore(true, state.readOnly));
}
run().catch(
  (error) => warning(`Could not save Zig cache: ${getErrorMessage(error)}`)
);
