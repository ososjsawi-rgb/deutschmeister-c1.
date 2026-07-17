import {
  ACHIEVEMENTS,
  DAILY_GOAL,
  awardMotivationEvent,
  buildDailyReminderIcs,
  calculateStreak,
  dateKey,
  getLevelProgress,
  normalizeMotivationState,
} from "./motivation-core.js";

const STORAGE_KEY = "deutschmeister-motivation-v1";
const $ = (selector) => document.querySelector(selector);

function loadState() {
  try {
    return normalizeMotivationState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return normalizeMotivationState({});
  }
}

function notificationPermissionLabel() {
  if (!("Notification" in window)) return "Browser-Benachrichtigungen werden nicht unterstützt.";
  if (Notification.permission === "granted") return "Benachrichtigungen sind erlaubt.";
  if (Notification.permission === "denied") return "Benachrichtigungen wurden im Browser blockiert.";
  return "Der Browser fragt beim Speichern nach deiner Erlaubnis.";
}

export function initMotivation() {
  const elements = {
    level: $("#motivationLevel"),
    xp: $("#motivationXp"),
    progress: $("#motivationProgress"),
    next: $("#motivationNext"),
    daily: $("#motivationDaily"),
    dailyBar: $("#motivationDailyBar"),
    streak: $("#motivationStreak"),
    sound: $("#motivationSound"),
    reminder: $("#motivationReminder"),
    reminderStatus: $("#motivationReminderStatus"),
    modal: $("#motivationModal"),
    close: $("#closeMotivationModal"),
    modalLevel: $("#motivationModalLevel"),
    modalXp: $("#motivationModalXp"),
    achievements: $("#achievementGrid"),
    reminderEnabled: $("#reminderEnabled"),
    reminderTime: $("#reminderTime"),
    permission: $("#reminderPermission"),
    saveReminder: $("#saveReminder"),
    downloadCalendar: $("#downloadReminderCalendar"),
    toastRegion: $("#motivationToasts"),
  };

  let state = loadState();
  let audioContext = null;

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function playTone(frequency, startsAt, duration, volume) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + duration + 0.02);
  }

  function playSound(kind = "xp") {
    if (!state.settings.sound) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") void audioContext.resume();
      const start = audioContext.currentTime + 0.01;
      playTone(kind === "achievement" ? 523 : 660, start, 0.16, 0.075);
      playTone(kind === "achievement" ? 659 : 880, start + 0.09, 0.18, 0.065);
      if (kind === "achievement") playTone(784, start + 0.18, 0.26, 0.06);
    } catch {
      // Audio feedback is optional and must never block learning.
    }
  }

  function showToast(text, kind = "xp") {
    if (!elements.toastRegion) return;
    const toast = document.createElement("div");
    toast.className = "motivation-toast " + kind;
    toast.textContent = text;
    elements.toastRegion.append(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 260);
    }, 2600);
  }

  function renderAchievements() {
    elements.achievements.replaceChildren();
    for (const achievement of ACHIEVEMENTS) {
      const unlocked = Boolean(state.unlocked[achievement.id]);
      const card = document.createElement("article");
      card.className = "achievement-card" + (unlocked ? " unlocked" : "");
      const icon = document.createElement("span");
      icon.textContent = unlocked ? achievement.icon : "○";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = achievement.title;
      const description = document.createElement("small");
      description.textContent = achievement.description;
      copy.append(title, description);
      card.append(icon, copy);
      elements.achievements.append(card);
    }
  }

  function render() {
    const level = getLevelProgress(state.xp);
    const todayUnits = Math.min(DAILY_GOAL, Number(state.dailyUnits[dateKey()]) || 0);
    const streak = calculateStreak(state.completedDays);
    elements.level.textContent = "Stufe " + level.current.level + " · " + level.current.name;
    elements.xp.textContent = state.xp.toLocaleString("de-DE") + " XP";
    elements.progress.style.width = level.percent + "%";
    elements.next.textContent = level.next
      ? "Noch " + level.remaining.toLocaleString("de-DE") + " XP bis " + level.next.name
      : "Höchste Stufe erreicht";
    elements.daily.textContent = todayUnits + "/" + DAILY_GOAL;
    elements.dailyBar.style.width = Math.round((todayUnits / DAILY_GOAL) * 100) + "%";
    elements.streak.textContent = streak + (streak === 1 ? " Tag" : " Tage");
    elements.sound.textContent = state.settings.sound ? "🔊 Töne an" : "🔇 Töne aus";
    elements.sound.setAttribute("aria-pressed", String(state.settings.sound));
    elements.reminderStatus.textContent = state.settings.reminderEnabled
      ? "Täglich " + state.settings.reminderTime
      : "Aus";
    elements.modalLevel.textContent = "Stufe " + level.current.level + " · " + level.current.name;
    elements.modalXp.textContent = state.xp.toLocaleString("de-DE") + " XP";
    elements.reminderEnabled.checked = Boolean(state.settings.reminderEnabled);
    elements.reminderTime.value = state.settings.reminderTime;
    elements.permission.textContent = notificationPermissionLabel();
    renderAchievements();
  }

  function award(event, { silent = false } = {}) {
    const result = awardMotivationEvent(state, event);
    state = result.state;
    if (!result.awarded) return result;
    save();
    render();
    if (!silent) {
      showToast("+" + result.xpAwarded + " XP · " + event.label);
      playSound("xp");
      if (result.dailyBonus) {
        setTimeout(() => showToast("+25 XP · Tagesziel erreicht", "goal"), 380);
        setTimeout(() => playSound("achievement"), 360);
      }
      if (result.leveledUp) {
        setTimeout(() => showToast("Neue Stufe erreicht!", "achievement"), 760);
        setTimeout(() => playSound("achievement"), 720);
      }
      if (result.unlocked.length) {
        setTimeout(() => showToast("Abzeichen: " + result.unlocked[0].title, "achievement"), 1120);
        setTimeout(() => playSound("achievement"), 1080);
      }
    }
    return result;
  }

  function recordCardReview(cardId, wasDue = true) {
    if (!wasDue) return;
    award({
      id: "card:" + cardId + ":" + dateKey(),
      xp: 5,
      units: 1,
      kind: "card",
      label: "Wort wiederholt",
    });
  }

  function recordHomework(moduleId, index, label = "Hausaufgabe erledigt", options) {
    return award({
      id: "homework:" + moduleId + ":" + index,
      xp: 25,
      units: options?.silent ? 0 : 5,
      kind: "homework",
      label,
    }, options);
  }

  function recordModule(moduleId, title = "Modul abgeschlossen", options) {
    return award({
      id: "module:" + moduleId,
      xp: 120,
      units: options?.silent ? 0 : DAILY_GOAL,
      kind: "module",
      label: title,
    }, options);
  }

  function syncProgress(progress, chapters) {
    for (const chapter of chapters) {
      for (const module of chapter.modules) {
        const saved = progress[module.id] || {};
        if (saved.done) recordModule(module.id, "Bereits abgeschlossenes Modul", { silent: true });
        const homework = Array.isArray(saved.homework) ? saved.homework : [];
        homework.forEach((done, index) => {
          if (done) recordHomework(module.id, index, "Bereits erledigte Hausaufgabe", { silent: true });
        });
      }
    }
  }

  function openModal() {
    render();
    elements.modal.classList.remove("hidden");
  }

  function closeModal() {
    elements.modal.classList.add("hidden");
  }

  async function saveReminderSettings() {
    let enabled = elements.reminderEnabled.checked;
    if (enabled && "Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      enabled = permission === "granted";
      elements.reminderEnabled.checked = enabled;
    } else if (enabled && (!("Notification" in window) || Notification.permission === "denied")) {
      enabled = false;
      elements.reminderEnabled.checked = false;
    }
    state.settings.reminderEnabled = enabled;
    state.settings.reminderTime = elements.reminderTime.value || "19:00";
    save();
    render();
    showToast(enabled ? "Lernerinnerung gespeichert" : "Browser-Erinnerung ausgeschaltet", "goal");
    checkReminder();
  }

  function checkReminder() {
    if (!state.settings.reminderEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
    const today = dateKey();
    if (state.settings.lastNotifiedDate === today || state.completedDays[today]) return;
    const [hours, minutes] = state.settings.reminderTime.split(":").map(Number);
    const now = new Date();
    const due = new Date(now);
    due.setHours(hours, minutes, 0, 0);
    if (now < due) return;
    const remaining = Math.max(0, DAILY_GOAL - (Number(state.dailyUnits[today]) || 0));
    const notification = new Notification("DeutschMeister C1", {
      body: remaining
        ? "Dein Tagesziel wartet: Noch " + remaining + " Lernaktionen."
        : "Zeit für eine kurze C1-Wiederholung.",
      tag: "deutschmeister-daily",
    });
    notification.onclick = () => window.focus();
    state.settings.lastNotifiedDate = today;
    save();
  }

  function downloadCalendarReminder() {
    const content = buildDailyReminderIcs(elements.reminderTime.value || state.settings.reminderTime);
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "DeutschMeister-Taegliche-Erinnerung.ics";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Kalender-Erinnerung erstellt", "goal");
  }

  elements.sound.addEventListener("click", () => {
    state.settings.sound = !state.settings.sound;
    save();
    render();
    if (state.settings.sound) playSound("xp");
  });
  elements.reminder.addEventListener("click", openModal);
  elements.close.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.modal.classList.contains("hidden")) closeModal();
  });
  elements.saveReminder.addEventListener("click", () => void saveReminderSettings());
  elements.downloadCalendar.addEventListener("click", downloadCalendarReminder);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkReminder();
  });

  render();
  checkReminder();
  setInterval(checkReminder, 30_000);

  return {
    recordCardReview,
    recordHomework,
    recordModule,
    syncProgress,
    getState: () => structuredClone(state),
    refresh: render,
  };
}
