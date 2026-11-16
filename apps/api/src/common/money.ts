/** Money is stored as integer minor units (paise). The API speaks major units (rupees). */
export function toMinor(major: number | null | undefined): bigint | null {
  if (major === null || major === undefined) return null;
  return BigInt(Math.round(major * 100));
}
export function fromMinor(minor: bigint | null | undefined): number | null {
  if (minor === null || minor === undefined) return null;
  return Number(minor) / 100;
}
