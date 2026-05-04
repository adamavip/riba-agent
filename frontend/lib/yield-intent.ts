const YIELD_TERMS = [
  "yield",
  "harvest",
  "production",
  "output",
  "t/ha",
  "ton per hectare",
  "tons per hectare",
  "tonnes per hectare",
  "kg/ha yield",
];

const ESTIMATION_TERMS = [
  "estimate",
  "predict",
  "prediction",
  "calculate",
  "forecast",
  "simulate",
  "expected",
  "project",
  "projection",
  "how much",
  "what will",
  "what would",
];

const PROFIT_TERMS = [
  "profit",
  "profitability",
  "net return",
  "gross margin",
  "benefit cost",
  "benefit-cost",
  "roi",
];

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function isYieldEstimationRequest(text: string) {
  const normalized = text.toLowerCase();
  const asksForYield =
    includesAny(normalized, YIELD_TERMS) &&
    includesAny(normalized, ESTIMATION_TERMS);
  const asksForProfitability =
    includesAny(normalized, PROFIT_TERMS) &&
    includesAny(normalized, ESTIMATION_TERMS);

  return asksForYield || asksForProfitability;
}
