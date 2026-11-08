import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  username: text("username"),
  locale: text("locale").notNull(),
  state: text("state"),
  name: text("name"),
  birthYear: integer("birth_year"),
  gender: integer("gender"),
  bio: text("bio"),
  langFilter: text("lang_filter"),
  isActive: integer("is_active").notNull().default(1),
  isFake: integer("is_fake").notNull().default(0),
  isPremium: integer("is_premium").notNull().default(0),
  lastActiveAt: integer("last_active_at").notNull(),
  lastLikeNotifAt: integer("last_like_notif_at"),
  lastCardUserId: integer("last_card_user_id"),
  browseMode: text("browse_mode"),
  createdAt: integer("created_at").notNull(),
});

export const snippets = sqliteTable(
  "snippets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    language: text("language").notNull(),
    content: text("content").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [uniqueIndex("snippets_user_id_unique").on(table.userId)],
);

export const likes = sqliteTable(
  "likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromUser: integer("from_user").notNull(),
    toUser: integer("to_user").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("likes_from_to_unique").on(table.fromUser, table.toUser)],
);


export const skips = sqliteTable(
  "skips",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromUser: integer("from_user").notNull(),
    toUser: integer("to_user").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("skips_from_to_unique").on(table.fromUser, table.toUser)],
);

export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userA: integer("user_a").notNull(),
    userB: integer("user_b").notNull(),
    revealedA: integer("revealed_a").notNull().default(0),
    revealedB: integer("revealed_b").notNull().default(0),
    premiumOwnerId: integer("premium_owner_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("matches_pair_unique").on(table.userA, table.userB)],
);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  type: text("type").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
