import { ChatPage } from "@/pages/chat-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { useTheme } from "@/hooks/use-theme";

export default function App() {
  const { theme } = useTheme();
  return (
    <TooltipProvider delayDuration={200}>
      <ChatPage />
      <Toaster theme={theme === "system" ? undefined : (theme as any)} position="top-right" />
    </TooltipProvider>
  );
}
