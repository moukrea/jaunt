// Android's bridge is injected only into the bundled main frame at its exact origin.
export const isAndroid = !!window.JauntNative?.postMessage;
const pending = new Map();
if (isAndroid) window.JauntNative.onmessage = event => {
  let result; try { result = JSON.parse(event.data); } catch { return; }
  const task = pending.get(result.id); if (!task) return;
  clearTimeout(task.timer); pending.delete(result.id);
  if (result.error) task.reject(new Error(result.error)); else task.resolve(result.value);
};
export function nativeCall(method, params = {}) {
  if (!isAndroid) return Promise.reject(new Error('Android integration is unavailable.'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Android action timed out. Please try again.')); }, 180000);
    pending.set(id, {resolve, reject, timer});
    window.JauntNative.postMessage(JSON.stringify({id, method, params}));
  });
}
export async function nativeClipboard(method = 'clipboard.read') {
  const result = await nativeCall(method);
  if (!result?.token) return {files: [], text: result?.text || ''};
  const parts = []; let size = 0;
  try {
    while (true) {
      const chunk = await nativeCall('read.chunk', {token: result.token}); if (chunk.done) break;
      const bytes = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0)); size += bytes.length;
      if (size > 32 * 1024 * 1024) throw new Error('This clipboard image exceeds 32 MiB. Select it with Attach instead.');
      parts.push(bytes);
    }
  } finally { await nativeCall('read.close', {token: result.token}); }
  return {files: [new File(parts, result.name, {type: result.type})], text: ''};
}
export async function nativeSave(blob, name) {
  const {token} = await nativeCall('save.begin', {name, type: blob.type || 'application/octet-stream'});
  try {
    for (let offset = 0; offset < blob.size; offset += 49152) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + 49152).arrayBuffer());
      await nativeCall('save.chunk', {token, data: btoa(String.fromCharCode(...bytes))});
    }
  } finally { await nativeCall('save.close', {token}); }
}
