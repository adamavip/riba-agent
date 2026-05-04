import Link from "next/link";
import {
  ArrowRightIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  CloudRainIcon,
  CoinsIcon,
  MapPinnedIcon,
  MessageSquareTextIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SproutIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const predictorGroups = [
  {
    title: "Field context",
    icon: MapPinnedIcon,
    items: ["Browser or WhatsApp location", "Raster soil extraction", "2024 rainfall layer"],
  },
  {
    title: "Nutrient scenario",
    icon: SlidersHorizontalIcon,
    items: ["N, P, K inferred from conversation", "kg/ha normalization", "Scenario comparison ready"],
  },
  {
    title: "Model response",
    icon: BrainCircuitIcon,
    items: ["Backend yield model call", "Predictor audit before yield", "Profit assumptions separated"],
  },
];

const upgrades = [
  "Infer N, P, and K from plain farmer language, then ask only for missing rates.",
  "Summarize soil, rainfall, and fertilizer predictors before giving yield.",
  "Separate yield prediction from profitability so price and fertilizer-cost assumptions are explicit.",
  "Support low-bandwidth use through concise chat responses and location-first workflows.",
];

const roadmap = [
  {
    label: "Adaptive recommendations",
    text: "Compare marginal yield response across NPK scenarios and recommend the next profitable rate, not just the highest yield.",
  },
  {
    label: "Risk-aware advice",
    text: "Flag rainfall variability, soil constraints, and missing inputs before making a confident recommendation.",
  },
  {
    label: "Farmer-ready delivery",
    text: "Keep answers short, explain units, and make the same agent usable from browser and WhatsApp.",
  },
];

export default function Home() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background">
      <section className="border-border border-b">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <div className="flex flex-col justify-center">
            <Badge className="mb-5 w-fit bg-emerald-700 text-white" variant="secondary">
              Agentic AI for Nigerian maize systems
            </Badge>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
              Yield and profitability estimation for farmers in Nigeria.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Riba Agent combines conversation, field position, soil layers,
              rainfall predictors, and fertilizer scenarios to produce practical
              maize yield estimates. The system is designed to move from a basic
              chatbot to an expert agronomy workflow farmers can use directly.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/chat">
                  Start estimator
                  <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#system">View system design</a>
              </Button>
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="rounded-md bg-emerald-50 p-4 text-emerald-950">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Prediction pipeline</p>
                  <p className="mt-1 text-3xl font-semibold">NPK + field context</p>
                </div>
                <SproutIcon className="size-8 text-emerald-700" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border p-3">
                <CloudRainIcon className="size-5 text-sky-700" />
                <p className="mt-3 text-sm font-medium">Rainfall</p>
                <p className="mt-1 text-xs text-muted-foreground">2024 rain and variability</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <MapPinnedIcon className="size-5 text-emerald-700" />
                <p className="mt-3 text-sm font-medium">Soil</p>
                <p className="mt-1 text-xs text-muted-foreground">OC, pH, sand, clay, ECEC</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <CoinsIcon className="size-5 text-amber-700" />
                <p className="mt-3 text-sm font-medium">Profit</p>
                <p className="mt-1 text-xs text-muted-foreground">Costs and maize price required</p>
              </div>
            </div>

            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquareTextIcon className="size-4 text-emerald-700" />
                Example request
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Estimate my maize yield if I apply N 100, P 40, and K 20 kg/ha
                on this field.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6" id="system">
        <div className="grid gap-4 lg:grid-cols-3">
          {predictorGroups.map((group) => {
            const Icon = group.icon;

            return (
              <article className="rounded-lg border border-border bg-card p-5" key={group.title}>
                <Icon className="size-5 text-emerald-700" />
                <h2 className="mt-4 text-lg font-semibold">{group.title}</h2>
                <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                  {group.items.map((item) => (
                    <li className="flex gap-2" key={item}>
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-border border-y bg-muted/35">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <Badge variant="outline">Production-grade upgrades</Badge>
            <h2 className="mt-4 text-3xl font-semibold">From chatbot to agronomy decision system</h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              The estimator should reason over interactions between nutrients,
              soil constraints, weather risk, and farmer economics. Each answer
              should show what the model used before it gives a recommendation.
            </p>
          </div>
          <div className="grid gap-3">
            {upgrades.map((upgrade) => (
              <div className="flex gap-3 rounded-lg border border-border bg-background p-4" key={upgrade}>
                <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-emerald-700" />
                <p className="text-sm leading-6 text-muted-foreground">{upgrade}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {roadmap.map((item) => (
            <article className="rounded-lg border border-border p-5" key={item.label}>
              <h3 className="font-semibold">{item.label}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
