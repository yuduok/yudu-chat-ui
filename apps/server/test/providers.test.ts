import assert from "node:assert/strict";
import test from "node:test";
import { getProvider, isCustomProvider } from "../src/providers/registry.js";

test("dynamic custom chat provider ids reuse the OpenAI-compatible adapter", () => {
  const provider = getProvider("custom:example");
  assert.equal(isCustomProvider("custom:example"), true);
  assert.equal(provider?.id, "custom:example");
  assert.equal(provider?.supportsTools, true);
  assert.deepEqual(provider?.defaultModels, ["custom-model"]);
  assert.equal(getProvider("unknown"), undefined);
});
