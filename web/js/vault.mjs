import {b64, unb64, random, utf8, text} from './crypto.mjs';

const DB = 'jaunt-v1';
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storage(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('vault', mode);
    const request = action(tx.objectStore('vault'));
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Storage transaction aborted')); };
  });
}
async function derive(password, salt) {
  const base = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: 600000},
    base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
export class Vault {
  constructor() { this.data = null; this.record = null; this.key = null; this.writeQueue = Promise.resolve(); }
  async load() {
    this.record = await storage('readonly', store => store.get('main'));
    if (!this.record) {
      this.data = {machines: [], preferences: {fontSize: 14, autoLock: 0}, vapid: null};
      await this.save();
    } else if (!this.record.locked) {
      this.data = this.record.data;
    }
    return this.data;
  }
  get locked() { return !!this.record?.locked && !this.data; }
  get protected() { return !!this.record?.locked; }
  async unlock(password) {
    if (!this.record?.locked) return this.data;
    const key = await derive(password, this.record.salt);
    try {
      const raw = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(this.record.iv), additionalData: utf8('jaunt-vault-v1')},
        key, unb64(this.record.ct));
      this.data = JSON.parse(text(raw));
      this.key = key;
      return this.data;
    } catch { throw new Error('Incorrect passphrase or PIN'); }
  }
  save() {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      if (!this.data) throw new Error('Vault is locked');
      let record;
      if (this.key) {
        const iv = random(12);
        const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv: unb64(iv), additionalData: utf8('jaunt-vault-v1')},
          this.key, utf8(JSON.stringify(this.data)));
        record = {v: 1, locked: true, salt: this.record.salt, iv, ct: b64(new Uint8Array(ct))};
      } else record = {v: 1, locked: false, data: this.data};
      await storage('readwrite', store => store.put(record, 'main'));
      this.record = record;
    });
    return this.writeQueue;
  }
  async protect(password) {
    if (password.length < 6) throw new Error('Use at least six characters; a long passphrase is safer than a PIN.');
    this.record = {...this.record, salt: random(16)};
    this.key = await derive(password, this.record.salt);
    await this.save();
  }
  async unprotect() { this.key = null; this.record.locked = false; await this.save(); }
  async lock() { await this.save(); this.data = null; this.key = null; }
  async forgetAll() {
    await storage('readwrite', store => store.delete('main'));
    this.data = null; this.key = null; this.record = null;
  }
}
