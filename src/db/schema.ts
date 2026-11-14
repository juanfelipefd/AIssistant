import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// activity_types
// ---------------------------------------------------------------------------

// 'committed' | 'available' — see docs/SPEC.md §5
export const activityTypeKind = pgEnum("activity_type_kind", [
  "committed",
  "available",
]);

// 'active' | 'archived'
export const activityTypeStatus = pgEnum("activity_type_status", [
  "active",
  "archived",
]);

export const activityTypes = pgTable("activity_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: activityTypeKind("kind").notNull(),
  color: text("color").notNull(),
  status: activityTypeStatus("status").notNull().default("active"),
});

// ---------------------------------------------------------------------------
// tracks
// ---------------------------------------------------------------------------

// 'study' | 'project' | 'habit' — see docs/SPEC.md §2
export const trackKind = pgEnum("track_kind", ["study", "project", "habit"]);

// 'active' | 'paused' | 'archived'
export const trackStatus = pgEnum("track_status", [
  "active",
  "paused",
  "archived",
]);

export const tracks = pgTable("tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: trackKind("kind").notNull(),
  charter: text("charter").notNull(),
  // Minutes, never hours — this project standardizes ALL duration columns
  // on minutes to avoid unit-conversion bugs.
  weeklyMinutesTarget: integer("weekly_minutes_target").notNull(),
  status: trackStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// track_relevance
// ---------------------------------------------------------------------------
// Append-only: a BEFORE UPDATE OR DELETE trigger is added by hand in the
// generated migration file (drizzle-kit cannot express triggers). See the
// migration SQL for the trigger definition and its drop/recreate note.

export const trackRelevance = pgTable(
  "track_relevance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    weight: smallint("weight").notNull(),
    rationale: text("rationale").notNull(),
    // Plain calendar date, not timestamptz.
    effectiveFrom: date("effective_from").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("track_relevance_weight_check", sql`${table.weight} BETWEEN 1 AND 5`),
  ],
);

// ---------------------------------------------------------------------------
// deadlines
// ---------------------------------------------------------------------------

export const deadlines = pgTable(
  "deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    // Plain calendar date.
    dueDate: date("due_date").notNull(),
    notes: text("notes"),
  },
  (table) => [
    // Used for the "nearest deadline" urgency signal across all tracks.
    index("deadlines_due_date_idx").on(table.dueDate),
  ],
);

// ---------------------------------------------------------------------------
// week_plans
// ---------------------------------------------------------------------------

export const weekPlans = pgTable("week_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  weekStart: date("week_start").notNull().unique(),
  // Nullable: the row can exist before the weekly planning conversation
  // fills it in.
  focus: text("focus"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Mutable/revised in place, unlike track_relevance which is append-only.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// topic_keys
// ---------------------------------------------------------------------------

export const topicKeys = pgTable(
  "topic_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    description: text("description"),
    // Mutable: updated whenever the key is reused (update logic not built yet).
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A real UNIQUE CONSTRAINT (not just a unique index) is required here:
    // Postgres composite foreign keys (roadmap_items, memories below) can
    // only reference a unique/primary-key constraint, not a bare unique
    // index.
    unique("topic_keys_track_id_key_unique").on(table.trackId, table.key),
  ],
);

// ---------------------------------------------------------------------------
// roadmap_items
// ---------------------------------------------------------------------------

// 'todo' | 'in_progress' | 'done' | 'skipped'
export const roadmapItemStatus = pgEnum("roadmap_item_status", [
  "todo",
  "in_progress",
  "done",
  "skipped",
]);

export const roadmapItems = pgTable(
  "roadmap_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    // App-level allocation convention: positions are spaced by 100
    // (0, 100, 200, ...) so inserting between two items never requires
    // renumbering. Purely application-level — no DB constraint for it.
    position: integer("position").notNull(),
    status: roadmapItemStatus("status").notNull().default("todo"),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    // Nullable: an item may not map to a memory topic yet.
    topicKey: text("topic_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "roadmap_items_estimated_minutes_check",
      sql`${table.estimatedMinutes} > 0`,
    ),
    index("roadmap_items_track_id_status_idx").on(table.trackId, table.status),
    foreignKey({
      columns: [table.trackId, table.topicKey],
      foreignColumns: [topicKeys.trackId, topicKeys.key],
      name: "roadmap_items_track_id_topic_key_fk",
    }).onDelete("restrict"),
  ],
);

// ---------------------------------------------------------------------------
// week_template_blocks
// ---------------------------------------------------------------------------

