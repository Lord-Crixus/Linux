import { PLANS, tg, paystack, members, fmt } from "../lib/shared.mjs";

export const config = { path: "/api/telegram" };

export default async (req) => {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    await handle(await req.json());
  } catch (e) {
    console.error("telegram error", e);
  }
  return new Response("ok");
};

async function showPlans(chatId) {
  const rows = Object.entries(PLANS).map(([key, p]) => [
    { text: `${p.label} · KES ${p.kes.toLocaleString("en-US")}`, callback_data: `plan:${key}` },
  ]);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "Welcome to Gizmo Insights VIP.\n\nChoose your plan. You pay once (M-Pesa or card), and you get a private invite link to the VIP channel automatically. Nothing renews by itself.\n\n3+ odds = safer, more frequent picks.\n10+ odds = long shots that win rarely. No picks are guaranteed. 18+ only.",
    reply_markup: { inline_keyboard: rows },
  });
}

async function handle(update) {
  if (update.message) {
    const m = update.message;
    if (m.chat.type !== "private" || !m.text) return;
    if (m.text.startsWith("/status")) {
      const rec = await members().get(String(m.from.id), { type: "json" });
      const text =
        rec && rec.active && rec.expiry > Date.now()
          ? `Your VIP access is active until ${fmt(rec.expiry)}.`
          : "You have no active VIP access. Send /start to choose a plan.";
      await tg("sendMessage", { chat_id: m.chat.id, text });
      return;
    }
    await showPlans(m.chat.id);
    return;
  }

  if (update.callback_query) {
    const q = update.callback_query;
    const key = (q.data || "").replace("plan:", "");
    const plan = PLANS[key];
    await tg("answerCallbackQuery", { callback_query_id: q.id });
    if (!plan) return;

    const userId = q.from.id;
    const reference = `gz_${userId}_${key}_${Date.now()}`;
    const init = await paystack("/transaction/initialize", {
      method: "POST",
      body: {
        email: `tg${userId}@vipgizmoinsights.com`,
        amount: plan.kes * 100,
        currency: "KES",
        reference,
        callback_url: "https://t.me/GizmoVipAccesbot",
        metadata: {
          telegram_id: userId,
          telegram_username: q.from.username || "",
          plan: key,
        },
      },
    });

    if (!init.status) {
      console.error("initialize failed", init);
      await tg("sendMessage", { chat_id: q.message.chat.id, text: "Sorry, we could not start the payment. Please try again in a minute." });
      return;
    }
    await tg("sendMessage", {
      chat_id: q.message.chat.id,
      text: `${plan.label}\nKES ${plan.kes.toLocaleString("en-US")}\n\nTap the button to pay with M-Pesa or card. After you pay, your invite link arrives here automatically.`,
      reply_markup: { inline_keyboard: [[{ text: `Pay KES ${plan.kes.toLocaleString("en-US")}`, url: init.data.authorization_url }]] },
    });
  }
}
