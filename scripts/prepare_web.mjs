#!/usr/bin/env node
/** Build-time-only dependency vendoring. No CDN script executes in jaunt. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import sharp from 'sharp';
for(const [key,value] of Object.entries(process.env)) if(key.toLowerCase().startsWith('jaunt_')) process.env['jaunt_'+key.slice(6)] ??= value;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), web = path.join(root, 'web');
// Resize the supplied artwork into standard desktop icon-theme directories.
// Nonstandard 547x547 entries are not indexed by common Linux icon themes.
const iconDir=path.join(root,'desktop/icons');await fs.mkdir(iconDir,{recursive:true});
for(const size of [16,24,32,48,64,128,256,512]) {
  await sharp(path.join(web,'assets/jaunt.png')).resize(size,size).png().toFile(path.join(iconDir,`${size}x${size}.png`));
  await fs.chmod(path.join(iconDir,`${size}x${size}.png`),0o644);
}
// Use exactly the desktop artwork for installable web icons and the favicon.
await fs.copyFile(path.join(iconDir,'512x512.png'),path.join(web,'assets/app-icon-512.png'));
await fs.copyFile(path.join(iconDir,'32x32.png'),path.join(web,'assets/favicon.png'));
await sharp(path.join(web,'assets/jaunt.png')).resize(192,192).png().toFile(path.join(web,'assets/app-icon-192.png'));
await fs.copyFile(path.join(web,'assets/jaunt.png'),path.join(root,'android/app/src/main/res/drawable-nodpi/ic_jaunt.png'));
const icons = await build({stdin:{contents: "export {createElement, Terminal, Plus, X, ChevronRight, ChevronDown, Menu, Monitor, Folder, File, Image, Upload, Download, Copy, ClipboardPaste, Paperclip, Lock, ShieldCheck, QrCode, Settings, Bell, Check, RefreshCw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Trash2, Pencil, Keyboard, Ellipsis, ExternalLink, Eye, Zap, Search, LogOut, TriangleAlert, ArrowDownUp, Sun, Columns2, Rows2, Globe, House, Cloud} from 'lucide';",resolveDir:root},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false});
await fs.writeFile(path.join(web,'vendor/lucide.mjs'),icons.outputFiles[0].contents);
await fs.copyFile(path.join(root,'node_modules/lucide/LICENSE'),path.join(web,'vendor/LICENSE-lucide.txt'));
// The complete icon set, loaded only by the host icon picker (about 480 KB minified).
const allIcons = await build({stdin:{contents: "export {icons} from 'lucide';",resolveDir:root},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false});
await fs.writeFile(path.join(web,'vendor/lucide-all.mjs'),allIcons.outputFiles[0].contents);
const brands = await build({stdin:{contents:"export {default as claude} from 'meteor-icons/icons/claude'; export {default as openai} from 'meteor-icons/icons/openai'; export {default as github} from 'meteor-icons/icons/github';",resolveDir:root},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false});
await fs.writeFile(path.join(web,'vendor/meteor.mjs'),brands.outputFiles[0].contents);
await fs.copyFile(path.join(root,'node_modules/meteor-icons/LICENSE'),path.join(web,'vendor/LICENSE-meteor.txt'));
const terminal = await build({stdin: {contents: "import {Terminal} from '@xterm/xterm'; import {FitAddon} from '@xterm/addon-fit'; import {WebglAddon} from '@xterm/addon-webgl'; import {Unicode11Addon} from '@xterm/addon-unicode11'; export default {Terminal, FitAddon, WebglAddon, Unicode11Addon};", resolveDir: root}, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false});
await fs.writeFile(path.join(web, 'vendor/xterm.mjs'), terminal.outputFiles[0].contents);
await fs.copyFile(path.join(root, 'node_modules/@xterm/xterm/css/xterm.css'), path.join(web, 'vendor/xterm.css'));
await fs.writeFile(path.join(web, 'vendor/LICENSE-xterm.txt'), (await Promise.all(['xterm','addon-fit','addon-webgl','addon-unicode11'].map(name => fs.readFile(path.join(root, `node_modules/@xterm/${name}/LICENSE`), 'utf8')))).join('\n'));
// Terminal font: JetBrains Mono 2.304 (SIL OFL 1.1). The complete official web
// fonts (arrows, geometric shapes, block elements) are committed unmodified in
// web/vendor/fonts from JetBrainsMono-2.304.zip
// (https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304) and pinned here.
const fonts = {'JetBrainsMono-Regular.woff2': [400, 'a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2'], 'JetBrainsMono-Bold.woff2': [700, 'c503cc5ec5f8b2c7666b7ecda1adf44bd45f2e6579b2eba0fc292150416588a2']};
let fontCss = '/* JetBrains Mono 2.304, SIL Open Font License 1.1. See LICENSE-jetbrains-mono.txt. */\n';
for (const [file, [weight, sha]] of Object.entries(fonts)) {
  const digest = createHash('sha256').update(await fs.readFile(path.join(web, 'vendor/fonts', file))).digest('hex');
  if (digest !== sha) throw new Error(`Unexpected ${file}; review before changing the pin.`);
  fontCss += `@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:${weight};font-display:swap;src:url(./fonts/${file}) format('woff2');}\n`;
}
await fs.writeFile(path.join(web, 'vendor/jetbrains-mono.css'), fontCss);
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
await fs.mkdir(path.join(web,'locales'),{recursive:true});
for(const name of await fs.readdir(path.join(root,'host/jaunt/locales')))if(name.endsWith('.json'))await fs.copyFile(path.join(root,'host/jaunt/locales',name),path.join(web,'locales',name));
const files = (await walk(web)).filter(f => (/\.(?:mjs|css|html|png|webmanifest|woff2)$/.test(f)||f.includes(path.sep+'locales'+path.sep))).sort();
const hash = createHash('sha256'); for (const f of files) { hash.update(path.relative(web,f)); hash.update(await fs.readFile(f)); }
const assets = ['./', ...files.map(f=>'./'+path.relative(web,f).split(path.sep).join('/'))];
const sw = await fs.readFile(path.join(web,'sw.js'),'utf8');
const code = `// precache:begin\nconst CACHE = 'jaunt-static-${hash.digest('hex').slice(0,16)}';\nconst STATIC = ${JSON.stringify(assets)};\n// precache:end`;
await fs.writeFile(path.join(web,'sw.js'),sw.replace(/\/\/ precache:begin[\s\S]*?\/\/ precache:end/,code));
await fs.writeFile(path.join(web,'.nojekyll'),'');
console.log(`Prepared ${files.length} local web resources. jsQR ${pkg.version}.`);
