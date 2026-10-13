const name = 'mangalens-page-v1';
let connection;
async function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cache');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return connection;
}
export async function read(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction('cache').objectStore('cache').get(key);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function write(key, value) {
  return writeMany([{ key, value }]);
}
export async function writeMany(entries) {
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite');
    for (const { key, value } of entries) tx.objectStore('cache').put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function hash(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
