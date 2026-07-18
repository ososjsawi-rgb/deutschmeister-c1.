import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/pdf.mjs";
import { chapters, defaultSelection } from "./modules.js";
import { buildNoApiPrompt, buildTeacherPrompt } from "./teacher-prompt.js";
import { deleteBook, loadBook, loadProgress, saveBook, saveProgress } from "./storage.js";
import { GeminiLiveSession } from "./gemini-live.js";
import { initFlashcards } from "./flashcards.js";
import { initMotivation } from "./motivation.js?v=1.5.1";
import {
  PROVIDERS,
  calculateGeminiPaidEquivalent,
  calculateOpenAIResponseCost,
  defaultRuntimeSettings,
  normalizeUsage,
  saveRuntimeSettings,
} from "./runtime-config.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/pdf.worker.mjs";

const $ = (selector) => document.querySelector(selector);
const elements = {
  apiBadge: $("#apiBadge"), bookBadge: $("#bookBadge"), bookModal: $("#bookModal"),
  bookInput: $("#bookInput"), closeModal: $("#closeModal"), changeBookButton: $("#changeBookButton"),
  uploadStatus: $("#uploadStatus"), chapterList: $("#chapterList"), moduleSearch: $("#moduleSearch"),
  progressPercent: $("#progressPercent"), progressBar: $("#progressBar"), lessonTag: $("#lessonTag"),
  lessonTitle: $("#lessonTitle"), lessonGoal: $("#lessonGoal"), lessonPages: $("#lessonPages"),
  pageCount: $("#pageCount"), pagePreview: $("#pagePreview"), startButton: $("#startButton"),
  muteButton: $("#muteButton"), stopButton: $("#stopButton"), teacherOrb: $("#teacherOrb"),
  liveDot: $("#liveDot"), sessionStatus: $("#sessionStatus"), sessionHint: $("#sessionHint"),
  timer: $("#timer"), wave: $("#wave"), transcript: $("#transcript"),
  clearTranscript: $("#clearTranscript"), checkpointText: $("#checkpointText"),
  copyCheckpoint: $("#copyCheckpoint"), markComplete: $("#markComplete"),
  fallbackButton: $("#fallbackButton"), promptModal: $("#promptModal"),
  closePromptModal: $("#closePromptModal"), promptModalTitle: $("#promptModalTitle"),
  promptModalMeta: $("#promptModalMeta"), checkpointOption: $("#checkpointOption"),
  includeCheckpoint: $("#includeCheckpoint"), fallbackPromptText: $("#fallbackPromptText"),
  copyFallbackPrompt: $("#copyFallbackPrompt"), downloadFallbackPrompt: $("#downloadFallbackPrompt"),
  shareFallbackPrompt: $("#shareFallbackPrompt"), openChatGpt: $("#openChatGpt"),
  themeToggle: $("#themeToggle"), themeIcon: $("#themeIcon"), themeLabel: $("#themeLabel"),
  providerSelect: $("#providerSelect"), modelSelect: $("#modelSelect"), voiceSelect: $("#voiceSelect"),
  usageTokens: $("#usageTokens"), usageBreakdown: $("#usageBreakdown"),
  sessionCost: $("#sessionCost"), costNote: $("#costNote"), runtimeBar: $(".runtime-bar"),
  guideObjectives: $("#guideObjectives"), guideVocabulary: $("#guideVocabulary"),
  guideStructures: $("#guideStructures"), guideMastery: $("#guideMastery"),
  guideHomework: $("#guideHomework"), homeworkProgress: $("#homeworkProgress"),
  moduleGuidePanel: $("#moduleGuidePanel"), toggleGuideSize: $("#toggleGuideSize"),
  guideBackdrop: $("#guideBackdrop"),
};

let selectedChapter = chapters[0];
let selectedModule = defaultSelection;
let pdfDocument = null;
let bookBuffer = null;
let providerStatus = { openai: false, google: false };
let runtimeSettings = defaultRuntimeSettings();
let activeProvider = null;
let peerConnection = null;
let dataChannel = null;
let microphoneStream = null;
let geminiSession = null;
let timerHandle = null;
let timerStartedAt = 0;
let assistantDraft = "";
let speechStartedAt = 0;
let totalUserSpeechMs = 0;
let sessionUsage = { total: 0, input: 0, output: 0 };
let sessionBaseCostUsd = 0;
let pendingGeminiUsage = null;
let progress = loadProgress();
let latestCheckpoint = localStorage.getItem("aspekte-checkpoint") || "";
const motivation = initMotivation({
  getStudyContext: () => ({ moduleId: selectedModule.id, moduleTitle: selectedModule.title }),
});
motivation.syncProgress(progress, chapters);
const flashcards = initFlashcards({
  chapters,
  initialModuleId: selectedModule.id,
  onCardReviewed: (card, wasDue) => motivation.recordCardReview(card.id, wasDue),
});

