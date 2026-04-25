import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createRedisState } from "@chat-adapter/state-redis";
import { ToolLoopAgent } from "ai";
import { tools } from "./tools";

const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.6",
  instructions:
    "You are a helpful AI assistant in chat conversations. " +
    "Answer questions clearly and use your tools when you need " +
    "real-time data. Keep responses concise and well-formatted for chat.",
  tools,
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

  const history = await thread.allMessages; // or however chat SDK exposes it

  const result = await agent.generate({
    prompt: message.text,
    //messages: history, // ← pass prior turns
  });

  await thread.post(result.text);
});
