"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  AlertTriangleIcon,
  BotIcon,
  ChartNoAxesCombinedIcon,
  CheckCircle2Icon,
  CircleIcon,
  CloudRainIcon,
  CoinsIcon,
  FlaskConicalIcon,
  GaugeIcon,
  Layers3Icon,
  LocateFixedIcon,
  MapPinIcon,
  ScaleIcon,
  SendIcon,
  SproutIcon,
  TargetIcon,
  UserIcon,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isYieldEstimationRequest } from "@/lib/yield-intent";

const workflowSteps = [
  "Request sent to chat API",
  "NPK rates inferred from request",
  "Backend prediction requested",
  "Soil and climate predictors calculated",
  "Yield estimate prepared",
  "Response composed",
];

function formatNumber(value, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "NA";
}

function PredictorPill({ label, value, unit }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-[11px] font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">
        {value}
        {unit ? <span className="ml-1 text-xs text-muted-foreground">{unit}</span> : null}
      </p>
    </div>
  );
}

function classifyYield(value) {
  if (value >= 5) {
    return {
      label: "High potential",
      tone: "text-emerald-100",
      gauge: "bg-emerald-500",
      note: "The model sees a strong response environment for this scenario.",
    };
  }
  if (value >= 3) {
    return {
      label: "Moderate potential",
      tone: "text-sky-100",
      gauge: "bg-sky-500",
      note: "The estimate is useful for scenario comparison, with some constraints visible.",
    };
  }
  return {
    label: "Constrained potential",
    tone: "text-amber-100",
    gauge: "bg-amber-400",
    note: "The model is flagging conditions that may limit fertilizer response.",
  };
}

function classifyPh(value) {
  if (typeof value !== "number") {
    return "pH unavailable";
  }
  if (value < 5.5) {
    return "Acidic soil flag";
  }
  if (value > 7.5) {
    return "Alkaline soil flag";
  }
  return "pH in common maize range";
}

function classifyOrganicCarbon(value) {
  if (typeof value !== "number") {
    return "OC unavailable";
  }
  if (value < 1) {
    return "Low organic carbon flag";
  }
  if (value < 2) {
    return "Moderate organic carbon";
  }
  return "Stronger organic carbon signal";
}

function classifyTexture({ sand, clay }) {
  if (typeof sand !== "number" || typeof clay !== "number") {
    return "Texture unavailable";
  }
  if (sand >= 65) {
    return "Sandy texture flag";
  }
  if (clay >= 35) {
    return "High clay texture flag";
  }
  return "Balanced texture signal";
}

function classifyRainCv(value) {
  if (typeof value !== "number") {
    return "Rainfall variability unavailable";
  }
  if (value >= 0.35) {
    return "Higher rainfall variability flag";
  }
  return "Lower rainfall variability signal";
}

function getNutrientBalance(fertilizer) {
  const values = [
    fertilizer.N_fertilizer,
    fertilizer.P_fertilizer,
    fertilizer.K_fertilizer,
  ];

  if (values.some((value) => typeof value !== "number" || value <= 0)) {
    return "One or more nutrient rates are zero or unavailable";
  }

  const [n, p, k] = values;
  if (n > p * 3 && n > k * 4) {
    return "N-heavy blend; check P and K adequacy";
  }
  if (p > n || k > n) {
    return "Unusual nutrient balance; verify rates";
  }
  return "NPK balance is plausible for scenario testing";
}

function getLimitingFactors({ soil, climate, fertilizer }) {
  const factors = [];

  if (typeof soil.oc === "number" && soil.oc < 1) {
    factors.push({
      title: "Organic carbon constraint",
      detail: "Low OC can reduce water holding, nutrient retention, and crop response.",
      tone: "warning",
    });
  }

  if (typeof soil.pH === "number" && (soil.pH < 5.5 || soil.pH > 7.5)) {
    factors.push({
      title: "Soil reaction risk",
      detail: "pH is outside the common maize comfort range and may affect nutrient availability.",
      tone: "warning",
    });
  }

  if (typeof soil.sand === "number" && soil.sand >= 65) {
    factors.push({
      title: "Sandy soil risk",
      detail: "Higher sand content can increase leaching risk, especially for nitrogen.",
      tone: "warning",
    });
  }

  if (typeof soil.clay === "number" && soil.clay >= 35) {
    factors.push({
      title: "Heavy texture risk",
      detail: "Higher clay can make timing, drainage, and field operations more sensitive.",
      tone: "warning",
    });
  }

  if (typeof climate.raincv_2024 === "number" && climate.raincv_2024 >= 0.35) {
    factors.push({
      title: "Rainfall variability",
      detail: "High rainfall variability increases the risk around fertilizer payback.",
      tone: "warning",
    });
  }

  const balance = getNutrientBalance(fertilizer);
  if (balance.toLowerCase().includes("heavy") || balance.toLowerCase().includes("unusual")) {
    factors.push({
      title: "Nutrient balance check",
      detail: balance,
      tone: "warning",
    });
  }

  if (factors.length === 0) {
    factors.push({
      title: "No major red flags",
      detail: "The displayed predictors do not show an obvious single constraint.",
      tone: "good",
    });
  }

  return factors;
}

