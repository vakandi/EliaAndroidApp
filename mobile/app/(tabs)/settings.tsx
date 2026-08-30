/**
 * Settings — Unit F (PLAN.md §3 + §4).
 * Server section: URL edit dialog, connection test, LAN discovery panel.
 * Notifications section: agent run alerts. About: version + notes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';

import { Avatar } from '@/src/components/Avatar';
import { AvatarPickerModal } from '@/src/components/AvatarPickerModal';
import ScanResults from '@/src/components/ScanResults';
import { SubworkerApi } from '@/src/lib/api';
import { normalizeServerUrl, useSettingsStore } from '@/src/lib/settings';
import { useSubworkersStore } from '@/src/lib/store';
import { radius, spacing, useTheme } from '@/src/theme';
import {
  normalizeDomain,
  tunnelApi,
  tunnelStepLabel,
  TUNNEL_POLL_INTERVAL_MS,
  TUNNEL_STEP_ORDER,
  type TunnelSetupStep,
  type TunnelStatus,
} from '@/src/lib/tunnel';

/** One-shot health probe timeout (matches PLAN §3 "Test connection"). */
const PROBE_TIMEOUT_MS = 3000;

type ThemeType = ReturnType<typeof useTheme>;

type SettingsStyles = ReturnType<typeof makeStyles>;

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail' };

