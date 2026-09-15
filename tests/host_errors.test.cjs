const {test}=require('node:test');const assert=require('node:assert/strict');const {hostError}=require('../desktop/host-errors.cjs');
test('native host errors exclude curl output and explain preserved active shells',()=>{
 const message=hostError({stderr:'% Total Received\n'+('#'.repeat(700))+'\njaunt: 2 plain shells are running. Finish them before updating.\njaunt: Installation failed during replacement (line 200, exit 1).'});
 assert.equal(message,'The update is waiting for active shells. Your sessions are still running.');
 assert.equal(hostError({stderr:'jaunt: Permission denied\n'}),'Permission denied');
 assert.equal(hostError({message:'Command failed: private-path '+('x'.repeat(1000))}),'The local host action failed. Check the host connection and try again.');
});
