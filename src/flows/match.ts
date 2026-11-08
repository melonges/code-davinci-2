import { GrammyError, InlineKeyboard, type Api } from "grammy";
import {
  type Db,
  type MatchRecord,
  type UserRecord,
  getUser,
  hasReciprocalLike,
  insertEvent,
  insertMatch,
  insertPremiumMatch,
  isOnboarding,
  listMatchesForUser,
  claimLikeDigest,
  setBrowseState,
  setMatchRevealed,
  setUserInactive,
} from "../db/queries";
import { homeKeyboard, withMenuLegend } from "../keyboards";
import { ageFromBirthYear, escapeHtml } from "./card";
import { isPausedUser, replyPaused } from "./screens";
import { isLocale, t, type Locale } from "../t";
import type { OutsideContext } from "./onboarding";

type MatchContext = OutsideContext;

function likesOpenKeyboard(locale: Locale): InlineKeyboard {
  return new InlineKeyboard().text(t(locale, "likesOpen"), "lk:open");
}

function localeOf(user: UserRecord): Locale {
  return isLocale(user.locale) ? user.locale : "en";
}

function isBlocked(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 403;
}

async function safeSend(api: Api, db: Db, chatId: number, send: () => Promise<unknown>): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (error) {
    if (isBlocked(error)) await setUserInactive(db, chatId);
    return false;
  }
}

function matchText(to: UserRecord, other: UserRecord, nowMs: number): string {
  const locale = localeOf(to);
  const age = other.birthYear != null ? ageFromBirthYear(other.birthYear, nowMs) : "?";
  return `${t(locale, "matchTitle")}\n\n<b>${escapeHtml(other.name ?? "")}</b>, ${age}\nhttps://t.me/${other.username}`;
}

async function sendReveal(
  api: Api,
  db: Db,
  to: UserRecord,
  other: UserRecord,
  nowMs: number,
): Promise<boolean> {
  if (to.isActive !== 1 || !other.username) return false;
  const locale = localeOf(to);
  const html = withMenuLegend(matchText(to, other, nowMs), "home", locale);
  return safeSend(api, db, to.id, () =>
    api.sendMessage(to.id, html, {
      parse_mode: "HTML",
      reply_markup: homeKeyboard(locale),
    }),
  );
}

async function revealIfPossible(
  api: Api,
  db: Db,
  match: MatchRecord,
  recipient: UserRecord,
  other: UserRecord,
  recipientIsA: boolean,
  nowMs: number,
): Promise<void> {
  const already = recipientIsA ? match.revealedA === 1 : match.revealedB === 1;
  if (already || !other.username || recipient.isActive !== 1) return;
  const sent = await sendReveal(api, db, recipient, other, nowMs);
  if (sent) await setMatchRevealed(db, match.id, recipientIsA ? "a" : "b");
}

async function sendPending(
  api: Api,
  db: Db,
  to: UserRecord,
  key: "matchPendingViewer" | "matchPendingOther",
): Promise<void> {
  if (to.isActive !== 1) return;
  const locale = localeOf(to);
  await safeSend(api, db, to.id, () =>
    api.sendMessage(to.id, withMenuLegend(t(locale, key), "home", locale), {
      reply_markup: homeKeyboard(locale),
    }),
  );
}

