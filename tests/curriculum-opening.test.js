import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {curriculumOpening} from '../lib/curriculum-opening.js';
const definition=JSON.parse(await readFile(new URL('../curriculum/fdd-4plus4.json',import.meta.url)));
test('every curriculum conversation starts with an answerable question',()=>{for(const week of definition.weeks)for(const step of week.steps)assert.match(curriculumOpening(step),/\?/,step.id);});
test('life today includes the first concrete question instead of internal instructions',()=>{const text=curriculumOpening(definition.weeks[0].steps[1]);assert.match(text,/Was läuft in deinem Leben/);assert.doesNotMatch(text,/Speicherlogik|Klarheitsskala/);});
