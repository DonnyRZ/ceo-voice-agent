import type { VoiceOwner, VoiceServiceOptions } from './types.js';

type Prepare<Context, Prepared> = VoiceServiceOptions<Context, unknown, Prepared>['prepare'];

export class VoicePreparation<Context, Prepared> {
  private pending?: {
    text: string;
    context?: Context;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
    value?: Prepared;
  };

  constructor(
    private readonly owner: VoiceOwner,
    private readonly prepare: Prepare<Context, Prepared>,
    private readonly delayMs: number,
  ) {}

  queue(text: string, context?: Context) {
    const { prepare } = this;
    if (!prepare || (this.pending?.text === text && this.pending.context === context)) return;
    this.clear();
    if (text.length < 8) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(250)]);
      void Promise.resolve().then(() => prepare({ ...this.owner, text, context, signal })).then((value) => {
        if (this.pending?.controller === controller && !signal.aborted) this.pending.value = value;
      }).catch(() => undefined);
    }, this.delayMs);
    timer.unref();
    this.pending = { text, context, timer, controller };
  }

  take(text: string, context?: Context) {
    const result = this.pending?.text === text && this.pending.context === context ? this.pending.value : undefined;
    this.clear();
    return result;
  }

  clear() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.controller.abort();
    this.pending = undefined;
  }
}
