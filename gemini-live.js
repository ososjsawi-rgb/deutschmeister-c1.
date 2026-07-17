function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToInt16(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer);
}

export function buildGeminiSetup(model, voice, instructions) {
  const generationConfig = {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
  };
  if (model.startsWith("gemini-3.1")) {
    generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
  }
  return {
    setup: {
      model: `models/${model}`,
      generationConfig,
      systemInstruction: { parts: [{ text: instructions }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(model.startsWith("gemini-3.1")
        ? { historyConfig: { initialHistoryInClientContent: true } }
        : {}),
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 300,
          silenceDurationMs: 700,
        },
      },
    },
  };
}

function closeMessage(event) {
  const reason = String(event.reason || "").trim();
  if (/quota|resource.?exhausted|429/i.test(reason)) {
    return "Das kostenlose Google-Kontingent oder Nutzungslimit wurde erreicht. Versuche es später oder prüfe die Quote in AI Studio.";
  }
  if (/api.?key|auth|permission|access.?token|401|403/i.test(reason)) {
    return "Google hat die Authentifizierung abgelehnt. Erstelle in AI Studio einen neuen Schlüssel, trage ihn als GEMINI_API_KEY ein und starte die App neu.";
  }
  if (/model|not.?found|404/i.test(reason)) {
    return "Das Modell ist für dieses Konto oder diese Region nicht verfügbar. Wähle das andere Gemini-Modell.";
  }
  if (reason) return `Google hat die Sitzung beendet (${event.code}): ${reason.slice(0, 220)}`;
  if (event.code === 1006) return "Die Google-Verbindung wurde ohne weitere Angaben getrennt (1006). Prüfe die Internetverbindung und wähle das andere Modell.";
  return `Google hat die Sitzung mit Code ${event.code} beendet.`;
}

