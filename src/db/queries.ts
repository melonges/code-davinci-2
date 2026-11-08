import { and, asc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { now } from "../now";
import { localeFromTelegram, type Locale } from "../t";
import * as schema from "./schema";
import { events, likes, matches, skips, snippets, users } from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

export type UserRecord = typeof users.$inferSelect;
export type SnippetRecord = typeof snippets.$inferSelect;
export type EventType = "onboarding_start" | "profile_complete" | "like" | "skip" | "match";
export type MatchRecord = typeof matches.$inferSelect;

export async function upsertUser(
  db: Db,
  from: { id: number; username?: string; language_code?: string },
): Promise<{ locale: Locale }> {
  const ts = now();
  const locale = localeFromTelegram(from.language_code);
  const existing = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, from.id))
    .get();

  if (existing) {
    await db
      .update(users)
      .set({
        username: from.username ?? null,
        lastActiveAt: ts,
      })
      .where(eq(users.id, from.id));
    return { locale: existing.locale === "ru" ? "ru" : "en" };
  }

  await db.insert(users).values({
    id: from.id,
    username: from.username ?? null,
    locale,
    state: "onboarding",
    isActive: 1,
    lastActiveAt: ts,
    createdAt: ts,
  });
  return { locale };
}

export async function getUser(db: Db, id: number): Promise<UserRecord | null> {
  const row = await db.select().from(users).where(eq(users.id, id)).get();
  return row ?? null;
}

export async function patchUser(
  db: Db,
  id: number,
  patch: Partial<typeof users.$inferInsert>,
): Promise<void> {
  await db.update(users).set(patch).where(eq(users.id, id));
}

export async function listSnippets(db: Db, userId: number): Promise<SnippetRecord[]> {
  return db
    .select()
    .from(snippets)
    .where(eq(snippets.userId, userId))
    .orderBy(asc(snippets.position))
    .all();
}

export async function upsertSnippet(
  db: Db,
  values: { userId: number; language: string; content: string },
): Promise<void> {
  await db.delete(snippets).where(eq(snippets.userId, values.userId));
  await db.insert(snippets).values({ ...values, position: 0 });
}

export async function clearOnboardingFields(db: Db, userId: number): Promise<void> {
  await db
    .update(users)
    .set({
      name: null,
      birthYear: null,
      gender: null,
      bio: null,
      state: "onboarding:name",
      lastCardUserId: null,
      browseMode: null,
    })
    .where(eq(users.id, userId));
  await db.delete(snippets).where(eq(snippets.userId, userId));
}

export async function beginProfileRefill(db: Db, userId: number): Promise<void> {
  await db
    .update(users)
    .set({
      state: "onboarding:refill:name",
      lastCardUserId: null,
      browseMode: null,
    })
    .where(eq(users.id, userId));
}

export async function completeProfile(db: Db, userId: number): Promise<void> {
  await db.update(users).set({ state: null, isActive: 1 }).where(eq(users.id, userId));
  await insertEventOnce(db, userId, "profile_complete");
}

export async function hasEvent(db: Db, userId: number, type: EventType): Promise<boolean> {
  const row = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.type, type)))
    .get();
  return row !== undefined;
}

export async function insertEventOnce(db: Db, userId: number, type: EventType): Promise<void> {
  if (await hasEvent(db, userId, type)) return;
  await db.insert(events).values({ userId, type, createdAt: now() });
}

export async function insertEvent(db: Db, userId: number, type: EventType): Promise<void> {
  await db.insert(events).values({ userId, type, createdAt: now() });
}

export async function insertLike(db: Db, fromUser: number, toUser: number): Promise<boolean> {
  const existing = await db
    .select({ id: likes.id })
    .from(likes)
    .where(and(eq(likes.fromUser, fromUser), eq(likes.toUser, toUser)))
    .get();
  if (existing) return false;
  await db.insert(likes).values({ fromUser, toUser, createdAt: now() });
  return true;
}

