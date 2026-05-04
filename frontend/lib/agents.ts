import { ToolLoopAgent, tool, Output } from "ai";
import { z } from "zod";

const npkRatesSchema = z.object({
  N: z.number().describe("The nitrogen rate in kg/ha"),
  P: z.number().describe("The phosphorus rate in kg/ha"),
  K: z.number().describe("The potassium rate in kg/ha"),
});

/*Sub-agent for extracting N, P, and K rates*/
const getNPKAgent = new ToolLoopAgent({
  model: "deepseek/deepseek-reasoner",
  instructions:
    "You are a helpful AI assistant that extracts the N, P, and K rates from the user request.",
  output: Output.object({
    schema: npkRatesSchema,
  }),
});

export async function extractNPKRates(task: string, abortSignal?: AbortSignal) {
  const result = await getNPKAgent.generate({
    prompt: task,
    abortSignal,
  });

  return npkRatesSchema.parse((result as { output?: unknown }).output);
}

export const npkTool = tool({
  description: "Extract N, P, and K rates from the user request",
  inputSchema: z.object({
    task: z
      .string()
      .describe("The user's request containing N, P, and K rates"),
  }),
  execute: async ({ task }, { abortSignal }) => {
    return extractNPKRates(task, abortSignal);
  },
});
