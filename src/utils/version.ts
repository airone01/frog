export function compareVersions(a: string, b: string): number {
  const normalize = (v: string) => v.split('.').map(Number);

  const aParts = normalize(a);
  const bParts = normalize(b);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;

    if (aPart > bPart) {
      return 1;
    }

    if (aPart < bPart) {
      return -1;
    }
  }

  return 0;
}
