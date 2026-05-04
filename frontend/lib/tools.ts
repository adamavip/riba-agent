import { tool } from "ai";
import { z } from "zod";

const backendPredictionSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  message: z.string().optional(),
  predicted_yield_t_ha: z.number(),
  predictors: z.object({
    N_fertilizer: z.number(),
    P_fertilizer: z.number(),
    K_fertilizer: z.number(),
    oc: z.number(),
    pH: z.number(),
    sand: z.number(),
    clay: z.number(),
    ecec: z.number(),
    rain: z.number(),
    raincv: z.number(),
  }),
});

const yieldPredictionInputSchema = z.object({
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .describe("Field latitude in decimal degrees."),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .describe("Field longitude in decimal degrees."),
  N: z.number().min(0).describe("Nitrogen fertilizer rate in kg/ha."),
  P: z.number().min(0).describe("Phosphorus fertilizer rate in kg/ha."),
  K: z.number().min(0).describe("Potassium fertilizer rate in kg/ha."),
});

export type YieldPredictionInput = z.infer<typeof yieldPredictionInputSchema>;

export type YieldPredictionResult = {
  expectedYield: number;
  fertilizerRates: {
    N: number;
    P: number;
    K: number;
  };
  latitude: number;
  longitude: number;
  message?: string;
  predictorSummary: {
    fertilizer: {
      N_fertilizer: number;
      P_fertilizer: number;
      K_fertilizer: number;
    };
    soil: {
      oc: number;
      pH: number;
      sand: number;
      clay: number;
      ecec: number;
    };
    climate: {
      rain_2024: number;
      raincv_2024: number;
    };
  };
  predictors: z.infer<typeof backendPredictionSchema>["predictors"];
};

function getBackendUrl() {
  const backendUrl = process.env.BACKEND_URL;

  if (!backendUrl) {
    throw new Error("BACKEND_URL is not configured.");
  }

  return backendUrl.replace(/\/$/, "");
}

export async function getExpectedYield(
  input: YieldPredictionInput,
): Promise<YieldPredictionResult> {
  const validatedInput = yieldPredictionInputSchema.parse(input);
  const response = await fetch(`${getBackendUrl()}/predict`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      latitude: validatedInput.latitude,
      longitude: validatedInput.longitude,
      N_fertilizer: validatedInput.N,
      P_fertilizer: validatedInput.P,
      K_fertilizer: validatedInput.K,
    }),
  });

  const rawData: unknown = await response.json();

  if (!response.ok) {
    const backendError =
      rawData && typeof rawData === "object" && "error" in rawData
        ? String(rawData.error)
        : `Backend prediction failed with status ${response.status}.`;
    throw new Error(backendError);
  }

  const data = backendPredictionSchema.parse(rawData);

  return {
    expectedYield: data.predicted_yield_t_ha,
    fertilizerRates: {
      N: validatedInput.N,
      P: validatedInput.P,
      K: validatedInput.K,
    },
    latitude: data.latitude,
    longitude: data.longitude,
    message: data.message,
    predictorSummary: {
      fertilizer: {
        N_fertilizer: data.predictors.N_fertilizer,
        P_fertilizer: data.predictors.P_fertilizer,
        K_fertilizer: data.predictors.K_fertilizer,
      },
      soil: {
        oc: data.predictors.oc,
        pH: data.predictors.pH,
        sand: data.predictors.sand,
        clay: data.predictors.clay,
        ecec: data.predictors.ecec,
      },
      climate: {
        rain_2024: data.predictors.rain,
        raincv_2024: data.predictors.raincv,
      },
    },
    predictors: data.predictors,
  };
}

export const tools = {
  predictMaizeYield: tool({
    description:
      "Predict maize yield from field coordinates and N, P, K fertilizer rates using the backend soil, climate, and yield model.",
    inputSchema: yieldPredictionInputSchema,
    execute: getExpectedYield,
  }),
};
