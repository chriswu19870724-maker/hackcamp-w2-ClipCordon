import { withExternalCall } from "./external.js";

export async function sendTGAlert(message: string): Promise<void> {
  await withExternalCall({
    label: "Telegram notification",
    context: { messagePreview: message.slice(0, 120) },
    fn: async () => {
      // TODO(D4): send Telegram alert with TG_BOT_TOKEN and TG_CHAT_ID.
      console.log("[notify] TG placeholder:", message);
    },
  });
}
