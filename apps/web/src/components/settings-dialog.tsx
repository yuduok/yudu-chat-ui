import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useI18n, type Locale } from "@/i18n";
import type { ProviderConfig } from "@yudu/shared";
import type { SkillDefinition } from "@yudu/shared";
import { SkillsSettings } from "@/components/skills-settings";
import { toast } from "sonner";
import { Check, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

// Per-provider memory of the most recent fetch and per-row selection state.
// Held in component state rather than zustand because it's transient UI state.
interface FetchedModels {
  models: string[];
  source: "remote" | "fallback";
  error?: string;
}

type SettingsTab = "providers" | "images" | "skills" | "appearance";

export function SettingsDialog({ open, onOpenChange, onSaved, defaultTab = "providers" }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved?: () => void | Promise<void>; defaultTab?: SettingsTab }) {
  const { t, locale, setLocale } = useI18n();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [draft, setDraft] = useState<Record<string, { apiKey: string; baseUrl: string; show: boolean; manualModels: string[] }>>({});
  const [active, setActive] = useState<string>("");
  const [imageDraft, setImageDraft] = useState<Record<string, { name: string; apiKey: string; baseUrl: string; model: string; show: boolean; copyFrom?: string }>>({});
  const [deletedImageProviders, setDeletedImageProviders] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
  const [skillsEnabled, setSkillsEnabled] = useState(false);
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<Record<string, FetchedModels>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const { theme, setTheme } = useTheme();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    if (!open) return;
    setActiveTab(defaultTab);
    (async () => {
      const [ps, st, installedSkills] = await Promise.all([api.listProviders(), api.getSettings(), api.listSkills()]);
      setProviders(ps);
      const init: typeof draft = {};
      for (const p of ps) {
        const cur = st.providers[p.id];
        init[p.id] = {
          apiKey: cur?.apiKeyMasked ?? "",
          baseUrl: cur?.baseUrl ?? p.baseUrl ?? "",
          show: false,
          manualModels: cur?.manualModels ?? [],
        };
      }
      setDraft(init);
      const imageProviderIds = Array.from(new Set(["openai", "custom", ...Object.keys(st.imageProviders).filter((id) => id.startsWith("custom:"))]));
      setImageDraft(Object.fromEntries(imageProviderIds.map((id) => [id, {
        name: st.imageProviders[id]?.name ?? (id === "openai" ? "OpenAI" : "Custom"),
        apiKey: st.imageProviders[id]?.apiKeyMasked ?? "",
        baseUrl: st.imageProviders[id]?.baseUrl ?? "",
        model: st.imageProviders[id]?.model ?? (id === "openai" ? "" : "gpt-image-2"),
        show: false,
      }])));
      setDeletedImageProviders([]);
      setSkillsEnabled(st.skills.enabled);
      setSkills(installedSkills);
      if (ps[0]) setActive(ps[0].id);
      setFetched({});
      setPicked({});
    })();
  }, [open, defaultTab]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, [theme]);

  function setField<K extends "apiKey" | "baseUrl">(id: string, key: K, value: string) {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  }

  function addManual(id: string) {
    const v = manualInput.trim();
    if (!v) return;
    setDraft((d) => {
      const cur = d[id]?.manualModels ?? [];
      if (cur.includes(v)) return d;
      return { ...d, [id]: { ...d[id], manualModels: [...cur, v] } };
    });
    setManualInput("");
  }

  function removeManual(id: string, model: string) {
    setDraft((d) => ({
      ...d,
      [id]: { ...d[id], manualModels: (d[id]?.manualModels ?? []).filter((m) => m !== model) },
    }));
  }

  function togglePicked(id: string, model: string) {
    setPicked((p) => {
      const cur = p[id] ?? [];
      const next = cur.includes(model) ? cur.filter((m) => m !== model) : [...cur, model];
      return { ...p, [id]: next };
    });
  }

  function addPicked(id: string) {
    const sel = picked[id] ?? [];
    if (sel.length === 0) return;
    setDraft((d) => {
      const cur = d[id]?.manualModels ?? [];
      const merged = Array.from(new Set([...cur, ...sel]));
      return { ...d, [id]: { ...d[id], manualModels: merged } };
    });
    // Clear picks for this provider after promoting them.
    setPicked((p) => ({ ...p, [id]: [] }));
    toast.success(t("settings.fetchedModelsAdded", { count: sel.length }));
  }

  async function fetchModels(id: string) {
    setFetching(true);
    try {
      const res = await api.getProviderModels(id, { remote: true });
      setFetched((f) => ({
        ...f,
        [id]: { models: res.models, source: res.source, error: res.error },
      }));
      if (res.source === "remote" && res.models.length) {
        toast.success(t("settings.fetchedCount", { count: res.models.length }));
      }
    } catch (err: any) {
      toast.error(err?.message ?? t("settings.fetchFailed"));
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    const payload = {
      providers: Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [
          k,
          { apiKey: v.apiKey, baseUrl: v.baseUrl, manualModels: v.manualModels },
        ]),
      ),
      imageProviders: {
        ...Object.fromEntries(Object.entries(imageDraft).map(([id, value]) => [id, { name: value.name, apiKey: value.apiKey, baseUrl: value.baseUrl, model: value.model, copyFrom: value.copyFrom }])),
        ...Object.fromEntries(deletedImageProviders.map((id) => [id, null])),
      },
      skills: { enabled: skillsEnabled },
    };
    await api.saveSettings(payload);
    await onSaved?.();
    toast.success(t("settings.saved"));
    onOpenChange(false);
  }

  const activeDraft = active ? draft[active] : undefined;
  const activeProvider = providers.find((p) => p.id === active);
  const activeFetched = active ? fetched[active] : undefined;
  const activePicked = active ? picked[active] ?? [] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)}>
          <TabsList>
            <TabsTrigger value="providers">{t("settings.tab.providers")}</TabsTrigger>
            <TabsTrigger value="images">{t("settings.tab.imageProviders")}</TabsTrigger>
            <TabsTrigger value="skills">{t("settings.tab.skills")}</TabsTrigger>
            <TabsTrigger value="appearance">{t("settings.tab.appearance")}</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-3">
            <div className="flex items-center gap-3">
              <Label className="shrink-0">{t("settings.provider")}</Label>
              <Select value={active} onValueChange={setActive}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {activeProvider && activeDraft && (
              <div className="space-y-3 rounded-md border p-4">
                <div className="space-y-1.5">
                  <Label>{t("settings.apiKey")}</Label>
                  <div className="flex gap-2">
                    <Input
                      type={activeDraft.show ? "text" : "password"}
                      value={activeDraft.apiKey}
                      onChange={(e) => setField(active, "apiKey", e.target.value)}
                      placeholder={t("settings.apiKey.placeholder")}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          [active]: { ...d[active], show: !d[active].show },
                        }))
                      }
                      title={activeDraft.show ? "Hide" : "Show"}
                      aria-label={activeDraft.show ? "Hide" : "Show"}
                    >
                      {activeDraft.show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("settings.apiKey.hint")}</p>
                </div>

                <div className="space-y-1.5">
                  <Label>{t("settings.baseUrl")}</Label>
                  <Input
                    value={activeDraft.baseUrl}
                    onChange={(e) => setField(active, "baseUrl", e.target.value)}
                    placeholder="https://..."
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>{t("settings.models")}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fetchModels(active)}
                      disabled={fetching}
                    >
                      {fetching ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      )}
                      {fetching ? t("settings.fetching") : t("settings.fetchModels")}
                    </Button>
                  </div>

                  {/* Fetched models picker. Only render when we have a list
                      to show; otherwise fall through to defaults chips. */}
                  {activeFetched?.models.length ? (
                    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
                      <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
                        <span>
                          {t("settings.fetchedModels")} ·{" "}
                          {activeFetched.source === "remote"
                            ? t("settings.source.remote")
                            : t("settings.source.fallback")}
                          {activeFetched.error ? ` — ${activeFetched.error}` : ""}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => addPicked(active)}
                          disabled={activePicked.length === 0}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          {t("settings.fetchedModelsAdd", { count: activePicked.length })}
                        </Button>
                      </div>
                      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                        {activeFetched.models.map((m) => {
                          const already = (activeDraft.manualModels ?? []).includes(m);
                          return (
                            <label
                              key={m}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-background/60"
                            >
                              <Checkbox
                                checked={activePicked.includes(m) || already}
                                disabled={already}
                                onCheckedChange={() => togglePicked(active, m)}
                              />
                              <code className={already ? "text-muted-foreground line-through" : ""}>{m}</code>
                              {already && (
                                <span className="ml-auto rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                                  {t("settings.fetchedModelsAlready")}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {t("settings.manualModels")}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={manualInput}
                        onChange={(e) => setManualInput(e.target.value)}
                        placeholder={t("settings.manualModel.placeholder")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addManual(active);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => addManual(active)}
                        disabled={!manualInput.trim()}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> {t("settings.manualModel.add")}
                      </Button>
                    </div>
                    {activeDraft.manualModels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {activeDraft.manualModels.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]"
                          >
                            {m}
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => removeManual(active, m)}
                              aria-label={t("settings.manualModel.remove")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="images" className="space-y-3">
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => {
                const id = `custom:${crypto.randomUUID()}`;
                setImageDraft((draft) => ({ ...draft, [id]: { name: t("settings.imageProviders.newName"), apiKey: "", baseUrl: "", model: "gpt-image-2", show: false } }));
              }}>
                <Plus className="mr-1 h-3.5 w-3.5" />{t("settings.imageProviders.add")}
              </Button>
            </div>
            {Object.keys(imageDraft).map((id) => {
              const value = imageDraft[id];
              if (!value) return null;
              return <div key={id} className="space-y-3 rounded-md border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {id === "openai" ? <Label>OpenAI</Label> : <div className="space-y-1.5"><Label>{t("settings.imageProviders.name")}</Label><Input value={value.name} onChange={(event) => setImageDraft((draft) => ({ ...draft, [id]: { ...draft[id], name: event.target.value } }))} /></div>}
                    <p className="mt-1 text-[11px] text-muted-foreground">{t(id === "openai" ? "settings.imageProviders.openaiHint" : "settings.imageProviders.customHint")}</p>
                  </div>
                  {id === "custom" && <Button type="button" variant="outline" size="sm" onClick={() => {
                    const nextId = `custom:${crypto.randomUUID()}`;
                    setImageDraft((draft) => ({ ...draft, [nextId]: { ...value, name: t("settings.imageProviders.newName"), show: false, copyFrom: id } }));
                  }}><Plus className="mr-1 h-3.5 w-3.5" />{t("settings.imageProviders.saveAsNew")}</Button>}
                  {id !== "openai" && id !== "custom" && <Button type="button" variant="ghost" size="icon" aria-label={t("settings.imageProviders.delete")} onClick={() => {
                    setImageDraft((draft) => { const next = { ...draft }; delete next[id]; return next; });
                    setDeletedImageProviders((items) => items.includes(id) ? items : [...items, id]);
                  }}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                <div className="space-y-1.5"><Label>{t("settings.apiKey")}</Label><div className="relative"><Input type={value.show ? "text" : "password"} value={value.apiKey} onChange={(event) => setImageDraft((draft) => ({ ...draft, [id]: { ...draft[id], apiKey: event.target.value } }))} /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setImageDraft((draft) => ({ ...draft, [id]: { ...draft[id], show: !draft[id].show } }))}>{value.show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
                <div className="space-y-1.5"><Label>{t("settings.baseUrl")}</Label><Input value={value.baseUrl} onChange={(event) => setImageDraft((draft) => ({ ...draft, [id]: { ...draft[id], baseUrl: event.target.value } }))} placeholder="https://api.example.com/v1" /></div>
                <div className="space-y-1.5"><Label>{t("images.model")}</Label><Input value={value.model} onChange={(event) => setImageDraft((draft) => ({ ...draft, [id]: { ...draft[id], model: event.target.value } }))} placeholder="gpt-image-2" /></div>
              </div>;
            })}
          </TabsContent>

          <TabsContent value="skills"><SkillsSettings enabled={skillsEnabled} onEnabledChange={setSkillsEnabled} skills={skills} onSkillsChange={setSkills} /></TabsContent>

          <TabsContent value="appearance" className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <Label>{t("settings.appearance.dark")}</Label>
                <p className="text-[11px] text-muted-foreground">{t("settings.appearance.darkHint")}</p>
              </div>
              <Switch checked={dark} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
            </div>
            <div className="space-y-1.5 rounded-md border p-4">
              <Label>{t("settings.appearance.theme")}</Label>
              <Select value={theme} onValueChange={(v) => setTheme(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("settings.appearance.theme.system")}</SelectItem>
                  <SelectItem value="light">{t("settings.appearance.theme.light")}</SelectItem>
                  <SelectItem value="dark">{t("settings.appearance.theme.dark")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 rounded-md border p-4">
              <Label>Language</Label>
              <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">中文</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("settings.cancel")}
          </Button>
          <Button onClick={save}>{t("settings.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