function applyTheme(theme, persist = true) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  const dark = normalized === "dark";
  elements.themeToggle.setAttribute("aria-pressed", String(dark));
  elements.themeToggle.title = dark ? "Hellmodus aktivieren" : "Dunkelmodus aktivieren";
  elements.themeIcon.textContent = dark ? "☀" : "☾";
  elements.themeLabel.textContent = dark ? "Hellmodus" : "Dunkelmodus";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0a1312" : "#0f766e";
  if (persist) {
    try { localStorage.setItem("aspekte-theme", normalized); } catch {}
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function setModuleGuideExpanded(expanded) {
  elements.moduleGuidePanel.classList.toggle("expanded", expanded);
  elements.guideBackdrop.classList.toggle("hidden", !expanded);
  document.body.classList.toggle("guide-expanded-open", expanded);
  elements.toggleGuideSize.setAttribute("aria-expanded", String(expanded));
  const label = expanded ? "Modulkompass verkleinern" : "Modulkompass vergrößern";
  elements.toggleGuideSize.setAttribute("aria-label", label);
  elements.toggleGuideSize.title = label;
}

function toggleModuleGuideSize() {
  setModuleGuideExpanded(!elements.moduleGuidePanel.classList.contains("expanded"));
}

function populateSelect(select, options, selectedValue) {
  select.innerHTML = "";
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = options.some((option) => option.id === selectedValue) ? selectedValue : options[0].id;
}

function updateRuntimeControls({ resetUsage = false } = {}) {
  const config = PROVIDERS[runtimeSettings.provider];
  elements.providerSelect.value = runtimeSettings.provider;
  populateSelect(elements.modelSelect, config.models, runtimeSettings.model);
  runtimeSettings.model = elements.modelSelect.value;
  populateSelect(elements.voiceSelect, config.voices, runtimeSettings.voice);
  runtimeSettings.voice = elements.voiceSelect.value;
  elements.runtimeBar.classList.toggle("google-free", runtimeSettings.provider === "google");
  saveRuntimeSettings(runtimeSettings);
  if (resetUsage) resetSessionUsage();
  updateProviderBadge();
}

function updateProviderBadge() {
  const provider = runtimeSettings.provider;
  const configured = providerStatus[provider];
  const name = provider === "google" ? "Google" : "OpenAI";
  setBadge(elements.apiBadge, configured, `${name} bereit`, `${name} nicht eingerichtet`);
  elements.fallbackButton.classList.toggle("recommended", !configured);
  elements.fallbackButton.innerHTML = configured
    ? "<span>⎘</span> Modulprompt"
    : "<span>⎘</span> Ohne API starten";
}

function resetSessionUsage() {
  sessionUsage = { total: 0, input: 0, output: 0 };
  sessionBaseCostUsd = 0;
  totalUserSpeechMs = 0;
  speechStartedAt = 0;
  pendingGeminiUsage = null;
  renderSessionUsage();
}

function renderSessionUsage() {
  elements.usageTokens.textContent = `${sessionUsage.total.toLocaleString("en-US")} Token`;
  elements.usageBreakdown.textContent = `Eingabe ${sessionUsage.input.toLocaleString("de-DE")} · Ausgabe ${sessionUsage.output.toLocaleString("de-DE")}`;
  if (activeProvider === "google" || (!activeProvider && runtimeSettings.provider === "google")) {
    elements.sessionCost.textContent = sessionBaseCostUsd > 0
      ? `Free Tier* · ≈ $${sessionBaseCostUsd.toFixed(4)}`
      : "Free Tier*";
    elements.costNote.textContent = "Begrenzt · Google kann Daten des kostenlosen Tarifs verwenden";
    return;
  }
  const transcriptionCost = (totalUserSpeechMs / 60_000) * 0.003;
  elements.sessionCost.textContent = `$${(sessionBaseCostUsd + transcriptionCost).toFixed(4)}`;
  elements.costNote.textContent = "Schätzung einschließlich Transkription deiner Stimme";
}

function addUsage(usage, provider) {
  const normalized = normalizeUsage(usage, provider);
  sessionUsage.total += normalized.total;
  sessionUsage.input += normalized.input;
  sessionUsage.output += normalized.output;
  if (provider === "openai") {
    sessionBaseCostUsd += calculateOpenAIResponseCost(runtimeSettings.model, usage);
  } else {
    sessionBaseCostUsd += calculateGeminiPaidEquivalent(runtimeSettings.model, usage);
  }
  renderSessionUsage();
}

function setRuntimeControlsDisabled(disabled) {
  elements.providerSelect.disabled = disabled;
  elements.modelSelect.disabled = disabled;
  elements.voiceSelect.disabled = disabled;
}

function setBadge(element, ok, okText, pendingText) {
  element.classList.toggle("warning", !ok);
  element.innerHTML = `<i></i> ${ok ? okText : pendingText}`;
}

async function checkApi() {
  try {
    const response = await fetch("api/status");
    const data = await response.json();
    providerStatus = {
      openai: Boolean(data.providers?.openai ?? data.configured),
      google: Boolean(data.providers?.google),
    };
  } catch {
    providerStatus = { openai: false, google: false };
  }
  updateProviderBadge();
}

function renderChapters(filter = "") {
  const normalized = filter.trim().toLowerCase();
  elements.chapterList.innerHTML = "";
  for (const chapter of chapters) {
    const matchingModules = chapter.modules.filter((module) => {
      const studyText = [
        ...module.study.objectives,
        ...module.study.vocabulary.flat(),
        ...module.study.structures,
      ].join(" ");
      return `${chapter.title} ${module.kind} ${module.title} ${module.goal} ${studyText}`
        .toLowerCase()
        .includes(normalized);
    });
    if (normalized && matchingModules.length === 0) continue;

    const section = document.createElement("section");
    const shouldOpen = normalized || chapter.number === selectedChapter.number;
    section.className = `chapter${shouldOpen ? " open" : ""}`;
    const head = document.createElement("button");
    head.className = "chapter-head";
    head.innerHTML = `<span class="chapter-number">${chapter.number}</span><strong dir="ltr">${chapter.title}</strong><span class="chevron">›</span>`;
    head.addEventListener("click", () => section.classList.toggle("open"));
    section.append(head);

    const list = document.createElement("div");
    list.className = "module-list";
    for (const module of matchingModules) {
      const button = document.createElement("button");
      const isActive = module.id === selectedModule.id;
      button.className = `module-button${isActive ? " active" : ""}${progress[module.id]?.done ? " done" : ""}`;
      button.innerHTML = `<strong dir="ltr">${module.kind}: ${module.title}</strong><span class="pages">${module.pageStart}–${module.pageEnd}</span><small dir="ltr">${module.goal}</small>`;
      button.addEventListener("click", () => selectModule(chapter, module));
      list.append(button);
    }
    section.append(list);
    elements.chapterList.append(section);
  }
  updateProgressUi();
}

function updateProgressUi() {
  const modules = chapters.flatMap((chapter) => chapter.modules);
  const complete = modules.filter((module) => progress[module.id]?.done).length;
  const percent = Math.round((complete / modules.length) * 100);
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressBar.style.width = `${percent}%`;
}

function fillGuideList(element, items) {
  element.replaceChildren();
  for (const item of items) {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    element.append(listItem);
  }
}

function updateHomeworkProgress() {
  const homework = progress[selectedModule.id]?.homework || [];
  const complete = selectedModule.study.homework.filter((_, index) => homework[index]).length;
  const total = selectedModule.study.homework.length;
  elements.homeworkProgress.textContent = `${complete}/${total} Aufgaben`;
  elements.homeworkProgress.classList.toggle("complete", complete === total);
}

function setHomeworkComplete(index, done) {
  const current = [...(progress[selectedModule.id]?.homework || [])];
  current[index] = done;
  progress[selectedModule.id] = {
    ...(progress[selectedModule.id] || {}),
    homework: current,
  };
  saveProgress(progress);
  if (done) motivation.recordHomework(selectedModule.id, index);
  updateHomeworkProgress();
}

function renderModuleGuide() {
  const study = selectedModule.study;
  fillGuideList(elements.guideObjectives, study.objectives);
  fillGuideList(elements.guideStructures, study.structures);
  fillGuideList(elements.guideMastery, study.mastery);

  elements.guideVocabulary.replaceChildren();
  for (const [term, meaning] of study.vocabulary) {
    const item = document.createElement("div");
    item.className = "vocabulary-item";
    const word = document.createElement("strong");
    word.dir = "ltr";
    word.textContent = term;
    const translation = document.createElement("span");
    translation.textContent = meaning;
    item.append(word, translation);
    elements.guideVocabulary.append(item);
  }

  const homeworkState = progress[selectedModule.id]?.homework || [];
  elements.guideHomework.replaceChildren();
  study.homework.forEach((homework, index) => {
    const label = document.createElement("label");
    label.className = "homework-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(homeworkState[index]);
    checkbox.addEventListener("change", () => setHomeworkComplete(index, checkbox.checked));
    const copy = document.createElement("span");
    const type = document.createElement("b");
    type.textContent = homework.type;
    const task = document.createElement("span");
    task.textContent = homework.task;
    copy.append(type, task);
    label.append(checkbox, copy);
    elements.guideHomework.append(label);
  });
  updateHomeworkProgress();
}

async function selectModule(chapter, module) {
  if (peerConnection || geminiSession) await stopSession();
  selectedChapter = chapter;
  selectedModule = module;
  elements.lessonTag.textContent = `KAPITEL ${chapter.number} · ${module.kind.toUpperCase()}`;
  elements.lessonTitle.textContent = module.title;
  elements.lessonGoal.textContent = module.goal;
  elements.lessonPages.textContent = `▤ Seiten ${module.pageStart}–${module.pageEnd}`;
  const count = module.pdfEnd - module.pdfStart + 1;
  elements.pageCount.textContent = `${count} ${count === 1 ? "Seite" : "Seiten"}`;
  flashcards.setActiveModule(module.id);
  renderModuleGuide();
  updateCompleteButton();
  updateFallbackPrompt();
  renderChapters(elements.moduleSearch.value);
  await renderSelectedPages();
}

async function loadPdf(buffer) {
  bookBuffer = buffer;
  const copy = buffer.slice(0);
  pdfDocument = await pdfjsLib.getDocument({ data: copy }).promise;
  if (pdfDocument.numPages < 200) throw new Error("Diese Datei scheint nicht das vollständige Lehrbuch Aspekte neu C1 zu sein.");
  setBadge(elements.bookBadge, true, "Buch bereit", "Buch fehlt");
  await renderSelectedPages();
}

async function renderSelectedPages() {
  if (!pdfDocument) {
    elements.pagePreview.innerHTML = '<div class="page-placeholder">Nach dem Hinzufügen des Buches erscheinen hier die Modulseiten.</div>';
    return;
  }
  elements.pagePreview.innerHTML = "";
  for (let pageNumber = selectedModule.pdfStart; pageNumber <= selectedModule.pdfEnd; pageNumber++) {
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = 360 / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.title = `Seite ${pageNumber - 1}`;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    elements.pagePreview.append(canvas);
  }
}

async function handleBookFile(file) {
  if (!file) return;
  elements.uploadStatus.textContent = "Das Buch wird gelesen und auf deinem Gerät gespeichert …";
  try {
    const buffer = await file.arrayBuffer();
    await loadPdf(buffer);
    await saveBook(buffer.slice(0));
    elements.uploadStatus.textContent = "Das Buch wurde erfolgreich vorbereitet.";
    setTimeout(() => elements.bookModal.classList.add("hidden"), 550);
  } catch (error) {
    console.error(error);
    elements.uploadStatus.textContent = error.message || "Die Datei konnte nicht gelesen werden. Versuche es erneut.";
  }
}

async function extractModuleMaterial() {
  const pages = [];
  for (let pageNumber = selectedModule.pdfStart; pageNumber <= selectedModule.pdfEnd; pageNumber++) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    let text = "";
    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      text += `${item.str}${item.hasEOL ? "\n" : " "}`;
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const scale = 1000 / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
    const image = canvas.toDataURL("image/jpeg", 0.68);
    pages.push({ printedPage: pageNumber - 1, text: text.trim(), image });
  }
  return pages;
}