export default function SettingsScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const authToken = useSettingsStore((s) => s.authToken);
  const setAuthToken = useSettingsStore((s) => s.setAuthToken);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const subworkers = useSubworkersStore((s) => s.subworkers);
  const reconnect = useSubworkersStore((s) => s.reconnect);

  const [editOpen, setEditOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [photoAgent, setPhotoAgent] = useState<string | null>(null);

  const remoteDomain = useSettingsStore((s) => s.remoteDomain);
  const setRemoteDomain = useSettingsStore((s) => s.setRemoteDomain);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [resettingTunnel, setResettingTunnel] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A URL change (manual save or LAN pick) invalidates any previous result.
  useEffect(() => {
    setTest({ kind: 'idle' });
  }, [serverUrl]);

  const runConnectionTest = useCallback(async () => {
    if (!mountedRef.current) return;
    setTest({ kind: 'testing' });
    const startedAt = Date.now();
    try {
      const reachable = await SubworkerApi.probeHealth(
        serverUrl,
        PROBE_TIMEOUT_MS,
        authToken,
      );
      if (!mountedRef.current) return;
      setTest(
        reachable
          ? { kind: 'ok', latencyMs: Date.now() - startedAt }
          : { kind: 'fail' },
      );
    } catch {
      if (!mountedRef.current) return;
      setTest({ kind: 'fail' });
    }
  }, [serverUrl, authToken]);

  const handleSaveServer = (url: string): void => {
    setServerUrl(url); // Normalizes internally (scheme + :5656 default port).
    try {
      reconnect(); // Re-point the connection core at the new server.
    } catch (error) {
      // Connection core lands independently (Unit B); never crash the UI here.
      console.warn('[Settings] reconnect unavailable:', error);
    }
    setEditOpen(false);
  };

  const handleSaveToken = (token: string): void => {
    setAuthToken(token); // Trims + persists; '' disables auth.
    try {
      reconnect(); // Re-handshake WS + polls with the new credentials.
    } catch (error) {
      console.warn('[Settings] reconnect unavailable:', error);
    }
    setTokenOpen(false);
  };

  // Tunnel status follows the server URL — reload whenever it changes.
  useEffect(() => {
    let cancelled = false;
    tunnelApi
      .getStatus()
      .then((status) => {
        if (!cancelled) setTunnelStatus(status);
      })
      .catch(() => {
        if (!cancelled) setTunnelStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const refreshTunnelStatus = useCallback(() => {
    tunnelApi
      .getStatus()
      .then((status) => setTunnelStatus(status))
      .catch(() => setTunnelStatus(null));
  }, []);

  const handleResetTunnel = useCallback(() => {
    Alert.alert(
      'Reset Cloudflare?',
      `This permanently deletes the DNS record and the tunnel${
        tunnelStatus?.domain ? ` for ${tunnelStatus.domain}` : ''
      } on Cloudflare, then stops the connector. The app goes back to LAN-only until setup runs again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setResettingTunnel(true);
            tunnelApi
              .resetTunnel()
              .then((result) => {
                setRemoteDomain('');
                setTunnelStatus(null);
                Alert.alert(
                  result.remoteErrors.length === 0
                    ? 'Cloudflare reset'
                    : 'Reset finished with warnings',
                  result.remoteErrors.length === 0
                    ? 'The domain was removed from Cloudflare and the connector stopped.'
                    : result.remoteErrors.join('\n'),
                );
              })
              .catch((err) => {
                Alert.alert(
                  'Reset failed',
                  err instanceof Error ? err.message : String(err),
                );
              })
              .finally(() => setResettingTunnel(false));
          },
        },
      ],
    );
  }, [tunnelStatus?.domain, setRemoteDomain]);

  const appVersion =
    Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? '1.0.0';

  const profileAgents = useMemo(
    () => subworkers.map((sw) => sw.name).sort((a, b) => a.localeCompare(b)),
    [subworkers],
  );

  const renderTestStatus = () => {
    switch (test.kind) {
      case 'idle':
        return (
          <Text style={[styles.statusText, { color: theme.colors.textTertiary }]}>
            Not checked yet
          </Text>
        );
      case 'testing':
        return (
          <>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
              Testing…
            </Text>
          </>
        );
      case 'ok':
        return (
          <Text
            style={[styles.statusText, styles.statusOk, { color: theme.colors.accent }]}
          >
            ✓ Reachable · {test.latencyMs} ms
          </Text>
        );
      case 'fail':
        return (
          <Text
            style={[styles.statusText, styles.statusFail, { color: theme.stateColors.error }]}
          >
            ✕ Unreachable
          </Text>
        );
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* ---------------------------------------------------------- SERVER */}
      <Text style={[styles.sectionHeader, { color: theme.colors.textTertiary }]}>
        Server
      </Text>
      <View style={styles.card}>
        <Pressable
          onPress={() => setEditOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Change server address, currently ${serverUrl}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
        >
          <Text style={styles.rowLabel}>Server URL</Text>
          <View style={styles.rowValue}>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.urlValue}>
              {serverUrl}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>

        <View style={styles.separator} />

        <Pressable
          onPress={() => setTokenOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            authToken
              ? `Change auth token, currently set ending ${authToken.slice(-4)}`
              : 'Set auth token, currently not set'
          }
          style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
        >
          <Text style={styles.rowLabel}>Auth token</Text>
          <View style={styles.rowValue}>
            <Text numberOfLines={1} style={styles.urlValue}>
              {authToken ? maskToken(authToken) : 'Not set'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>

        <View style={styles.separator} />

        <Pressable
          onPress={() => void runConnectionTest()}
          disabled={test.kind === 'testing'}
          accessibilityRole="button"
          accessibilityLabel={`Test the connection to ${serverUrl}`}
          accessibilityState={{ busy: test.kind === 'testing' }}
          style={({ pressed }) => [
            styles.row,
            test.kind === 'testing' && styles.rowDisabled,
            pressed && test.kind !== 'testing' && styles.pressedSoft,
          ]}
        >
          <Text style={styles.rowLabel}>Test connection</Text>
          <View style={styles.testStatus}>{renderTestStatus()}</View>
        </Pressable>

        <View style={styles.separator} />

        <Pressable
          onPress={() => setScanOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={
            scanOpen ? 'Hide network scan' : 'Scan the local network for your server'
          }
          accessibilityState={{ expanded: scanOpen }}
          style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
        >
          <Text style={styles.rowLabel}>Scan network</Text>
          <View style={styles.rowValue}>
            <Text style={styles.scanHintValue}>
              {scanOpen ? 'Hide' : 'Find automatically'}
            </Text>
            <Text style={[styles.chevron, scanOpen && styles.chevronOpen]}>›</Text>
          </View>
        </Pressable>
      </View>

      {scanOpen && (
        <View style={[styles.card, styles.scanPanel]}>
          <ScanResults autoStart />
        </View>
      )}

      {/* ---------------------------------------------------- REMOTE ACCESS */}
      <Text style={[styles.sectionHeader, { color: theme.colors.textTertiary }]}>
        Remote access
      </Text>
      <View style={styles.card}>
        <Pressable
          onPress={() => setWizardOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Set up Cloudflare Tunnel remote access"
          style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
        >
          <Text style={styles.rowLabel}>Cloudflare Tunnel</Text>
          <View style={styles.rowValue}>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.urlValue}>
              {tunnelStatus?.configured ? (tunnelStatus.domain ?? 'Configured') : 'Not configured'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>

        {tunnelStatus?.configured && (
          <>
            <View style={styles.separator} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Status</Text>
              <Text
                style={[
                  styles.statusText,
                  {
                    color: tunnelStatus.publicOk
                      ? theme.colors.accent
                      : tunnelStatus.cloudflaredRunning
                        ? theme.colors.textSecondary
                        : theme.stateColors.error,
                  },
                ]}
              >
                {tunnelStatus.publicOk
                  ? '✓ Live everywhere'
                  : tunnelStatus.cloudflaredRunning
                    ? '• Starting…'
                    : '✕ Stopped'}
              </Text>
            </View>
            {remoteDomain ? (
              <>
                <View style={styles.separator} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Saved domain</Text>
                  <Text numberOfLines={1} ellipsizeMode="middle" style={styles.urlValue}>
                    {remoteDomain}
                  </Text>
                </View>
              </>
            ) : null}
            <View style={styles.separator} />
            <Pressable
              onPress={handleResetTunnel}
              disabled={resettingTunnel}
              accessibilityRole="button"
              accessibilityLabel="Reset Cloudflare and remove the domain"
              accessibilityState={{ busy: resettingTunnel }}
              style={({ pressed }) => [
                styles.row,
                pressed && !resettingTunnel && styles.pressedSoft,
              ]}
            >
              {resettingTunnel ? (
                <ActivityIndicator size="small" color={theme.stateColors.error} />
              ) : (
                <Text style={[styles.rowLabel, { color: theme.stateColors.error }]}>
                  Reset Cloudflare…
                </Text>
              )}
            </Pressable>
          </>
        )}
      </View>

      {/* --------------------------------------------------- NOTIFICATIONS */}
      <Text style={[styles.sectionHeader, { color: theme.colors.textTertiary }]}>
        Notifications
      </Text>
      <View style={styles.card}>
        <Pressable
          onPress={() => setNotificationsEnabled(!notificationsEnabled)}
          accessibilityRole="switch"
          accessibilityLabel="Agent run notifications"
          accessibilityState={{ checked: notificationsEnabled }}
          style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
        >
          <Text style={styles.rowLabel}>Agent run alerts</Text>
          <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} />
        </Pressable>
        <Text style={styles.segmentCaption}>
          Notifies when an agent errors or finishes — pushed live over WebSocket.
        </Text>
      </View>

      {/* --------------------------------------------------------- PROFILES */}
      <Text style={[styles.sectionHeader, { color: theme.colors.textTertiary }]}>
        Profiles
      </Text>
      <View style={styles.card}>
        {profileAgents.length === 0 ? (
          <View style={styles.profilesEmpty}>
            <Text style={styles.profilesEmptyTitle}>No agents yet</Text>
            <Text style={styles.profilesEmptyHint}>
              Connect to your server — agent photos live here.
            </Text>
          </View>
        ) : (
          profileAgents.map((agent, index) => (
            <View key={agent}>
              {index > 0 && <View style={styles.separator} />}
              <Pressable
                onPress={() => setPhotoAgent(agent)}
                accessibilityRole="button"
                accessibilityLabel={`Change profile photo for ${agent}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
              >
                <View style={styles.profileRow}>
                  <Avatar name={agent} size={36} />
                  <Text numberOfLines={1} style={styles.rowLabel}>
                    {agent}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
      <Text style={styles.sectionCaption}>
        Photos stay on this device and appear next to each agent.
      </Text>

      {/* ----------------------------------------------------------- ABOUT */}
      <Text style={[styles.sectionHeader, { color: theme.colors.textTertiary }]}>
        About
      </Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.aboutValue}>{appVersion}</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.aboutBlock}>
          <Text style={styles.aboutTagline}>
            Elia Subworkers — companion for the EliaAgent subworker server.
          </Text>
          <Text style={styles.aboutRepo}>Source &amp; server docs · github.com/vakandi/EliaAgent</Text>
        </View>
      </View>

      {/* ------------------------------------------------------------ MODAL */}
      <EditServerModal
        visible={editOpen}
        serverUrl={serverUrl}
        onClose={() => setEditOpen(false)}
        onSave={handleSaveServer}
      />
      <EditTokenModal
        visible={tokenOpen}
        authToken={authToken}
        onClose={() => setTokenOpen(false)}
        onSave={handleSaveToken}
      />
      <AvatarPickerModal
        visible={photoAgent !== null}
        agentName={photoAgent ?? ''}
        onClose={() => setPhotoAgent(null)}
      />
      <TunnelWizardModal
        visible={wizardOpen}
        currentDomain={tunnelStatus?.domain ?? null}
        onClose={() => {
          setWizardOpen(false);
          refreshTunnelStatus();
        }}
        onUseDomain={(domain) => {
          setServerUrl(`https://${domain}`);
          setRemoteDomain(domain);
          try {
            reconnect();
          } catch (error) {
            console.warn('[Settings] reconnect unavailable:', error);
          }
          setWizardOpen(false);
        }}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Edit-server dialog
// ---------------------------------------------------------------------------

interface EditServerModalProps {
  visible: boolean;
  serverUrl: string;
  onClose: () => void;
  onSave: (normalizedUrl: string) => void;
}

/**
 * Validation mirrors `normalizeServerUrl` (settings.ts): scheme http/https,
 * host required, `:5656` appended when no explicit port and no path.
 */
function validateDraft(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter the server address — e.g. 192.168.1.10.';
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate.replace(/\/+$/, ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Only http:// or https:// addresses are supported.';
    }
    if (!parsed.hostname) return 'Add a host — e.g. 192.168.1.10 or myserver.local.';
    return null;
  } catch {
    return "That address doesn't look valid — e.g. 192.168.1.10.";
  }
}

function EditServerModal({ visible, serverUrl, onClose, onSave }: EditServerModalProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [draft, setDraft] = useState(serverUrl);
  const [error, setError] = useState<string | null>(null);

  // Prefill each time the dialog opens; reset stale errors.
  useEffect(() => {
    if (visible) {
      setDraft(serverUrl);
      setError(null);
    }
  }, [visible, serverUrl]);

  const validation = validateDraft(draft);
  const isValid = validation === null;
  const normalizedPreview = isValid ? normalizeServerUrl(draft) : null;
  const showsPreview =
    normalizedPreview !== null && normalizedPreview !== draft.trim();

  const stop = (event: GestureResponderEvent): void => event.stopPropagation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable style={styles.dialog} onPress={stop}>
          <Text style={styles.dialogTitle}>Edit server address</Text>
          <Text style={styles.dialogCaption}>
            Where the EliaAgent subworker server lives on your network.
          </Text>

          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setError(null);
            }}
            onSubmitEditing={() => {
              if (isValid && draft.trim()) onSave(normalizedPreview ?? draft.trim());
            }}
            autoFocus
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="192.168.1.10:5656"
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.input}
          />

          {error !== null ? (
            <Text style={[styles.dialogHint, { color: theme.stateColors.error }]}>
              {error}
            </Text>
          ) : isValid && showsPreview ? (
            <Text style={[styles.dialogHint, { color: theme.colors.accent }]}>
              Saves as {normalizedPreview}
            </Text>
          ) : (
            <Text style={styles.dialogHint}>
              Local addresses get port 5656 automatically; domains use https.
            </Text>
          )}

          <View style={styles.dialogButtons}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressedSoft]}
            >
              <Text style={[styles.cancelButtonText, { color: theme.colors.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (validation !== null) {
                  setError(validation);
                  return;
                }
                onSave(normalizedPreview ?? draft.trim());
              }}
              disabled={!isValid}
              accessibilityRole="button"
              accessibilityLabel="Save address and connect"
              accessibilityState={{ disabled: !isValid }}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: theme.colors.accent },
                !isValid && styles.saveDisabled,
                pressed && isValid && styles.pressedStrong,
              ]}
            >
              <Text style={styles.saveButtonText}>Save &amp; connect</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Auth-token dialog
