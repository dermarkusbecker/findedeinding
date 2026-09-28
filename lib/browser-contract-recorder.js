import { uploadRecordingChunks } from "./resumable-recording-upload.js";
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
export function recordingMimeType(Recorder = globalThis.MediaRecorder) {
  return (
    [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((type) => Recorder?.isTypeSupported?.(type)) || ""
  );
}
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
    this.recorder = null;
    this.streams = [];
    this.partialUpload = null;
    this.saved = false;
    this.node = document.querySelector("#videoRecordingState");
    this.preview = document.querySelector("#contractRecordingPreview");
    this.uploadArea = document.querySelector("#recordingUploadArea");
    this.start = document.querySelector("#startVideoContractRecording");
    this.consentButton = document.querySelector("#confirmVideoRecordingConsent");
    this.consentState = document.querySelector("#recordingConsentState");
    this.stopButton = document.querySelector("#stopVideoContractRecording");
    this.file = document.querySelector("#contractRecordingFile");
    this.retry = document.querySelector("#retryContractRecording");
    this.download = document.querySelector("#downloadContractRecording");
    this.discard = document.querySelector("#discardContractRecording");
    this.start.onclick = () => this.begin();
    this.consentButton.onclick = () => this.prepareConsent();
    this.stopButton.onclick = () => this.stop();
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
    return (
      this.busy ||
      this.recorder?.state === "recording" ||
      Boolean(this.blob && !this.saved)
    );
  }
  status(text, kind = "", timer = "") {
    this.node.classList.remove("uploaded", "recording", "uploading");
    if (kind) this.node.classList.add(kind);
    this.node.querySelector("span").textContent = text;
    this.node.querySelector("time").textContent = timer;
  }
  supported() {
    return Boolean(
      navigator.mediaDevices?.getDisplayMedia &&
      navigator.mediaDevices?.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext) &&
      globalThis.MediaRecorder &&
      recordingMimeType(),
    );
  }
  controls() {
    const context = this.getContext();
    const record = context.record;
    const locked =
      this.busy ||
      this.recorder?.state === "recording" ||
      Boolean(this.blob) ||
      Boolean(record?.video_recording_path) ||
      record?.status !== "draft";
    const consentReady = Boolean(this.confirmedThisSession && context.consents && record?.video_recording_consent_at && record?.video_recording_consent_record_id);
    this.consentButton.disabled = locked || !context.consents || consentReady;
    this.consentButton.hidden = consentReady;
    this.start.hidden = !consentReady || !this.supported();
    this.start.disabled = locked || !consentReady || !this.supported();
    this.file.disabled = locked || !consentReady;
    this.uploadArea.hidden = !consentReady && !this.blob;
    this.stopButton.disabled = this.recorder?.state !== "recording";
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
    this.consentState.textContent = record?.video_recording_consent_at
      ? `Einwilligung protokolliert am ${new Date(record.video_recording_consent_at).toLocaleString('de-DE')} durch ${record.video_recording_consent_staff_name || 'einen verantwortlichen Mitarbeiter'}.`
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
          ? "Einwilligung protokolliert. Aufnahme starten oder Geräteaufnahme auswählen."
          : "Noch keine Aufnahme gespeichert.",
      );
    document.querySelector(".device-recording-help").open = !this.supported();
    document.querySelector("#screenRecordingSupport").textContent =
      this.supported()
        ? "Wähle im Browser den Meet-Tab und aktiviere „Tab-Audio teilen“. Erst danach werden Meet-Bild, Meet-Ton und Mikrofon mit MediaRecorder lokal aufgezeichnet."
        : "Dieser Browser unterstützt die direkte Aufnahme mit Meet-Ton und Mikrofon nicht. Nutze eine Geräteaufnahme und lade das Video anschließend hier hoch.";
    this.controls();
  }
  check() {
    const context = this.getContext();
    if (!context.contractId)
      throw new Error("Bitte zuerst das Vertragsdokument erstellen.");
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
      this.consentState.textContent = `Einwilligung protokolliert am ${new Date(data.consentedAt).toLocaleString('de-DE')} durch ${data.actorName}.`;
      this.status("Einwilligung protokolliert. Du kannst jetzt die Bildschirmaufnahme starten oder eine Geräteaufnahme auswählen.");
    } catch (error) {
      this.notify(error.message);
    } finally {
      this.busy = false;
      this.controls();
    }
  }
  async begin() {
    if (this.busy || this.recorder?.state === "recording" || this.blob) return;
    let context;
    try {
      context = this.check();
      if (!this.confirmedThisSession || !context.record?.video_recording_consent_record_id)
        throw new Error("Bitte die drei Pflichtbestätigungen zuerst mit Datum und Mitarbeiter protokollieren.");
      if (!this.supported())
        throw new Error("Bitte die Geräteaufnahme verwenden.");
    } catch (error) {
      this.notify(error.message);
      return;
    }
    this.busy = true;
    this.controls();
    this.status("Bildschirm und Ton auswählen …");
    try {
      // Called directly from the click, before any asynchronous server request.
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 20, displaySurface: "browser" },
        audio: true,
        systemAudio: "include",
        selfBrowserSurface: "exclude",
      });
      this.streams.push(display);
      if (!display.getVideoTracks().some(track=>track.readyState === "live")) throw new Error("Die Freigabe liefert kein Bildschirmbild. Bitte den Gesprächstab erneut auswählen.");
      const hasDisplayAudio = display.getAudioTracks().some(track => track.readyState === 'live');
      if (!hasDisplayAudio) throw new Error("Der gewählte Tab liefert keinen Meet-Ton. Bitte den Meet-Tab erneut wählen und „Tab-Audio teilen“ aktivieren. Die Aufnahme wurde nicht gestartet.");
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      this.streams.push(mic);
      if (!mic.getAudioTracks().some(track=>track.readyState === "live")) throw new Error("Das Mikrofon liefert keinen Ton. Die Aufnahme wurde nicht gestartet.");
      const Audio = window.AudioContext || window.webkitAudioContext;
      this.audio = new Audio();
      await this.audio.resume();
      const destination = this.audio.createMediaStreamDestination();
      this.audio.createMediaStreamSource(display).connect(destination);
      this.audio.createMediaStreamSource(mic).connect(destination);
      const mixed = new MediaStream([
        ...display.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
      this.streams.push(mixed);
      await this.api("start-video-recording", { id: context.leadId, contractId: context.contractId });
      if (display.getVideoTracks()[0]?.readyState !== "live")
        throw new Error(
          "Die Bildschirmfreigabe wurde beendet. Bitte erneut starten.",
        );
      this.captureContext = context;
      this.chunks = [];
      this.bytes = 0;
      this.provider = "browser_screen";
      this.hasDisplayAudio = hasDisplayAudio;
      const mimeType = recordingMimeType();
      this.recorder = new MediaRecorder(mixed, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 700000,
        audioBitsPerSecond: 128000,
      });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) {
          this.chunks.push(event.data);
          this.bytes += event.data.size;
          if (this.bytes > MAX_RECORDING_BYTES - 2 * 1024 * 1024) {
            this.notify(
              "Die Aufnahme wurde am Größenlimit beendet. Bitte Vorschau prüfen und speichern.",
            );
            this.stop();
          }
        }
      };
      this.recorder.onerror = () => {
        this.notify(
          "Die Aufnahme wurde unterbrochen. Bitte die gespeicherte Sequenz auf Vollständigkeit prüfen.",
        );
        this.stop();
      };
      this.recorder.onstop = () => {
        this.endedAt = new Date().toISOString();
        this.blob = new Blob(this.chunks, {
          type: this.recorder.mimeType || mimeType,
        });
        this.chunks = [];
        this.fileName = `Vertragsaufnahme-${new Date().toISOString().replace(/[:.]/g, "-")}.${this.blob.type.startsWith("video/mp4") ? "mp4" : "webm"}`;
        this.finishCapture();
        this.setLocalPreview();
        this.busy = false;
        if (!this.blob.size) {
          this.status("Der Browser hat keine Videodaten geliefert. Bitte eine neue Aufnahme starten.");
          this.controls();
          return;
        }
        this.status("Aufnahme beendet. Bitte Bild und beide Stimmen in der Vorschau prüfen und die Datei hochladen.", "", "BEREIT");
        this.controls();
      };
      display
        .getVideoTracks()[0]
        .addEventListener("ended", () => this.stop(), { once: true });
      mic
        .getAudioTracks()[0]
        ?.addEventListener("ended", () => this.stop(), { once: true });
      this.preview.srcObject = display;
      this.preview.muted = true;
      this.preview.hidden = false;
      this.preview.play().catch(() => {});
      this.recorder.start(1000);
      this.started = Date.now();
      this.status(
        "● Aufnahme läuft · Meet-Ton und Mikrofon.",
        "recording",
        "00:00",
      );
      this.timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - this.started) / 1000);
        this.node.querySelector("time").textContent =
          `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      }, 1000);
    } catch (error) {
      this.finishCapture();
      this.status(
        error.name === "NotAllowedError"
          ? "Freigabe abgebrochen oder nicht erlaubt. Du kannst erneut starten oder eine Geräteaufnahme hochladen."
          : error.message,
      );
    } finally {
      this.busy = false;
      this.controls();
    }
  }
  stop() {
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
      this.busy = true;
      this.controls();
      this.status("Aufnahme wird abgeschlossen …", "uploading");
    }
  }
  finishCapture() {
    clearInterval(this.timer);
    this.preview.srcObject = null;
    this.streams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
    this.streams = [];
    this.audio?.close().catch(() => {});
    this.audio = null;
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