function sendEvent(event) {
  if (!dataChannel || dataChannel.readyState !== "open") throw new Error("Der Verbindungskanal ist noch nicht bereit.");
  dataChannel.send(JSON.stringify(event));
}

async function waitForChannelBuffer() {
  if (!dataChannel || dataChannel.bufferedAmount < 700_000) return;
  await new Promise((resolve) => {
    dataChannel.bufferedAmountLowThreshold = 250_000;
    dataChannel.addEventListener("bufferedamountlow", resolve, { once: true });
  });
}

async function sendLessonMaterial(pages) {
  const text = pages.map((page) => `=== Buchseite ${page.printedPage} ===\n${page.text}`).join("\n\n");
  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message", role: "user",
      content: [{ type: "input_text", text: `Hier ist das automatisch geladene Unterrichtsmaterial. Analysiere es intern und beginne anschließend den Unterricht gemäß deinen Anweisungen.\n\n${text}` }],
    },
  });

  for (const page of pages) {
    await waitForChannelBuffer();
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message", role: "user",
        content: [
          { type: "input_text", text: `Seitenbild zu Buchseite ${page.printedPage}. Nutze es für Layout, Bilder, Tabellen und Aufgabenzuordnung. Antworte noch nicht.` },
          { type: "input_image", image_url: page.image },
        ],
      },
    });
  }
  sendEvent({ type: "response.create", response: { output_modalities: ["audio"] } });
}

