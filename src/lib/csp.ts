function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function buildFrameAncestorsCsp(ancestors: string[]): string {
  const normalized = ancestors
    .map(normalizeOrigin)
    .filter((value): value is string => Boolean(value));

  if (normalized.length === 0) {
    return "frame-ancestors 'none';";
  }

  return `frame-ancestors ${normalized.join(" ")};`;
}

