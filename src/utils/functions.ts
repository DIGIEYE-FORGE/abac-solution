export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseTimeToMinutes(time: string): number | null {
  const normalized = time.trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  // Invalid time text cannot participate in ordered time comparisons, so callers can fail the condition safely.
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }

  // AM/PM values are normalized to 24-hour time before comparison.
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "AM" && hours === 12) hours = 0;
    if (meridiem === "PM" && hours !== 12) hours += 12;
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
}


export function timeToMinutes(time: string): number {
  return parseTimeToMinutes(time) ?? 0;
}