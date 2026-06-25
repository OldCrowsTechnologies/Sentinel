/**
 * notifications.ts -- local intercept notifications.
 *
 * Fires a heads-up notification on every NEW contact so the operator is alerted
 * even when Corvus Sentinel is backgrounded / minimized. Works while monitoring
 * continues under the microphone foreground service (the JS audio callback keeps
 * running, so this keeps firing). Local notifications only -- no push server.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'intercepts';
let ready = false;

// Show the banner + play sound even if the app happens to be foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Request permission + (Android) create the high-importance intercepts channel. */
export async function initNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Intercepts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00C2C7',
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    ready = status === 'granted';
    return ready;
  } catch {
    return false;
  }
}

/** Post an immediate intercept notification. No-op if permission was denied. */
export async function notifyIntercept(title: string, body: string): Promise<void> {
  if (!ready) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    /* non-fatal */
  }
}