function configureSession() {
  const prompt = buildTeacherPrompt(selectedChapter, selectedModule);
  sendEvent({
    type: "session.update",
    session: {
      type: "realtime",
      model: runtimeSettings.model,
      output_modalities: ["audio"],
      instructions: prompt,
      audio: {
        input: {
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: true,
            interrupt_response: true,
          },
          transcription: { model: "gpt-4o-mini-transcribe", language: "de" },
        },
        output: { voice: runtimeSettings.voice },
      },
    },
  });
}

function handleServerEvent(event) {
  if (event.type === "session.updated") {
    elements.sessionStatus.textContent = "Der Lehrer prüft die Modulseiten";
    elements.sessionHint.textContent = "Die Stunde beginnt in wenigen Augenblicken";
  }
  if (event.type === "input_audio_buffer.speech_started") {
    speechStartedAt = Date.now();
    elements.wave.classList.add("active");
    elements.sessionStatus.textContent = "Ich höre dir zu …";
  }
  if (event.type === "input_audio_buffer.speech_stopped") {
    if (speechStartedAt) {
      totalUserSpeechMs += Date.now() - speechStartedAt;
      speechStartedAt = 0;
      renderSessionUsage();
    }
    elements.wave.classList.remove("active");
    elements.sessionStatus.textContent = "Der Lehrer verarbeitet deine Antwort";
  }
  if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
    appendMessage("user", event.transcript);
  }
  if (event.type === "response.output_audio_transcript.delta") {
    assistantDraft += event.delta || "";
    updateDraftMessage(assistantDraft);
  }
  if (event.type === "response.output_audio_transcript.done") {
    const finalText = event.transcript || assistantDraft;
    finalizeDraftMessage(finalText);
    assistantDraft = "";
    elements.sessionStatus.textContent = "Du bist dran";
    elements.sessionHint.textContent = "Nimm dir Zeit; der Lehrer unterbricht dich nicht";
    if (/checkpoint/i.test(finalText) || /Nächster Schritt|Aktiver Wortschatz/i.test(finalText)) {
      saveCheckpoint(finalText);
    }
    if (/Modul (ist )?(vollständig )?abgeschlossen/i.test(finalText)) markModuleComplete(true);
  }
  if (event.type === "response.done" && event.response?.usage) {
    addUsage(event.response.usage, "openai");
  }
  if (event.type === "error") {
    console.error("Realtime error", event.error || event);
    elements.sessionStatus.textContent = "Verbindungsproblem";
    elements.sessionHint.textContent = event.error?.message || "Starte die Stunde erneut";
  }
}