function getRainReliability(value) {
  if (typeof value !== "number") {
    return "Rainfall stability cannot be assessed from the returned predictors.";
  }
  if (value >= 0.45) {
    return "High rainfall volatility; recommendations should stay conservative.";
  }
  if (value >= 0.3) {
    return "Moderate rainfall volatility; compare fertilizer scenarios before scaling up.";
  }
  return "Lower rainfall volatility; fertilizer response risk is less weather-driven.";
}

function SignalBadge({ children, tone = "default" }) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : tone === "good"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-slate-200 bg-slate-50 text-slate-900";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function NutrientBar({ label, value, max }) {
  const width =
    typeof value === "number" && max > 0 ? Math.max(4, (value / max) * 100) : 4;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-muted-foreground">{formatNumber(value, 0)} kg/ha</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-700"
          style={{ width: `${Math.min(width, 100)}%` }}
        />
      </div>
    </div>
  );
}

function YieldGauge({ value, yieldClass }) {
  const percent =
    typeof value === "number" ? Math.min(Math.max((value / 8) * 100, 4), 100) : 4;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>Constrained</span>
        <span>High response</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/15">
        <div
          className={`h-full rounded-full ${yieldClass.gauge}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function InsightRow({ icon: Icon, title, detail, tone = "default" }) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : tone === "good"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-slate-200 bg-slate-50 text-slate-900";

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 opacity-85">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function YieldPredictionCard({ prediction }) {
  if (!prediction) {
    return null;
  }

  const soil = prediction.predictorSummary?.soil ?? {};
  const climate = prediction.predictorSummary?.climate ?? {};
  const fertilizer = prediction.predictorSummary?.fertilizer ?? {};
  const yieldClass = classifyYield(prediction.expectedYield);
  const nutrientMax = Math.max(
    fertilizer.N_fertilizer ?? 0,
    fertilizer.P_fertilizer ?? 0,
    fertilizer.K_fertilizer ?? 0,
    1
  );
  const signals = [
    classifyPh(soil.pH),
    classifyOrganicCarbon(soil.oc),
    classifyTexture(soil),
    classifyRainCv(climate.raincv_2024),
    getNutrientBalance(fertilizer),
  ];
  const limitingFactors = getLimitingFactors({ soil, climate, fertilizer });

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="bg-slate-950 px-5 py-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <ChartNoAxesCombinedIcon className="size-4" />
              Backend yield estimate
            </div>
            <p className="mt-3 text-5xl font-semibold tracking-normal">
              {formatNumber(prediction.expectedYield)}
              <span className="ml-2 text-lg font-medium text-slate-300">
                t/ha
              </span>
            </p>
            <p className={`mt-2 text-sm font-medium ${yieldClass.tone}`}>
              {yieldClass.label}
            </p>
            <div className="mt-4 max-w-md">
              <YieldGauge
                value={prediction.expectedYield}
                yieldClass={yieldClass}
              />
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {yieldClass.note}
              </p>
            </div>
          </div>
          <div className="grid min-w-52 gap-2 rounded-md bg-white/10 p-3">
            <div>
              <p className="text-[11px] uppercase text-slate-300">Field position</p>
              <p className="mt-1 text-sm font-medium">
                {formatNumber(prediction.latitude, 4)},{" "}
                {formatNumber(prediction.longitude, 4)}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <TargetIcon className="size-3.5" />
              Location-based soil and climate lookup
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5">
        <div className="grid gap-3 lg:grid-cols-3">
          <InsightRow
            detail={getRainReliability(climate.raincv_2024)}
            icon={CloudRainIcon}
            title="Weather risk"
            tone={
              typeof climate.raincv_2024 === "number" && climate.raincv_2024 >= 0.35
                ? "warning"
                : "good"
            }
          />
          <InsightRow
            detail={getNutrientBalance(fertilizer)}
            icon={ScaleIcon}
            title="NPK interaction"
            tone={
              getNutrientBalance(fertilizer).toLowerCase().includes("plausible")
                ? "good"
                : "warning"
            }
          />
          <InsightRow
            detail="Use the prediction as a scenario estimate, then compare with input prices and maize sale price before advising the farmer."
            icon={CoinsIcon}
            title="Profit lens"
          />
        </div>

        <section className="rounded-lg border border-border bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FlaskConicalIcon className="size-4 text-emerald-700" />
            Fertilizer scenario and balance
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
            <div className="grid grid-cols-3 gap-2">
              <PredictorPill
                label="Nitrogen"
                unit="kg/ha"
                value={formatNumber(fertilizer.N_fertilizer, 0)}
              />
              <PredictorPill
                label="Phosphorus"
                unit="kg/ha"
                value={formatNumber(fertilizer.P_fertilizer, 0)}
              />
              <PredictorPill
                label="Potassium"
                unit="kg/ha"
                value={formatNumber(fertilizer.K_fertilizer, 0)}
              />
            </div>
            <div className="grid gap-2">
              <NutrientBar
                label="N"
                max={nutrientMax}
                value={fertilizer.N_fertilizer}
              />
              <NutrientBar
                label="P"
                max={nutrientMax}
                value={fertilizer.P_fertilizer}
              />
              <NutrientBar
                label="K"
                max={nutrientMax}
                value={fertilizer.K_fertilizer}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <SproutIcon className="size-4 text-lime-700" />
              Soil predictors
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <PredictorPill label="OC" value={formatNumber(soil.oc)} />
              <PredictorPill label="pH" value={formatNumber(soil.pH)} />
              <PredictorPill label="Sand" value={formatNumber(soil.sand)} />
              <PredictorPill label="Clay" value={formatNumber(soil.clay)} />
              <PredictorPill label="ECEC" value={formatNumber(soil.ecec)} />
            </div>
          </section>

          <section className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CloudRainIcon className="size-4 text-sky-700" />
              Climate predictors
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PredictorPill
                label="Rain 2024"
                value={formatNumber(climate.rain_2024)}
              />
              <PredictorPill
                label="Rain CV 2024"
                value={formatNumber(climate.raincv_2024)}
              />
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <GaugeIcon className="size-4 text-slate-700" />
            Screening signals
          </div>
          <div className="flex flex-wrap gap-2">
            {signals.map((signal) => {
              const isFlag = signal.toLowerCase().includes("flag");
              const isGood =
                signal.toLowerCase().includes("plausible") ||
                signal.toLowerCase().includes("common") ||
                signal.toLowerCase().includes("lower");

              return (
                <SignalBadge
                  key={signal}
                  tone={isFlag ? "warning" : isGood ? "good" : "default"}
                >
                  {signal}
                </SignalBadge>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Layers3Icon className="size-4 text-slate-700" />
            Main decision factors
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {limitingFactors.map((factor) => (
              <InsightRow
                detail={factor.detail}
                icon={factor.tone === "warning" ? AlertTriangleIcon : CheckCircle2Icon}
                key={factor.title}
                title={factor.title}
                tone={factor.tone}
              />
            ))}
          </div>
        </section>

        <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm leading-6">
              Treat the labels above as decision-support flags. The backend
              yield is model-derived; final fertilizer advice should consider
              seed, planting date, weed control, local prices, and farmer budget.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <CoinsIcon className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm leading-6">
              Profitability needs maize price, fertilizer prices, transport,
              and labor costs before net return can be estimated.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowProgress({ activeStep }) {
  return (
    <div className="w-full min-w-64 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Spinner />
        <span>Running yield workflow</span>
      </div>
      <ol className="space-y-2">
        {workflowSteps.map((step, index) => {
          const isComplete = index < activeStep;
          const isActive = index === activeStep;

          return (
            <li
              className="flex items-center gap-2 text-sm text-muted-foreground"
              key={step}
            >
              {isComplete ? (
                <CheckCircle2Icon className="size-4 text-emerald-700" />
              ) : isActive ? (
                <Spinner className="size-4 text-emerald-700" />
              ) : (
                <CircleIcon className="size-4 text-muted-foreground/55" />
              )}
              <span className={isActive ? "text-foreground" : undefined}>
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MessageParts({ message }) {
  return message.parts.map((part, index) => {
    if (part.type === "text") {
      return message.role === "assistant" ? (
        <MessageResponse key={`${message.id}-${index}`}>
          {part.text}
        </MessageResponse>
      ) : (
        <p className="whitespace-pre-wrap" key={`${message.id}-${index}`}>
          {part.text}
        </p>
      );
    }

    if (part.type === "tool-showYieldPredictors") {
      if (part.state === "output-available") {
        return (
          <YieldPredictionCard
            key={`${message.id}-${index}`}
            prediction={part.output}
          />
        );
      }

      return (
        <div
          className="flex items-center gap-2 text-muted-foreground"
          key={`${message.id}-${index}`}
        >
          <Spinner />
          <span>Rendering prediction card</span>
        </div>
      );
    }

    return null;
  });
}

export default function Chat() {
  const [hasMounted, setHasMounted] = useState(false);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState("");
  const [locationStatus, setLocationStatus] = useState("idle");
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(0);

  const requestLocation = useCallback(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationStatus("error");
      setLocationError("Geolocation is not available in this browser.");
      return;
    }

    setLocationStatus("loading");
    setLocationError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationStatus("ready");
      },
      (error) => {
        setLocationStatus("error");
        setLocationError(error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 300000,
        timeout: 10000,
      },
    );
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setHasMounted(true);
      requestLocation();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [requestLocation]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
      }),
    []
  );

  const { messages, sendMessage, status, stop } = useChat({
    transport,
  });

  const locationLabel = location
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : locationStatus === "loading"
      ? "Detecting current location..."
      : locationError || "Location not available";
  const isWaitingForResponse = status === "submitted";
  const shouldShowWorkflow = isWaitingForResponse && showWorkflow;

  useEffect(() => {
    if (!shouldShowWorkflow) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setWorkflowStep((current) =>
        Math.min(current + 1, workflowSteps.length - 1)
      );
    }, 900);

    return () => window.clearInterval(intervalId);
  }, [shouldShowWorkflow]);

  if (!hasMounted) {
    return null;
  }

  return (
    <TooltipProvider>
      <section className="flex min-h-[calc(100vh-4rem)] flex-col bg-background">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-1 flex-col px-4 py-6 sm:px-6">
          <header className="border-border border-b pb-4">
            <p className="text-muted-foreground text-sm">Riba Agent</p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">
              Agronomy Chat
            </h1>
            <div className="mt-4">
              <div className="rounded-lg border border-border px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Field position
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPinIcon className="size-4" />
                      <span>{locationLabel}</span>
                    </p>
                  </div>
                  <button
                    className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    onClick={requestLocation}
                    type="button"
                  >
                    <LocateFixedIcon className="mr-2 size-4" />
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <Conversation className="min-h-0 py-4">
              <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-0">
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    title="Ask about maize yield"
                    description="Share a field question to start the conversation."
                    icon={<BotIcon className="size-6" />}
                  />
                ) : (
                  messages.map((message) => {
                    return (
                      <Message from={message.role} key={message.id}>
                        <div className="flex items-start gap-3">
                          <div className="mt-1 text-muted-foreground">
                            {message.role === "user" ? (
                              <UserIcon className="size-4" />
                            ) : (
                              <BotIcon className="size-4" />
                          )}
                        </div>
                        <MessageContent className="w-full">
                          <MessageParts message={message} />
                        </MessageContent>
                      </div>
                    </Message>
                    );
                  })
                )}
                {shouldShowWorkflow && (
                  <Message from="assistant">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 text-muted-foreground">
                        <BotIcon className="size-4" />
                      </div>
                      <MessageContent className="w-full">
                        <WorkflowProgress activeStep={workflowStep} />
                      </MessageContent>
                    </div>
                  </Message>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <div className="mx-auto w-full max-w-3xl border-border border-t pt-4">
              <PromptInput
                onSubmit={async ({ text }) => {
                  const trimmed = text.trim();
                  if (!trimmed) {
                    return;
                  }

                  setWorkflowStep(0);
                  setShowWorkflow(isYieldEstimationRequest(trimmed));
                  await sendMessage(
                    { text: trimmed },
                    {
                      body: {
                        location,
                      },
                    }
                  );
                }}
              >
                <PromptInputBody>
                  <PromptInputTextarea placeholder="Ask about yield, rainfall, or soil conditions..." />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    <PromptInputButton
                      onClick={requestLocation}
                      tooltip="Refresh browser location"
                    >
                      <LocateFixedIcon className="size-4" />
                    </PromptInputButton>
                  </PromptInputTools>
                  <PromptInputSubmit
                    disabled={status === "submitted"}
                    onStop={stop}
                    status={status}
                  >
                    {status === "ready" || status === "error" ? (
                      <SendIcon className="size-4" />
                    ) : undefined}
                  </PromptInputSubmit>
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}
