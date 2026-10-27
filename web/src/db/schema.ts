// Typed mirror of supabase/migrations for Drizzle queries. The SQL migrations
// are the source of truth: constraints, triggers and the occupancy exclusion
// constraint live there, not here. Keep the two in step.

import {
  boolean,
  char,
  customType,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres daterange in canonical "[start,end)" text form. */
export const daterange = customType<{ data: string; driverData: string }>({
  dataType: () => "daterange",
});

export const propertyStatus = pgEnum("property_status", ["DRAFT", "PUBLISHED", "HIDDEN"]);
export const rateKind = pgEnum("rate_kind", ["BASE", "WEEKEND", "SEASON", "DATE"]);
export const bookingSource = pgEnum("booking_source", ["WEB", "AIRBNB", "MANUAL"]);
export const bookingStatus = pgEnum("booking_status", [
  "HOLD",
  "AWAITING_APPROVAL",
  "CONFIRMED",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "REFUNDED",
]);
export const emailStatus = pgEnum("email_status", ["QUEUED", "SENT", "FAILED", "BOUNCED"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

export const properties = pgTable("properties", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  status: propertyStatus().notNull().default("DRAFT"),
  maxGuests: integer("max_guests").notNull(),
  maxPets: integer("max_pets"),
  minNights: integer("min_nights").notNull().default(1),
  cleaningFeeCents: integer("cleaning_fee_cents").notNull().default(0),
  petFeeCents: integer("pet_fee_cents").notNull().default(0),
  currency: char({ length: 3 }).notNull().default("USD"),
  timezone: text().notNull().default("America/Chicago"),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateRules = pgTable("rate_rules", {
  id: uuid().primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  kind: rateKind().notNull(),
  nightlyCents: integer("nightly_cents").notNull(),
  during: daterange(),
  label: text(),
  ...timestamps,
});

export const taxRates = pgTable("tax_rates", {
  id: uuid().primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  name: text().notNull(),
  rateBasisPoints: integer("rate_basis_points").notNull(),
  appliesToNightly: boolean("applies_to_nightly").notNull().default(true),
  appliesToCleaning: boolean("applies_to_cleaning").notNull().default(false),
  appliesToPet: boolean("applies_to_pet").notNull().default(false),
  active: boolean().notNull().default(true),
  ...timestamps,
});

export const bookings = pgTable("bookings", {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  source: bookingSource().notNull().default("WEB"),
  status: bookingStatus().notNull(),
  checkIn: date("check_in", { mode: "string" }).notNull(),
  checkOut: date("check_out", { mode: "string" }).notNull(),
  guests: integer().notNull(),
  pets: integer().notNull().default(0),
  guestName: text("guest_name"),
  guestEmail: text("guest_email"),
  guestPhone: text("guest_phone"),
  message: text(),
  quote: jsonb(),
  totalCents: integer("total_cents"),
  policyVersion: text("policy_version"),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calendarBlocks = pgTable("calendar_blocks", {
  id: uuid().primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  during: daterange().notNull(),
  reason: text(),
  ...timestamps,
});

/** Written only by database triggers. Read it to draw the availability calendar. */
export const occupancy = pgTable("occupancy", {
  id: uuid().primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  during: daterange().notNull(),
  bookingId: uuid("booking_id")
    .unique()
    .references(() => bookings.id),
  blockId: uuid("block_id")
    .unique()
    .references(() => calendarBlocks.id),
  active: boolean().notNull().default(true),
});

export const stripeEvents = pgTable("stripe_events", {
  id: text().primaryKey(),
  type: text().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailOutbox = pgTable("email_outbox", {
  id: uuid().primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").references(() => bookings.id),
  template: text().notNull(),
  toAddress: text("to_address").notNull(),
  payload: jsonb().notNull().default({}),
  status: emailStatus().notNull().default("QUEUED"),
  attempts: integer().notNull().default(0),
  lastError: text("last_error"),
  providerId: text("provider_id"),
  ...timestamps,
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const siteSettings = pgTable("site_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
