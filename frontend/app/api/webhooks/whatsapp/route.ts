import { after } from "next/server";

import { bot } from "@/lib/bot";

export const runtime = "nodejs";

function handleWebhook(request: Request) {
  return bot.webhooks.whatsapp(request, {
    waitUntil: (task) => after(() => task),
  });
}

export const GET = handleWebhook;
export const POST = handleWebhook;
