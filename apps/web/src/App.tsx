import { ChatPage } from "@/pages/chat-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { useTheme } from "@/hooks/use-theme";
import { ImageGenerationPage } from "@/pages/image-generation-page";
import { useEffect, useState } from "react";

export default function App() {
  const { theme } = useTheme();
  const [route, setRoute] = useState(() => window.location.hash || "#/chat");
  useEffect(() => {
    const listener = () => setRoute(window.location.hash || "#/chat");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return (
    <TooltipProvider delayDuration={200}>
      {route.startsWith("#/images") ? <ImageGenerationPage /> : <ChatPage />}
      <Toaster theme={theme === "system" ? undefined : (theme as any)} position="top-right" />
    </TooltipProvider>
  );
}
