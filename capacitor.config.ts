import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kexin.infofilter',
  appName: 'flow',
  webDir: 'www',
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: false
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      overlaysWebView: false
    }
  }
};

export default config;
