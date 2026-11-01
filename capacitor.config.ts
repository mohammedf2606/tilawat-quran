import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tilawat.quran",
  appName: "Tilawat",
  webDir: "dist",
  android: {
    // Assets are bundled; nothing should ever be fetched from the network.
    allowMixedContent: false,
  },
};

export default config;
