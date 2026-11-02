// Daily recitation reminders as local notifications (no server, works offline).
//
// Rather than one repeating notification, the next DAYS_AHEAD days are scheduled
// one by one so that each can carry that day's plan portion, and today's can be
// dropped once the reciter has already used the mic. The window is rebuilt on
// every app start and after every recitation.
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export interface ReminderSettings {
  enabled: boolean;
  /** Local time, "HH:MM". */
  time: string;
}

export interface ReminderMessage {
  title: string;
  body: string;
  /** Route to open when the notification is tapped. */
  hash?: string;
}

/** Notifications need the native app; the web build has no background scheduling. */
export const supported = Capacitor.isNativePlatform();

const DAYS_AHEAD = 30; // iOS keeps at most 64 pending
const ID_BASE = 7000;

/** Ask for permission. Resolves true when notifications may be shown. */
export async function requestPermission(): Promise<boolean> {
  if (!supported) return false;
  let { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") ({ display } = await LocalNotifications.requestPermissions());
  return display === "granted";
}

async function cancelOurs(): Promise<void> {
  const { notifications } = await LocalNotifications.getPending();
  const ours = notifications.filter((n) => n.id >= ID_BASE && n.id < ID_BASE + DAYS_AHEAD + 1);
  if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
}

/**
 * Rebuild the schedule. `message(date, offset)` writes each day's text (offset 0
 * is today); `skipToday` drops today's reminder when the reciter already practised.
 */
export async function refresh(
  settings: ReminderSettings,
  skipToday: boolean,
  message: (date: Date, offset: number) => ReminderMessage,
): Promise<void> {
  if (!supported) return;
  await cancelOurs();
  if (!settings.enabled) return;
  const { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") return;

  const [hour, minute] = settings.time.split(":").map(Number);
  const now = new Date();
  const notifications = [];
  for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
    if (offset === 0 && skipToday) continue;
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute);
    if (at <= now) continue;
    const m = message(at, offset);
    notifications.push({
      id: ID_BASE + offset,
      title: m.title,
      body: m.body,
      schedule: { at },
      extra: { hash: m.hash ?? "#/" },
    });
  }
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

/** Open the route a tapped reminder points at. */
export function onTap(open: (hash: string) => void): void {
  if (!supported) return;
  LocalNotifications.addListener("localNotificationActionPerformed", (e) => {
    const hash = e.notification.extra?.hash;
    if (typeof hash === "string") open(hash);
  });
}
