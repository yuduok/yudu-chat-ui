import { registerTool } from "./index.js";
import { get_weather } from "./get_weather.js";
import { http_fetch } from "./http_fetch.js";

export function registerBuiltinTools(): void {
  registerTool(get_weather.def, get_weather.handler);
  registerTool(http_fetch.def, http_fetch.handler);
}
