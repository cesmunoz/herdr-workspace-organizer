import { uniq } from "lodash-es";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeOrder(values: readonly string[]): string[] {
  return uniq(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}
