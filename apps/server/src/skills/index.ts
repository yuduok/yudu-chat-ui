import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { SkillDefinition } from "@yudu/shared";
import { dataDir } from "../data-dir.js";

const skillsPath = path.join(dataDir, "skills.json");
const MAX_SKILLS = 50;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CONTENT_LENGTH = 100_000;
const MAX_ENABLED_CONTENT_LENGTH = 200_000;

function readSkills(): SkillDefinition[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(skillsPath, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isSkill) : [];
  } catch {
    return [];
  }
}

function writeSkills(skills: SkillDefinition[]): void {
  fs.writeFileSync(skillsPath, JSON.stringify(skills, null, 2), "utf8");
}

function isSkill(value: unknown): value is SkillDefinition {
  if (!value || typeof value !== "object") return false;
  const skill = value as Record<string, unknown>;
  return typeof skill.id === "string" && typeof skill.name === "string" && typeof skill.content === "string";
}

export function listSkills(): SkillDefinition[] {
  return readSkills();
}

export function importSkill(input: { name: string; description?: string; content: string }): SkillDefinition {
  const name = input.name.trim();
  const content = input.content.trim();
  if (!name) throw new Error("skill name is required");
  if (!content) throw new Error("skill content is required");
  if (name.length > MAX_NAME_LENGTH) throw new Error("skill name is too long");
  if ((input.description?.length ?? 0) > MAX_DESCRIPTION_LENGTH) throw new Error("skill description is too long");
  if (content.length > MAX_CONTENT_LENGTH) throw new Error("skill content is too long");
  const skills = readSkills();
  if (skills.length >= MAX_SKILLS) throw new Error(`skill limit reached (${MAX_SKILLS})`);
  if (skills.some((skill) => skill.name.toLocaleLowerCase() === name.toLocaleLowerCase() || skill.content === content)) {
    throw new Error("skill already imported");
  }
  const enabledLength = skills.filter((skill) => skill.enabled).reduce((total, skill) => total + skill.content.length, 0);
  if (enabledLength + content.length > MAX_ENABLED_CONTENT_LENGTH) throw new Error("enabled skill content limit reached");
  const skill: SkillDefinition = {
    id: nanoid(),
    name,
    description: input.description?.trim() || undefined,
    content,
    enabled: true,
    createdAt: Date.now(),
  };
  skills.push(skill);
  writeSkills(skills);
  return skill;
}

export function setSkillEnabled(id: string, enabled: boolean): SkillDefinition | undefined {
  const skills = readSkills();
  const skill = skills.find((item) => item.id === id);
  if (!skill) return undefined;
  if (enabled && !skill.enabled) {
    const enabledLength = skills.filter((item) => item.enabled).reduce((total, item) => total + item.content.length, 0);
    if (enabledLength + skill.content.length > MAX_ENABLED_CONTENT_LENGTH) throw new Error("enabled skill content limit reached");
  }
  skill.enabled = enabled;
  writeSkills(skills);
  return skill;
}

export function deleteSkill(id: string): boolean {
  const skills = readSkills();
  const next = skills.filter((item) => item.id !== id);
  if (next.length === skills.length) return false;
  writeSkills(next);
  return true;
}

export function getEnabledSkillsPrompt(): string | undefined {
  const enabled = readSkills().filter((skill) => skill.enabled);
  if (!enabled.length) return undefined;
  return enabled.map((skill) => `## Skill: ${skill.name}\n${skill.description ? `${skill.description}\n\n` : ""}${skill.content}`).join("\n\n");
}
