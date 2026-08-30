export function resolveSpeechRecognition(windowObject = window) {
  if (!windowObject) return null;
  return windowObject.SpeechRecognition || windowObject.webkitSpeechRecognition || null;
}

export function applySpeechTranscript(existingValue = '', newText = '') {
  const text = String(newText || '').trim();
  if (!text) return String(existingValue || '');
  const current = String(existingValue || '').trimEnd();
  return current ? `${current} ${text}` : text;
}