async function startSession() {
  if (!pdfDocument) {
    elements.bookModal.classList.remove("hidden");
    return;
  }
  const provider = runtimeSettings.provider;
  if (!providerStatus[provider]) {
    const keyName = provider === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    const providerName = provider === "google" ? "Google Gemini" : "OpenAI";
    elements.sessionStatus.textContent = `Zuerst einen ${providerName}-Schlüssel hinzufügen`;
    elements.sessionHint.textContent = `${keyName} in .env eintragen und die App neu starten`;
    return;
  }

  resetSessionUsage();
  activeProvider = provider;
  elements.startButton.disabled = true;
  setRuntimeControlsDisabled(true);
  elements.sessionStatus.textContent = "Die Stunde wird vorbereitet";
  elements.sessionHint.textContent = "Seiten werden gelesen und der Lehrer wird verbunden";
  try {
    if (provider === "google") await startGeminiSession();
    else await startOpenAISession();

    elements.muteButton.disabled = false;
    elements.stopButton.disabled = false;
    elements.liveDot.classList.add("active");
    elements.teacherOrb.classList.add("live");
    startTimer();
    motivation.ensureStudyTimer();
  } catch (error) {
    console.error(error);
    elements.sessionStatus.textContent = "Die Stunde konnte nicht gestartet werden";
    elements.sessionHint.textContent = normalizeError(error.message);
    await stopSession(false);
  } finally {
    if (!peerConnection && !geminiSession) {
      elements.startButton.disabled = false;
      setRuntimeControlsDisabled(false);
    }
  }
}

async function startOpenAISession() {
  const materialPromise = extractModuleMaterial();
  peerConnection = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  peerConnection.ontrack = (event) => { audio.srcObject = event.streams[0]; };

  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  for (const track of microphoneStream.getTracks()) peerConnection.addTrack(track, microphoneStream);

  dataChannel = peerConnection.createDataChannel("oai-events");
  dataChannel.addEventListener("message", (message) => handleServerEvent(JSON.parse(message.data)));
  const channelReady = new Promise((resolve) => dataChannel.addEventListener("open", resolve, { once: true }));

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  const query = new URLSearchParams({ model: runtimeSettings.model, voice: runtimeSettings.voice });
  const response = await fetch(`session?${query}`, {
    method: "POST", body: offer.sdp, headers: { "Content-Type": "application/sdp" },
  });
  if (!response.ok) throw new Error((await response.text()) || "Die OpenAI-Sprachverbindung konnte nicht gestartet werden.");
  await peerConnection.setRemoteDescription({ type: "answer", sdp: await response.text() });
  await channelReady;
  configureSession();
  await sendLessonMaterial(await materialPromise);
}

