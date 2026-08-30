import test from 'node:test';
import assert from 'node:assert/strict';
import { applySpeechTranscript, resolveSpeechRecognition } from '../lib/speech-input.js';

test('resolveSpeechRecognition bevorzugt das Browser-API-Interface', () => {
  const fakeWindow = {
    SpeechRecognition: function SpeechRecognition() {},
    webkitSpeechRecognition: function WebkitSpeechRecognition() {}
  };

  assert.equal(resolveSpeechRecognition(fakeWindow), fakeWindow.SpeechRecognition);
});

test('applySpeechTranscript hängt neue Spracheingaben sauber an das bestehende Feld an', () => {
  assert.equal(applySpeechTranscript('', 'Hallo Welt'), 'Hallo Welt');
  assert.equal(applySpeechTranscript('Ich bin', ' bereit'), 'Ich bin bereit');
  assert.equal(applySpeechTranscript('Ich bin ', 'bereit'), 'Ich bin bereit');
});
