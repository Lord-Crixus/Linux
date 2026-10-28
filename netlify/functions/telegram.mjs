import { PLANS, tg, paystack, members, fmt, usdOn, siteStore } from "../lib/shared.mjs";

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


const isAdmin = (id) => !!process.env.ADMIN_CHAT_ID && String(id) === String(process.env.ADMIN_CHAT_ID);

const HELP =
  "Admin commands:\n\n" +
  "/addpick Fixture | Pick | Won or Lost | Confidence (optional) | Competition (optional)\n" +
  "Example:\n/addpick Chelsea vs Spurs | Over 2.5 Goals | Won | 75% | Premier League\n\n" +
  "/picks - show the picks on the website\n" +
  "/delpick - remove the last pick\n" +
  "/clearpicks yes - remove all picks";

async function adminCommand(m) {
  const text = m.text.trim();
  const reply = (t) => tg("sendMessage", { chat_id: m.chat.id, text: t });
  const store = siteStore();
  const list = (await store.get("picks", { type: "json" })) || [];

  if (/^\/addpick/i.test(text)) {
    const parts = text.replace(/^\/addpick(@\w+)?\s*/i, "").split("|").map((x) => x.trim());
    const [fixture, pick, resultRaw, confidence, competition] = parts;
    const r = (resultRaw || "").toLowerCase();
    const result = ["won", "win", "w"].includes(r) ? "Won" : ["lost", "loss", "l"].includes(r) ? "Lost" : null;
    if (!fixture || !pick || !result) return reply(HELP);
    list.push({
      date: new Date().toISOString().slice(0, 10),
      competition: competition || "Football",
      fixture,
      pick,
      result,
      confidence: confidence || "",
    });
    await store.setJSON("picks", list.slice(-20));
    return reply(`Added: ${fixture} · ${pick} · ${result}\nIt will show on the website within a minute.`);
  }
  if (/^\/picks/i.test(text)) {
    if (!list.length) return reply("No picks on the website yet.");
    return reply(list.slice(-10).map((p, i) => `${i + 1}. ${p.date} ${p.fixture} · ${p.pick} · ${p.result}`).join("\n"));
  }
  if (/^\/delpick/i.test(text)) {
    if (!list.length) return reply("Nothing to remove.");
    const gone = list.pop();
    await store.setJSON("picks", list);
    return reply(`Removed: ${gone.fixture} · ${gone.pick}`);
  }
  if (/^\/clearpicks/i.test(text)) {
    if (!/yes/i.test(text)) return reply("This removes ALL picks from the website. To confirm send:\n/clearpicks yes");
    await store.setJSON("picks", []);
    return reply("All picks removed from the website.");
  }
  return reply(HELP);
}

const money = (n) => n.toLocaleString("en-US");

async function showPlans(chatId) {
  const rows = Object.entries(PLANS).map(([key, p]) => [
    {
      text: usdOn() ? `${p.label} · $${p.usd} / KES ${money(p.kes)}` : `${p.label} · KES ${money(p.kes)}`,
      callback_data: `plan:${key}`,
    },
  ]);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "Welcome to Gizmo Insights VIP.\n\nChoose your plan. You pay once (card, Apple Pay, Google Pay or M-Pesa), and you get a private invite link to the VIP channel automatically. Nothing renews by itself.\n\n3+ odds = safer, more frequent picks.\n10+ odds = long shots that win rarely. No picks are guaranteed. 18+ only.",
    reply_markup: { inline_keyboard: rows },
  });
}

async function checkout(chatId, from, key, currency) {
  const plan = PLANS[key];
  if (!plan) return;
  if (currency === "USD" && !usdOn()) currency = "KES";
  const amount = currency === "USD" ? plan.usd : plan.kes;
  const reference = `gz_${from.id}_${key}_${Date.now()}`;

  const init = await paystack("/transaction/initialize", {
    method: "POST",
    body: {
      email: `tg${from.id}@vipgizmoinsights.com`,
      amount: amount * 100,
      currency,
      reference,
      callback_url: "https://t.me/GizmoVipAccesbot",
      metadata: {
        telegram_id: from.id,
        telegram_username: from.username || "",
        plan: key,
        currency,
      },
    },
  });

  if (!init.status) {
    console.error("initialize failed", init);
    await tg("sendMessage", { chat_id: chatId, text: "Sorry, we could not start the payment. Please try again in a minute." });
    return;
  }
  const sym = currency === "USD" ? "$" : "KES ";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `${plan.label}\n${sym}${money(amount)}\n\nTap the button to pay. After you pay, your invite link arrives here automatically.`,
    reply_markup: { inline_keyboard: [[{ text: `Pay ${sym}${money(amount)}`, url: init.data.authorization_url }]] },
  });
}

async function handle(update) {
  if (update.message) {
    const m = update.message;
    if (m.chat.type !== "private" || !m.text) return;
    if (/^\/myid/i.test(m.text)) {
      await tg("sendMessage", { chat_id: m.chat.id, text: `Your Telegram ID is: ${m.from.id}` });
      return;
    }
    if (isAdmin(m.from.id) && /^\/(addpick|picks|delpick|clearpicks|admin)/i.test(m.text)) {
      await adminCommand(m);
      return;
    }
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
    const chatId = q.message.chat.id;
    await tg("answerCallbackQuery", { callback_query_id: q.id });
    const [kind, key, cur] = (q.data || "").split(":");
    const plan = PLANS[key];
    if (!plan) return;

    if (kind === "plan") {
      if (!usdOn()) return checkout(chatId, q.from, key, "KES");
      await tg("sendMessage", {
        chat_id: chatId,
        text: `${plan.label}\nChoose how you want to pay:`,
        reply_markup: {
          inline_keyboard: [
            [{ text: `Pay in USD · $${plan.usd} (cards, Apple Pay, Google Pay)`, callback_data: `pay:${key}:USD` }],
            [{ text: `Pay in KES · ${money(plan.kes)} (M-Pesa or card)`, callback_data: `pay:${key}:KES` }],
          ],
        },
      });
      return;
    }
    if (kind === "pay") return checkout(chatId, q.from, key, cur === "USD" ? "USD" : "KES");
  }
}
