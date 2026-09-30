import { uploadRecordingChunks } from "./resumable-recording-upload.js";
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
export function recordingFileType(file) {
  const type = (file.type || "").split(";")[0].toLowerCase();
  if (["video/mp4", "video/webm", "video/quicktime"].includes(type))
    return type;
  return (
    { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" }[
      file.name?.split(".").pop().toLowerCase()
    ] || ""
  );
}
export class ContractRecorder {
  constructor({ getContext, beforeConsent, onRecord, onChange, notify }) {
    Object.assign(this, { getContext, beforeConsent, onRecord, onChange, notify });
    this.busy = false;
    this.blob = null;
    this.partialUpload = null;
    this.saved = false;
    this.node = document.querySelector("#videoRecordingState");
    this.preview = document.querySelector("#contractRecordingPreview");
    this.uploadArea = document.querySelector("#recordingUploadArea");
    this.start = document.querySelector("#startVideoContractRecording");
    this.consentButton = document.querySelector("#confirmVideoRecordingConsent");
    this.consentState = document.querySelector("#recordingConsentState");
    this.file = document.querySelector("#contractRecordingFile");
    this.retry = document.querySelector("#retryContractRecording");
    this.download = document.querySelector("#downloadContractRecording");
    this.discard = document.querySelector("#discardContractRecording");
    this.guide = document.querySelector("#nativeRecordingInstructions");
    this.start.onclick = () => this.openNativeGuide();
    this.consentButton.onclick = () => this.prepareConsent();
    this.file.onchange = () => this.importFile();
    this.retry.onclick = () => this.save();
    this.discard.onclick = () => this.discardLocal();
    window.addEventListener("beforeunload", (event) => {
      if (this.hasUnsaved()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
  hasUnsaved() {
    return this.busy || Boolean(this.blob && !this.saved);
  }
  status(text, kind = "", timer = "") {
    this.node.classList.remove("uploaded", "recording", "uploading");
    if (kind) this.node.classList.add(kind);
    this.node.querySelector("span").textContent = text;
    this.node.querySelector("time").textContent = timer;
  }
  controls() {
    const context = this.getContext();
    const record = context.record;
    const locked = this.busy || Boolean(this.blob) || Boolean(record?.video_recording_path) || Boolean(record && record.status !== "draft");
    const consentReady = Boolean(this.confirmedThisSession && context.consents && record?.video_recording_consent_at && record?.video_recording_consent_record_id);
    this.consentButton.disabled = locked || !context.consents || consentReady;
    this.consentButton.hidden = consentReady;
    this.start.hidden = !consentReady || Boolean(record?.video_recording_path);
    this.start.disabled = locked || !consentReady;
    this.file.disabled = locked || !consentReady;
    this.uploadArea.hidden = !consentReady && !this.blob;
    this.retry.hidden = !this.blob || this.saved || this.busy;
    this.retry.textContent = this.partialUpload ? "Upload erneut versuchen" : "Aufnahme hochladen und speichern";
    this.discard.hidden = !this.blob || this.saved || this.busy;
  }
  reset(record) {
    if (this.hasUnsaved()) return;
    this.cleanupPreview();
    this.blob = null;
    this.partialUpload = null;
    this.mimeType = null;
    this.saved = false;
    this.confirmedThisSession = false;
    this.download.hidden = true;
    this.retry.hidden = true;
    this.discard.hidden = true;
    this.preview.hidden = true;
    this.guide.hidden = true;
    this.consentState.textContent = record?.video_recording_consent_at
      ? `Letzte Einwilligung: ${new Date(record.video_recording_consent_at).toLocaleString('de-DE')} · ${record.video_recording_consent_staff_name || 'verantwortlicher Mitarbeiter'}. Für eine neue Aufnahme die drei Punkte erneut bestätigen.`
      : 'Alle drei Pflichtbestätigungen auswählen. Erst nach der Protokollierung wird die Aufnahme freigegeben.';
    document.querySelector("#recordingReviewed").checked = Boolean(
      record?.video_recording_reviewed_at,
    );
    if (record?.video_recording_path) {
      this.preview.src = `/api/leads?action=video-recording-download&id=${encodeURIComponent(this.getContext().leadId)}&contractId=${encodeURIComponent(record.id)}`;
      this.preview.hidden = false;
      this.preview.muted = false;
      this.preview.controls = true;
      this.download.href = `${this.preview.src}&download=1`;
      this.download.removeAttribute("download");
      this.download.hidden = false;
      this.status(
        "Video ist in dieser Vertragsakte gespeichert. Bitte Bild und beide Stimmen prüfen.",
        "uploaded",
        "GESPEICHERT",
      );
    } else
      this.status(
        record?.video_recording_consent_at
          ? "Einwilligung protokolliert. Systemaufnahme öffnen und Datei anschließend hier auswählen."
          : "Noch keine Aufnahme gespeichert.",
      );
    document.querySelector("#screenRecordingSupport").textContent =
      "Die Aufnahme erfolgt mit der Bildschirmaufnahme deines Geräts und wird zuerst lokal gespeichert. Öffne die Systemaufnahme, beende und speichere sie dort, wähle die Datei unten aus und lade sie in diese Vertragsakte hoch.";
    this.controls();
  }
  check() {
    const context = this.getContext();
    if (!context.contractId)
      throw new Error("Der Vertragsentwurf konnte nicht angelegt werden. Bitte erneut versuchen.");
    if (!context.consents)
      throw new Error(
        "Bitte zuerst alle drei Einwilligungshinweise bestätigen.",
      );
    return context;
  }
  async api(action, body) {
    const response = await fetch(`/api/leads?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "Die Aufnahme konnte nicht gespeichert werden.",
      );
    return data;
  }
  async consent(context) {
    const data = await this.api("begin-video-recording", {
      id: context.leadId,
      contractId: context.contractId,
      recordingConsent: true,
      recordingPurposeAccepted: true,
      recordingRevocationAccepted: true,
    });
    this.onRecord(data.record);
    return data;
  }
  async prepareConsent() {
    if (this.busy) return;
    try {
      this.busy = true;
      this.controls();
      await this.beforeConsent?.();
      const context = this.check();
      const data = await this.consent(context);
      this.confirmedThisSession = true;
      this.consentState.textContent = `Bildschirmaufnahme freigegeben · Einwilligung am ${new Date(data.consentedAt).toLocaleString('de-DE')} durch ${data.actorName} protokolliert.`;
      this.status("Einwilligung protokolliert. Öffne die Systemaufnahme und lade die gespeicherte Datei anschließend hoch.");
    } catch (error) {
      this.notify(error.message);
    } finally {
      this.busy = false;
      this.controls();
    }
  }
  openNativeGuide() {
    try {
      const context = this.check();
      if (!this.confirmedThisSession || !context.record?.video_recording_consent_record_id)
        throw new Error("Bitte zuerst alle drei Einwilligungen mit Datum und Mitarbeiter protokollieren.");
      const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
      const mac = /Mac/i.test(platform);
      const windows = /Win/i.test(platform);
      const title = mac ? "macOS-Bildschirmaufnahme" : windows ? "Windows-Bildschirmaufnahme" : "Bildschirmaufnahme des Geräts";
      const shortcut = mac ? "⇧ ⌘ 5" : windows ? "⊞ Win + Umschalt + R" : "Bildschirmaufnahme im Kontrollzentrum öffnen";
      const action = mac
        ? "Wähle „Gesamten Bildschirm aufnehmen“ oder einen Ausschnitt, stelle unter „Optionen“ Mikrofon und Speicherort ein und starte die Aufnahme."
        : windows
          ? "Wähle im Snipping Tool den Aufnahmebereich, aktiviere die verfügbaren Audioquellen und starte die Aufnahme."
          : "Öffne die Bildschirmaufnahme in den Systemeinstellungen oder Schnelleinstellungen und aktiviere das Mikrofon.";
      this.guide.innerHTML = `<h4>${title}</h4><p class="native-recording-shortcut">${shortcut}</p><p>${action}</p><p>Beende und speichere die Aufnahme auf deinem Gerät. Prüfe, ob Bild und beide Stimmen vorhanden sind. Wähle danach die Datei im Upload-Feld unten aus.</p>`;
      this.guide.hidden = false;
      this.guide.scrollIntoView({ block: "nearest", behavior: "smooth" });
      this.status("Systemaufnahme öffnen, lokal speichern und die Datei anschließend hochladen.");
    } catch (error) {
      this.notify(error.message);
    }
  }
  cleanupPreview() {
    this.preview.pause();
    this.preview.removeAttribute("src");
    this.preview.srcObject = null;
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
    this.localUrl = null;
  }
  setLocalPreview() {
    this.cleanupPreview();
    this.localUrl = URL.createObjectURL(this.blob);
    this.preview.src = this.localUrl;
    this.preview.muted = false;
    this.preview.volume = 1;
    this.preview.controls = true;
    this.preview.load();
    this.preview.hidden = false;
    this.download.href = this.localUrl;
    this.download.download = this.fileName;
    this.download.hidden = false;
  }
  async importFile() {
    try {
      const context = this.check();
      const file = this.file.files?.[0];
      if (!file) return;
      if (!context.record?.video_recording_consent_at)
        throw new Error("Bitte zuerst die Einwilligung protokollieren.");
      const type = recordingFileType(file);
      if (!type || !file.size || file.size > MAX_RECORDING_BYTES)
        throw new Error("Bitte MP4, WebM oder MOV auswählen, maximal 50 MB.");
      this.blob = file;
      this.mimeType = type;
      this.fileName = file.name;
      this.provider = "device_upload";
      this.endedAt = null;
      this.captureContext = context;
      this.setLocalPreview();
      this.status("Videodatei bereit. Bitte Vorschau mit Ton prüfen und anschließend speichern.", "", "VORSCHAU");
      this.controls();
    } catch (error) {
      this.notify(error.message);
    } finally {
      this.file.value = "";
    }
  }
  async save() {
    if (!this.blob || this.saved || this.busy) return;
    this.busy = true;
    this.controls();
    this.status(
      "Video wird direkt in die Vertragsakte hochgeladen …",
      "uploading",
      "0 %",
    );
    try {
      const context = this.captureContext;
      if (!this.partialUpload)
        this.partialUpload = await this.api("video-recording-upload", {
          id: context.leadId,
          contractId: context.contractId,
          fileName: this.fileName,
          mimeType: this.mimeType || this.blob.type,
          byteSize: this.blob.size,
          provider: this.provider,
          endedAt: this.endedAt,
          recordingConsent: true,
          recordingPurposeAccepted: true,
          recordingRevocationAccepted: true,
        });
      await uploadRecordingChunks(
        this.blob,
        this.partialUpload,
        (sent, total) => {
          this.node.querySelector("time").textContent =
            `${Math.floor((sent / total) * 100)} %`;
        },
      );
      this.status(
        "Upload abgeschlossen. Gespeicherte Datei wird geprüft …",
        "uploading",
        "PRÜFUNG",
      );
      const result = await this.api("complete-video-recording-upload", {
        id: context.leadId,
        contractId: context.contractId,
        storagePath: this.partialUpload.storagePath,
      });
      this.saved = true;
      this.onRecord(result.record);
      this.busy = false;
      this.reset(result.record);
      this.onChange();
    } catch (error) {
      this.status(
        `${error.message} Die lokale Datei bleibt hier verfügbar. Du kannst den Upload wiederholen oder sie herunterladen.`,
        "",
        "ERNEUT",
      );
    } finally {
      this.busy = false;
      this.controls();
    }
  }
  discardLocal() {
    if (
      this.busy ||
      !confirm(
        "Die noch nicht gespeicherte lokale Aufnahme verwerfen? Lade sie bei Bedarf vorher herunter.",
      )
    )
      return;
    this.blob = null;
    this.partialUpload = null;
    this.mimeType = null;
    this.saved = false;
    this.reset(this.getContext().record);
  }
}