export class GeminiLiveSession {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.socket = null;
    this.inputStream = null;
    this.inputContext = null;
    this.outputContext = null;
    this.recorderNode = null;
    this.inputSource = null;
    this.captureEnabled = false;
    this.muted = false;
    this.nextPlayTime = 0;
    this.playingSources = new Set();
    this.inputDraft = "";
    this.outputDraft = "";
    this.initialTurn = true;
    this.closedByUser = false;
  }

  async connect({ model, voice, instructions, pages }) {
    this.callbacks.onStatus?.("connecting");
    this.model = model;
    this.outputContext = new AudioContext();
    await this.outputContext.resume();
    await this.startMicrophone();

    const tokenResponse = await fetch(`api/google-token?${new URLSearchParams({ model, voice })}`);
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.token) {
      throw new Error(tokenData.error || "Die Google-Gemini-Sitzung konnte nicht erstellt werden.");
    }

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(tokenData.token)}`;
    this.socket = new WebSocket(url);
    this.pendingPages = pages;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(() => finish(reject, new Error("Zeitüberschreitung beim Einrichten der Google-Gemini-Sitzung.")), 15000);
      this.socket.addEventListener("open", () => {
        this.socket.send(JSON.stringify(buildGeminiSetup(model, voice, instructions)));
      }, { once: true });
      this.socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.setupComplete) finish(resolve);
        this.handleMessage(message);
      });
      this.socket.addEventListener("error", () => finish(reject, new Error("Die WebSocket-Verbindung zu Google Gemini ist fehlgeschlagen.")));
      this.socket.addEventListener("close", (event) => {
        const message = closeMessage(event);
        if (!settled) finish(reject, new Error(message));
        else if (!this.closedByUser) this.callbacks.onError?.(message);
      });
    });

    this.callbacks.onStatus?.("connected");
  }

  async startMicrophone() {
    this.inputStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.inputContext = new AudioContext();
    await this.inputContext.audioWorklet.addModule(new URL("./pcm-recorder-worklet.js", import.meta.url));
    this.inputSource = this.inputContext.createMediaStreamSource(this.inputStream);
    this.recorderNode = new AudioWorkletNode(this.inputContext, "pcm-recorder");
    const silentGain = this.inputContext.createGain();
    silentGain.gain.value = 0;
    this.inputSource.connect(this.recorderNode).connect(silentGain).connect(this.inputContext.destination);
    this.recorderNode.port.onmessage = (event) => {
      if (!this.captureEnabled || this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({
        realtimeInput: {
          audio: { data: arrayBufferToBase64(event.data), mimeType: "audio/pcm;rate=16000" },
        },
      }));
    };
    await this.inputContext.resume();
  }

  sendInitialMaterial() {
    const pages = this.pendingPages || [];
    const text = pages.map((page) => `=== Buchseite ${page.printedPage} ===\n${page.text}`).join("\n\n");
    const parts = [{
      text: `Hier ist das automatisch geladene Unterrichtsmaterial. Analysiere es intern und beginne danach gemäß den Systemanweisungen.\n\n${text}`,
    }];
    if (this.model?.startsWith("gemini-3.1")) {
      for (const page of pages) {
        const [header, data] = page.image.split(",", 2);
        parts.push({ inlineData: { data, mimeType: header.includes("png") ? "image/png" : "image/jpeg" } });
      }
    }
    this.socket.send(JSON.stringify({
      clientContent: { turns: [{ role: "user", parts }], turnComplete: true },
    }));
    if (this.model?.startsWith("gemini-3.1")) {
      this.socket.send(JSON.stringify({
        realtimeInput: { text: "Beginne jetzt die Unterrichtsstunde mit deiner kurzen Einführung und der ersten Aufgabe." },
      }));
    }
    this.pendingPages = null;
    this.callbacks.onStatus?.("material");
  }

  handleMessage(message) {
    if (message.setupComplete) {
      this.sendInitialMaterial();
      return;
    }
    if (message.usageMetadata) this.callbacks.onUsage?.(message.usageMetadata);
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      this.stopPlayback();
      this.outputDraft = "";
      this.callbacks.onStatus?.("listening");
    }
    if (content.inputTranscription?.text) {
      this.inputDraft += content.inputTranscription.text;
      this.callbacks.onStatus?.("thinking");
    }
    if (content.outputTranscription?.text) {
      this.outputDraft += content.outputTranscription.text;
      this.callbacks.onTeacherDraft?.(this.outputDraft);
    }
    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data) this.playPcm(part.inlineData.data);
    }
    if (content.turnComplete) {
      if (this.inputDraft.trim()) this.callbacks.onTranscript?.("user", this.inputDraft.trim());
      if (this.outputDraft.trim()) this.callbacks.onTranscript?.("teacher", this.outputDraft.trim());
      this.inputDraft = "";
      this.outputDraft = "";
      this.captureEnabled = true;
      this.initialTurn = false;
      this.callbacks.onTurnComplete?.();
    }
  }

  playPcm(base64) {
    const pcm = base64ToInt16(base64);
    const buffer = this.outputContext.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index++) channel[index] = pcm[index] / 32768;
    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputContext.destination);
    const startAt = Math.max(this.outputContext.currentTime + 0.025, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
    this.playingSources.add(source);
    source.onended = () => this.playingSources.delete(source);
  }

  stopPlayback() {
    for (const source of this.playingSources) {
      try { source.stop(); } catch {}
    }
    this.playingSources.clear();
    this.nextPlayTime = this.outputContext?.currentTime || 0;
  }

  sendText(text) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Die Google-Sitzung ist nicht verbunden.");
    this.socket.send(JSON.stringify({ realtimeInput: { text } }));
  }

  setMuted(muted) {
    this.muted = muted;
    for (const track of this.inputStream?.getAudioTracks() || []) track.enabled = !muted;
  }

  async close() {
    this.closedByUser = true;
    this.captureEnabled = false;
    try {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      }
    } catch {}
    try { this.socket?.close(); } catch {}
    this.inputStream?.getTracks().forEach((track) => track.stop());
    this.recorderNode?.disconnect();
    this.inputSource?.disconnect();
    this.stopPlayback();
    await this.inputContext?.close().catch(() => {});
    await this.outputContext?.close().catch(() => {});
  }
}
