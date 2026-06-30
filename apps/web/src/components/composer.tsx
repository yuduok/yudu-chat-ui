import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@/store/chat";

export function Composer() {
  const send = useChat((s) => s.sendMessage);
  const stop = useChat((s) => s.stop);
  const streaming = useChat((s) => s.streaming);

  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || streaming) return;
    setValue("");
    void send(text);
  }

  return (
    <div className="border-t bg-background/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
          className="min-h-[44px] resize-none"
          rows={1}
        />
        {streaming ? (
          <Button onClick={stop} variant="destructive" size="icon" title="Stop">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} size="icon" disabled={!value.trim()} title="Send">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="mx-auto mt-1 max-w-3xl text-[11px] text-muted-foreground">
        AI can make mistakes. Verify important info.
      </p>
    </div>
  );
}
