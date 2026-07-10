import { lazy, Suspense, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { useTheme } from "@/hooks/use-theme";

const ChatPage = lazy(() =>
  import("@/pages/chat-page").then((module) => ({ default: module.ChatPage })),
);
const ImageGenerationPage = lazy(() =>
  import("@/pages/image-generation-page").then((module) => ({
    default: module.ImageGenerationPage,
  })),
);

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
      <Suspense fallback={<AppLoadingState />}>
        {route.startsWith("#/images") ? <ImageGenerationPage /> : <ChatPage />}
      </Suspense>
      <Toaster theme={theme === "system" ? undefined : (theme as any)} position="top-right" />
    </TooltipProvider>
  );
}

function AppLoadingState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  );
}
