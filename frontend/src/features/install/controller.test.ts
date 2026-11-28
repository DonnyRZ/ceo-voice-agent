import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const evidence = vi.hoisted(() => ({ installed: false }));
vi.mock('./evidence', () => ({
  isStandalone: () => false,
  hasInstalledApplication: async () => evidence.installed,
}));

describe('installation browser lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    evidence.installed = false;
    const window = new EventTarget() as EventTarget & { matchMedia: () => EventTarget };
    window.matchMedia = () => new EventTarget();
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', new EventTarget());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  async function load(outcome: 'accepted' | 'dismissed' = 'accepted') {
    const controller = await import('./controller');
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(event);
    return { controller, prompt };
  }

  it('retains a real prompt, calls it during the gesture, and does not equate acceptance with installation', async () => {
    const { controller, prompt } = await load();
    expect(controller.getInstallationState().phase).toBe('ready');
    controller.requestInstall();
    expect(prompt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getInstallationState().phase).toBe('waiting');
    window.dispatchEvent(new Event('appinstalled'));
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getInstallationState().phase).toBe('waiting');
    evidence.installed = true;
    await vi.advanceTimersByTimeAsync(1600);
    expect(controller.getInstallationState().phase).toBe('installed');
  });

  it('stops spinning when evidence never arrives and permits an explicit retry', async () => {
    const { controller } = await load();
    controller.requestInstall();
    await vi.advanceTimersByTimeAsync(47000);
    expect(controller.getInstallationState().phase).toBe('unconfirmed');
    controller.retryInstallCheck();
    evidence.installed = true;
    await vi.advanceTimersByTimeAsync(1600);
    expect(controller.getInstallationState().phase).toBe('installed');
  });

  it('does not install on dismissal and consumes a prompt only once', async () => {
    const { controller, prompt } = await load('dismissed');
    controller.requestInstall();
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getInstallationState().phase).toBe('cancelled');
    controller.requestInstall();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('ignores an outstanding prompt result after leaving the install page', async () => {
    const { controller } = await load();
    controller.requestInstall();
    controller.leaveInstallWait();
    await vi.advanceTimersByTimeAsync(47000);
    expect(controller.getInstallationState().phase).toBe('unavailable');
  });
});

it('a fresh browser install offer invalidates an installation removed while the tab remains open', async () => {
  vi.resetModules();
  evidence.installed = true;
  const target = new EventTarget() as EventTarget & { matchMedia: () => EventTarget };
  target.matchMedia = () => new EventTarget();
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', new EventTarget());
  try {
    const controller = await import('./controller');
    await Promise.resolve();
    expect(controller.getInstallationState().phase).toBe('installed');
    evidence.installed = false;
    target.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }),
    }));
    expect(controller.getInstallationState().phase).toBe('ready');
  } finally { vi.unstubAllGlobals(); }
});
