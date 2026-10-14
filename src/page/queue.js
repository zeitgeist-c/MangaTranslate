'use strict';
// One scheduler per extension worker: every manga tab shares this capacity.
globalThis.MLQueue = class {
  constructor(onLimit = () => {}) { this.limit = 4; this.active = 0; this.streak = 0; this.waiting = []; this.paused = new Set(); this.blockedOwners = new Set(); this.lanes = new Map(); this.onLimit = onLimit; }
  get blocked() { return this.blockedOwners.size > 0; }
  isBlocked(owner) { return this.blockedOwners.has(owner); }
  block(owner) { this.blockedOwners.add(owner); this.pump(); }
  begin(owner, retry = false) { this.paused.delete(owner); if (retry) this.blockedOwners.delete(owner); this.pump(); }
  pause(owner) {
    this.paused.add(owner);
    this.waiting = this.waiting.filter(entry => {
      if (entry.owner !== owner) return true;
      entry.reject(Object.assign(new Error('Gönderilmemiş grup duraklatıldı.'), { notSent: true, code: 'JOB_PAUSED' })); return false;
    });
  }
  enqueue(owner, task, { lane = 'default', maxConcurrency = 8 } = {}) {
    const queuedAt = Date.now();
    return new Promise((resolve, reject) => { this.waiting.push({ owner, task, resolve, reject, queuedAt, lane, maxConcurrency }); this.pump(); });
  }
  pump() {
    this.waiting = this.waiting.filter(entry => {
      if (!this.isBlocked(entry.owner) && !this.paused.has(entry.owner)) return true;
      entry.reject(Object.assign(new Error('Bu işin yeni gönderimleri durduruldu; açık yeniden deneme gerekli.'), { notSent: true, stopJob: true, code: 'DISPATCH_STOPPED' })); return false;
    });
    while (this.active < this.limit && this.waiting.length) {
      const index = this.waiting.findIndex(entry => (this.lanes.get(entry.lane) || 0) < entry.maxConcurrency);
      if (index < 0) break;
      const [entry] = this.waiting.splice(index, 1); this.active++;
      if (this.paused.has(entry.owner)) { this.active--; entry.reject(Object.assign(new Error('Gönderilmemiş grup duraklatıldı.'), { notSent: true, code: 'JOB_PAUSED' })); continue; }
      this.lanes.set(entry.lane, (this.lanes.get(entry.lane) || 0) + 1);
      Promise.resolve().then(() => entry.task({ queueMs: Date.now() - entry.queuedAt, concurrency: Math.min(this.limit, entry.maxConcurrency) })).then(value => {
        if (!this.isBlocked(entry.owner) && ++this.streak >= 4) { this.streak = 0; this.limit = Math.min(8, this.limit + 2); this.onLimit(this.limit); }
        entry.resolve(value);
      }, error => {
        this.streak = 0;
        if (error.stopJob) {
          this.blockedOwners.add(entry.owner);
          if (['PROVIDER_RATE_LIMITED', 'PROVIDER_IN_FLIGHT_BUDGET', 'PROVIDER_OVERLOADED', 'PROVIDER_UNAVAILABLE'].includes(error.code)) { this.limit = Math.max(1, Math.floor(this.limit / 2)); this.onLimit(this.limit); }
        }
        entry.reject(error);
      }).finally(() => { this.active--; this.lanes.set(entry.lane, (this.lanes.get(entry.lane) || 1) - 1); this.pump(); });
    }
  }
};