export async function insertSkip(db: Db, fromUser: number, toUser: number): Promise<boolean> {
  const existing = await db
    .select({ id: skips.id })
    .from(skips)
    .where(and(eq(skips.fromUser, fromUser), eq(skips.toUser, toUser)))
    .get();
  if (existing) return false;
  await db.insert(skips).values({ fromUser, toUser, createdAt: now() });
  return true;
}

export async function listIncomingLikers(db: Db, userId: number): Promise<UserRecord[]> {
  const incoming = await db
    .select({ fromUser: likes.fromUser, createdAt: likes.createdAt })
    .from(likes)
    .where(eq(likes.toUser, userId))
    .all();
  const swiped = await listSwipedIds(db, userId);
  incoming.sort((a, b) => b.createdAt - a.createdAt);
  const result: UserRecord[] = [];
  for (const row of incoming) {
    if (swiped.has(row.fromUser)) continue;
    const liker = await getUser(db, row.fromUser);
    if (!liker || liker.isActive !== 1 || liker.state !== null || liker.isFake === 1) continue;
    result.push(liker);
  }
  return result;
}

export async function countIncomingLikes(db: Db, userId: number): Promise<number> {
  return (await listIncomingLikers(db, userId)).length;
}

export async function listSwipedIds(db: Db, fromUser: number): Promise<Set<number>> {
  const liked = await db
    .select({ toUser: likes.toUser })
    .from(likes)
    .where(eq(likes.fromUser, fromUser))
    .all();
  const skipped = await db
    .select({ toUser: skips.toUser })
    .from(skips)
    .where(eq(skips.fromUser, fromUser))
    .all();
  return new Set([...liked.map((row) => row.toUser), ...skipped.map((row) => row.toUser)]);
}

export function pickCandidate(candidates: UserRecord[]): UserRecord | null {
  const ranked = candidates.filter((candidate) => candidate.isFake === 0);
  ranked.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  return ranked[0] ?? null;
}

export async function listFeedCandidates(db: Db, viewer: UserRecord): Promise<UserRecord[]> {
  const swiped = await listSwipedIds(db, viewer.id);
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.isActive, 1), eq(users.isFake, 0), isNull(users.state)))
    .all();

  const open = rows.filter((row) => row.id !== viewer.id && !swiped.has(row.id));
  if (viewer.langFilter == null) return open;

  const withLang: UserRecord[] = [];
  for (const row of open) {
    const candidateSnippets = await listSnippets(db, row.id);
    if (candidateSnippets.some((snippet) => snippet.language === viewer.langFilter)) {
      withLang.push(row);
    }
  }
  return withLang;
}

export async function hasReciprocalLike(
  db: Db,
  fromUser: number,
  toUser: number,
): Promise<boolean> {
  const row = await db
    .select({ id: likes.id })
    .from(likes)
    .where(and(eq(likes.fromUser, toUser), eq(likes.toUser, fromUser)))
    .get();
  return row !== undefined;
}

export async function insertMatch(db: Db, userX: number, userY: number): Promise<MatchRecord | null> {
  const userA = Math.min(userX, userY);
  const userB = Math.max(userX, userY);
  const existing = await db.select().from(matches).where(and(eq(matches.userA, userA), eq(matches.userB, userB))).get();
  if (existing) {
    // A later reciprocal like upgrades a one-sided Premium match to a regular mutual match.
    if (existing.premiumOwnerId === null) return null;
    await db.update(matches).set({ premiumOwnerId: null }).where(eq(matches.id, existing.id));
    return (await db.select().from(matches).where(eq(matches.id, existing.id)).get()) ?? null;
  }
  try {
    await db.insert(matches).values({ userA, userB, createdAt: now(), premiumOwnerId: null });
  } catch { return null; }
  return (await db.select().from(matches).where(and(eq(matches.userA, userA), eq(matches.userB, userB))).get()) ?? null;
}

