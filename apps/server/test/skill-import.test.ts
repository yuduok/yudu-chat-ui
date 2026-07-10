import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseSkillFile } from "../src/skills/import-file.js";

test("parses JSON skills and instructions alias", () => {
  assert.deepEqual(parseSkillFile("writer.json", strToU8(JSON.stringify({ description: "Short answers", instructions: "Be concise." }))), {
    name: "writer",
    description: "Short answers",
    content: "Be concise.",
  });
});

test("parses Markdown skills with frontmatter", () => {
  assert.deepEqual(parseSkillFile("writer.md", strToU8("---\nname: Concise writer\ndescription: Short answers\n---\nUse direct language.\n")), {
    name: "Concise writer",
    description: "Short answers",
    content: "Use direct language.\n",
  });
});

test("parses ZIP skills containing one SKILL.md", () => {
  const archive = zipSync({ "concise-writer/SKILL.md": strToU8("---\nname: Concise writer\n---\nUse direct language.") });
  assert.deepEqual(parseSkillFile("concise-writer.zip", archive), {
    name: "Concise writer",
    description: undefined,
    content: "Use direct language.",
  });
});

test("rejects ambiguous or unsafe ZIP skills", () => {
  assert.throws(() => parseSkillFile("two.zip", zipSync({ "a/SKILL.md": strToU8("a"), "b/SKILL.md": strToU8("b") })), /exactly one/);
  assert.throws(() => parseSkillFile("unsafe.zip", zipSync({ "../SKILL.md": strToU8("a") })), /unsafe path/);
});