async function startGeminiSession() {
  const pages = await extractModuleMaterial();
  geminiSession = new GeminiLiveSession({
    onStatus(status) {
      const messages = {
        connecting: ["Verbindung mit Google Gemini", "Sichere Audioverbindung wird vorbereitet"],
        connected: ["Mit Google Gemini verbunden", "Modulseiten werden gesendet"],
        material: ["Der Lehrer prüft die Modulseiten", "Die Stunde beginnt in wenigen Augenblicken"],
        listening: ["Ich höre dir zu …", "Sprich in deinem eigenen Tempo"],
        thinking: ["Der Lehrer verarbeitet deine Antwort", "Nimm dir Zeit für deine Antwort"],
      };
      const [title, hint] = messages[status] || ["Google-Sitzung läuft", "Sprachverbindung ist aktiv"];
      elements.sessionStatus.textContent = title;
      elements.sessionHint.textContent = hint;
      elements.wave.classList.toggle("active", status === "listening");
    },
    onTeacherDraft(text) { updateDraftMessage(text); },
    onTranscript(role, text) {
      if (role === "teacher") {
        finalizeDraftMessage(text);
        if (/checkpoint/i.test(text) || /Nächster Schritt|Aktiver Wortschatz/i.test(text)) saveCheckpoint(text);
        if (/Modul (ist )?(vollständig )?abgeschlossen/i.test(text)) markModuleComplete(true);
      } else {
        appendMessage("user", text);
      }
    },
    onUsage(usage) { pendingGeminiUsage = usage; },
    onTurnComplete() {
      if (pendingGeminiUsage) {
        addUsage(pendingGeminiUsage, "google");
        pendingGeminiUsage = null;
      }
      elements.wave.classList.remove("active");
      elements.sessionStatus.textContent = "Du bist dran";
      elements.sessionHint.textContent = "Nimm dir Zeit; der Lehrer wartet auf das Ende deines Beitrags";
    },
    onError(message) {
      void stopSession(false).then(() => {
        elements.sessionStatus.textContent = "Problem mit Google Gemini";
        elements.sessionHint.textContent = message;
      });
    },
  });
  await geminiSession.connect({
    model: runtimeSettings.model,
    voice: runtimeSettings.voice,
    instructions: buildTeacherPrompt(selectedChapter, selectedModule),
    pages,
  });
}

function normalizeError(message = "") {
  if (/401|api key|authentication|permission_denied/i.test(message)) {
    return `Der Schlüssel für ${activeProvider === "google" ? "Google Gemini" : "OpenAI"} ist ungültig oder nicht aktiviert.`;
  }
  if (/429|resource_exhausted|quota/i.test(message)) return "Das kostenlose Kontingent oder Nutzungslimit wurde erreicht. Warte kurz oder prüfe deine Kontolimits.";
  if (/microphone|permission|notallowed/i.test(message)) return "Erlaube dem Browser den Mikrofonzugriff und versuche es erneut.";
  return message.slice(0, 180) || "Versuche es erneut.";
}

async function stopSession(markProgress = true) {
  if (markProgress && (peerConnection || geminiSession)) {
    progress[selectedModule.id] = { ...(progress[selectedModule.id] || {}), visited: true, lastStudied: new Date().toISOString() };
    saveProgress(progress);
  }
  microphoneStream?.getTracks().forEach((track) => track.stop());
  if (speechStartedAt) {
    totalUserSpeechMs += Date.now() - speechStartedAt;
    speechStartedAt = 0;
    renderSessionUsage();
  }
  dataChannel?.close();
  peerConnection?.close();
  await geminiSession?.close().catch(() => {});
  peerConnection = null;
  dataChannel = null;
  microphoneStream = null;
  geminiSession = null;
  activeProvider = null;
  elements.startButton.disabled = false;
  elements.muteButton.disabled = true;
  elements.stopButton.disabled = true;
  elements.muteButton.textContent = "🎙";
  setRuntimeControlsDisabled(false);
  elements.liveDot.classList.remove("active");
  elements.teacherOrb.classList.remove("live");
  elements.wave.classList.remove("active");
  elements.sessionStatus.textContent = "Stunde beendet";
  elements.sessionHint.textContent = "Du kannst neu starten oder ein anderes Modul wählen";
  stopTimer();
  renderChapters(elements.moduleSearch.value);
}

function toggleMute() {
  if (activeProvider === "google" && geminiSession) {
    const muted = elements.muteButton.textContent !== "🔇";
    geminiSession.setMuted(muted);
    elements.muteButton.textContent = muted ? "🔇" : "🎙";
    elements.sessionHint.textContent = muted ? "Mikrofon stumm" : "Mikrofon aktiv";
    return;
  }
  const track = microphoneStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  elements.muteButton.textContent = track.enabled ? "🎙" : "🔇";
  elements.sessionHint.textContent = track.enabled ? "Mikrofon aktiv" : "Mikrofon stumm";
}