// ---------------------------------------------------------------------------

/** •••• + last 4 chars; short tokens are fully masked. */
function maskToken(token: string): string {
  return token.length > 4 ? `••••${token.slice(-4)}` : '••••••';
}

interface EditTokenModalProps {
  visible: boolean;
  authToken: string;
  onClose: () => void;
  onSave: (token: string) => void;
}

function EditTokenModal({ visible, authToken, onClose, onSave }: EditTokenModalProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [draft, setDraft] = useState(authToken);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraft(authToken);
      setReveal(false);
    }
  }, [visible, authToken]);

  const trimmed = draft.trim();

  const stop = (event: GestureResponderEvent): void => event.stopPropagation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable style={styles.dialog} onPress={stop}>
          <Text style={styles.dialogTitle}>Auth token</Text>
          <Text style={styles.dialogCaption}>
            Shared token required by your server (ELIA_AUTH_TOKEN). Leave empty
            if the server has no auth.
          </Text>

          <View style={styles.tokenInputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => onSave(trimmed)}
              autoFocus
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!reveal}
              placeholder="Paste token…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.input, styles.tokenInput]}
            />
            <Pressable
              onPress={() => setReveal((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={reveal ? 'Hide token' : 'Show token'}
              accessibilityState={{ expanded: reveal }}
              style={({ pressed }) => [
                styles.revealButton,
                pressed && styles.pressedSoft,
              ]}
            >
              <Text style={[styles.revealButtonText, { color: theme.colors.accent }]}>
                {reveal ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.dialogHint}>
            {trimmed ? 'Sent as Authorization Bearer + X-Elia-Token.' : 'No token — requests are sent unauthenticated.'}
          </Text>

          <View style={styles.dialogButtons}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing token"
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressedSoft]}
            >
              <Text style={[styles.cancelButtonText, { color: theme.colors.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onSave(trimmed)}
              disabled={!trimmed && !authToken}
              accessibilityRole="button"
              accessibilityLabel="Save auth token"
              accessibilityState={{ disabled: !trimmed && !authToken }}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: theme.colors.accent },
                !trimmed && !authToken && styles.saveDisabled,
                pressed && (trimmed || authToken) && styles.pressedStrong,
              ]}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cloudflare Tunnel wizard
