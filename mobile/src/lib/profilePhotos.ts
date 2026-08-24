/**
 * Local agent profile photos (PLAN.md §8 Unit K) — port of ProfilePhotos.swift.
 * Photos are COPIED into the app's own documents folder
 * (`Paths.document/agent_photos/{name}.{ext}`) so they never get lost when the
 * source gallery item moves. A JSON map `{agentName: filename}` is persisted in
 * AsyncStorage — the Android mirror of Swift's agent_profiles.json.
 *
 * Public API mirrors the Swift class 1:1:
 *   getPhoto / setPhoto / removePhoto / hasPhoto
 * plus a tiny pub-sub + `useAgentPhoto` hook so every mounted <Avatar> updates
 * live after a pick, without a global store.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

/** AsyncStorage key holding the `{agentName: filename}` JSON map. */
const MAP_KEY = 'elia-agent-profile-photos';

/** Subfolder of Paths.document — mirrors Swift's `agent_photos` directory. */
const PHOTOS_DIR_NAME = 'agent_photos';

type ProfilePhotoMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Storage plumbing
// ---------------------------------------------------------------------------

function photosDirectory(): Directory {
  return new Directory(Paths.document, PHOTOS_DIR_NAME);
}

function ensurePhotosDirectory(): Directory {
  const dir = photosDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

let mapCache: ProfilePhotoMap | null = null;

async function loadMap(): Promise<ProfilePhotoMap> {
  if (mapCache !== null) return mapCache;
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        );
        mapCache = Object.fromEntries(entries);
        return mapCache;
      }
    }
  } catch {
    // Corrupt payload — start clean, same spirit as Swift's `try?`.
  }
  mapCache = {};
  return mapCache;
}

async function saveMap(map: ProfilePhotoMap): Promise<void> {
  mapCache = map;
  try {
    await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    // Persisting failed — cache stays authoritative for this session.
  }
}

/** Server names are safe for display but not for paths — sanitize once. */
export function photoFilenameBase(agentName: string): string {
  const sanitized = agentName.replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'agent';
}

/** Pick a sane extension from the picked asset; defaults to jpg per PLAN §8. */
function extensionFor(mimeType?: string | null, fileName?: string | null): string {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  if (mimeType && byMime[mimeType.toLowerCase()]) {
    return byMime[mimeType.toLowerCase()];
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  }
  return 'jpg';
}

// ---------------------------------------------------------------------------
// Change notification (keeps every mounted Avatar in sync)
// ---------------------------------------------------------------------------

type PhotoListener = () => void;

const listeners = new Set<PhotoListener>();

/** Subscribe to any profile-photo mutation. Returns an unsubscribe function. */
export function subscribeProfilePhotos(listener: PhotoListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyChanged(): void {
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Public API — mirrors ProfilePhotos.swift
// ---------------------------------------------------------------------------

/** Returns the local file:// URI for an agent's photo, or null if none set. */
export async function getPhoto(agentName: string): Promise<string | null> {
  const map = await loadMap();
  const filename = map[agentName];
  if (!filename) return null;
  const file = new File(photosDirectory(), filename);
  // Self-heal: drop stale map entries pointing at deleted files.
  if (!file.exists) {
    delete map[agentName];
    await saveMap(map);
    return null;
  }
  return file.uri;
}

/**
 * Sets a profile photo for an agent by COPYING the picked image into the app
 * folder (mirror of Swift setPhoto). Removes any previous photo first.
 * Resolves with the stored URI on success, or null on failure.
 */
export async function setPhoto(
  agentName: string,
  sourceUri: string,
  assetInfo?: { mimeType?: string | null; fileName?: string | null },
): Promise<string | null> {
  if (!sourceUri) return null;
  try {
    await removePhoto(agentName);

    const ext = extensionFor(assetInfo?.mimeType, assetInfo?.fileName);
    const destFilename = `${photoFilenameBase(agentName)}.${ext}`;
    const dir = ensurePhotosDirectory();
    const dest = new File(dir, destFilename);

    const source = new File(sourceUri);
    if (!source.exists) return null;
    await source.copy(dest);

    const map = await loadMap();
    map[agentName] = destFilename;
    await saveMap(map);
    notifyChanged();
    return dest.uri;
  } catch {
    return null;
  }
}

/** Removes the profile photo for an agent (file + map entry). */
export async function removePhoto(agentName: string): Promise<void> {
  const map = await loadMap();
  const filename = map[agentName];
  if (!filename) return;
  try {
    const file = new File(photosDirectory(), filename);
    if (file.exists) file.delete();
  } catch {
    // Best-effort deletion, like Swift's `try?`.
  }
  delete map[agentName];
  await saveMap(map);
  notifyChanged();
}

/** Returns true if an agent has a profile photo on disk. */
export async function hasPhoto(agentName: string): Promise<boolean> {
  return (await getPhoto(agentName)) !== null;
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

/** Live photo URI for an agent — re-renders whenever any photo mutates. */
export function useAgentPhoto(agentName: string): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      void getPhoto(agentName).then((next) => {
        if (alive) setUri(next);
      });
    };
    refresh();
    const unsubscribe = subscribeProfilePhotos(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [agentName]);

  return uri;
}
