import {isAndroid, nativeCall, nativeClipboard, nativeSave} from './native.mjs';
import {b64, unb64} from './crypto.mjs';
export async function serviceWorker() {
  if (isAndroid) return null;
  if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
  await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), {scope: new URL('../', import.meta.url).pathname});
  return navigator.serviceWorker.ready;
}
export async function subscribe(vault, link) {
  if (isAndroid) { await nativeCall('notifications.enable', {machine: link.machine}); link.machine.push = true; await vault.save(); return true; }
  if (!('PushManager' in window) || !('Notification' in window)) throw new Error('Web Push is not supported. On iPhone/iPad, install Jaunt on the home screen first.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are not allowed. Change this site’s notification permission in your browser settings.');
  const reg = await serviceWorker();
  if (!vault.data.vapid) {
    const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
    const key = await crypto.subtle.exportKey('jwk', pair.privateKey);
    vault.data.vapid = {private: key.d, public: b64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))};
    await vault.save();
  }
  let subscription = await reg.pushManager.getSubscription();
  const expected = unb64(vault.data.vapid.public);
  if (subscription && subscription.options.applicationServerKey && b64(new Uint8Array(subscription.options.applicationServerKey)) !== vault.data.vapid.public) {
    await subscription.unsubscribe(); subscription = null;
  }
  subscription ||= await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: expected});
  await link.request('notifications.subscribe', {subscription: subscription.toJSON(), vapidPrivate: vault.data.vapid.private, showDetails: false});
  link.machine.push = true; await vault.save();
  return true;
}
export async function unsubscribe(vault, link) {
  if (isAndroid) { await nativeCall('notifications.disable', {room: link.machine.room}); link.machine.push = false; await vault.save(); return; }
  // A PushSubscription is per browser origin, shared by all Jaunt machines.
  // Removing it here would silently break push from the other hosts.
  await link.request('notifications.unsubscribe');
  link.machine.push = false; await vault.save();
}