export const weekTemplateBlocks = pgTable(
  "week_template_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ISO 8601 convention: 1 = Monday ... 7 = Sunday. This deliberately does
    // NOT match JavaScript's Date.getDay() (0 = Sunday) — chosen because
    // week_plans.week_start is Monday-anchored. See docs/BUILD-LOG.md: any
    // JS caller must convert at exactly one boundary helper (not built yet).
    dayOfWeek: smallint("day_of_week").notNull(),
    // No timezone — single-user recurring template.
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    activityTypeId: uuid("activity_type_id")
      .notNull()
      .references(() => activityTypes.id, { onDelete: "restrict" }),
  },
  (table) => [
    check(
      "week_template_blocks_day_of_week_check",
      sql`${table.dayOfWeek} BETWEEN 1 AND 7`,
    ),
    // Overnight/midnight-wrapping blocks are explicitly disallowed in v1.
    check(
      "week_template_blocks_end_after_start_check",
      sql`${table.endTime} > ${table.startTime}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// calendar_blocks
// ---------------------------------------------------------------------------

export const calendarBlocks = pgTable(
  "calendar_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Plain calendar date.
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    activityTypeId: uuid("activity_type_id")
      .notNull()
      .references(() => activityTypes.id, { onDelete: "restrict" }),
    note: text("note"),
  },
  (table) => [
    check(
      "calendar_blocks_end_after_start_check",
      sql`${table.endTime} > ${table.startTime}`,
    ),
    index("calendar_blocks_date_idx").on(table.date),
  ],
);

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

// 'active' | 'closed' | 'abandoned'
export const sessionStatus = pgEnum("session_status", [
  "active",
  "closed",
  "abandoned",
]);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // Deliberately NOT derived from ended_at - started_at (if the user walks
    // away mid-session, the honest worked-minutes number matters more than
    // wall-clock delta). Write-once at session close — the app must never
    // edit it after close (app-discipline note, not DB-enforced).
    actualMinutes: integer("actual_minutes"),
    status: sessionStatus("status").notNull().default("active"),
    handoffDone: text("handoff_done"),
    handoffStopped: text("handoff_stopped"),
    handoffNext: text("handoff_next"),
    handoffBlockers: text("handoff_blockers"),
    // No tokens_used column: per-session tokens are derived from
    // SUM(token_usage) — one source of truth.
  },
  (table) => [
    index("sessions_track_id_status_idx").on(table.trackId, table.status),
    // At most one status = 'active' row across the whole table — this
    // product's premise is one live session at a time. Expressible directly
    // through Drizzle's partial-index API (uniqueIndex().where(...)).
    uniqueIndex("sessions_one_active_idx")
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
  ],
);

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

// Matches Anthropic's Messages API exactly: no 'system' role (the system
// prompt is assembled from the track's charter at request time and never
// stored per-message), and no 'tool' role (tool_use blocks live inside
// assistant messages, tool_result blocks live inside user messages).
export const messageRole = pgEnum("message_role", ["user", "assistant"]);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    role: messageRole("role").notNull(),
    // The Anthropic content-blocks array, stored verbatim as the API
    // returns/accepts it — a pass-through, not a reconstruction.
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_session_id_created_at_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------
// search_vector (generated tsvector over what/why/learned, GIN indexed) is
// added by hand in the generated migration file — see docs/BUILD-LOG.md for
// the where_ -> location column mapping.

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    topicKey: text("topic_key").notNull(),
    what: text("what").notNull(),
    why: text("why").notNull(),
    // This is the SPEC's `where_` field, renamed to `location` (self
    // describing, no quoting needed in Drizzle Studio). lib/memory.ts keeps
    // the TS param name `where` — see docs/BUILD-LOG.md.
    location: text("location").notNull(),
    learned: text("learned").notNull(),
    // Nullable: track-creation conversations aren't `sessions` rows but can
    // legitimately produce memories.
    sourceSessionId: uuid("source_session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("memories_track_id_created_at_idx").on(
      table.trackId,
      sql`${table.createdAt} DESC`,
    ),
    foreignKey({
      columns: [table.trackId, table.topicKey],
      foreignColumns: [topicKeys.trackId, topicKeys.key],
      name: "memories_track_id_topic_key_fk",
    }).onDelete("restrict"),
  ],
);

// ---------------------------------------------------------------------------
// token_usage
// ---------------------------------------------------------------------------

// One row per model call, written by src/lib/ai.ts and nothing else. Stores
// token COUNTS only — they are facts. Cost is derived from them at read time
// using the RATES table in src/lib/ai.ts, so a pricing change (or a wrong
// rate) never corrupts history; it's just recomputed.
export const tokenUsage = pgTable(
  "token_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: not every model call belongs to a session (e.g. track
    // creation, ranking).
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    // Prompt-cache writes/reads, reported separately from input_tokens and
    // priced differently. Nullable: present whenever the API reports them.
    cacheCreationInputTokens: integer("cache_creation_input_tokens"),
    cacheReadInputTokens: integer("cache_read_input_tokens"),
    // What the call was for, e.g. 'session_chat', 'track_create', 'ranking'.
    purpose: text("purpose").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("token_usage_created_at_idx").on(table.createdAt),
    check(
      "token_usage_tokens_nonnegative_check",
      sql`${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0`,
    ),
  ],
);
