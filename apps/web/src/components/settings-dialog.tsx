import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useI18n, type Locale } from "@/i18n";
import type { ProviderConfig } from "@yudu/shared";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, locale, setLocale } = useI18n();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [draft, setDraft] = useState<Record<string, { apiKey: string; baseUrl: string; show: boolean; manualModels: string[] }>>({});
  const [active, setActive] = useState<string>("");
  const [manualInput, setManualInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchInfo, setFetchInfo] = useState<{ source: "remote" | "fallback"; error?: string } | null>(null);
  const { theme, setTheme } = useTheme();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [ps, st] = await Promise.all([api.listProviders(), api.getSettings()]);
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
      if (ps[0]) setActive(ps[0].id);
      setFetchInfo(null);
    })();
  }, [open]);

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

  async function fetchModels(id: string) {
    setFetching(true);
    setFetchInfo(null);
    try {
      const res = await api.getProviderModels(id, { remote: true });
      setFetchInfo({ source: res.source, error: res.error });
      if (res.source === "remote" && res.models.length) {
        // Reflect any new defaults surfaced by the server without clobbering manual entries.
        // We don't persist these — the conversation model select below uses the same endpoint.
        toast.success(`${res.models.length} models loaded`);
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
    };
    await api.saveSettings(payload);
    toast.success(t("settings.saved"));
    onOpenChange(false);
  }

  const activeDraft = active ? draft[active] : undefined;
  const activeProvider = providers.find((p) => p.id === active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="providers">
          <TabsList>
            <TabsTrigger value="providers">{t("settings.tab.providers")}</TabsTrigger>
            <TabsTrigger value="appearance">{t("settings.tab.appearance")}</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-3">
            <div className="flex items-center gap-3">
              <Label className="shrink-0">{t("settings.provider")}</Label>
              <Select value={active} onValueChange={(v) => { setActive(v); setFetchInfo(null); }}>
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

            {active && activeDraft && (
              <div className="space-y-3 rounded-md border p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="apikey">{t("settings.apiKey")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="apikey"
                      type={activeDraft.show ? "text" : "password"}
                      placeholder={t("settings.apiKey.placeholder")}
                      value={activeDraft.apiKey}
                      onChange={(e) => setField(active, "apiKey", e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setDraft((d) => ({ ...d, [active]: { ...d[active], show: !d[active].show } }))
                      }
                      aria-label={activeDraft.show ? "Hide" : "Show"}
                    >
                      {activeDraft.show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t("settings.apiKey.hint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="baseurl">{t("settings.baseUrl")}</Label>
                  <Input
                    id="baseurl"
                    placeholder="https://api.openai.com/v1"
                    value={activeDraft.baseUrl}
                    onChange={(e) => setField(active, "baseUrl", e.target.value)}
                  />
                </div>

                {/* Models */}
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

                  {fetchInfo && (
                    <p className="text-[11px] text-muted-foreground">
                      {fetchInfo.source === "remote"
                        ? t("settings.source.remote")
                        : t("settings.source.fallback")}
                      {fetchInfo.error ? ` — ${fetchInfo.error}` : ""}
                    </p>
                  )}

                  {activeProvider?.models.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {activeProvider.models.map((m) => (
                        <code key={m} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          {m}
                        </code>
                      ))}
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
