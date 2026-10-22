import { tg } from "../lib/shared.mjs";

// Open once: https://vipgizmoinsights.com/api/setup?key=YOUR_TELEGRAM_WEBHOOK_SECRET
export const config = { path: "/api/setup" };

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const r = await tg("setWebhook", {
    url: `${url.origin}/api/telegram`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
};