function sendCommand(command) {
  if (activeProvider === "google" && geminiSession) {
    try {
      geminiSession.sendText(command);
      appendMessage("user", command);
    } catch (error) {
      elements.sessionHint.textContent = error.message;
    }
    return;
  }
  if (!dataChannel || dataChannel.readyState !== "open") {
    elements.sessionHint.textContent = "Starte zuerst die Stunde, um Befehle zu verwenden";
    return;
  }
  sendEvent({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: command }] } });
  sendEvent({ type: "response.create", response: { output_modalities: ["audio"] } });
  appendMessage("user", command);
}

function appendMessage(role, text) {
  elements.transcript.querySelector(".empty-state")?.remove();
  const message = document.createElement("div");
  message.className = `message${role === "teacher" ? " teacher" : ""}`;
  message.innerHTML = `<span class="speaker">${role === "teacher" ? "LEHRER" : "DU"}</span><p></p>`;
  message.querySelector("p").textContent = text;
  elements.transcript.append(message);
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function updateDraftMessage(text) {
  elements.transcript.querySelector(".empty-state")?.remove();
  let draft = elements.transcript.querySelector(".message.teacher.draft");
  if (!draft) {
    draft = document.createElement("div");
    draft.className = "message teacher draft";
    draft.innerHTML = '<span class="speaker">LEHRER</span><p></p>';
    elements.transcript.append(draft);
  }
  draft.querySelector("p").textContent = text;
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function finalizeDraftMessage(text) {
  const draft = elements.transcript.querySelector(".message.teacher.draft");
  if (draft) {
    draft.classList.remove("draft");
    draft.querySelector("p").textContent = text;
  } else if (text) {
    appendMessage("teacher", text);
  }
}

function saveCheckpoint(text) {
  latestCheckpoint = text;
  localStorage.setItem("aspekte-checkpoint", text);
  elements.checkpointText.textContent = text;
  elements.copyCheckpoint.disabled = false;
  updateFallbackPrompt();
}

function updateFallbackPrompt() {
  const checkpoint = elements.includeCheckpoint?.checked ? latestCheckpoint : "";
  elements.fallbackPromptText.value = buildNoApiPrompt(selectedChapter, selectedModule, checkpoint);
  elements.promptModalTitle.textContent = `${selectedModule.kind}: ${selectedModule.title}`;
  elements.promptModalMeta.textContent = `Kapitel ${selectedChapter.number}: ${selectedChapter.title} · Seiten ${selectedModule.pageStart}–${selectedModule.pageEnd}`;
  const hasCheckpoint = Boolean(latestCheckpoint.trim());
  elements.checkpointOption.classList.toggle("hidden", !hasCheckpoint);
  if (!hasCheckpoint) elements.includeCheckpoint.checked = false;
}

function openFallbackPrompt() {
  motivation.ensureStudyTimer();
  updateFallbackPrompt();
  elements.promptModal.classList.remove("hidden");
  requestAnimationFrame(() => elements.fallbackPromptText.scrollTop = 0);
}

function closeFallbackPrompt() {
  elements.promptModal.classList.add("hidden");
}

async function copyFallbackPrompt() {
  const text = elements.fallbackPromptText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    elements.fallbackPromptText.focus();
    elements.fallbackPromptText.select();
    document.execCommand("copy");
  }
  elements.copyFallbackPrompt.textContent = "Kopiert ✓";
  setTimeout(() => elements.copyFallbackPrompt.textContent = "Prompt kopieren", 1300);
}

async function shareFallbackPrompt() {
  const text = elements.fallbackPromptText.value;
  const title = `DeutschMeister · ${selectedModule.title}`;
  const original = elements.shareFallbackPrompt.textContent;
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      elements.shareFallbackPrompt.textContent = "Geteilt ✓";
    } else {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        elements.fallbackPromptText.focus();
        elements.fallbackPromptText.select();
        document.execCommand("copy");
      }
      elements.shareFallbackPrompt.textContent = "Kopiert ✓";
    }
  } catch (error) {
    if (error?.name !== "AbortError") elements.shareFallbackPrompt.textContent = "Teilen fehlgeschlagen";
  }
  setTimeout(() => { elements.shareFallbackPrompt.textContent = original; }, 1500);
}

function openChatGpt() {
  window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
}

