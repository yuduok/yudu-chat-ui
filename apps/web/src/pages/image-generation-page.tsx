import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, Loader2, RefreshCw, Settings, Sparkles, Square, Trash2, Upload, X } from "lucide-react";
import type { ImageGeneration, ImageGenerationCapabilities, ImageGenerationRequest } from "@yudu/shared";
import { Sidebar } from "@/components/sidebar";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiAssetUrl, getImageCapabilities, getSettings } from "@/lib/api";
import { useImageGeneration } from "@/store/image-generation";
import { useI18n } from "@/i18n";

type CapabilityEntry = { provider: string; label?: string; capabilities: ImageGenerationCapabilities };
type ReferenceImage = { name: string; dataUrl: string };

const STORAGE_KEY = "yudu-image-generation-defaults";
const isCustomProvider = (id: string) => id === "custom" || id.startsWith("custom:");

function fileToReference(file: File): Promise<ReferenceImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ImageGenerationPage() {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityEntry[]>([]);
  const [configuredModels, setConfiguredModels] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("mock");
  const capability = capabilities.find((entry) => entry.provider === provider)?.capabilities;
  const [model, setModel] = useState("mock-image-1");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("auto");
  const [style, setStyle] = useState("auto");
  const [count, setCount] = useState(1);
  const [outputFormat, setOutputFormat] = useState("png");
  const [background, setBackground] = useState("auto");
  const [moderation, setModeration] = useState("auto");
  const [outputCompression, setOutputCompression] = useState(100);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { items, generating, error, load, generate, remove, cancel } = useImageGeneration();

  async function refreshImageSettings() {
    const [entries, settings] = await Promise.all([getImageCapabilities(), getSettings()]);
    setCapabilities(entries);
    setConfiguredModels(Object.fromEntries(Object.entries(settings.imageProviders).flatMap(([id, value]) => value.model ? [[id, value.model]] : [])));
    if (!entries.some((entry) => entry.provider === provider)) {
      const fallback = entries.find((entry) => entry.provider === "mock") ?? entries[0];
      if (fallback) changeProvider(fallback.provider);
    }
  }

  useEffect(() => {
    void Promise.all([getImageCapabilities(), getSettings()]).then(([entries, settings]) => {
      setCapabilities(entries);
      setConfiguredModels(Object.fromEntries(Object.entries(settings.imageProviders).flatMap(([id, value]) => value.model ? [[id, value.model]] : [])));
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<ImageGenerationRequest>;
      const selected = entries.find((entry) => entry.provider === saved.provider) ?? entries.find((entry) => entry.provider === "mock") ?? entries[0];
      if (!selected) return;
      setProvider(selected.provider);
      const configuredModel = settings.imageProviders[selected.provider]?.model;
      setModel(isCustomProvider(selected.provider) ? saved.model || configuredModel || selected.capabilities.models[0] : selected.capabilities.models.includes(saved.model || "") ? saved.model! : configuredModel || selected.capabilities.models[0]);
      setSize(selected.capabilities.sizes.includes(saved.size || "") ? saved.size! : selected.capabilities.sizes[0]);
      setQuality(selected.capabilities.qualities.includes(saved.quality || "") ? saved.quality! : selected.capabilities.qualities[0]);
      setStyle(selected.capabilities.styles.includes(saved.style || "") ? saved.style! : selected.capabilities.styles[0]);
      setOutputFormat(selected.capabilities.outputFormats.includes(saved.outputFormat || "") ? saved.outputFormat! : selected.capabilities.outputFormats[0]);
      setBackground(selected.capabilities.backgrounds.includes(saved.background || "") ? saved.background! : selected.capabilities.backgrounds[0]);
      setModeration(selected.capabilities.moderations.includes(saved.moderation || "") ? saved.moderation! : selected.capabilities.moderations[0]);
      setOutputCompression(saved.outputCompression ?? 100);
      setCount(Math.min(saved.count || 1, selected.capabilities.maxImages));
      setPreferencesReady(true);
    });
    void load();
  }, [load]);

  useEffect(() => {
    if (!capability) return;
    if (!isCustomProvider(provider) && !capability.models.includes(model)) setModel(capability.models[0]);
    if (!capability.sizes.includes(size)) setSize(capability.sizes[0]);
    if (!capability.qualities.includes(quality)) setQuality(capability.qualities[0]);
    if (!capability.styles.includes(style)) setStyle(capability.styles[0]);
    if (!capability.outputFormats.includes(outputFormat)) setOutputFormat(capability.outputFormats[0]);
    if (!capability.backgrounds.includes(background)) setBackground(capability.backgrounds[0]);
    if (!capability.moderations.includes(moderation)) setModeration(capability.moderations[0]);
    setCount((value) => Math.min(value, capability.maxImages));
    if (!capability.supportsReferenceImages) setReferences([]);
  }, [provider, capability]);

  useEffect(() => {
    if (!preferencesReady || !capability) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      provider,
      model,
      size,
      quality,
      style,
      count,
      outputFormat,
      background,
      moderation,
      outputCompression,
    }));
  }, [preferencesReady, capability, provider, model, size, quality, style, count, outputFormat, background, moderation, outputCompression]);

  const canGenerate = Boolean(capability && prompt.trim() && !generating);
  function changeProvider(nextProvider: string) {
    setProvider(nextProvider);
    const nextCapability = capabilities.find((entry) => entry.provider === nextProvider)?.capabilities;
    setModel(configuredModels[nextProvider] || nextCapability?.models[0] || "");
  }
  const request = useMemo<ImageGenerationRequest | null>(() => capability ? ({
    provider, model, prompt: prompt.trim(), size, quality, style, count, outputFormat, background, moderation, outputCompression,
    referenceImages: references,
  }) : null, [provider, model, prompt, size, quality, style, count, outputFormat, background, moderation, outputCompression, references, capability]);

  async function addReferences(files: FileList | null) {
    if (!files || !capability) return;
    const available = capability.maxReferenceImages - references.length;
    const additions = await Promise.all(Array.from(files)
      .filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type) && file.size <= 8 * 1024 * 1024)
      .slice(0, available)
      .map(fileToReference));
    setReferences((current) => [...current, ...additions]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (!request || !canGenerate) return;
    await generate(request);
  }

  function reuse(item: ImageGeneration) {
    setProvider(item.provider); setModel(item.model); setPrompt(item.prompt);
    setSize(item.options.size); setQuality(item.options.quality); setStyle(item.options.style || "auto");
    setCount(item.options.count); setOutputFormat(item.options.outputFormat); setBackground(item.options.background || "auto");
    setModeration(item.options.moderation || "auto"); setOutputCompression(item.options.outputCompression ?? 100);
    setReferences(item.referenceImages);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex h-full">
      <Sidebar mode="images" onOpenSettings={() => setSettingsOpen(true)} />
      <main className="min-w-0 flex-1 overflow-y-auto bg-muted/20">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-5 py-3 backdrop-blur">
          <div><h1 className="font-semibold">{t("images.title")}</h1><p className="text-xs text-muted-foreground">{t("images.subtitle")}</p></div>
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label={t("sidebar.settings")}><Settings className="h-4 w-4" /></Button>
        </header>
        <div className="mx-auto grid max-w-7xl gap-6 p-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="h-fit space-y-5 rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-20">
            <div className="space-y-2"><Label>{t("images.prompt")}</Label><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-32" placeholder={t("images.promptPlaceholder")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <Option label={t("images.provider")} value={provider} values={capabilities.map((entry) => entry.provider)} valueLabels={Object.fromEntries(capabilities.map((entry) => [entry.provider, entry.label || entry.provider]))} onChange={changeProvider} />
              {isCustomProvider(provider) ? <div className="space-y-2"><Label>{t("images.model")}</Label><Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-image-2" /></div> : <Option label={t("images.model")} value={model} values={capability?.models ?? []} onChange={setModel} />}
              <Option label={t("images.size")} value={size} values={capability?.sizes ?? []} onChange={setSize} />
              <Option label={t("images.quality")} value={quality} values={capability?.qualities ?? []} onChange={setQuality} />
              {capability && capability.styles.length > 0 && <Option label={t("images.style")} value={style} values={capability.styles} onChange={setStyle} />}
              <Option label={t("images.format")} value={outputFormat} values={capability?.outputFormats ?? []} onChange={setOutputFormat} />
              <Option label={t("images.background")} value={background} values={capability?.backgrounds ?? []} onChange={setBackground} />
              <Option label={t("images.moderation")} value={moderation} values={capability?.moderations ?? []} onChange={setModeration} />
              <div className="space-y-2"><Label>{t("images.count")}</Label><Input type="number" min={1} max={capability?.maxImages ?? 1} value={count} onChange={(event) => setCount(Math.max(1, Math.min(Number(event.target.value), capability?.maxImages ?? 1)))} /></div>
              {capability?.supportsOutputCompression && outputFormat !== "png" && <div className="space-y-2"><Label>{t("images.compression")}</Label><Input type="number" min={0} max={100} value={outputCompression} onChange={(event) => setOutputCompression(Math.max(0, Math.min(100, Number(event.target.value))))} /></div>}
            </div>
            {capability?.supportsReferenceImages && (
              <div className="space-y-2">
                <Label>{t("images.references")}</Label>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => void addReferences(event.target.files)} />
                <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground hover:bg-muted/50" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addReferences(event.dataTransfer.files); }}>
                  <Upload className="h-4 w-4" />{t("images.addReferences")}
                </button>
                <div className="grid grid-cols-4 gap-2">{references.map((reference, index) => <div key={`${reference.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border"><img src={reference.dataUrl} alt={reference.name} className="h-full w-full object-cover" /><button onClick={() => setReferences((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-3 w-3" /></button></div>)}</div>
              </div>
            )}
            {error && <p className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
            {generating ? <Button variant="destructive" className="w-full" onClick={cancel}><Square className="mr-2 h-4 w-4" />{t("images.cancel")}</Button> : <Button className="w-full" disabled={!canGenerate} onClick={() => void submit()}><Sparkles className="mr-2 h-4 w-4" />{t("images.generate")}</Button>}
          </section>
          <section className="space-y-4">
            {generating && <div className="flex min-h-64 items-center justify-center rounded-2xl border bg-card"><div className="text-center"><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" /><p className="text-sm">{t("images.generating")}</p></div></div>}
            {!generating && items.length === 0 && <div className="flex min-h-96 items-center justify-center rounded-2xl border border-dashed"><div className="text-center text-muted-foreground"><ImagePlus className="mx-auto mb-3 h-10 w-10" /><p>{t("images.empty")}</p></div></div>}
            {items.map((item) => <GenerationCard key={item.id} item={item} onReuse={() => reuse(item)} onDelete={() => void remove(item.id)} />)}
          </section>
        </div>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={refreshImageSettings} defaultTab="images" />
    </div>
  );
}

function Option({ label, value, values, valueLabels, onChange }: { label: string; value: string; values: string[]; valueLabels?: Record<string, string>; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{values.map((option) => <SelectItem key={option} value={option}>{valueLabels?.[option] ?? option}</SelectItem>)}</SelectContent></Select></div>;
}

function GenerationCard({ item, onReuse, onDelete }: { item: ImageGeneration; onReuse: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  return <article className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.prompt}</p><p className="text-xs text-muted-foreground">{item.provider} · {item.model} · {new Date(item.createdAt).toLocaleString()}</p></div><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={onReuse} title={t("images.reuse")}><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={onDelete} title={t("images.delete")}><Trash2 className="h-4 w-4" /></Button></div></div>{item.status === "failed" ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{item.error}</p> : <div className="grid gap-3 sm:grid-cols-2">{item.images.map((image) => <div key={image.id} className="group relative overflow-hidden rounded-xl border bg-muted"><img src={apiAssetUrl(image.url)} alt={item.prompt} className="aspect-square w-full object-cover" /><a href={apiAssetUrl(image.url)} download={image.filename} className="absolute bottom-2 right-2 rounded-full bg-black/70 p-2 text-white opacity-0 transition group-hover:opacity-100"><Download className="h-4 w-4" /></a></div>)}</div>}</article>;
}
