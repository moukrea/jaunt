/** Real local Worker server for browser E2E; all state belongs to its temp harness. */
import {Miniflare, Log, LogLevel} from 'miniflare';
import {fileURLToPath} from 'node:url';
const [port, origin, persistence] = process.argv.slice(2);
if (!port || !origin || !persistence) throw new Error('Expected port, origin and temporary persistence directory');
const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../relay/worker.mjs', import.meta.url)),
  compatibilityDate: '2025-11-17',
  host: '127.0.0.1', port: Number(port),
  bindings: {APP_ORIGIN: origin},
  durableObjects: {ROOMS: {className: 'Room', useSQLite: true}},
  durableObjectsPersist: persistence,
  log: new Log(LogLevel.ERROR),
});
await mf.ready;
process.on('SIGTERM', async () => { await mf.dispose(); process.exit(0); });
