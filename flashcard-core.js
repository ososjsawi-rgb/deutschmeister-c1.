const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeTermForImage(term) {
  const cleaned = String(term || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:jmdn?|jdm|jmdm|etw)\.?\b/gi, " ")
    .replace(/^(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer)\s+/i, "")
    .replace(/[|/↔]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nouns = cleaned.match(/\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}\b/g);
  return (nouns?.[0] || cleaned).slice(0, 80);
}

export function parseVocabularyInput(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.includes("|") ? line.split("|") : line.split("\t");
      const [term = "", meaning = "", example = "", imageQuery = ""] = parts.map((part) => part.trim());
      return { term, meaning, example, imageQuery };
    })
    .filter((entry) => entry.term && entry.meaning);
}

export function createModuleCards(module, now = new Date()) {
  return module.study.vocabulary.map(([term, meaning], index) => ({
    id: `aspekte-${module.id}-${index}`,
    term,
    meaning,
    example: "",
    imageQuery: normalizeTermForImage(term),
    moduleId: module.id,
    moduleTitle: module.title,
    source: "aspekte",
    createdAt: now.toISOString(),
    dueAt: now.toISOString(),
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
    reviews: 0,
    image: null,
  }));
}

export function mergeCards(existingCards, incomingCards) {
  const byId = new Map(existingCards.map((card) => [card.id, card]));
  for (const incoming of incomingCards) {
    const existing = byId.get(incoming.id);
    byId.set(incoming.id, existing ? {
      ...incoming,
      ...existing,
      meaning: incoming.meaning || existing.meaning,
      example: incoming.example || existing.example,
      imageQuery: incoming.imageQuery || existing.imageQuery,
    } : incoming);
  }
  return [...byId.values()];
}

export function scheduleCard(card, rating, now = new Date()) {
  const next = { ...card };
  const previousInterval = Math.max(Number(card.intervalDays) || 0, 0);
  let dueMs;

  if (rating === "again") {
    next.repetitions = 0;
    next.intervalDays = 0;
    next.ease = Math.max(1.3, (Number(card.ease) || 2.5) - 0.2);
    next.lapses = (Number(card.lapses) || 0) + 1;
    dueMs = now.getTime() + 10 * 60 * 1000;
  } else if (rating === "hard") {
    next.repetitions = (Number(card.repetitions) || 0) + 1;
    next.intervalDays = Math.max(1, Math.round(previousInterval * 1.2) || 1);
    next.ease = Math.max(1.3, (Number(card.ease) || 2.5) - 0.15);
    dueMs = now.getTime() + next.intervalDays * DAY_MS;
  } else if (rating === "easy") {
    next.repetitions = (Number(card.repetitions) || 0) + 1;
    next.ease = Math.min(3.2, (Number(card.ease) || 2.5) + 0.15);
    next.intervalDays = previousInterval === 0 ? 4 : Math.max(4, Math.round(previousInterval * (next.ease + 0.3)));
    dueMs = now.getTime() + next.intervalDays * DAY_MS;
  } else {
    next.repetitions = (Number(card.repetitions) || 0) + 1;
    next.intervalDays = previousInterval === 0
      ? (next.repetitions === 1 ? 1 : 3)
      : Math.max(2, Math.round(previousInterval * (Number(card.ease) || 2.5)));
    dueMs = now.getTime() + next.intervalDays * DAY_MS;
  }

  next.reviews = (Number(card.reviews) || 0) + 1;
  next.lastReviewedAt = now.toISOString();
  next.dueAt = new Date(dueMs).toISOString();
  return next;
}

export function isDue(card, now = new Date()) {
  const due = Date.parse(card.dueAt || card.createdAt || 0);
  return !Number.isFinite(due) || due <= now.getTime();
}

export function isMastered(card) {
  return Number(card.repetitions) >= 3 && Number(card.intervalDays) >= 14;
}

export function nextReviewLabel(card, now = new Date()) {
  if (isDue(card, now)) return "Jetzt fällig";
  const difference = Date.parse(card.dueAt) - now.getTime();
  const hours = Math.ceil(difference / (60 * 60 * 1000));
  if (hours < 24) return `in ${hours} Std.`;
  return `in ${Math.ceil(hours / 24)} Tagen`;
}

export function buildVocabularyCoachPrompt(cards, deckTitle = "Deutscher Wortschatz") {
  const selected = cards.slice(0, 15);
  const wordList = selected.map((card, index) => `${index + 1}. ${card.term} — ${card.meaning}${card.example ? ` — Beispiel: ${card.example}` : ""}`).join("\n");
  return `
Du bist mein persönlicher deutscher Wortschatztrainer auf C1-Niveau. Wir üben heute: ${deckTitle}.

ZIELWÖRTER
${wordList}

Führe die Übung vollständig und selbstständig ausschließlich auf Deutsch. Teste immer nur EIN Wort und warte auf meine gesprochene Antwort. Zeige die deutsche Erklärung nicht, bevor ich antworte.

Für jedes Wort:
1. Gib eine kurze deutsche Definition, ein Synonym oder einen natürlichen Kontext.
2. Lass mich die Bedeutung erklären und einen eigenen deutschen Satz bilden.
3. Reagiere kurz auf den Inhalt, korrigiere nur wichtige Fehler und gib eine natürliche C1-Variante.
4. Prüfe das Wort später noch einmal in einem anderen Kontext, wenn ich unsicher war.

Mische die Reihenfolge. Führe intern eine Fehlerliste. Am Ende gib mir: sicher beherrschte Wörter, unsichere Wörter, meine wichtigsten Fehler und fünf kurze Wiederholungssätze. Beginne jetzt direkt mit dem ersten Wort und nur einer Frage.
`.trim();
}
