// Tauri 壳层入口。
// 在 Web 模式下,直接提示用户访问 Web 端,不重复渲染 UI;
// 在 Tauri 模式下,通过 IPC 控制后端 sidecar 与窗口。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";

interface ServerStatus {
  running: boolean;
  port: number;
}

function render(el: HTMLElement) {
  const isDesktop = isTauri();
  el.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
                padding: 24px; line-height: 1.6; max-width: 720px; margin: 0 auto;">
      <h1 style="margin-bottom: 8px;">Yudu Chat — Desktop shell</h1>
      <p style="color: #555; margin-top: 0;">
        ${
          isDesktop
            ? "Tauri 桌面壳已启动。后端 sidecar 正在 <code>127.0.0.1</code> 上监听。"
            : "当前在浏览器中打开,实际窗口由 Tauri 桌面壳加载。"
        }
      </p>
      <div id="status" style="margin: 16px 0; padding: 12px; border: 1px solid #eee; border-radius: 8px;">
        正在查询后端状态…
      </div>
      <div id="log" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                          font-size: 12px; color: #333; white-space: pre-wrap;
                          background: #fafafa; padding: 12px; border-radius: 8px;
                          min-height: 60px;"></div>
    </div>
  `;

  const statusEl = el.querySelector<HTMLDivElement>("#status")!;
  const logEl = el.querySelector<HTMLDivElement>("#log")!;
  const append = (line: string) => {
    logEl.textContent += (logEl.textContent ? "\n" : "") + line;
  };

  if (!isDesktop) {
    statusEl.textContent =
      "当前是 Web 模式。Web UI 请访问 apps/web(由 pnpm dev:web 启动)。";
    return;
  }

  (async () => {
    try {
      const status = await invoke<ServerStatus>("server_status");
      statusEl.textContent = `Sidecar running: ${status.running} · port: ${status.port}`;
      const unlisten = await listen("server-event", (e) => append(String(e.payload)));
      window.addEventListener("beforeunload", () => {
        unlisten();
      });
    } catch (err) {
      statusEl.textContent = `查询失败:${String(err)}`;
    }
  })();
}

const root = document.getElementById("root");
if (root) render(root);
