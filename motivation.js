import {
  ACHIEVEMENTS,
  DAILY_GOAL,
  STUDY_REWARD_SECONDS,
  awardMotivationEvent,
  buildDailyReminderIcs,
  dateKey,
  getLevelProgress,
  getStudySummary,
  normalizeMotivationState,
  splitStudyDuration,
} from "./motivation-core.js?v=1.5.0";

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

function formatDuration(secondsInput, { clock = false } = {}) {
  const seconds = Math.max(0, Math.floor(Number(secondsInput) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (clock) return [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":");
  if (hours) return hours + " Std. " + minutes + " Min.";
  return Math.floor(seconds / 60) + " Min.";
}

export function initMotivation({ getStudyContext } = {}) {
  const elements = {
    level: $("#motivationLevel"),
    xp: $("#motivationXp"),
    progress: $("#motivationProgress"),
    next: $("#motivationNext"),
    daily: $("#motivationDaily"),
    dailyBar: $("#motivationDailyBar"),
    streak: $("#motivationStreak"),
    studyTimerDisplay: $("#studyTimerDisplay"),
    studyTimerToggle: $("#studyTimerToggle"),
    studyTimerStop: $("#studyTimerStop"),
    dashboard: $("#motivationDashboard"),
    sound: $("#motivationSound"),
    reminder: $("#motivationReminder"),
    reminderStatus: $("#motivationReminderStatus"),
    modal: $("#motivationModal"),
    close: $("#closeMotivationModal"),
    modalLevel: $("#motivationModalLevel"),
    modalXp: $("#motivationModalXp"),
    studyToday: $("#studyToday"),
    studyWeek: $("#studyWeek"),
    studyTotal: $("#studyTotal"),
    studySessions: $("#studySessions"),
    studyCurrentStreak: $("#studyCurrentStreak"),
    studyBestStreak: $("#studyBestStreak"),
    studyCalendar: $("#studyCalendar"),
    studyCalendarLabel: $("#studyCalendarLabel"),
    studyCalendarPrevious: $("#studyCalendarPrevious"),
    studyCalendarNext: $("#studyCalendarNext"),
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
  let studyTickCount = 0;
  const calendarCursor = new Date();
  calendarCursor.setDate(1);
  calendarCursor.setHours(12, 0, 0, 0);

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

  function activeStudySeconds(now = new Date()) {
    const active = state.study.active;
    if (!active) return 0;
    const stored = Math.max(0, Math.floor(Number(active.accumulatedSeconds) || 0));
    if (!active.running) return stored;
    const last = new Date(active.lastRecordedAt);
    const pending = Number.isFinite(last.getTime()) ? Math.max(0, Math.floor((now - last) / 1000)) : 0;
    return stored + pending;
  }

  function renderStudyClock() {
    const active = state.study.active;
    const running = Boolean(active?.running);
    elements.studyTimerDisplay.textContent = formatDuration(activeStudySeconds(), { clock: true });
    elements.studyTimerDisplay.classList.toggle("running", running);
    elements.studyTimerToggle.textContent = running ? "Ⅱ Pause" : active ? "▶ Weiter" : "▶ Start";
    elements.studyTimerToggle.setAttribute("aria-pressed", String(running));
    elements.studyTimerStop.disabled = !active;
  }

  function renderStudyCalendar() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const today = new Date();
    const summary = getStudySummary(state, today);
    const firstDay = new Date(year, month, 1, 12);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    elements.studyCalendarLabel.textContent = new Intl.DateTimeFormat("de-DE", {
      month: "long",
      year: "numeric",
    }).format(firstDay);
    elements.studyCalendar.replaceChildren();

    for (let index = 0; index < cells; index += 1) {
      const button = document.createElement("div");
      button.className = "study-calendar-day";
      const day = index - offset + 1;
      if (day < 1 || day > daysInMonth) {
        button.classList.add("outside");
        button.setAttribute("aria-hidden", "true");
        elements.studyCalendar.append(button);
        continue;
      }
      const date = new Date(year, month, day, 12);
      const key = dateKey(date);
      const seconds = Math.max(0, Number(state.study.dailySeconds[key]) || 0);
      const minutes = Math.floor(seconds / 60);
      const intensity = minutes >= 45 ? 4 : minutes >= 25 ? 3 : minutes >= 10 ? 2 : minutes > 0 ? 1 : 0;
      button.classList.add("intensity-" + intensity);
      if (summary.activityDays[key]) button.classList.add("active-day");
      if (key === dateKey(today)) button.classList.add("today");
      button.title = key + " · " + minutes + " Lernminuten";
      const number = document.createElement("span");
      number.textContent = String(day);
      const duration = document.createElement("small");
      duration.textContent = minutes ? minutes + "m" : "";
      button.append(number, duration);
      elements.studyCalendar.append(button);
    }

    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    elements.studyCalendarNext.disabled = calendarCursor >= currentMonth;
  }

  function renderStudySummary() {
    const summary = getStudySummary(state);
    elements.studyToday.textContent = formatDuration(summary.todaySeconds);
    elements.studyWeek.textContent = formatDuration(summary.last7Seconds);
    elements.studyTotal.textContent = formatDuration(summary.totalSeconds);
    elements.studySessions.textContent = summary.sessions.toLocaleString("de-DE");
    elements.studyCurrentStreak.textContent = summary.currentStreak + (summary.currentStreak === 1 ? " Tag" : " Tage");
    elements.studyBestStreak.textContent = summary.bestStreak + (summary.bestStreak === 1 ? " Tag" : " Tage");
    renderStudyCalendar();
  }

  function rewardStudyBlocks(beforeByDay, afterByDay) {
    let xp = 0;
    let dailyBonus = 0;
    let unlocked = false;
    for (const [day, afterSeconds] of Object.entries(afterByDay)) {
      const beforeSeconds = Math.max(0, Number(beforeByDay[day]) || 0);
      const firstBlock = Math.floor(beforeSeconds / STUDY_REWARD_SECONDS) + 1;
      const lastBlock = Math.floor(afterSeconds / STUDY_REWARD_SECONDS);
      for (let block = firstBlock; block <= lastBlock; block += 1) {
        const result = award({
          id: "study:" + day + ":" + block,
          day,
          xp: 5,
          units: 1,
          kind: "study",
          label: "5 Lernminuten",
        }, { silent: true });
        if (!result.awarded) continue;
        xp += result.xpAwarded;
        dailyBonus += result.dailyBonus;
        unlocked ||= result.unlocked.length > 0 || result.leveledUp;
      }
    }
    if (xp) {
      showToast("+" + xp + " XP · konzentrierte Lernzeit");
      playSound(unlocked ? "achievement" : "xp");
    }
    if (dailyBonus) setTimeout(() => showToast("+" + dailyBonus + " XP · Tagesziel erreicht", "goal"), 380);
  }

  function creditStudyInterval(start, end, { announce = true } = {}) {
    const allocation = splitStudyDuration(start, end);
    const beforeByDay = {};
    const afterByDay = {};
    let added = 0;
    for (const [day, secondsInput] of Object.entries(allocation)) {
      const seconds = Math.max(0, Math.floor(Number(secondsInput) || 0));
      if (!seconds) continue;
      const before = Math.max(0, Number(state.study.dailySeconds[day]) || 0);
      beforeByDay[day] = before;
      afterByDay[day] = before + seconds;
      state.study.dailySeconds[day] = before + seconds;
      added += seconds;
    }
    state.study.totalSeconds += added;
    if (announce) rewardStudyBlocks(beforeByDay, afterByDay);
    else {
      for (const [day, seconds] of Object.entries(afterByDay)) {
        const firstBlock = Math.floor((beforeByDay[day] || 0) / STUDY_REWARD_SECONDS) + 1;
        const lastBlock = Math.floor(seconds / STUDY_REWARD_SECONDS);
        for (let block = firstBlock; block <= lastBlock; block += 1) {
          award({ id: "study:" + day + ":" + block, day, xp: 5, units: 1, kind: "study", label: "5 Lernminuten" }, { silent: true });
        }
      }
    }
    return added;
  }

  function flushStudyTimer(now = new Date(), { announce = true, capSeconds = Infinity } = {}) {
    const active = state.study.active;
    if (!active?.running) return 0;
    let start = new Date(active.lastRecordedAt);
    if (!Number.isFinite(start.getTime()) || start > now) start = new Date(now);
    const available = Math.max(0, Math.floor((now - start) / 1000));
    const seconds = Math.min(available, Math.max(0, Math.floor(capSeconds)));
    if (!seconds) return 0;
    const end = new Date(start.getTime() + seconds * 1000);
    const added = creditStudyInterval(start, end, { announce });
    const currentActive = state.study.active;
    if (!currentActive) return added;
    currentActive.accumulatedSeconds = Math.max(0, Number(currentActive.accumulatedSeconds) || 0) + added;
    currentActive.lastRecordedAt = end.toISOString();
    save();
    return added;
  }

  function startStudyTimer({ automatic = false } = {}) {
    const now = new Date();
    if (!state.study.active) {
      const context = typeof getStudyContext === "function" ? getStudyContext() : {};
      state.study.active = {
        id: "session-" + now.getTime(),
        startedAt: now.toISOString(),
        lastRecordedAt: now.toISOString(),
        accumulatedSeconds: 0,
        running: true,
        moduleId: String(context?.moduleId || ""),
        moduleTitle: String(context?.moduleTitle || "Freies Lernen"),
      };
    } else if (!state.study.active.running) {
      state.study.active.running = true;
      state.study.active.lastRecordedAt = now.toISOString();
    }
    save();
    render();
    showToast(automatic ? "Lernzeituhr automatisch gestartet" : "Lernzeituhr gestartet", "goal");
    playSound("xp");
  }

  function pauseStudyTimer({ silent = false } = {}) {
    if (!state.study.active?.running) return;
    flushStudyTimer(new Date(), { announce: !silent });
    state.study.active.running = false;
    save();
    render();
    if (!silent) showToast("Lernzeituhr pausiert", "goal");
  }

  function stopStudyTimer() {
    if (!state.study.active) return;
    if (state.study.active.running) flushStudyTimer(new Date());
    const active = state.study.active;
    if (!active) return;
    const seconds = Math.max(0, Math.floor(Number(active.accumulatedSeconds) || 0));
    if (seconds > 0) {
      state.study.sessions.push({
        id: active.id,
        startedAt: active.startedAt,
        endedAt: new Date().toISOString(),
        seconds,
        moduleId: active.moduleId || "",
        moduleTitle: active.moduleTitle || "Freies Lernen",
      });
      state.study.sessions = state.study.sessions.slice(-365);
    }
    state.study.active = null;
    save();
    render();
    showToast("Lernsitzung gespeichert · " + formatDuration(seconds), "goal");
    playSound("achievement");
  }

  function recoverInterruptedTimer() {
    if (!state.study.active?.running) return;
    flushStudyTimer(new Date(), { announce: false, capSeconds: 60 });
    if (state.study.active) state.study.active.running = false;
    save();
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
    const study = getStudySummary(state);
    elements.level.textContent = "Stufe " + level.current.level + " · " + level.current.name;
    elements.xp.textContent = state.xp.toLocaleString("de-DE") + " XP";
    elements.progress.style.width = level.percent + "%";
    elements.next.textContent = level.next
      ? "Noch " + level.remaining.toLocaleString("de-DE") + " XP bis " + level.next.name
      : "Höchste Stufe erreicht";
    elements.daily.textContent = todayUnits + "/" + DAILY_GOAL;
    elements.dailyBar.style.width = Math.round((todayUnits / DAILY_GOAL) * 100) + "%";
    elements.streak.textContent = study.currentStreak + (study.currentStreak === 1 ? " Tag" : " Tage");
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
    renderStudyClock();
    renderStudySummary();
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
  elements.studyTimerToggle.addEventListener("click", () => {
    if (state.study.active?.running) pauseStudyTimer();
    else startStudyTimer();
  });
  elements.studyTimerStop.addEventListener("click", stopStudyTimer);
  elements.dashboard.addEventListener("click", openModal);
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
  elements.studyCalendarPrevious.addEventListener("click", () => {
    calendarCursor.setMonth(calendarCursor.getMonth() - 1);
    renderStudyCalendar();
  });
  elements.studyCalendarNext.addEventListener("click", () => {
    if (elements.studyCalendarNext.disabled) return;
    calendarCursor.setMonth(calendarCursor.getMonth() + 1);
    renderStudyCalendar();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkReminder();
      flushStudyTimer();
      render();
    } else {
      flushStudyTimer(new Date(), { announce: false });
    }
  });
  window.addEventListener("pagehide", () => pauseStudyTimer({ silent: true }));

  recoverInterruptedTimer();
  render();
  checkReminder();
  setInterval(checkReminder, 30_000);
  setInterval(() => {
    studyTickCount += 1;
    renderStudyClock();
    if (studyTickCount % 15 === 0) {
      flushStudyTimer(new Date(), { announce: document.visibilityState === "visible" });
      render();
    }
  }, 1000);

  return {
    recordCardReview,
    recordHomework,
    recordModule,
    syncProgress,
    ensureStudyTimer: () => {
      if (!state.study.active?.running) startStudyTimer({ automatic: true });
    },
    pauseStudyTimer,
    stopStudyTimer,
    getState: () => structuredClone(state),
    refresh: render,
  };
}
