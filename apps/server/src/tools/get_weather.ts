import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";

// Mock weather tool. Returns a small JSON object so the chat loop can
// reason about it. The city is taken verbatim from the arguments.
const def: ToolDefinition = {
  name: "get_weather",
  description:
    "Get the current weather for a city. Returns a small JSON object " +
    "with temperature in Celsius, condition, and the requested city.",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "City name, e.g. Shanghai, New York, Tokyo.",
      },
    },
    required: ["city"],
  },
};

const handler: ToolHandler = async (args) => {
  const city = (args as { city?: unknown })?.city;
  if (typeof city !== "string" || city.trim().length === 0) {
    return { content: "missing 'city' argument", isError: true };
  }
  const payload = {
    city: city.trim(),
    temp_c: 22,
    condition: "clear",
    unit: "celsius",
    source: "mock",
  };
  return { content: JSON.stringify(payload) };
};

export const get_weather = { def, handler };