export async function insertPremiumMatch(db: Db, ownerId: number, otherId: number): Promise<MatchRecord | null> {
  const userA = Math.min(ownerId, otherId);
  const userB = Math.max(ownerId, otherId);
  try {
    await db.insert(matches).values({ userA, userB, premiumOwnerId: ownerId, createdAt: now() });
  } catch { return null; }
  return (await db.select().from(matches).where(and(eq(matches.userA, userA), eq(matches.userB, userB))).get()) ?? null;
}

export async function setMatchRevealed(
  db: Db,
  matchId: number,
  side: "a" | "b",
): Promise<void> {
  await db
    .update(matches)
    .set(side === "a" ? { revealedA: 1 } : { revealedB: 1 })
    .where(eq(matches.id, matchId));
}

export async function listMatchesForUser(
  db: Db,
  userId: number,
): Promise<{ match: MatchRecord; other: UserRecord; meIsA: boolean }[]> {
  const rows = await db
    .select()
    .from(matches)
    .where(or(and(isNull(matches.premiumOwnerId), or(eq(matches.userA, userId), eq(matches.userB, userId))), eq(matches.premiumOwnerId, userId)))
    .all();
  const result: { match: MatchRecord; other: UserRecord; meIsA: boolean }[] = [];
  for (const match of rows) {
    const meIsA = match.userA === userId;
    const other = await getUser(db, meIsA ? match.userB : match.userA);
    if (other && other.isFake === 0) result.push({ match, other, meIsA });
  }
  return result;
}

export async function setUserInactive(db: Db, userId: number): Promise<void> {
  await db.update(users).set({ isActive: 0 }).where(eq(users.id, userId));
}

export async function setBrowseState(
  db: Db,
  userId: number,
  browseMode: string | null,
  lastCardUserId: number | null,
): Promise<void> {
  await db.update(users).set({ browseMode, lastCardUserId }).where(eq(users.id, userId));
}

export async function setUserPaused(db: Db, userId: number): Promise<void> {
  await db
    .update(users)
    .set({ isActive: 0, lastCardUserId: null, browseMode: "paused" })
    .where(eq(users.id, userId));
}

export async function resumeUser(db: Db, userId: number): Promise<void> {
  await db.update(users).set({ isActive: 1 }).where(eq(users.id, userId));
}

export async function claimLikeDigest(
  db: Db,
  toUser: number,
): Promise<{ n: number; locale: string } | null> {
  const user = await getUser(db, toUser);
  if (!user || user.isFake === 1 || user.isActive !== 1) return null;
  const ts = now();
  const windowStart = ts - 86400;
  const claimed = await db
    .update(users)
    .set({ lastLikeNotifAt: ts })
    .where(
      and(
        eq(users.id, toUser),
        eq(users.isActive, 1),
        eq(users.isFake, 0),
        or(isNull(users.lastLikeNotifAt), lt(users.lastLikeNotifAt, windowStart)),
      ),
    )
    .returning({ id: users.id });
  if (claimed.length === 0) return null;

  const since = user.lastLikeNotifAt;
  const incoming = await db
    .select({ fromUser: likes.fromUser })
    .from(likes)
    .where(
      since == null
        ? eq(likes.toUser, toUser)
        : and(eq(likes.toUser, toUser), gt(likes.createdAt, since)),
    )
    .all();
  const paired = await listMatchesForUser(db, toUser);
  const matched = new Set(paired.map((row) => row.other.id));
  const n = incoming.filter((row) => !matched.has(row.fromUser)).length;
  if (n === 0) return null;
  return { n, locale: user.locale };
}

export function isOnboarding(user: UserRecord): boolean {
  return user.state !== null;
}

export function isProfileComplete(
  user: UserRecord,
  snippetCount: number,
): boolean {
  return (
    user.state === null &&
    user.name !== null &&
    user.birthYear !== null &&
    user.gender !== null &&
    snippetCount > 0
  );
}


export async function hasSkipped(db: Db, fromUser: number, toUser: number): Promise<boolean> {
  const row = await db
    .select({ id: skips.id })
    .from(skips)
    .where(and(eq(skips.fromUser, fromUser), eq(skips.toUser, toUser)))
    .get();
  return row !== undefined;
}
