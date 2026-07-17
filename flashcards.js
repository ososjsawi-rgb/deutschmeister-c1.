import {
  buildVocabularyCoachPrompt,
  createModuleCards,
  isDue,
  isMastered,
  mergeCards,
  nextReviewLabel,
  normalizeTermForImage,
  parseVocabularyInput,
  scheduleCard,
} from "./flashcard-core.js";
import { buildCommonsImageUrl, parseCommonsImages } from "./commons-images.js";

const STORAGE_KEY = "deutschmeister-flashcards-v1";

const $ = (selector) => document.querySelector(selector);

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      reviewDates: parsed.reviewDates && typeof parsed.reviewDates === "object" ? parsed.reviewDates : {},
    };
  } catch {
    return { cards: [], reviewDates: {} };
  }
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function reviewStreak(reviewDates) {
  let cursor = new Date();
  if (!reviewDates[dateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (reviewDates[dateKey(cursor)]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `word-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeExternalUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : String(fallback);
  } catch {
    return String(fallback);
  }
}

function safeImage(image) {
  if (!image || typeof image !== "object") return null;
  try {
    const url = new URL(image.url);
    if (url.protocol !== "https:") return null;
    return {
      url: url.toString(),
      originalUrl: safeExternalUrl(image.originalUrl, url),
      title: String(image.title || "Bild aus Wikimedia Commons").slice(0, 240),
      author: String(image.author || "Wikimedia contributor").slice(0, 240),
      license: String(image.license || "Lizenz prüfen").slice(0, 120),
      licenseUrl: safeExternalUrl(image.licenseUrl, url),
      sourceUrl: safeExternalUrl(image.sourceUrl, url),
    };
  } catch {
    return null;
  }
}

function validImportedCard(card) {
  if (!card || typeof card !== "object" || !String(card.term || "").trim() || !String(card.meaning || "").trim()) return null;
  const now = new Date().toISOString();
  return {
    id: String(card.id || randomId()),
    term: String(card.term).trim().slice(0, 160),
    meaning: String(card.meaning).trim().slice(0, 300),
    example: String(card.example || "").trim().slice(0, 500),
    imageQuery: String(card.imageQuery || normalizeTermForImage(card.term)).trim().slice(0, 80),
    moduleId: String(card.moduleId || "custom"),
    moduleTitle: String(card.moduleTitle || "Meine Wörter").slice(0, 160),
    source: String(card.source || "custom"),
    createdAt: String(card.createdAt || now),
    dueAt: String(card.dueAt || now),
    intervalDays: Math.max(0, Number(card.intervalDays) || 0),
    ease: Math.min(3.2, Math.max(1.3, Number(card.ease) || 2.5)),
    repetitions: Math.max(0, Number(card.repetitions) || 0),
    lapses: Math.max(0, Number(card.lapses) || 0),
    reviews: Math.max(0, Number(card.reviews) || 0),
    lastReviewedAt: card.lastReviewedAt ? String(card.lastReviewedAt) : undefined,
    image: safeImage(card.image),
  };
}

async function shareText(title, text) {
  if (navigator.share) {
    await navigator.share({ title, text });
    return "shared";
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
  return "copied";
}

export function initFlashcards({ chapters, initialModuleId, onCardReviewed = () => {} }) {
  const elements = {
    lessonWorkspace: $(".layout"), vocabularyWorkspace: $("#vocabularyWorkspace"),
    lessonViewButton: $("#lessonViewButton"), vocabViewButton: $("#vocabViewButton"),
    dueCardsBadge: $("#dueCardsBadge"), moduleSelect: $("#flashcardModuleSelect"),
    addModuleWords: $("#addModuleWords"), sharePrompt: $("#shareVocabularyPrompt"),
    total: $("#flashcardTotal"), due: $("#flashcardDue"), mastered: $("#flashcardMastered"), streak: $("#flashcardStreak"),
    filters: $("#reviewFilters"), progressText: $("#reviewProgressText"), progressBar: $("#reviewProgressBar"),
    stage: $("#flashcardStage"), ratingButtons: $("#reviewRatingButtons"),
    input: $("#vocabularyInput"), autoImage: $("#autoImageSearch"), createCards: $("#createVocabularyCards"),
    inputStatus: $("#vocabularyInputStatus"), exportButton: $("#exportVocabulary"), importInput: $("#importVocabulary"),
    listCount: $("#vocabularyListCount"), cardList: $("#vocabularyCardList"),
  };

  const moduleLookup = new Map();
  for (const chapter of chapters) for (const module of chapter.modules) moduleLookup.set(module.id, { chapter, module });

  let state = loadState();
  let currentModuleId = moduleLookup.has(initialModuleId) ? initialModuleId : chapters[0].modules[0].id;
  let reviewFilter = "due";
  let reviewQueue = [];
  let revealed = false;
  let isVocabularyView = false;
  const reviewedInSession = new Set();
  const imageResults = new Map();
  const imageLoading = new Set();

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function deckCards() {
    return state.cards.filter((card) => card.moduleId === currentModuleId);
  }

  function filteredCards() {
    const cards = deckCards();
    if (reviewFilter === "new") return cards.filter((card) => Number(card.reviews) === 0);
    if (reviewFilter === "hard") return cards.filter((card) => Number(card.lapses) > 0 || Number(card.ease) < 2.35);
    if (reviewFilter === "mastered") return cards.filter(isMastered);
    if (reviewFilter === "due") return cards.filter((card) => isDue(card));
    return cards;
  }

  function currentCard() {
    return reviewQueue[0] || null;
  }

  function updateModuleButton() {
    const module = moduleLookup.get(currentModuleId)?.module;
    if (!module) return;
    const existingIds = new Set(deckCards().map((card) => card.id));
    const expected = createModuleCards(module);
    const complete = expected.every((card) => existingIds.has(card.id));
    elements.addModuleWords.textContent = complete ? "Modulwörter vorhanden ✓" : `${expected.length} Modulwörter hinzufügen`;
  }

  function renderStats() {
    const cards = deckCards();
    elements.total.textContent = String(cards.length);
    elements.due.textContent = String(cards.filter((card) => isDue(card)).length);
    elements.mastered.textContent = String(cards.filter(isMastered).length);
    elements.streak.textContent = String(reviewStreak(state.reviewDates));
    const totalDue = state.cards.filter((card) => isDue(card)).length;
    elements.dueCardsBadge.textContent = String(totalDue);
    elements.dueCardsBadge.title = `${totalDue} Wörter zur Wiederholung fällig`;
  }

  function renderProgress() {
    const total = reviewedInSession.size + reviewQueue.length;
    const done = reviewedInSession.size;
    elements.progressText.textContent = total ? `${Math.min(done + 1, total)} / ${total}` : "0 / 0";
    elements.progressBar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  }

  function speakGerman(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "de-DE";
    utterance.rate = 0.86;
    const germanVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("de"));
    if (germanVoice) utterance.voice = germanVoice;
    window.speechSynthesis.speak(utterance);
  }

  function makeButton(text, action, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.dataset.action = action;
    if (className) button.className = className;
    return button;
  }

  function renderEmptyReview() {
    const total = deckCards().length;
    const empty = document.createElement("div");
    empty.className = "review-empty";
    const icon = document.createElement("span");
    icon.textContent = total ? "✓" : "＋";
    const title = document.createElement("h3");
    title.textContent = total ? "Aktuelle Auswahl abgeschlossen" : "Mit den Modulwörtern beginnen";
    const copy = document.createElement("p");
    copy.textContent = total
      ? (reviewFilter === "due" ? "Jetzt sind keine weiteren Wörter fällig. Wähle einen anderen Filter, um weiterzuüben." : "Du hast in dieser Sitzung alle Wörter dieses Filters wiederholt.")
      : "Klicke auf „Modulwörter hinzufügen“, damit der Lehrbuchwortschatz automatisch erscheint.";
    empty.append(icon, title, copy);
    elements.stage.replaceChildren(empty);
    elements.ratingButtons.classList.add("workspace-hidden");
  }

  function renderCurrentCard() {
    renderProgress();
    const card = currentCard();
    if (!card) {
      renderEmptyReview();
      return;
    }

    const article = document.createElement("article");
    article.className = `study-flashcard${revealed ? " revealed" : ""}`;
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", revealed ? `Erklärung: ${card.meaning}` : `Karte ${card.term} wenden`);

    const topline = document.createElement("div");
    topline.className = "flashcard-topline";
    const moduleChip = document.createElement("span");
    moduleChip.className = "deck-chip";
    moduleChip.textContent = card.moduleTitle || "Meine Wörter";
    const speak = makeButton("🔊", "speak", "card-speak");
    speak.title = "Deutsche Aussprache anhören";
    topline.append(moduleChip, speak);

    const imageBox = document.createElement("div");
    imageBox.className = `card-image${imageLoading.has(card.id) ? " image-loading" : ""}`;
    if (card.image?.url) {
      const image = document.createElement("img");
      image.src = card.image.url;
      image.alt = card.image.title || card.term;
      image.loading = "eager";
      image.referrerPolicy = "no-referrer";
      const credit = document.createElement("a");
      credit.className = "image-credit";
      credit.href = card.image.sourceUrl;
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      credit.textContent = `${card.image.author} · ${card.image.license}`;
      credit.title = "Quelle und Lizenz auf Wikimedia Commons";
      imageBox.append(image, credit);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "card-image-placeholder";
      placeholder.textContent = card.term.trim().charAt(0).toUpperCase() || "D";
      imageBox.append(placeholder);
    }

    const content = document.createElement("div");
    content.className = "flashcard-content";
    const term = document.createElement("h3");
    term.dir = "ltr";
    term.lang = "de";
    term.textContent = card.term;
    const prompt = document.createElement("p");
    prompt.className = "recall-prompt";
    prompt.textContent = "Erkläre die Bedeutung und bilde einen deutschen Satz, bevor du die Karte wendest.";
    const answer = document.createElement("div");
    answer.className = "flashcard-answer";
    const meaning = document.createElement("strong");
    meaning.textContent = card.meaning;
    const example = document.createElement("p");
    example.lang = "de";
    example.textContent = card.example || `Bilde selbst einen Satz mit „${card.term}“.`;
    const next = document.createElement("small");
    next.textContent = nextReviewLabel(card);
    answer.append(meaning, example, next);
    content.append(term, prompt, answer);

    const controls = document.createElement("div");
    controls.className = "flashcard-controls";
    controls.append(makeButton(revealed ? "Erklärung ausblenden" : "Erklärung anzeigen", "flip"));
    const youglish = document.createElement("a");
    youglish.className = "youglish-link";
    youglish.href = `https://youglish.com/pronounce/${encodeURIComponent(card.term)}/german`;
    youglish.target = "_blank";
    youglish.rel = "noopener noreferrer";
    youglish.textContent = "🎬 In echten Beispielen hören";
    controls.append(youglish, makeButton(card.image ? "Anderes Bild" : "Bild suchen", "image"));
    if (card.image) controls.append(makeButton("Bild entfernen", "remove-image"));

    article.append(topline, imageBox, content, controls);
    elements.stage.replaceChildren(article);
    elements.ratingButtons.classList.toggle("workspace-hidden", !revealed);

    article.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "speak") speakGerman(card.term);
      else if (action === "image") void findImage(card, Boolean(card.image));
      else if (action === "remove-image") removeImage(card);
      else if (action === "flip" || !event.target.closest("button,a")) flipCard();
    });
    article.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button,a")) {
        event.preventDefault();
        event.stopPropagation();
        flipCard();
      }
    });
  }

  function renderList() {
    const cards = deckCards();
    elements.listCount.textContent = `${cards.length} Wörter`;
    elements.cardList.replaceChildren();
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "review-empty";
      empty.innerHTML = "<span>▤</span><h3>Noch keine Wörter</h3><p>Füge die Modulwörter hinzu oder füge deine eigene Liste ein.</p>";
      elements.cardList.append(empty);
      return;
    }

    for (const card of cards) {
      const item = document.createElement("article");
      item.className = "word-list-card";
      const visual = document.createElement("div");
      visual.className = "word-list-image";
      if (card.image?.url) {
        const image = document.createElement("img");
        image.src = card.image.url;
        image.alt = card.image.title || card.term;
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        visual.append(image);
      } else {
        visual.textContent = card.term.charAt(0).toUpperCase();
      }
      const copy = document.createElement("div");
      copy.className = "word-list-copy";
      const term = document.createElement("strong");
      term.dir = "ltr";
      term.textContent = card.term;
      const meaning = document.createElement("span");
      meaning.textContent = card.meaning;
      const status = document.createElement("small");
      status.textContent = isMastered(card) ? "Sicher gelernt ✓" : nextReviewLabel(card);
      copy.append(term, meaning, status);
      const actions = document.createElement("div");
      actions.className = "word-list-actions";
      const speak = makeButton("🔊", "speak");
      speak.title = "Aussprache";
      const image = makeButton(card.image ? "↻" : "▧", "image");
      image.title = card.image ? "Anderes Bild" : "Bild suchen";
      const remove = makeButton("×", "delete", "danger");
      remove.title = "Wort löschen";
      actions.append(speak, image, remove);
      actions.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "speak") speakGerman(card.term);
        if (action === "image") void findImage(card, Boolean(card.image));
        if (action === "delete") deleteCard(card);
      });
      item.append(visual, copy, actions);
      elements.cardList.append(item);
    }
  }

  function renderAll() {
    renderStats();
    updateModuleButton();
    renderCurrentCard();
    renderList();
  }

  function rebuildQueue({ resetSession = false } = {}) {
    if (resetSession) reviewedInSession.clear();
    reviewQueue = filteredCards()
      .filter((card) => !reviewedInSession.has(card.id))
      .sort((a, b) => Date.parse(a.dueAt || 0) - Date.parse(b.dueAt || 0));
    revealed = false;
    renderAll();
  }

  function flipCard() {
    if (!currentCard()) return;
    revealed = !revealed;
    renderCurrentCard();
  }

  function rateCard(rating) {
    const card = currentCard();
    if (!card || !revealed) return;
    const wasDue = isDue(card);
    const updated = scheduleCard(card, rating);
    const index = state.cards.findIndex((item) => item.id === card.id);
    state.cards[index] = updated;
    state.reviewDates[dateKey()] = true;
    reviewedInSession.add(card.id);
    saveState();
    onCardReviewed(card, wasDue);
    rebuildQueue();
  }

  async function fetchImageResults(card) {
    const query = card.imageQuery || normalizeTermForImage(card.term);
    const key = query.toLocaleLowerCase("de");
    if (imageResults.has(key)) return imageResults.get(key);
    const response = await fetch(buildCommonsImageUrl(query));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Die Bildsuche ist fehlgeschlagen.");
    const results = parseCommonsImages(data).map(safeImage).filter(Boolean);
    imageResults.set(key, results);
    return results;
  }

  async function findImage(card, advance = false, quiet = false) {
    imageLoading.add(card.id);
    if (!quiet) renderAll();
    try {
      const results = await fetchImageResults(card);
      if (!results.length) throw new Error("Kein passendes Bild gefunden. Verwende eine einfachere Beschreibung im Feld für die Bildsuche.");
      const currentIndex = card.image ? results.findIndex((image) => image.url === card.image.url) : -1;
      const nextIndex = advance && currentIndex >= 0 ? (currentIndex + 1) % results.length : 0;
      const index = state.cards.findIndex((item) => item.id === card.id);
      if (index >= 0) state.cards[index] = { ...state.cards[index], image: results[nextIndex] };
      saveState();
      elements.inputStatus.textContent = `Bild für ${card.term} gefunden.`;
    } catch (error) {
      elements.inputStatus.textContent = error.message;
    } finally {
      imageLoading.delete(card.id);
      renderAll();
    }
  }

  function removeImage(card) {
    const index = state.cards.findIndex((item) => item.id === card.id);
    if (index < 0) return;
    state.cards[index] = { ...state.cards[index], image: null };
    saveState();
    renderAll();
  }

  function deleteCard(card) {
    if (!window.confirm(`„${card.term}“ aus den Karten löschen?`)) return;
    state.cards = state.cards.filter((item) => item.id !== card.id);
    reviewedInSession.delete(card.id);
    saveState();
    rebuildQueue();
  }

  async function addCurrentModuleCards({ automatic = false } = {}) {
    const module = moduleLookup.get(currentModuleId)?.module;
    if (!module) return;
    const incoming = createModuleCards(module);
    const existingIds = new Set(state.cards.map((card) => card.id));
    const added = incoming.filter((card) => !existingIds.has(card.id));
    state.cards = mergeCards(state.cards, incoming);
    saveState();
    rebuildQueue({ resetSession: true });
    elements.inputStatus.textContent = added.length
      ? `${added.length} Wörter aus ${module.title} hinzugefügt.`
      : "Die Modulwörter sind bereits vorhanden und werden nicht doppelt angelegt.";
    if (elements.autoImage.checked) {
      const targets = (added.length ? added : deckCards().filter((card) => !card.image)).slice(0, 8);
      if (targets.length) {
        elements.addModuleWords.disabled = true;
        elements.addModuleWords.textContent = "Bilder werden gesucht …";
        await Promise.allSettled(targets.map((card) => findImage(card, false, true)));
        elements.addModuleWords.disabled = false;
        updateModuleButton();
      }
    }
    if (!automatic) elements.stage.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function createCustomCards() {
    const parsed = parseVocabularyInput(elements.input.value);
    if (!parsed.length) {
      elements.inputStatus.textContent = "Gib mindestens Wort | deutsche Erklärung ein, ein Wort pro Zeile.";
      return;
    }
    const module = moduleLookup.get(currentModuleId)?.module;
    const now = new Date().toISOString();
    const affected = [];
    for (const entry of parsed) {
      const existing = state.cards.find((card) => card.moduleId === currentModuleId && card.term.toLocaleLowerCase("de") === entry.term.toLocaleLowerCase("de"));
      if (existing) {
        Object.assign(existing, {
          meaning: entry.meaning,
          example: entry.example || existing.example,
          imageQuery: entry.imageQuery || existing.imageQuery || normalizeTermForImage(entry.term),
        });
        affected.push(existing);
      } else {
        const card = {
          id: `custom-${randomId()}`,
          ...entry,
          imageQuery: entry.imageQuery || normalizeTermForImage(entry.term),
          moduleId: currentModuleId,
          moduleTitle: module?.title || "Meine Wörter",
          source: "custom",
          createdAt: now,
          dueAt: now,
          intervalDays: 0,
          ease: 2.5,
          repetitions: 0,
          lapses: 0,
          reviews: 0,
          image: null,
        };
        state.cards.push(card);
        affected.push(card);
      }
    }
    saveState();
    elements.input.value = "";
    elements.inputStatus.textContent = `${affected.length} Karten vorbereitet.`;
    rebuildQueue({ resetSession: true });
    if (elements.autoImage.checked) {
      elements.createCards.disabled = true;
      elements.createCards.textContent = "Bilder werden gesucht …";
      await Promise.allSettled(affected.slice(0, 12).map((card) => findImage(card, false, true)));
      elements.createCards.disabled = false;
      elements.createCards.textContent = "Karten erstellen";
    }
  }

  function populateModuleSelect() {
    elements.moduleSelect.replaceChildren();
    for (const chapter of chapters) {
      const group = document.createElement("optgroup");
      group.label = `Kapitel ${chapter.number}: ${chapter.title}`;
      for (const module of chapter.modules) {
        const option = document.createElement("option");
        option.value = module.id;
        option.textContent = `${module.kind}: ${module.title}`;
        group.append(option);
      }
      elements.moduleSelect.append(group);
    }
    elements.moduleSelect.value = currentModuleId;
  }

  function setModule(moduleId) {
    if (!moduleLookup.has(moduleId)) return;
    currentModuleId = moduleId;
    elements.moduleSelect.value = moduleId;
    rebuildQueue({ resetSession: true });
  }

  async function showVocabulary() {
    isVocabularyView = true;
    elements.lessonWorkspace.classList.add("workspace-hidden");
    elements.vocabularyWorkspace.classList.remove("workspace-hidden");
    elements.lessonViewButton.classList.remove("active");
    elements.vocabViewButton.classList.add("active");
    if (!deckCards().length) await addCurrentModuleCards({ automatic: true });
    else renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showLesson() {
    isVocabularyView = false;
    elements.vocabularyWorkspace.classList.add("workspace-hidden");
    elements.lessonWorkspace.classList.remove("workspace-hidden");
    elements.vocabViewButton.classList.remove("active");
    elements.lessonViewButton.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function shareCoachPrompt() {
    const cards = deckCards();
    const due = cards.filter((card) => isDue(card));
    const selected = (due.length ? due : cards).slice(0, 15);
    if (!selected.length) {
      elements.inputStatus.textContent = "Füge zuerst die Modulwörter hinzu und teile anschließend das Sprechtraining.";
      return;
    }
    const title = moduleLookup.get(currentModuleId)?.module.title || "Deutscher Wortschatz";
    const original = elements.sharePrompt.textContent;
    try {
      const result = await shareText(`Worttraining: ${title}`, buildVocabularyCoachPrompt(selected, title));
      elements.sharePrompt.textContent = result === "shared" ? "Geteilt ✓" : "Kopiert und ChatGPT geöffnet ✓";
    } catch (error) {
      if (error?.name !== "AbortError") elements.inputStatus.textContent = "Teilen fehlgeschlagen. Kopiere stattdessen den Modulprompt im Unterrichtsbereich.";
    }
    setTimeout(() => { elements.sharePrompt.textContent = original; }, 1800);
  }

  function exportState() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `DeutschMeister-Wortschatz-${dateKey()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importState(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const cards = Array.isArray(parsed.cards) ? parsed.cards.map(validImportedCard).filter(Boolean) : [];
      if (!cards.length) throw new Error("Die Sicherungsdatei enthält keine gültigen Karten.");
      state.cards = mergeCards(state.cards, cards);
      state.reviewDates = { ...state.reviewDates, ...(parsed.reviewDates || {}) };
      saveState();
      elements.inputStatus.textContent = `${cards.length} Karten erfolgreich importiert.`;
      rebuildQueue({ resetSession: true });
    } catch (error) {
      elements.inputStatus.textContent = error.message || "Die Wortschatzdatei konnte nicht gelesen werden.";
    } finally {
      elements.importInput.value = "";
    }
  }

  elements.lessonViewButton.addEventListener("click", showLesson);
  elements.vocabViewButton.addEventListener("click", () => void showVocabulary());
  elements.moduleSelect.addEventListener("change", () => setModule(elements.moduleSelect.value));
  elements.addModuleWords.addEventListener("click", () => void addCurrentModuleCards());
  elements.createCards.addEventListener("click", () => void createCustomCards());
  elements.sharePrompt.addEventListener("click", () => void shareCoachPrompt());
  elements.exportButton.addEventListener("click", exportState);
  elements.importInput.addEventListener("change", () => void importState(elements.importInput.files[0]));
  elements.filters.addEventListener("click", (event) => {
    const filter = event.target.closest("[data-filter]")?.dataset.filter;
    if (!filter) return;
    reviewFilter = filter;
    elements.filters.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("active", button.dataset.filter === filter));
    rebuildQueue({ resetSession: true });
  });
  elements.ratingButtons.addEventListener("click", (event) => {
    const rating = event.target.closest("[data-rating]")?.dataset.rating;
    if (rating) rateCard(rating);
  });
  document.addEventListener("keydown", (event) => {
    if (!isVocabularyView || event.target.matches("input,textarea,select")) return;
    if (event.code === "Space") {
      event.preventDefault();
      flipCard();
      return;
    }
    const ratings = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
    if (ratings[event.key]) rateCard(ratings[event.key]);
  });

  populateModuleSelect();
  rebuildQueue({ resetSession: true });

  return {
    setActiveModule(moduleId) {
      setModule(moduleId);
    },
    refresh() {
      renderAll();
    },
  };
}
