'use strict';
// One scheduler per extension worker: every manga tab shares this capacity.
globalThis.MLQueue = class {
  constructor(onLimit = () => {}) { this.limit = 4; this.active = 0; this.streak = 0; this.waiting = []; this.paused = new Set(); this.blocked = false; this.onLimit = onLimit; }
  begin(owner, retry = false) { this.paused.delete(owner); if (retry || owner !== this.blockedOwner) this.blocked = false; this.pump(); }
  pause(owner) {
    this.paused.add(owner);
    this.waiting = this.waiting.filter(entry => {
      if (entry.owner !== owner) return true;
      entry.reject(Object.assign(new Error('Gönderilmemiş grup duraklatıldı.'), { notSent: true, code: 'JOB_PAUSED' })); return false;
    });
  }
  enqueue(owner, task) {
    const queuedAt = Date.now();
    return new Promise((resolve, reject) => { this.waiting.push({ owner, task, resolve, reject, queuedAt }); this.pump(); });
  }
  pump() {
    while (this.waiting.length && (this.blocked || this.paused.has(this.waiting[0].owner))) {
      this.waiting.shift().reject(Object.assign(new Error('Yeni gönderimler durduruldu; açık yeniden deneme gerekli.'), { notSent: true, stopJob: true, code: 'DISPATCH_STOPPED' }));
    }
    while (!this.blocked && this.active < this.limit && this.waiting.length) {
      const entry = this.waiting.shift(); this.active++;
      if (this.paused.has(entry.owner)) { this.active--; entry.reject(Object.assign(new Error('Gönderilmemiş grup duraklatıldı.'), { notSent: true, code: 'JOB_PAUSED' })); continue; }
      Promise.resolve().then(() => entry.task({ queueMs: Date.now() - entry.queuedAt, concurrency: this.limit })).then(value => {
        if (!this.blocked && ++this.streak >= 4) { this.streak = 0; this.limit = Math.min(8, this.limit + 2); this.onLimit(this.limit); }
        entry.resolve(value);
      }, error => {
        this.streak = 0;
        if (error.stopJob) {
          this.blocked = true; this.blockedOwner = entry.owner;
          if (['PROVIDER_RATE_LIMITED', 'PROVIDER_IN_FLIGHT_BUDGET'].includes(error.code)) { this.limit = Math.max(1, Math.floor(this.limit / 2)); this.onLimit(this.limit); }
        }
        entry.reject(error);
      }).finally(() => { this.active--; this.pump(); });
    }
  }
};
