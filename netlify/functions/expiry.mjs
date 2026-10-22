import { DAY, tg, members } from "../lib/shared.mjs";

// Runs every hour: reminds members a day before expiry, removes them when time is up.
export const config = { schedule: "@hourly" };

export default async () => {
  const store = members();
  const { blobs } = await store.list();
  const now = Date.now();
  const channel = process.env.CHANNEL_ID;

  for (const b of blobs) {
    const m = await store.get(b.key, { type: "json" });
    if (!m || !m.active) continue;
    const left = m.expiry - now;

    if (left <= 0) {
      await tg("banChatMember", { chat_id: channel, user_id: m.userId });
      await tg("unbanChatMember", { chat_id: channel, user_id: m.userId, only_if_banned: true });
      await tg("sendMessage", {
        chat_id: m.userId,
        text: "Your VIP access has ended. To renew, send /start here and pick a plan.",
      });
      m.active = false;
      await store.setJSON(b.key, m);
    } else if (left <= DAY && !m.reminded) {
      await tg("sendMessage", {
        chat_id: m.userId,
        text: "Your VIP access ends in less than 24 hours. To keep it, send /start here and pick a plan. Time you pay for is added on top of what is left.",
      });
      m.reminded = true;
      await store.setJSON(b.key, m);
    }
  }
};
