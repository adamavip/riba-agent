import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createRedisState } from "@chat-adapter/state-redis";
import { ToolLoopAgent } from "ai";
import { tools as tls } from "./tools";
import { npkTool } from "./agents";

const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.6",
  instructions:
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

bot.onNewMention(async (thread) => {
  await thread.post("Hello from WhatsApp!");
});

bot.onDirectMessage(async (thread, message) => {
  await thread.startTyping();

  const result = await agent.stream({
    prompt: message.text,
    //messages: history, // ← pass prior turns
  });

  await thread.post(result.fullStream);
});
