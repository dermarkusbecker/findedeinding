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
  constructor({ getContext, onRecord, onChange, notify }) {
    Object.assign(this, { getContext, onRecord, onChange, notify });
    this.busy = false;
    this.blob = null;
    this.recorder = null;
    this.streams = [];
    this.partialUpload = null;
    this.saved = false;
    this.node = document.querySelector("#videoRecordingState");
    this.preview = document.querySelector("#contractRecordingPreview");
    this.start = document.querySelector("#startVideoContractRecording");
    this.stopButton = document.querySelector("#stopVideoContractRecording");
    this.file = document.querySelector("#contractRecordingFile");
    this.device = document.querySelector("#prepareDeviceRecording");
    this.retry = document.querySelector("#retryContractRecording");
    this.download = document.querySelector("#downloadContractRecording");
    this.discard = document.querySelector("#discardContractRecording");
    this.start.onclick = () => this.begin();
    this.stopButton.onclick = () => this.stop();
    this.device.onclick = () => this.prepareDevice();
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
      globalThis.MediaRecorder &&
      recordingMimeType(),
    );
  }
  controls() {
    const record = this.getContext().record;
    const locked =
      this.busy ||
      this.recorder?.state === "recording" ||
      Boolean(this.blob) ||
      Boolean(record?.video_recording_path) ||
      record?.status !== "draft";
    this.start.disabled = locked || !this.supported();
    this.device.disabled = locked;
    this.file.disabled = locked || !record?.video_recording_consent_at;
    this.stopButton.disabled = this.recorder?.state !== "recording";
    this.retry.hidden = !this.blob || this.saved || this.busy;
    this.discard.hidden = !this.blob || this.saved || this.busy;
  }
  reset(record) {
    if (this.hasUnsaved()) return;
    this.cleanupPreview();
    this.blob = null;
    this.partialUpload = null;
    this.mimeType = null;
    this.saved = false;
    this.download.hidden = true;
    this.retry.hidden = true;
    this.discard.hidden = true;
    this.preview.hidden = true;
    document.querySelector("#recordingReviewed").checked = Boolean(
      record?.video_recording_reviewed_at,
    );
    if (record?.video_recording_path) {
      this.preview.src = `/api/leads?action=video-recording-download&id=${encodeURIComponent(this.getContext().leadId)}&contractId=${encodeURIComponent(record.id)}`;
      this.preview.hidden = false;
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
        ? "Bildschirm oder Gesprächstab auswählen und „Audio teilen“ aktivieren. Bildschirmton und dein Mikrofon werden gemeinsam aufgenommen."
        : "Dieser Browser bietet keine direkte Bildschirmaufnahme an. Nutze die Geräteaufnahme und lade das Video anschließend hier hoch.";
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
  async consent(context, provider) {
    const data = await this.api("begin-video-recording", {
      id: context.leadId,
      contractId: context.contractId,
      provider,
      recordingConsent: true,
      recordingPurposeAccepted: true,
      recordingRevocationAccepted: true,
    });
    this.onRecord({
      ...context.record,
      video_recording_consent_at: data.startedAt,
    });
    return data;
  }
  async prepareDevice() {
    try {
      const context = this.check();
      this.busy = true;
      this.controls();
      await this.consent(context, "device_upload");
      this.status(
        "Einwilligung protokolliert. Starte jetzt die Geräteaufnahme und lade danach die Videodatei hier hoch.",
        "",
        "BEREIT",
      );
    } catch (error) {
      this.notify(error.message);
    } finally {
      this.busy = false;
      this.controls();
    }
  }
  async begin() {
    let context;
    try {
      context = this.check();
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
        video: { frameRate: 20 },
        audio: true,
      });
      this.streams.push(display);
      if (!display.getAudioTracks().length)
        throw new Error(
          "Diese Bildschirmfreigabe liefert keinen Gesprächston. Wähle einen Gesprächstab mit „Audio teilen“ oder nutze eine Geräteaufnahme.",
        );
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      this.streams.push(mic);
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
      await this.consent(context, "browser_screen");
      if (display.getVideoTracks()[0]?.readyState !== "live")
        throw new Error(
          "Die Bildschirmfreigabe wurde beendet. Bitte erneut starten.",
        );
      this.captureContext = context;
      this.chunks = [];
      this.bytes = 0;
      this.provider = "browser_screen";
      const mimeType = recordingMimeType();
      this.recorder = new MediaRecorder(mixed, {
        mimeType,
        videoBitsPerSecond: 700000,
        audioBitsPerSecond: 128000,
      });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) {
          this.chunks.push(event.data);
          this.bytes += event.data.size;
          if (this.bytes > MAX_RECORDING_BYTES - 2 * 1024 * 1024) {
            this.notify(
              "Die Aufnahme wurde am Größenlimit beendet und wird gespeichert.",
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
        void this.save();
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
        "Aufnahme läuft · Bildschirmton und Mikrofon.",
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
      await this.save();
    } catch (error) {
      this.notify(error.message);
    } finally {
      this.file.value = "";
    }
  }
  async save() {
    if (!this.blob || this.saved) return;
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
      this.status(
        "Video vollständig in der Vertragsakte gespeichert. Bitte Bild und beide Stimmen prüfen.",
        "uploaded",
        "GESPEICHERT",
      );
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