export async function processNewLike(
  ctx: MatchContext,
  fromUser: UserRecord,
  toUserId: number,
): Promise<boolean> {
  const toUser = await getUser(ctx.db, toUserId);
  if (!toUser || fromUser.isFake === 1 || toUser.isFake === 1) return false;

  if (await hasReciprocalLike(ctx.db, fromUser.id, toUserId)) {
    const created = await insertMatch(ctx.db, fromUser.id, toUserId);
    if (!created) return false;
    await insertEvent(ctx.db, fromUser.id, "match");
    await setBrowseState(ctx.db, fromUser.id, "home", null);
    await setBrowseState(ctx.db, toUser.id, "home", null);
    const nowMs = Date.now();
    await revealIfPossible(ctx.api, ctx.db, created, fromUser, toUser, created.userA === fromUser.id, nowMs);
    await revealIfPossible(ctx.api, ctx.db, created, toUser, fromUser, created.userA === toUser.id, nowMs);

    if (!toUser.username) await sendPending(ctx.api, ctx.db, fromUser, "matchPendingViewer");
    if (!fromUser.username) await sendPending(ctx.api, ctx.db, toUser, "matchPendingViewer");
    if (!fromUser.username) await sendPending(ctx.api, ctx.db, fromUser, "matchPendingOther");
    if (!toUser.username) await sendPending(ctx.api, ctx.db, toUser, "matchPendingOther");
    return true;
  }

  if (fromUser.isPremium === 1) {
    const created = await insertPremiumMatch(ctx.db, fromUser.id, toUserId);
    if (!created) return false;
    await insertEvent(ctx.db, fromUser.id, "match");
    await setBrowseState(ctx.db, fromUser.id, "home", null);
    const nowMs = Date.now();
    const ownerIsA = created.userA === fromUser.id;
    await revealIfPossible(ctx.api, ctx.db, created, fromUser, toUser, ownerIsA, nowMs);
    if (!toUser.username) await sendPending(ctx.api, ctx.db, fromUser, "matchPendingViewer");
    if (!fromUser.username) await sendPending(ctx.api, ctx.db, fromUser, "matchPendingOther");
    return true;
  }

  const digest = ctx.executionCtx.waitUntil(
    (async () => {
      const claimed = await claimLikeDigest(ctx.db, toUserId);
      if (!claimed) return;
      const locale = isLocale(claimed.locale) ? claimed.locale : "en";
      await safeSend(ctx.api, ctx.db, toUserId, () =>
        ctx.api.sendMessage(toUserId, t(locale, "likeDigest", { n: claimed.n }), {
          reply_markup: likesOpenKeyboard(locale),
        }),
      );
    })(),
  );
  void digest;
  return false;
}

export async function flushPendingReveals(ctx: MatchContext): Promise<void> {
  if (!ctx.from) return;
  const me = await getUser(ctx.db, ctx.from.id);
  if (!me) return;
  const pairs = await listMatchesForUser(ctx.db, me.id);
  const nowMs = Date.now();
  for (const { match, other, meIsA } of pairs) {
    await revealIfPossible(ctx.api, ctx.db, match, me, other, meIsA, nowMs);
  }
}

export async function handleMatchesCommand(ctx: OutsideContext): Promise<void> {
  if (!ctx.from) return;
  const me = await getUser(ctx.db, ctx.from.id);
  if (!me || isOnboarding(me)) {
    await ctx.reply(t(ctx.locale, "finishOnboardingFirst"));
    return;
  }
  if (isPausedUser(me)) {
    await replyPaused(ctx);
    return;
  }
  await setBrowseState(ctx.db, me.id, "home", null);
  const pairs = await listMatchesForUser(ctx.db, me.id);
  if (pairs.length === 0) {
    await ctx.reply(withMenuLegend(t(ctx.locale, "matchesEmpty"), "home", ctx.locale), {
      reply_markup: homeKeyboard(ctx.locale),
    });
    return;
  }
  const nowMs = Date.now();
  const lines = [t(ctx.locale, "matchesTitle"), ""];
  for (const { other } of pairs) {
    const name = other.name ?? "?";
    const age = other.birthYear != null ? String(ageFromBirthYear(other.birthYear, nowMs)) : "?";
    if (other.username) {
      lines.push(`${name}, ${age} — https://t.me/${other.username}`);
    } else {
      lines.push(`${name}, ${age} — ${t(ctx.locale, "matchPendingWait")}`);
    }
  }
  let text = lines.join("\n");
  if (text.length > 4000) text = `${text.slice(0, 3990)}\n…`;
  await ctx.reply(withMenuLegend(text, "home", ctx.locale), {
    reply_markup: homeKeyboard(ctx.locale),
  });
}
