// Scanning is entirely local. No QR image or pairing capability leaves this page.
import {$, el, modal, closeModal, button, toast} from './ui.mjs';
let jsqrPromise;
async function decoder() {
  if ('BarcodeDetector' in window) {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (formats.includes('qr_code')) {
      const d = new BarcodeDetector({formats: ['qr_code']});
      return async input => (await d.detect(input))[0]?.rawValue;
    }
  }
  // The release/Pages workflow vendors the pinned jsQR build; never load a CDN
  // script into a page holding machine keys. Native decoding needs no dependency.
  if (!jsqrPromise) jsqrPromise = import('../vendor/jsqr.mjs').catch(() => null);
  const module = await jsqrPromise;
  if (!module?.default) throw new Error('QR scanning is not supported by this browser/build. Paste the full pairing string instead.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  return async input => {
    const w = input.videoWidth || input.width, h = input.videoHeight || input.height;
    const scale = Math.min(1, 1280 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    context.drawImage(input, 0, 0, canvas.width, canvas.height);
    return module.default(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, {inversionAttempts: 'attemptBoth'})?.data;
  };
}
export async function scan(onCode) {
  let stop = false, stream, timer;
  const video = el('video', {class: 'scan-video', autoplay: true, playsInline: true, muted: true});
  const status = el('p', {class: 'modal-copy', text: 'Starting the camera…'});
  const pick = el('input', {type: 'file', accept: 'image/*', 'aria-label': 'Scan QR from an image'});
  const finish = async code => {
    if (!code || stop) return;
    stop = true; closeModal(); await onCode(code);
  };
  modal('Pair with a QR code', el('div', {}, video, status, pick), () => {
    stop = true; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop());
  });
  let decode;
  try { decode = await decoder(); } catch (e) { status.textContent = e.message; video.hidden = true; pick.hidden = true; return; }
  if (stop) return;
  pick.onchange = async () => {
    if (!pick.files[0]) return;
    try {
      const bitmap = await createImageBitmap(pick.files[0]);
      const code = await decode(bitmap); bitmap.close();
      if (!code) throw new Error('No readable QR code found. Try a sharper image or paste the pairing string.');
      await finish(code);
    } catch (e) { toast(e.message, true); }
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}}, audio: false});
    if (stop) { stream.getTracks().forEach(track => track.stop()); return; }
    video.srcObject = stream; await video.play(); status.textContent = 'Point the camera at the QR displayed by jaunt pair.';
    const loop = async () => {
      if (stop) return;
      try { if (video.readyState >= 2) await finish(await decode(video)); } catch (e) { toast(e.message, true); }
      if (!stop) timer = setTimeout(loop, 180);
    };
    loop();
  } catch { video.hidden = true; status.textContent = 'Camera unavailable or permission denied. Choose a QR image, or close this dialog and paste the pairing string.'; }
}
