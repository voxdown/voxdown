/** "Today, 7:05 PM", "Yesterday, 9:12 AM", "Monday, 4:30 PM", or a date. */
export function humanDate(time: number, now = Date.now()): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (time >= midnight.getTime()) return `Today, ${clock}`;
  if (time >= midnight.getTime() - day) return `Yesterday, ${clock}`;
  if (time >= midnight.getTime() - 6 * day)
    return `${date.toLocaleDateString(undefined, { weekday: "long" })}, ${clock}`;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}
