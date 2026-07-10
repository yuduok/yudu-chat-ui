import { useRef, useState } from "react";
import type { SkillDefinition } from "@yudu/shared";
import { FileUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as api from "@/lib/api";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function SkillsSettings({ enabled, onEnabledChange, skills, onSkillsChange }: { enabled: boolean; onEnabledChange: (enabled: boolean) => void; skills: SkillDefinition[]; onSkillsChange: (skills: SkillDefinition[]) => void }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const skill = await api.importSkillFile(file);
      onSkillsChange([...skills, skill]);
      toast.success(t("settings.skills.imported"));
    } catch (error: any) {
      toast.error(error?.message ?? t("settings.skills.importFailed"));
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function toggle(skill: SkillDefinition, next: boolean) {
    const updated = await api.setSkillEnabled(skill.id, next);
    onSkillsChange(skills.map((item) => item.id === updated.id ? updated : item));
  }

  async function remove(skill: SkillDefinition) {
    if (!window.confirm(t("settings.skills.deleteConfirm", { name: skill.name }))) return;
    await api.deleteSkill(skill.id);
    onSkillsChange(skills.filter((item) => item.id !== skill.id));
  }

  return <div className="space-y-3">
    <div className="flex items-center justify-between rounded-md border p-4">
      <div><Label>{t("settings.skills.enabled")}</Label><p className="text-[11px] text-muted-foreground">{t("settings.skills.enabledHint")}</p></div>
      <Switch checked={enabled} onCheckedChange={onEnabledChange} />
    </div>
    <input ref={inputRef} type="file" accept="application/json,text/markdown,application/zip,application/x-zip-compressed,.json,.md,.markdown,.zip" className="hidden" onChange={(event) => void importFile(event.target.files?.[0])} />
    <Button type="button" variant="outline" disabled={importing} onClick={() => inputRef.current?.click()}><FileUp className="mr-2 h-4 w-4" />{t("settings.skills.import")}</Button>
    <p className="text-[11px] text-muted-foreground">{t("settings.skills.format")}</p>
    <p className="text-[11px] text-muted-foreground">{t("settings.skills.immediate")}</p>
    {skills.length === 0 ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t("settings.skills.empty")}</p> : skills.map((skill) => <div key={skill.id} className="flex items-start gap-3 rounded-md border p-3">
      <Switch className="mt-0.5" checked={skill.enabled} onCheckedChange={(value) => void toggle(skill, value)} />
      <div className="min-w-0 flex-1"><p className="font-medium">{skill.name}</p>{skill.description && <p className="text-xs text-muted-foreground">{skill.description}</p>}<p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] text-muted-foreground">{skill.content}</p></div>
      <Button type="button" variant="ghost" size="icon" onClick={() => void remove(skill)} aria-label={t("settings.skills.delete")}><Trash2 className="h-4 w-4" /></Button>
    </div>)}
  </div>;
}
