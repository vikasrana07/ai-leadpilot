/**
 * Daylight sending window calculator for outbound WhatsApp marketing campaigns.
 * In accordance with TRAI regulations and WhatsApp Business messaging best practices,
 * marketing campaigns should only be delivered during daytime hours (default: 09:00 - 21:00 local time).
 *
 * If called during daylight hours, returns 0.
 * If called outside daylight hours (e.g. night), returns milliseconds until the next 09:00 AM window.
 */
export function msUntilNextDaylight(timezone = 'Asia/Kolkata', now = new Date()): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '12', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);

    // Daylight window is 09:00 to 21:00 (9:00 AM to 9:00 PM)
    if (hour >= 9 && hour < 21) {
      return 0;
    }

    // Outside window: calculate hours and minutes until next 09:00 AM
    let hoursUntil9: number;
    if (hour >= 21) {
      // Past 9 PM tonight: hours left in today (24 - hour) + 9 hours tomorrow morning
      hoursUntil9 = (24 - hour) + 9;
    } else {
      // Early morning before 9 AM today
      hoursUntil9 = 9 - hour;
    }

    const msUntil = (hoursUntil9 * 60 - minute) * 60 * 1000;
    return Math.max(60_000, msUntil);
  } catch {
    return 0; // fallback gracefully if timezone string is malformed
  }
}

/** Returns true if the provided time is within daylight sending hours for the timezone. */
export function isWithinDaylightHours(timezone = 'Asia/Kolkata', now = new Date()): boolean {
  return msUntilNextDaylight(timezone, now) === 0;
}
