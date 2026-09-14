import {isAndroid, nativeCall, nativeClipboard, nativeSave} from './native.mjs';
import {b64, unb64, random} from './crypto.mjs';
import {SHA256} from './sha256.mjs';
const CHUNK = 48 * 1024;

async function retryOnReconnect(link, operation, signal) {
  for (;;) {
    await link.waitOnline(signal);
    try { return await operation(); }
    catch (error) {
      if (signal?.aborted || link.state === 'online') throw error;
    }
  }
}

export async function upload(link, file, options, progress, signal) {
  const id = options.id || random(16);
  const args = {id, name: file.name, size: file.size, path: options.path || '~',
    attachment: !!options.attachment, overwrite: !!options.overwrite};
  // Hash in bounded slices; never allocate a video-sized ArrayBuffer.
  progress({status: 'Checking file', offset: 0, total: file.size, id});
  const hasher = new SHA256();
  for (let offset=0; offset<file.size; offset+=1024*1024) {
    if (signal?.aborted) throw new Error('Transfer cancelled');
    hasher.update(new Uint8Array(await file.slice(offset,offset+1024*1024).arrayBuffer()));
  }
  const expected = hasher.hex();
  let result = await retryOnReconnect(link, () => link.request('upload.begin', args), signal);
  if (result.complete) return result;
  let offset = result.offset;
  try {
    while (offset < file.size) {
      if (signal?.aborted) throw new Error('Transfer cancelled');
      if (link.state !== 'online') {
        progress({status: 'Waiting for connection', offset, total: file.size, id});
        await link.waitOnline(signal);
        result = await link.request('upload.begin', args);
        if (result.complete) return result;
        offset = result.offset;
      }
      const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
      const ack = await retryOnReconnect(link, () => link.request('upload.chunk', {id, offset, data: b64(chunk)}), signal);
      offset = ack.offset;
      progress({status: 'Uploading', offset, total: file.size, id});
    }
    const done = await retryOnReconnect(link, () => link.request('upload.finish', {id, sha256: expected}), signal);
    if (done.sha256 !== expected) throw new Error('The file checksum did not match.');
    progress({status: 'Verified', offset: file.size, total: file.size, id});
    return done;
  } catch (error) {
    if (signal?.aborted && link.state === 'online') link.request('upload.cancel', {id}).catch(() => {});
    throw error;
  }
}

export async function download(link, path, progress, options = {}) {
  const info = await link.request('download.begin', {path});
  const limit = options.preview ? 16 * 1024 * 1024 : 128 * 1024 * 1024;
  if (!options.writer && info.size > limit) {
    await link.request('download.close', {id: info.id});
    throw new Error(`This browser keeps downloads in memory (${limit/1048576} MiB limit). Use a desktop browser with Save to disk for larger files.`);
  }
  const chunks = [], hasher = new SHA256();
  let offset = 0;
  try {
    while (offset < info.size) {
      if (options.signal?.aborted) throw new Error('Transfer cancelled');
      const result = await retryOnReconnect(link, () => link.request('download.chunk', {id: info.id, offset}), options.signal);
      const data = unb64(result.data);
      if (result.offset !== offset || !data.length) throw new Error('Unexpected download offset');
      hasher.update(data);
      if (options.writer) await options.writer.write(data); else chunks.push(data);
      offset += data.length;
      progress?.({status: 'Downloading', offset, total: info.size});
    }
    if (options.writer) await options.writer.close();
    progress?.({status: 'Downloaded', offset, total: info.size});
    return {...info, sha256: hasher.hex(), blob: options.writer ? null : new Blob(chunks, {type: info.mime})};
  } catch (error) {
    if (options.writer) await options.writer.abort().catch(() => {});
    throw error;
  } finally {
    link.request('download.close', {id: info.id}).catch(() => {});
  }
}

export async function toPNG(file) {
  if (!file.type.startsWith('image/')) return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'}); }
  catch { throw new Error('This browser cannot decode this image. Export it as PNG or JPEG, or upload the original as a file.'); }
  const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not convert this image to PNG');
  return new File([blob], (file.name || 'pasted-image').replace(/\.[^.]+$/, '') + '.png', {type: 'image/png'});
}

export async function saveBlob(blob, filename) {
  if (isAndroid) return nativeSave(blob, filename);
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export const quotePath = path => "'" + path.replaceAll("'", "'\\''") + "'";
