// Shared JSON primitive decoders for untrusted boundary validation.
// Written in plain erasable TypeScript so Node scripts in gallery/ can import it directly.

export type ErrorFormatter = (path: string, expected: string) => string;

const defaultError: ErrorFormatter = (path, expected) => `${path}: expected ${expected}`;

export const MAX_UINT32 = 0xffffffff;

export function isUnsigned32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

export function assertUnsigned32(value: unknown, label: string): number {
  if (!isUnsigned32(value)) throw new Error(`${label} must be an unsigned 32-bit integer.`);
  return value;
}

export function decodeObject(value: unknown, path: string, format: ErrorFormatter = defaultError): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(format(path, "an object"));
  }
  return value as Record<string, unknown>;
}

export function decodeArray<T>(
  value: unknown,
  path: string,
  item: (entry: unknown, entryPath: string) => T,
  format: ErrorFormatter = defaultError,
): T[] {
  if (!Array.isArray(value)) throw new Error(format(path, "an array"));
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

export function decodeNullable<T>(
  value: unknown,
  path: string,
  read: (entry: unknown, entryPath: string) => T,
): T | null {
  return value === null || value === undefined ? null : read(value, path);
}

export function decodeString(value: unknown, path: string, format: ErrorFormatter = defaultError): string {
  if (typeof value !== "string") throw new Error(format(path, "a string"));
  return value;
}

export function decodeNonEmptyString(value: unknown, path: string, format: ErrorFormatter = defaultError): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(format(path, "a non-empty string"));
  return value;
}

export function decodeNumber(value: unknown, path: string, format: ErrorFormatter = defaultError): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(format(path, "a finite number"));
  return value;
}

export function decodeInteger(value: unknown, path: string, format: ErrorFormatter = defaultError): number {
  if (!Number.isSafeInteger(value)) throw new Error(format(path, "an integer"));
  return value as number;
}

export function decodeBoolean(value: unknown, path: string, format: ErrorFormatter = defaultError): boolean {
  if (typeof value !== "boolean") throw new Error(format(path, "a boolean"));
  return value;
}

export function decodeUnsigned32(value: unknown, path: string, format: ErrorFormatter = defaultError): number {
  if (!isUnsigned32(value)) throw new Error(format(path, "an unsigned 32-bit integer"));
  return value;
}