// ---------------------------------------------------------------------------

interface TunnelWizardModalProps {
  visible: boolean;
  currentDomain: string | null;
  onClose: () => void;
  onUseDomain: (domain: string) => void;
}

type WizardPhase = 'form' | 'running' | 'done' | 'error';

function TunnelWizardModal({
  visible,
  currentDomain,
  onClose,
  onUseDomain,
}: TunnelWizardModalProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [phase, setPhase] = useState<WizardPhase>('form');
  const [domainDraft, setDomainDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('wael.bousfira@gmail.com');
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [finalStatus, setFinalStatus] = useState<TunnelStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (visible) {
      setPhase('form');
      setDomainDraft(currentDomain ?? '');
      setTokenDraft('');
      setCheckMessage(null);
      setChecking(false);
      setStepIndex(-1);
      setFinalStatus(null);
    }
    return () => abortRef.current?.abort();
  }, [visible, currentDomain]);

  const normalizedDomain = normalizeDomain(domainDraft);
  const tokenTrimmed = tokenDraft.trim();
  const emailTrimmed = emailDraft.trim();
  const isGlobal = tokenTrimmed.startsWith('cfk_') || tokenTrimmed.length === 37;
  const formValid = normalizedDomain !== null && tokenTrimmed.length > 0 && (!isGlobal || emailTrimmed.includes('@'));

  const runCheck = async (): Promise<void> => {
    if (!formValid) return;
    setChecking(true);
    setCheckMessage(null);
    try {
      const result = await tunnelApi.check(normalizedDomain, tokenTrimmed, isGlobal ? emailTrimmed : undefined);
      setCheckMessage(
        result.message ?? (result.ok ? 'Looks good.' : 'Check failed.'),
      );
    } catch (err) {
      setCheckMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const startSetup = (): void => {
    if (!formValid) return;
    setPhase('running');
    setStepIndex(0);
    setFinalStatus(null);
    const controller = new AbortController();
    abortRef.current = controller;
    tunnelApi
      .startSetup(normalizedDomain, tokenTrimmed, isGlobal ? emailTrimmed : undefined)
      .then(() =>
        tunnelApi.pollSetup(
          (status) => {
            setFinalStatus(status);
            const idx =
              status.step !== null
                ? TUNNEL_STEP_ORDER.indexOf(status.step)
                : -1;
            if (idx >= 0) setStepIndex(idx);
          },
          { signal: controller.signal },
        ),
      )
      .then((final) => {
        setPhase(final.step === 'done' ? 'done' : 'error');
      })
      .catch(() => setPhase('error'));
  };

  const stop = (event: GestureResponderEvent): void => event.stopPropagation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable style={styles.dialog} onPress={stop}>
          {phase === 'form' ? (
            <>
              <Text style={styles.dialogTitle}>Remote access via Cloudflare</Text>
              <Text style={styles.dialogCaption}>
                One-time setup on this network. Creates a free Cloudflare Tunnel
                for your domain — the server stays reachable everywhere and
                survives every restart. Requires a domain hosted on Cloudflare.
              </Text>

              <TextInput
                value={domainDraft}
                onChangeText={(text) => {
                  setDomainDraft(text);
                  setCheckMessage(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="elia.yourdomain.com"
                placeholderTextColor={theme.colors.textTertiary}
                style={styles.input}
              />
              <TextInput
                value={tokenDraft}
                onChangeText={(text) => {
                  setTokenDraft(text);
                  setCheckMessage(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="Cloudflare API Token (or Global API Key cfk_...)"
                placeholderTextColor={theme.colors.textTertiary}
                style={styles.input}
              />
              <TextInput
                value={emailDraft}
                onChangeText={(text) => {
                  setEmailDraft(text);
                  setCheckMessage(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="Cloudflare Email (for Global API Key)"
                placeholderTextColor={theme.colors.textTertiary}
                style={styles.input}
              />
              <Text style={styles.dialogHint}>
                API Token needs Zone:DNS:Edit + Tunnel:Edit. Or paste Global API Key (cfk_...) + Email to auto-create.
              </Text>

              {checkMessage !== null ? (
                <Text style={styles.dialogHint}>{checkMessage}</Text>
              ) : null}

              <View style={styles.dialogButtons}>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel tunnel setup"
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.pressedSoft]}
                >
                  <Text style={[styles.cancelButtonText, { color: theme.colors.textSecondary }]}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={runCheck}
                  disabled={!formValid || checking}
                  accessibilityRole="button"
                  accessibilityLabel="Verify domain and token"
                  accessibilityState={{ disabled: !formValid || checking, busy: checking }}
                  style={({ pressed }) => [
                    styles.cancelButton,
                    !formValid && styles.saveDisabled,
                    pressed && formValid && styles.pressedSoft,
                  ]}
                >
                  {checking ? (
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  ) : (
                    <Text style={[styles.cancelButtonText, { color: theme.colors.accent }]}>
                      Check
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={startSetup}
                  disabled={!formValid}
                  accessibilityRole="button"
                  accessibilityLabel="Start tunnel setup"
                  accessibilityState={{ disabled: !formValid }}
                  style={({ pressed }) => [
                    styles.saveButton,
                    { backgroundColor: theme.colors.accent },
                    !formValid && styles.saveDisabled,
                    pressed && formValid && styles.pressedStrong,
                  ]}
                >
                  <Text style={styles.saveButtonText}>Setup</Text>
                </Pressable>
              </View>
            </>
          ) : phase === 'running' ? (
            <>
              <Text style={styles.dialogTitle}>Setting up the tunnel…</Text>
              <Text style={styles.dialogCaption}>
                This runs on the server — keep it powered and online.
              </Text>
              {TUNNEL_STEP_ORDER.map((step, index) => {
                const state =
                  index < stepIndex ? 'done' : index === stepIndex ? 'active' : 'pending';
                return (
                  <View key={step} style={[styles.row, styles.tunnelStepRow]}>
                    <Text
                      style={[
                        styles.statusText,
                        {
                          color:
                            state === 'done'
                              ? theme.colors.accent
                              : state === 'active'
                                ? theme.colors.textSecondary
                                : theme.colors.textTertiary,
                        },
                      ]}
                    >
                      {state === 'done' ? '✓' : state === 'active' ? '•' : '○'}
                    </Text>
                    <Text
                      style={[
                        styles.rowLabel,
                        {
                          color:
                            state === 'pending'
                              ? theme.colors.textTertiary
                              : theme.colors.textPrimary,
                        },
                      ]}
                    >
                      {tunnelStepLabel(step)}
                    </Text>
                    {state === 'active' && (
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                    )}
                  </View>
                );
              })}
            </>
          ) : phase === 'done' ? (
            <>
              <Text style={styles.dialogTitle}>Tunnel is live</Text>
              <Text style={styles.dialogCaption}>
                {`https://${finalStatus?.domain ?? normalizedDomain ?? ''}`} is now
                reachable everywhere. The setup is permanent — it comes back
                automatically after every restart.
              </Text>
              <View style={styles.dialogButtons}>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Keep current server URL"
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.pressedSoft]}
                >
                  <Text style={[styles.cancelButtonText, { color: theme.colors.textSecondary }]}>
                    Later
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const domain = finalStatus?.domain ?? normalizedDomain;
                    if (domain) onUseDomain(domain);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Use the tunnel domain everywhere"
                  style={({ pressed }) => [
                    styles.saveButton,
                    { backgroundColor: theme.colors.accent },
                    pressed && styles.pressedStrong,
                  ]}
                >
                  <Text style={styles.saveButtonText} numberOfLines={1}>
                    Use https://…
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.dialogTitle}>Setup failed</Text>
              <Text style={[styles.dialogCaption, { color: theme.stateColors.error }]}>
                {finalStatus?.lastError ?? 'The server reported an error during setup.'}
              </Text>
              <View style={styles.dialogButtons}>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.pressedSoft]}
                >
                  <Text style={[styles.cancelButtonText, { color: theme.colors.textSecondary }]}>
                    Close
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setPhase('form')}
                  accessibilityRole="button"
                  accessibilityLabel="Retry tunnel setup"
                  style={({ pressed }) => [
                    styles.saveButton,
                    { backgroundColor: theme.colors.accent },
                    pressed && styles.pressedStrong,
                  ]}
                >
                  <Text style={styles.saveButtonText}>Retry</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (theme: ThemeType) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl * 2,
      gap: spacing.sm,
    },

    // Section headers — iOS-grouped uppercase captions
    sectionHeader: {
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      marginTop: spacing.md,
      marginBottom: spacing.xs,
      marginHorizontal: spacing.xs,
    },

    // Card group
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },

    // Rows
    row: {
      minHeight: 52,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md - 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    rowDisabled: {
      opacity: 0.6,
    },
    rowLabel: {
      fontSize: 15,
      fontWeight: '400',
      color: theme.colors.textPrimary,
    },
    rowValue: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: spacing.sm,
    },
    urlValue: {
      flexShrink: 1,
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    chevron: {
      fontSize: 22,
      lineHeight: 26,
      fontWeight: '300',
      color: theme.colors.textTertiary,
    },
    chevronOpen: {
      transform: [{ rotate: '90deg' }],
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
      marginLeft: spacing.lg,
    },

    // Test connection
    testStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    statusText: {
      fontSize: 13,
      fontWeight: '500',
      textAlign: 'right',
    },
    statusOk: {
      fontWeight: '700',
    },
    statusFail: {
      fontWeight: '600',
    },

    // Scan panel
    scanPanel: {
      padding: spacing.lg,
    },
    scanHintValue: {
      fontSize: 14,
      color: theme.colors.textTertiary,
    },

    // Segmented control
    segmentTrack: {
      flexDirection: 'row',
      backgroundColor: theme.colors.background,
      borderRadius: radius.sm,
      padding: 3,
      gap: 2,
      marginTop: spacing.lg,
      marginHorizontal: spacing.lg,
    },
    segment: {
      flex: 1,
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm - 4,
    },
    segmentActive: {
      backgroundColor: `${theme.colors.accent}22`,
    },
    segmentText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    segmentTextActive: {
      color: theme.colors.accent,
      fontWeight: '700',
    },
    segmentCaption: {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.textTertiary,
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
      marginHorizontal: spacing.lg,
    },
    tunnelStepRow: {
      gap: spacing.sm,
    },

    // Profiles
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      flexShrink: 1,
    },
    profilesEmpty: {
      padding: spacing.lg,
      gap: spacing.xs,
    },
    profilesEmptyTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    profilesEmptyHint: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textTertiary,
    },
    sectionCaption: {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.textTertiary,
      marginHorizontal: spacing.xs + 2,
      marginTop: -spacing.xs + 4,
    },

    // About
    aboutValue: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    aboutBlock: {
      padding: spacing.lg,
      gap: spacing.xs,
    },
    aboutTagline: {
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.textSecondary,
    },
    aboutRepo: {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.textTertiary,
    },

    // Dialog
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    dialog: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: theme.colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      padding: spacing.xl,
      gap: spacing.md,
    },
    dialogTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    dialogCaption: {
      fontSize: 13,
      lineHeight: 18,
      marginTop: -spacing.xs + 2,
      color: theme.colors.textSecondary,
    },
    dialogHint: {
      fontSize: 12,
      lineHeight: 16,
      marginTop: -spacing.xs + 2,
      color: theme.colors.textTertiary,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: radius.sm,
      backgroundColor: theme.colors.background,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md - 2,
      fontSize: 15,
      color: theme.colors.textPrimary,
    },
    tokenInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    tokenInput: {
      flex: 1,
    },
    revealButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.xs,
    },
    revealButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    dialogButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    cancelButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
    },
    cancelButtonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    saveButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      borderRadius: radius.sm,
    },
    saveDisabled: {
      opacity: 0.4,
    },
    saveButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },

    // Press feedback
    pressedSoft: {
      opacity: 0.55,
    },
    pressedStrong: {
      opacity: 0.8,
    },
  });
