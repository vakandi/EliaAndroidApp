type LiveField = 'text' | 'reasoning' | 'tool';
type LiveListener = (agent: string, field: LiveField, delta: string) => void;
type BannerListener = (agent: string, banner: Record<string, unknown>) => void;

const liveListeners = new Set<LiveListener>();
const bannerListeners = new Set<BannerListener>();

export function emitLive(agent: string, field: string, delta: string) {
  const f = (field === 'reasoning' ? 'reasoning' : field === 'tool' ? 'tool' : 'text') as LiveField;
  for (const l of liveListeners) l(agent, f, delta);
}
export function emitBanner(agent: string, banner: Record<string, unknown>) {
  for (const l of bannerListeners) l(agent, banner);
}
export function onLive(cb: LiveListener): () => void {
  liveListeners.add(cb);
  return () => liveListeners.delete(cb);
}
export function onBanner(cb: BannerListener): () => void {
  bannerListeners.add(cb);
  return () => bannerListeners.delete(cb);
}
