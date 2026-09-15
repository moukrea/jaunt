#!/usr/bin/env node
/** Inspect the actual packaged renderer, not the source tree. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {listPackage,extractFile} from '@electron/asar';
import {execFileSync} from 'node:child_process';
const root=path.resolve('dist/desktop');let count=0;
for(const entry of await fs.readdir(root,{withFileTypes:true})) {
  if(!entry.isDirectory())continue;
  for(const relative of ['resources','jaunt.app/Contents/Resources']) {
    const resources=path.join(root,entry.name,relative), archive=path.join(resources,'app.asar');
    try {await fs.access(archive);}catch{continue;}
    const files=new Set(listPackage(archive).map(f=>f.replace(/^\//,'')));
    const read=file=>extractFile(archive,file).toString();
    assert.deepEqual(extractFile(archive,'web/assets/jaunt.png'),await fs.readFile('web/assets/jaunt.png'),'Packaged web logo differs or is absent');
    assert.deepEqual(await fs.readFile(path.join(resources,'jaunt.png')),await fs.readFile('desktop/icons/512x512.png'),'Native logo differs or is absent');
    for(const match of read('web/index.html').matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)) {
      assert(files.has(path.posix.normalize('web/'+match[1]).replace(/\/$/,'')+(match[1]==='./'?'/index.html':'')),`Missing packaged page asset ${match[1]}`);
    }
    for(const file of files) {
      if(!file.startsWith('web/')||!file.endsWith('.mjs'))continue;
      for(const match of read(file).matchAll(/(?:from\s+|import\s*\()(['"])(\.[^'"]+)\1/g))
        assert(files.has(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[2]))),`Missing packaged import ${file}: ${match[2]}`);
    }
    count++;console.log(`PASS packaged renderer assets, imports and original logo: ${entry.name}`);
  }
}
assert(count>0,'No packaged app found');
if(process.platform==='linux')for(const name of await fs.readdir(root)) {
  if(!name.endsWith('.deb'))continue;
  const listing=execFileSync('dpkg-deb',['-c',path.join(root,name)],{encoding:'utf8'});
  for(const suffix of ['usr/share/applications/dev.jaunt.desktop.desktop','usr/share/icons/hicolor/48x48/apps/jaunt-desktop.png','usr/share/icons/hicolor/512x512/apps/jaunt-desktop.png']) {
    const row=listing.split('\n').find(line=>line.endsWith('/'+suffix));
    assert(row?.startsWith('-rw-r--r--'),`Unreadable/missing ${name}: ${suffix}`);
  }
  console.log(`PASS readable launcher and standard icon sizes: ${name}`);
}
