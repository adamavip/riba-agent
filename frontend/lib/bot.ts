import { Actions, Button, Card, CardText, Chat } from "chat";
import type { Thread } from "chat";
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

type ThreadLocationState = {
  location?: WhatsAppLocation;
};

type WhatsAppThreadId = {
  phoneNumberId: string;
  userWaId: string;
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

const shareLocationRequest =
  "Please share your position before we continue. In WhatsApp, tap attach > Location > Send your current location.";

function decodeWhatsAppThreadId(threadId: string): WhatsAppThreadId {
  const [adapterName, phoneNumberId, userWaId] = threadId.split(":");

  if (adapterName !== "whatsapp" || !phoneNumberId || !userWaId) {
    throw new Error(`Invalid WhatsApp thread ID: ${threadId}`);
  }

  return { phoneNumberId, userWaId };
}

async function sendWhatsAppLocationRequest(threadId: string) {
  const { phoneNumberId, userWaId } = decodeWhatsAppThreadId(threadId);
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is required.");
  }

  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: userWaId,
        type: "interactive",
        interactive: {
          type: "location_request_message",
          body: {
            text: "Please share your current position.",
          },
          action: {
            name: "send_location",
          },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `WhatsApp location request failed: ${response.status} ${await response.text()}`,
    );
  }
}

async function askForLocation(thread: Thread<ThreadLocationState>) {
  await thread.post(
    Card({
      title: "📍 Share Position",
      children: [
        CardText(
          "📌 Please share your current position before we continue.",
        ),
        Actions([
          Button({
            id: "share_position",
            label: "📍 Share",
            style: "primary",
          }),
        ]),
      ],
    }),
  );
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

bot.onAction("share_position", async (event) => {
  try {
    await sendWhatsAppLocationRequest(event.threadId);
  } catch {
    await event.thread?.post(shareLocationRequest);
  }
});

bot.onDirectMessage(async (thread, message) => {
  await thread.startTyping();

  //const wa = requireBaileysAdapter(thread);

  /* const result = await agent.stream({
    prompt: message.text,
    //messages: history, // ← pass prior turns
  }); */

  const location = getWhatsAppLocation(message);
  const state = (await thread.state) as ThreadLocationState | null;

  if (location) {
    await thread.setState({ location });
    await thread.post(
      ["Position recorded:", formatWhatsAppLocationReply(location)].join("\n"),
    );
    return;
  }

  if (!state?.location) {
    await askForLocation(thread);
    return;
  }

  const result = await agent.stream({
    prompt: message.text,
    //messages: history, // pass prior turns
  });

  await thread.post(result.fullStream);
});
