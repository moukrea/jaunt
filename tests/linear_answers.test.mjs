import test from 'node:test';
import assert from 'node:assert/strict';
import { readReply, decideAnswer } from '../scripts/linear_answers.mjs';

// Every example promised in the approved JAU-80 plan, read exactly as written.
const cases = {
  approve: [
    '/approve', 'approuvé', "j'approuve", 'J’approuve', 'ok pour le plan', 'Plan validé', 'go', 'Vas-y',
    "C'est bon", 'lgtm', 'feu vert', 'ok, go', 'ok',
    // JAU-15, 23/09 00:03:49, word for word.
    'J\'ai approuvé le plan donc si tu réponds pas ça devrait retirer le label "du neuf du harnais"',
  ],
  neutral: [
    // JAU-92, 23/09 05:33:34, word for word.
    'Bah faut corriger !',
    'merci', 'Top', 'super', 'Parfait', 'nickel', 'Allez !', "c'est parti", 'faut le faire',
  ],
  correction: [
    "ok mais garde l'ancien nom", 'approuvé, sauf le point 3', 'go, par contre pas sur Android',
    'ok, et les tests ?', 'plutôt dans un autre fichier', 'Fais ça dans un autre fichier', 'non', 'attends',
    'ah, et aussi…', '/approve mais change X', 'des remarques', 'google it',
  ],
  decline: ['/decline', '/decline trop risqué'],
};
for (const [kind, bodies] of Object.entries(cases)) {
  test(`read as ${kind}`, () => {
    for (const body of bodies) assert.equal(readReply(body), kind, body);
  });
}

test('the newest decisive signal wins and cheers are looked through', () => {
  const at = (s) => `2026-09-23T05:33:${String(s).padStart(2, '0')}.000Z`;
  // JAU-92: 👍 at :30, "Bah faut corriger !" at :34.
  assert.equal(decideAnswer([{ at: at(30), kind: 'approve' }, { at: at(34), kind: 'neutral' }]).kind, 'approve');
  assert.equal(decideAnswer([{ at: at(34), kind: 'neutral' }, { at: at(30), kind: 'approve' }]).kind, 'approve', 'order-independent');
  assert.equal(decideAnswer([{ at: at(30), kind: 'approve' }, { at: at(34), kind: 'correction' }]).kind, 'correction');
  assert.equal(decideAnswer([{ at: at(30), kind: 'correction' }, { at: at(34), kind: 'approve' }]).kind, 'approve');
  assert.equal(decideAnswer([{ at: at(30), kind: 'neutral' }]), null, 'a cheer alone decides nothing');
  assert.equal(decideAnswer([]), null);
});
