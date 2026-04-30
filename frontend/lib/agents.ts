import { ToolLoopAgent, tool, Output } from "ai";
import { z } from "zod";

const getNPKAgent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.6",
  instructions:
    "You are a helpful AI assistant that extracts the N, P, and K rates from the user request.",
  output: Output.object({
    schema: z.object({
      N: z.number().describe("The nitrogen rate in kg/ha"),
      P: z.number().describe("The phosphorus rate in kg/ha"),
      K: z.number().describe("The potassium rate in kg/ha"),
    }),
  }),
});

export const npkTool = tool({
  description: "Extract N, P, and K rates from the user request",
  inputSchema: z.object({
    task: z
      .string()
      .describe("The user's request containing N, P, and K rates"),
  }),
  execute: async ({ task }, { abortSignal }) => {
    const result = await getNPKAgent.generate({
      prompt: task,
      abortSignal,
    });

    return result.text;
  },
});
