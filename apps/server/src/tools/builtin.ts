import { registerTool } from "./index.js";
import { get_weather } from "./get_weather.js";
import { http_fetch } from "./http_fetch.js";
import { execute_command } from "./execute_command.js";
import { list_directory } from "./list_directory.js";
import { read_file } from "./read_file.js";
import { search_files } from "./search_files.js";
import { web_search } from "./web_search.js";
import { write_file } from "./write_file.js";

export function registerBuiltinTools(): void {
  registerTool(get_weather.def, get_weather.handler);
  registerTool(http_fetch.def, http_fetch.handler);
  registerTool(list_directory.def, list_directory.handler);
  registerTool(read_file.def, read_file.handler);
  registerTool(search_files.def, search_files.handler);
  registerTool(write_file.def, write_file.handler, {
    defaultEnabled: false,
    isAvailable: write_file.isAvailable,
  });
  registerTool(execute_command.def, execute_command.handler, {
    defaultEnabled: false,
    isAvailable: execute_command.isAvailable,
  });
  registerTool(web_search.def, web_search.handler, {
    isAvailable: web_search.isAvailable,
  });
}
