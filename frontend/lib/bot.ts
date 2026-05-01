import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createRedisState } from "@chat-adapter/state-redis";
import { ToolLoopAgent } from "ai";
import { tools as tls } from "./tools";
import { npkTool } from "./agents";
import { emoji } from "chat";
import { requireBaileysAdapter } from "chat-adapter-baileys";

type WhatsAppLocation = {
  address?: string;
  latitude: number;
  longitude: number;
  name?: string;
  url?: string;
};

type IncomingMessage = {
  attachments?: Array<{ url?: string }>;
  raw: unknown;
  text: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numberValue) ? numberValue : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeLocationPayload(
  location: Record<string, unknown> | null,
  latitudeKeys: string[],
  longitudeKeys: string[],
): WhatsAppLocation | null {
  if (!location) {
    return null;
  }

  const latitude = latitudeKeys
    .map((key) => asFiniteNumber(location[key]))
    .find((value) => value !== null);
  const longitude = longitudeKeys
    .map((key) => asFiniteNumber(location[key]))
    .find((value) => value !== null);

  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  return {
    address: asOptionalString(location.address),
    latitude,
    longitude,
    name: asOptionalString(location.name),
    url: asOptionalString(location.url),
  };
}

function getWhatsAppLocationFromRaw(raw: unknown): WhatsAppLocation | null {
  const rawRecord = asRecord(raw);
  const rawMessage = asRecord(rawRecord?.message) ?? rawRecord;

  const cloudApiLocation = normalizeLocationPayload(
    asRecord(rawMessage?.location),
    ["latitude"],
    ["longitude"],
  );

  if (cloudApiLocation) {
    return cloudApiLocation;
  }

  return normalizeLocationPayload(
    asRecord(rawMessage?.locationMessage) ??
      asRecord(rawMessage?.liveLocationMessage),
    ["degreesLatitude", "latitude"],
    ["degreesLongitude", "longitude"],
  );
}

function getWhatsAppLocationFromText(text: string): WhatsAppLocation | null {
  const coordinateMatch = text.match(
    /(?:location:\s*)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
  );

  if (!coordinateMatch) {
    return null;
  }

  return normalizeLocationPayload(
    {
      latitude: coordinateMatch[1],
      longitude: coordinateMatch[2],
    },
    ["latitude"],
    ["longitude"],
  );
}

function getWhatsAppLocationFromAttachments(
  attachments: IncomingMessage["attachments"],
): WhatsAppLocation | null {
  const mapUrl = attachments
    ?.map((attachment) => attachment.url)
    .find((url) => url?.includes("maps") && url.includes("q="));

  if (!mapUrl) {
    return null;
  }

  const query = new URL(mapUrl).searchParams.get("q");
  return query ? getWhatsAppLocationFromText(query) : null;
}

function getWhatsAppLocation(message: IncomingMessage): WhatsAppLocation | null {
  return (
    getWhatsAppLocationFromRaw(message.raw) ??
    getWhatsAppLocationFromText(message.text) ??
    getWhatsAppLocationFromAttachments(message.attachments)
  );
}

function formatWhatsAppLocationReply(location: WhatsAppLocation): string {
  const locationDetails = [
    `Latitude: ${location.latitude}`,
    `Longitude: ${location.longitude}`,
    location.name ? `Name: ${location.name}` : null,
    location.address ? `Address: ${location.address}` : null,
    location.url ? `URL: ${location.url}` : null,
  ].filter(Boolean);

  return locationDetails.join("\n");
}

const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.6",
  instructions:
    "Your name is Riba Agent. Greet the user in Hausa: 'Hello, how can I help you today?' " +
    "You are a helpful  AI yield predictor based on N, P, and K rates in chat conversations. " +
    "Answer questions clearly and use your tools when you need " +
    "Keep responses concise and well-formatted for chat.",
  tools: { npkTool, ...tls },
});

export const bot = new Chat({
  userName: "riba-agent",
  adapters: {
    whatsapp: createWhatsAppAdapter(),
  },
  state: createRedisState(),
});

bot.onDirectMessage(async (thread, message) => {
  await thread.startTyping();

  //const wa = requireBaileysAdapter(thread);

  /* const result = await agent.stream({
    prompt: message.text,
    //messages: history, // ← pass prior turns
  }); */

  const location = getWhatsAppLocation(message);

  await thread.post(
    location
      ? formatWhatsAppLocationReply(location)
      : "No WhatsApp location found in this message.",
  );
});
