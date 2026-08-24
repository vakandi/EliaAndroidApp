/**
 * Persisted app settings — zustand + AsyncStorage (Unit A, full implementation).
 * Holds serverUrl + refreshIntervalSec; `hydrated` flips true once storage
 * rehydration completes so the root layout knows when to start the store.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_AUTH_TOKEN, DEFAULT_BASE_URL, DEFAULT_PORT } from './config';

const STORAGE_KEY = 'elia-subworkers-settings';

interface SettingsState {
  /** Normalized base URL, e.g. http://192.168.1.10:5656 */
  serverUrl: string;
  /** Last known-good LAN base URL (private Wi-Fi), for smart fallback §9.3. */
  lanUrl: string | null;
  /** Last configured https tunnel domain, for smart fallback §9.3. */
  remoteDomain: string | null;
  /** Status poll interval in seconds (5/10/15/30/60). */
  refreshIntervalSec: number;
  /** Shared static auth token ('' = no auth — server env ELIA_AUTH_TOKEN unset). */
  authToken: string;
  /** Fire local notifications on subworker error/completion events. */
  notificationsEnabled: boolean;
  /** True once persist rehydration finished. */
  hydrated: boolean;
  setServerUrl: (url: string) => void;
  setLanUrl: (url: string) => void;
  setRemoteDomain: (url: string) => void;
  setRefreshInterval: (sec: number) => void;
  setAuthToken: (token: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  markHydrated: () => void;
}

/** Hosts that should get the implicit :5656 LAN treatment. */
const LAN_HOST_RE =
  /^(10\.\d|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$|[a-z0-9-]+\.local$)/i;

function looksLikeLanHost(hostname: string): boolean {
  return LAN_HOST_RE.test(hostname);
}

/**
 * Normalize user input into a usable base URL:
 * - trim whitespace
 * - prepend http:// when no scheme
 * - LAN addresses (private IPs, *.local, localhost) get :5656 appended when
 *   no explicit port AND no path
 * - public domains stay port-less and upgrade to https:// (Cloudflare Tunnel)
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_BASE_URL;

  const hadScheme = /^https?:\/\//i.test(trimmed);
  let candidate = hadScheme ? trimmed : `http://${trimmed}`;
  candidate = candidate.replace(/\/+$/, '');

  try {
    const parsed = new URL(candidate);
    const hasNoPath = parsed.pathname === '' || parsed.pathname === '/';
    if (!parsed.port && hasNoPath) {
      if (parsed.protocol === 'https:') return candidate;
      if (looksLikeLanHost(parsed.hostname)) {
        return `${parsed.protocol}//${parsed.hostname}:${DEFAULT_PORT}`;
      }
      // Bare public domain without scheme → secure origin, implicit :443.
      if (!hadScheme) return `https://${parsed.host}`;
    }
    return candidate;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

/**
 * Normalize a tunnel domain input into a full https:// origin
 * (e.g. "sub.example.com" → "https://sub.example.com").
 * Returns null for empty or non-https-able input.
 */
export function normalizeRemoteDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate.replace(/\/+$/, ''));
    if (parsed.protocol !== 'https:') return null;
    return `https://${parsed.host}`;
  } catch {
    return null;
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_BASE_URL,
      lanUrl: null,
      remoteDomain: null,
      refreshIntervalSec: 5,
      authToken: DEFAULT_AUTH_TOKEN,
      notificationsEnabled: true,
      hydrated: false,
      setServerUrl: (url) => set({ serverUrl: normalizeServerUrl(url) }),
      setLanUrl: (url) => set({ lanUrl: url }),
      setRemoteDomain: (domain) => set({ remoteDomain: normalizeRemoteDomain(domain) }),
      setRefreshInterval: (sec) => set({ refreshIntervalSec: sec }),
      setAuthToken: (token) => set({ authToken: token.trim() }),
      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      // Persist only user preferences — `hydrated` is runtime state.
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        lanUrl: state.lanUrl,
        remoteDomain: state.remoteDomain,
        refreshIntervalSec: state.refreshIntervalSec,
        authToken: state.authToken,
        notificationsEnabled: state.notificationsEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        // Legacy installs may have persisted an empty token before the
        // built-in default existed — restore it so auth keeps working.
        if (state && !state.authToken) {
          state.setAuthToken(DEFAULT_AUTH_TOKEN);
        }
        state?.markHydrated();
      },
    },
  ),
);
