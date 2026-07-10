import { create } from "zustand";
import type { ImageGeneration, ImageGenerationRequest } from "@yudu/shared";
import * as api from "@/lib/api";

interface ImageGenerationState {
  items: ImageGeneration[];
  generating: boolean;
  error: string | null;
  load: () => Promise<void>;
  generate: (input: ImageGenerationRequest) => Promise<ImageGeneration | null>;
  remove: (id: string) => Promise<void>;
  cancel: () => void;
}

let abortController: AbortController | null = null;

export const useImageGeneration = create<ImageGenerationState>((set) => ({
  items: [],
  generating: false,
  error: null,
  async load() {
    try { set({ items: await api.listImageGenerations(), error: null }); }
    catch (error: any) { set({ error: error?.message ?? "Failed to load image history" }); }
  },
  async generate(input) {
    abortController = new AbortController();
    set({ generating: true, error: null });
    try {
      const item = await api.createImageGeneration(input, abortController.signal);
      set((state) => ({ items: [item, ...state.items] }));
      return item;
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        set({ error: error?.message ?? "Image generation failed" });
        try { set({ items: await api.listImageGenerations() }); } catch {}
      }
      return null;
    } finally {
      abortController = null;
      set({ generating: false });
    }
  },
  async remove(id) {
    await api.deleteImageGeneration(id);
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },
  cancel() { abortController?.abort(); },
}));
