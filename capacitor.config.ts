import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kexin.infofilter',
  appName: '信息过滤器',
  webDir: 'www',
  ios: {
    contentInset: 'always',
    allowsLinkPreview: false
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      overlaysWebView: true
    }
  }
};

export default config;
