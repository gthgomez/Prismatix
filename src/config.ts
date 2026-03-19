function readEnv(name: string): string {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export const CONFIG = {
  appName: readEnv('VITE_PUBLIC_APP_NAME') || 'Prismatix Public Starter',
  apiUrl: readEnv('VITE_API_URL'),
} as const;