function downloadFallbackPrompt() {
  const safeTitle = selectedModule.title.replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-|-$/g, "");
  const blob = new Blob([elements.fallbackPromptText.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Kapitel-${selectedChapter.number}-${safeTitle || selectedModule.id}-Prompt.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function updateCompleteButton() {
  const done = Boolean(progress[selectedModule.id]?.done);
  elements.markComplete.classList.toggle("done", done);
  elements.markComplete.textContent = done ? "Modul abgeschlossen ✓" : "Modul als abgeschlossen markieren";
}

function markModuleComplete(forceDone) {
  const current = Boolean(progress[selectedModule.id]?.done);
  const done = typeof forceDone === "boolean" ? forceDone : !current;
  progress[selectedModule.id] = {
    ...(progress[selectedModule.id] || {}),
    done,
    completedAt: done ? new Date().toISOString() : null,
  };
  saveProgress(progress);
  if (done) motivation.recordModule(selectedModule.id, "Modul abgeschlossen");
  updateCompleteButton();
  renderChapters(elements.moduleSearch.value);
}

function startTimer() {
  timerStartedAt = Date.now();
  timerHandle = setInterval(() => {
    const seconds = Math.floor((Date.now() - timerStartedAt) / 1000);
    elements.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerHandle);
  timerHandle = null;
  elements.timer.textContent = "00:00";
}

elements.bookInput.addEventListener("change", (event) => handleBookFile(event.target.files[0]));
elements.closeModal.addEventListener("click", () => elements.bookModal.classList.add("hidden"));
elements.changeBookButton.addEventListener("click", () => elements.bookModal.classList.remove("hidden"));
elements.moduleSearch.addEventListener("input", () => renderChapters(elements.moduleSearch.value));
elements.startButton.addEventListener("click", startSession);
elements.stopButton.addEventListener("click", () => stopSession());
elements.muteButton.addEventListener("click", toggleMute);
document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => sendCommand(button.dataset.command)));
elements.clearTranscript.addEventListener("click", () => {
  elements.transcript.innerHTML = '<div class="empty-state"><span>“</span><p>Hier erscheinen während der Stunde deine Beiträge, die Antworten des Lehrers und alle Korrekturen.</p></div>';
});
elements.copyCheckpoint.addEventListener("click", async () => {
  await navigator.clipboard.writeText(latestCheckpoint);
  elements.copyCheckpoint.textContent = "Kopiert ✓";
  setTimeout(() => (elements.copyCheckpoint.textContent = "Checkpoint kopieren"), 1200);
});
elements.markComplete.addEventListener("click", () => markModuleComplete());
elements.fallbackButton.addEventListener("click", openFallbackPrompt);
elements.closePromptModal.addEventListener("click", closeFallbackPrompt);
elements.promptModal.addEventListener("click", (event) => {
  if (event.target === elements.promptModal) closeFallbackPrompt();
});
elements.includeCheckpoint.addEventListener("change", updateFallbackPrompt);
elements.copyFallbackPrompt.addEventListener("click", copyFallbackPrompt);
elements.shareFallbackPrompt.addEventListener("click", shareFallbackPrompt);
elements.openChatGpt.addEventListener("click", openChatGpt);
elements.downloadFallbackPrompt.addEventListener("click", downloadFallbackPrompt);
elements.themeToggle.addEventListener("click", toggleTheme);
elements.toggleGuideSize.addEventListener("click", toggleModuleGuideSize);
elements.guideBackdrop.addEventListener("click", () => setModuleGuideExpanded(false));
elements.providerSelect.addEventListener("change", () => {
  runtimeSettings.provider = elements.providerSelect.value;
  runtimeSettings.model = PROVIDERS[runtimeSettings.provider].models[0].id;
  runtimeSettings.voice = PROVIDERS[runtimeSettings.provider].voices[0].id;
  updateRuntimeControls({ resetUsage: true });
});
elements.modelSelect.addEventListener("change", () => {
  runtimeSettings.model = elements.modelSelect.value;
  saveRuntimeSettings(runtimeSettings);
  resetSessionUsage();
});
elements.voiceSelect.addEventListener("change", () => {
  runtimeSettings.voice = elements.voiceSelect.value;
  saveRuntimeSettings(runtimeSettings);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (elements.moduleGuidePanel.classList.contains("expanded")) {
    setModuleGuideExpanded(false);
    elements.toggleGuideSize.focus();
  } else if (!elements.promptModal.classList.contains("hidden")) {
    closeFallbackPrompt();
  }
});

async function init() {
  applyTheme(document.documentElement.dataset.theme, false);
  updateRuntimeControls({ resetUsage: true });
  renderChapters();
  await checkApi();
  if (latestCheckpoint) {
    elements.checkpointText.textContent = latestCheckpoint;
    elements.copyCheckpoint.disabled = false;
  }
  try {
    const saved = await loadBook();
    if (saved) {
      await loadPdf(saved);
    } else {
      elements.bookModal.classList.remove("hidden");
    }
  } catch (error) {
    console.error(error);
    await deleteBook().catch(() => {});
    elements.bookModal.classList.remove("hidden");
    elements.uploadStatus.textContent = "Die gespeicherte Datei konnte nicht geöffnet werden. Wähle das Buch erneut aus.";
  }
  await selectModule(selectedChapter, selectedModule);
}

init();
