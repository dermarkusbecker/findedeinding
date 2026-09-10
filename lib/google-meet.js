const MEET_API = 'https://meet.googleapis.com/v2';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

function googleError(data, fallback, status) {
  const message = data?.error?.message || fallback;
  if (status === 401 || status === 403) {
    return Object.assign(new Error('Google Meet benötigt zusätzliche Berechtigungen. Bitte die Google-Verbindung unter Einstellungen → Schnittstellen neu verbinden.'), { status: 409 });
  }
  return Object.assign(new Error(message), { status });
}

async function meetRequest(path, accessToken) {
  const result = await fetch(`${MEET_API}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw googleError(data, 'Google Meet konnte die Anfrage nicht verarbeiten.', result.status);
  return data;
}

export function meetingCodeFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname !== 'meet.google.com') return '';
    return url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
  } catch {
    return String(value || '').trim().toLowerCase().match(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/)?.[0] || '';
  }
}

export async function assertGoogleMeetSpace(accessToken, meetUrl) {
  const meetingCode = meetingCodeFromUrl(meetUrl);
  if (!meetingCode) throw Object.assign(new Error('Für diesen Termin ist kein gültiger Google-Meet-Link hinterlegt.'), { status: 409 });
  const space = await meetRequest(`spaces/${encodeURIComponent(meetingCode)}`, accessToken);
  return { meetingCode, space };
}

export async function findGoogleMeetRecording(accessToken, meetUrl, { notBefore } = {}) {
  const { meetingCode, space } = await assertGoogleMeetSpace(accessToken, meetUrl);
  const filter = `space.meeting_code = "${meetingCode}"`;
  const data = await meetRequest(`conferenceRecords?filter=${encodeURIComponent(filter)}&pageSize=100`, accessToken);
  const threshold = notBefore && !Number.isNaN(new Date(notBefore).getTime()) ? new Date(notBefore).getTime() : 0;
  const conferences = (data.conferenceRecords || [])
    .filter((item) => !threshold || !item.endTime || new Date(item.endTime).getTime() >= threshold)
    .sort((left, right) => new Date(right.startTime || 0) - new Date(left.startTime || 0));

  for (const conference of conferences) {
    const recordingData = await meetRequest(`${conference.name}/recordings?pageSize=100`, accessToken);
    const recordings = (recordingData.recordings || [])
      .filter((item) => !threshold || new Date(item.startTime || 0).getTime() >= threshold - 60 * 1000)
      .sort((left, right) => new Date(right.startTime || 0) - new Date(left.startTime || 0));
    if (recordings[0]) return { meetingCode, space, conference, recording: recordings[0] };
  }
  return { meetingCode, space, conference: conferences[0] || null, recording: null };
}

export async function googleDriveFileMetadata(accessToken, fileId) {
  const query = new URLSearchParams({ fields: 'id,name,mimeType,size,webViewLink,capabilities(canDownload)', supportsAllDrives: 'true' });
  const result = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw googleError(data, 'Die Google-Meet-Aufzeichnung konnte in Drive nicht gelesen werden.', result.status);
  if (data.capabilities?.canDownload === false) throw Object.assign(new Error('Google Drive erlaubt den Download dieser Meet-Aufzeichnung nicht.'), { status: 409 });
  return data;
}

export async function downloadGoogleDriveFile(accessToken, fileId) {
  const result = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!result.ok) {
    const data = await result.json().catch(() => ({}));
    throw googleError(data, 'Die Google-Meet-Aufzeichnung konnte nicht aus Drive geladen werden.', result.status);
  }
  return result;
}
