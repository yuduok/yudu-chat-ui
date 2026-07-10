import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yudu-skills-test-"));
process.env.YUDU_DATA_DIR = testDataDir;
const skills = await import("../src/skills/index.js");

test.after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));
test.afterEach(() => fs.rmSync(path.join(testDataDir, "skills.json"), { force: true }));

test("skills can be imported, disabled, and deleted", () => {
  const skill = skills.importSkill({ name: "Concise writer", description: "Short answers", content: "Prefer direct language." });
  assert.equal(skills.listSkills().length, 1);
  assert.match(skills.getEnabledSkillsPrompt() ?? "", /Prefer direct language/);
  skills.setSkillEnabled(skill.id, false);
  assert.equal(skills.getEnabledSkillsPrompt(), undefined);
  assert.equal(skills.deleteSkill(skill.id), true);
  assert.deepEqual(skills.listSkills(), []);
});

test("skill import validates and rejects duplicates", () => {
  assert.throws(() => skills.importSkill({ name: "", content: "instructions" }), /name is required/);
  assert.throws(() => skills.importSkill({ name: "Example", content: "" }), /content is required/);
  assert.throws(() => skills.importSkill({ name: "x".repeat(121), content: "instructions" }), /name is too long/);
  skills.importSkill({ name: "Example", content: "instructions" });
  assert.throws(() => skills.importSkill({ name: "example", content: "different" }), /already imported/);
});
