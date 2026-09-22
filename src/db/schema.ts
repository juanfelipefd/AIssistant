import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";

// 'committed' | 'available' — see docs/SPEC.md §5
export const activityTypeKind = pgEnum("activity_type_kind", [
  "committed",
  "available",
]);

export const activityTypes = pgTable("activity_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: activityTypeKind("kind").notNull(),
  color: text("color").notNull(),
});
