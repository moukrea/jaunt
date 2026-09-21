#!/usr/bin/env node
// Same supervised lifecycle as Codex, with Claude's exact session contract.
import { main } from './linear_codex.mjs';
main('claude').then(result => { if (result) console.log(JSON.stringify(result, null, 2)); })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
