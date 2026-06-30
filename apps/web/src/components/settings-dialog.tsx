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
import type { ProviderConfig } from "@yudu/shared";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [draft, setDraft] = useState<Record<string, { apiKey: string; baseUrl: string; show: boolean }>>({});
  const [active, setActive] = useState<string>("");
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
        };
      }
      setDraft(init);
      if (ps[0]) setActive(ps[0].id);
    })();
  }, [open]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, [theme]);

  async function save() {
    const payload = {
      providers: Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, { apiKey: v.apiKey, baseUrl: v.baseUrl }]),
      ),
    };
    await api.saveSettings(payload);
    toast.success("Settings saved");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure model providers and UI preferences. Keys are stored locally on the server.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="providers">
          <TabsList>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="ui">Appearance</TabsTrigger>
          </TabsList>

          <TabsContent value="providers" className="space-y-3">
            <div className="flex items-center gap-3">
              <Label className="shrink-0">Provider</Label>
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

            {active && draft[active] && (
              <div className="space-y-3 rounded-md border p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="apikey">API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="apikey"
                      type={draft[active].show ? "text" : "password"}
                      placeholder="sk-..."
                      value={draft[active].apiKey}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [active]: { ...d[active], apiKey: e.target.value } }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setDraft((d) => ({ ...d, [active]: { ...d[active], show: !d[active].show } }))}
                    >
                      {draft[active].show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Leave blank to keep existing key. The mock provider does not require a key.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="baseurl">Base URL</Label>
                  <Input
                    id="baseurl"
                    placeholder="https://api.openai.com/v1"
                    value={draft[active].baseUrl}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [active]: { ...d[active], baseUrl: e.target.value } }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Models</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {providers.find((p) => p.id === active)?.models.map((m) => (
                      <code key={m} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        {m}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ui" className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <Label>Dark mode</Label>
                <p className="text-[11px] text-muted-foreground">Follow system if "Theme" is set to System.</p>
              </div>
              <Switch
                checked={dark}
                onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
              />
            </div>
            <div className="space-y-1.5 rounded-md border p-4">
              <Label>Theme</Label>
              <Select value={theme} onValueChange={(v) => setTheme(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
