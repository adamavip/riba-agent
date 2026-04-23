import { tool } from "ai";
import { z } from "zod";

export const tools = {
  getWeather: tool({
    description: "Get the current weather for a location",
    inputSchema: z.object({
      location: z.string().describe("City name, e.g. San Francisco"),
    }),
    execute: async ({ location }) => {
      // Replace with a real weather API call
      const response = await fetch(
        `https://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${encodeURIComponent(location)}`,
      );
      const data = await response.json();
      return {
        location,
        temperature: data.current.temp_f,
        condition: data.current.condition.text,
      };
    },
  }),
  searchDocs: tool({
    description: "Search the company documentation for a topic",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
    }),
    execute: async ({ query }) => {
      // Replace with your actual search implementation
      return { results: [`Result for: ${query}`] };
    },
  }),
};
