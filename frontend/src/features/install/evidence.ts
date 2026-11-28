type RelatedApplication = { platform: string; id?: string; url?: string };
type InstallNavigator = Navigator & {
  standalone?: boolean;
  getInstalledRelatedApps?: () => Promise<RelatedApplication[]>;
};

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as InstallNavigator).standalone === true;
}

export async function hasInstalledApplication() {
  if (isStandalone()) return true;
  const check = (navigator as InstallNavigator).getInstalledRelatedApps;
  if (!check) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const apps = await Promise.race([
      check.call(navigator),
      new Promise<RelatedApplication[]>((resolve) => { timer = setTimeout(() => resolve([]), 2500); }),
    ]);
    const manifest = new URL('/manifest.webmanifest', window.location.origin).href;
    const id = new URL('/', window.location.origin).href;
    return apps.some((app) => app.platform === 'webapp' && app.url === manifest && (!app.id || app.id === id));
  } catch { return false; } finally { clearTimeout(timer); }
}
