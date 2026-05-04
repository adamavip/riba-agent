import {
  convertToModelMessages,
  stepCountIs,
  tool,
  ToolLoopAgent,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { extractNPKRates, npkTool } from "@/lib/agents";
import { getExpectedYield, type YieldPredictionResult } from "@/lib/tools";
import { isYieldEstimationRequest } from "@/lib/yield-intent";

export const maxDuration = 30;

const requestSchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .nullable()
    .optional(),
});

function getMessageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getLatestUserText(messages: UIMessage[]) {
  const latestUserMessage = messages
    .filter((message) => message.role === "user")
    .at(-1);

  return latestUserMessage ? getMessageText(latestUserMessage) : "";
}

function formatPredictionContext(prediction: YieldPredictionResult) {
  return [
    "A backend yield prediction has already been computed for the latest user request.",
    `Location: latitude ${prediction.latitude}, longitude ${prediction.longitude}.`,
    `Fertilizer rates: N=${prediction.fertilizerRates.N} kg/ha, P=${prediction.fertilizerRates.P} kg/ha, K=${prediction.fertilizerRates.K} kg/ha.`,
    `Soil predictors: oc=${prediction.predictorSummary.soil.oc}, pH=${prediction.predictorSummary.soil.pH}, sand=${prediction.predictorSummary.soil.sand}, clay=${prediction.predictorSummary.soil.clay}, ecec=${prediction.predictorSummary.soil.ecec}.`,
    `Climate predictors: rain_2024=${prediction.predictorSummary.climate.rain_2024}, raincv_2024=${prediction.predictorSummary.climate.raincv_2024}.`,
    `Predicted maize yield: ${prediction.expectedYield} t/ha.`,
    "Use these exact values. Do not call another prediction path or invent values.",
  ].join(" ");
}

export async function POST(request: Request) {
  const payload = requestSchema.parse(await request.json());
  const modelMessages = await convertToModelMessages(payload.messages);
  const sessionContext = payload.location
    ? `Browser location is available at latitude ${payload.location.latitude} and longitude ${payload.location.longitude}.`
    : "Browser location is not available yet.";
  const latestUserText = getLatestUserText(payload.messages);
  const shouldAttemptPrediction = isYieldEstimationRequest(latestUserText);
  let prediction: YieldPredictionResult | null = null;
  let predictionContext = "";

  if (shouldAttemptPrediction && payload.location && latestUserText) {
    let rates: { N: number; P: number; K: number } | null = null;

    try {
      rates = await extractNPKRates(latestUserText);
    } catch {
      predictionContext =
        "No backend yield prediction was attempted because N, P, and K rates could not be inferred from the latest request. Ask the user to provide all three rates in kg/ha.";
    }

    if (rates) {
      try {
        prediction = await getExpectedYield({
          latitude: payload.location.latitude,
          longitude: payload.location.longitude,
          ...rates,
        });
        predictionContext = formatPredictionContext(prediction);
      } catch {
        predictionContext =
          "N, P, and K rates were inferred, but the backend yield prediction service did not return a prediction. Tell the user the backend prediction service is currently unavailable and do not invent a yield.";
      }
    }
  } else if (shouldAttemptPrediction && !payload.location) {
    predictionContext =
      "No backend yield prediction was attempted because browser location is unavailable.";
  } else {
    predictionContext =
      "The latest user message is not an explicit yield or profitability estimation request. Do not infer NPK rates, do not call prediction tools, and do not mention backend predictor workflow. Answer normally as an agronomy assistant.";
  }

  const showYieldPredictors = tool({
    description:
      "Render the already-computed backend maize yield prediction and predictor summary as a structured UI card.",
    inputSchema: z.object({}),
    execute: async () => prediction,
  });

  const agent = new ToolLoopAgent({
    model: "openai/gpt-5.4-nano",
    instructions:
      "You are Riba Agent, a maize yield and profitability estimator for Sub-Saharan Africa. " +
      "Your job is to estimate maize yield and, when enough economics are provided, discuss profitability from N, P, and K fertilizer scenarios. " +
      "Use browser-provided field location when available. Do not ask the user to enter rates in a separate interface. " +
      "Only start the NPK extraction and backend prediction workflow when the latest user message explicitly asks for yield estimation, yield prediction, yield calculation, expected yield, or profitability estimation. " +
      "For general agronomy questions, greetings, explanations, or follow-up discussion, answer normally without calling tools and without mentioning the backend workflow. " +
      "When the user explicitly asks for prediction, infer N, P, and K rates from the user's request with the npkTool. If any of N, P, or K is missing, ask for all three rates in kg/ha before predicting. " +
      "Never invent yields, soil values, climate values, or fertilizer rates. When backend prediction context is provided, call showYieldPredictors and use those exact values. " +
      "Before giving any narrative recommendation, ensure the UI card summarizes predictors in this order: location, fertilizer rates, soil predictors, and climate predictors. " +
      "Keep the predictor summary compact and include units where known: fertilizer in kg/ha and predicted yield in t/ha. Do not fabricate units for soil or climate values if the tool does not provide them. " +
      "After the predictor UI card, add one concise interpretation of the predicted yield. " +
      "If the user asks about profitability, explain that profit also depends on maize price and fertilizer costs; only calculate profit when those assumptions are supplied or explicitly stated. " +
      "Keep responses concise, practical, and transparent about assumptions.",
    tools: prediction
      ? {
          showYieldPredictors,
        }
      : shouldAttemptPrediction
        ? {
            npkTool,
          }
        : {},
    toolChoice: prediction
      ? { type: "tool", toolName: "showYieldPredictors" }
      : "auto",
    stopWhen: stepCountIs(1),
  });

  const result = await agent.stream({
    messages: [
      {
        role: "system",
        content: [sessionContext, predictionContext].filter(Boolean).join(" "),
      },
      ...modelMessages,
    ],
  });

  return result.toUIMessageStreamResponse();
}
