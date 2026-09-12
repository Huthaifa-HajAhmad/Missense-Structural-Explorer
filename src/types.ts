/**
 * Global Types Facade (Strangler Fig pattern).
 *
 * Re-exports all domain types from ./types/ and wire schemas from ./shared/contracts.ts
 * ensuring 100% backward-compatibility for all existing consumers.
 */

export * from "./types/index.ts";
