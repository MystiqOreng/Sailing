// Minimal event bus shared by sim, UI and the (future) hazard system.

export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => {
      const arr = this.handlers.get(type);
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }
  emit(type, payload) {
    for (const fn of this.handlers.get(type) ?? []) fn(payload);
  }
}
