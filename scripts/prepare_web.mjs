#!/usr/bin/env node
/** Build-time-only dependency vendoring. No CDN script executes in jaunt. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
for(const [key,value] of Object.entries(process.env)) if(key.toLowerCase().startsWith('jaunt_')) process.env['jaunt_'+key.slice(6)] ??= value;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), web = path.join(root, 'web');
const terminal = await build({stdin: {contents: "import {Terminal} from '@xterm/xterm'; import {FitAddon} from '@xterm/addon-fit'; export default {Terminal, FitAddon};", resolveDir: root}, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false});
await fs.writeFile(path.join(web, 'vendor/xterm.mjs'), terminal.outputFiles[0].contents);
await fs.copyFile(path.join(root, 'node_modules/@xterm/xterm/css/xterm.css'), path.join(web, 'vendor/xterm.css'));
await fs.writeFile(path.join(web, 'vendor/LICENSE-xterm.txt'), await fs.readFile(path.join(root, 'node_modules/@xterm/xterm/LICENSE'), 'utf8') + '\n' + await fs.readFile(path.join(root, 'node_modules/@xterm/addon-fit/LICENSE'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'node_modules/jsqr/package.json'), 'utf8'));
if (pkg.version !== '1.4.0') throw new Error('Unexpected jsQR version; review before changing the pin.');
const source = await fs.readFile(path.join(root, 'node_modules/jsqr/dist/jsQR.js'), 'utf8');
// Keep the original UMD source in an isolated CommonJS function, then export ESM.
const wrapped = '// jsQR 1.4.0; Apache-2.0. See LICENSE-jsQR.txt.\nconst module={exports:{}};const exports=module.exports;\n(function(module,exports){\n' + source + '\n})(module,exports);\nexport default module.exports;\n';
await fs.writeFile(path.join(web, 'vendor/jsqr.mjs'), wrapped);
await fs.copyFile(path.join(root, 'node_modules/jsqr/LICENSE'), path.join(web, 'vendor/LICENSE-jsQR.txt'));
await fs.copyFile(path.join(root, 'install.sh'), path.join(web, 'install.sh'));
let config = JSON.parse(await fs.readFile(path.join(web, 'config.json'), 'utf8'));
if (process.env.jaunt_RELAY_URL) config.relay = process.env.jaunt_RELAY_URL;
if (process.env.jaunt_RELEASE_TAG) config.release = process.env.jaunt_RELEASE_TAG;
if (process.env.jaunt_ANDROID_RELEASE_TAG) {
  if (!/^android-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(process.env.jaunt_ANDROID_RELEASE_TAG)) throw new Error('Invalid Android release tag');
  config.androidRelease = process.env.jaunt_ANDROID_RELEASE_TAG;
}
if (process.env.jaunt_DESKTOP_RELEASE_TAG) {
  if(!/^desktop-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(process.env.jaunt_DESKTOP_RELEASE_TAG))throw new Error('Invalid desktop release tag');
  config.desktopRelease=process.env.jaunt_DESKTOP_RELEASE_TAG;
}
if (process.env.jaunt_PAGE_URL) config.page = process.env.jaunt_PAGE_URL.replace(/\/?$/, '/');
if (process.env.GITHUB_REPOSITORY) config.repository = process.env.GITHUB_REPOSITORY;
if (process.env.jaunt_PRODUCTION === '1') {
  if (!config.relay || new URL(config.relay).protocol !== 'wss:') throw new Error('Set jaunt_RELAY_URL to the deployed WSS endpoint.');
  if (!config.release || !/^v\d+\.\d+\.\d+/.test(config.release)) throw new Error('Set a published release tag.');
}
await fs.writeFile(path.join(web, 'config.json'), JSON.stringify(config, null, 2) + '\n');
async function walk(dir) { const out=[]; for (const f of await fs.readdir(dir,{withFileTypes:true})) { const p=path.join(dir,f.name); if(f.isDirectory())out.push(...await walk(p)); else out.push(p); } return out; }
const files = (await walk(web)).filter(f => /\.(?:mjs|css|html|png|webmanifest)$/.test(f)).sort();
const hash = createHash('sha256'); for (const f of files) { hash.update(path.relative(web,f)); hash.update(await fs.readFile(f)); }
const assets = ['./', ...files.map(f=>'./'+path.relative(web,f).split(path.sep).join('/'))];
const sw = await fs.readFile(path.join(web,'sw.js'),'utf8');
const code = `// precache:begin\nconst CACHE = 'jaunt-static-${hash.digest('hex').slice(0,16)}';\nconst STATIC = ${JSON.stringify(assets)};\n// precache:end`;
await fs.writeFile(path.join(web,'sw.js'),sw.replace(/\/\/ precache:begin[\s\S]*?\/\/ precache:end/,code));
await fs.writeFile(path.join(web,'.nojekyll'),'');
console.log(`Prepared ${files.length} local web resources. jsQR ${pkg.version}.`);
