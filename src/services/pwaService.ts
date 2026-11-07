// src/services/pwaService.ts
// Service worker registration, install prompt management, and online/offline continuity.

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners: Array<(canInstall: boolean) => void> = [];
const onlineListeners: Array<(isOnline: boolean) => void> = [];

// Module-level window event listeners for browser environment
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installListeners.forEach((cb) => cb(true));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installListeners.forEach((cb) => cb(false));
  });

  window.addEventListener('online', () => {
    onlineListeners.forEach((cb) => cb(true));
  });

  window.addEventListener('offline', () => {
    onlineListeners.forEach((cb) => cb(false));
  });
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Register only in browser environment
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.installing) {
          reg.installing.addEventListener('statechange', () => {
            // State change tracked
          });
        }
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}

export function subscribeToInstallPrompt(callback: (canInstall: boolean) => void): () => void {
  installListeners.push(callback);
  callback(deferredPrompt !== null);
  return () => {
    const idx = installListeners.indexOf(callback);
    if (idx !== -1) installListeners.splice(idx, 1);
  };
}

export function subscribeToOnlineStatus(callback: (isOnline: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  callback(isOnline);

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  };
}

export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unsupported'> {
  if (!deferredPrompt) {
    return 'unsupported';
  }

  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installListeners.forEach((cb) => cb(false));
    return choice.outcome;
  } catch (err) {
    console.warn('PWA install prompt error:', err);
    return 'dismissed';
  }
}

export function isAppInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
