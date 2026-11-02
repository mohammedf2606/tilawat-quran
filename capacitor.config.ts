import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tilawat.quran",
  appName: "Tilawat",
  webDir: "dist",
  android: {
    // Assets are bundled; nothing should ever be fetched from the network.
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_tilawat",
      iconColor: "#0f6b5c",
    },
  },
};

export default config;
