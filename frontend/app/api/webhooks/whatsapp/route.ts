import { bot } from "@/lib/bot";

export async function GET(request: Request) {
  return bot.webhooks.whatsapp(request);
}

export async function POST(request: Request) {
  return bot.webhooks.whatsapp(request);
}
