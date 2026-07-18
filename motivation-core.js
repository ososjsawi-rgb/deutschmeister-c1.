export const DAILY_GOAL = 10;
export const STUDY_REWARD_SECONDS = 5 * 60;
export const STUDY_DAY_SECONDS = 10 * 60;

export const LEVELS = [
  { level: 1, name: "Starter", xp: 0 },
  { level: 2, name: "Wortfinder", xp: 150 },
  { level: 3, name: "Satzbauer", xp: 400 },
  { level: 4, name: "Sprachentdecker", xp: 800 },
  { level: 5, name: "C1-Aufsteiger", xp: 1400 },
  { level: 6, name: "Sprachprofi", xp: 2200 },
  { level: 7, name: "DeutschMeister", xp: 3200 },
];

export const ACHIEVEMENTS = [
  { id: "first_xp", icon: "✦", title: "Erster Schritt", description: "Die ersten Punkte gesammelt", test: (state) => state.xp > 0 },
  { id: "cards_25", icon: "▤", title: "Wortstarter", description: "25 fällige Wörter wiederholt", test: (state) => state.stats.cardsReviewed >= 25 },
  { id: "cards_100", icon: "◆", title: "Wortjäger", description: "100 fällige Wörter wiederholt", test: (state) => state.stats.cardsReviewed >= 100 },
  { id: "goal_3", icon: "⚡", title: "Im Rhythmus", description: "Drei Tagesziele erreicht", test: (state) => Object.keys(state.completedDays).length >= 3 },
  { id: "streak_7", icon: "♨", title: "Sieben-Tage-Serie", description: "Sieben Lerntage in Folge erreicht", test: (state) => calculateStreak(getActivityDays(state)) >= 7 },
  { id: "study_60", icon: "◷", title: "Fokusstunde", description: "60 Minuten konzentriert gelernt", test: (state) => state.study.totalSeconds >= 60 * 60 },
  { id: "first_module", icon: "✓", title: "Modul geschafft", description: "Das erste Modul abgeschlossen", test: (state) => state.stats.modulesCompleted >= 1 },
  { id: "modules_5", icon: "⬡", title: "Kapitelkurs", description: "Fünf Module abgeschlossen", test: (state) => state.stats.modulesCompleted >= 5 },
  { id: "xp_1000", icon: "★", title: "Punktesammler", description: "1.000 XP erreicht", test: (state) => state.xp >= 1000 },
];

export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function createInitialMotivationState() {
  return {
    version: 2,
    xp: 0,
    events: {},
    dailyUnits: {},
    completedDays: {},
    unlocked: {},
    stats: {
      cardsReviewed: 0,
      homeworkCompleted: 0,
      modulesCompleted: 0,
      studyBlocks: 0,
    },
    study: {
      totalSeconds: 0,
      dailySeconds: {},
      sessions: [],
      active: null,
    },
    settings: {
      sound: true,
      reminderEnabled: false,
      reminderTime: "19:00",
      lastNotifiedDate: "",
    },
  };
}

export function normalizeMotivationState(input) {
  const initial = createInitialMotivationState();
  const source = input && typeof input === "object" ? input : {};
  const studySource = source.study && typeof source.study === "object" ? source.study : {};
  const dailySeconds = {};
  for (const [key, seconds] of Object.entries(studySource.dailySeconds && typeof studySource.dailySeconds === "object" ? studySource.dailySeconds : {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) dailySeconds[key] = Math.max(0, Math.round(Number(seconds) || 0));
  }
  const recordedSeconds = Object.values(dailySeconds).reduce((sum, seconds) => sum + seconds, 0);
  const activeSource = studySource.active && typeof studySource.active === "object" ? studySource.active : null;
  const active = activeSource ? {
    id: String(activeSource.id || "session-restored"),
    startedAt: String(activeSource.startedAt || new Date().toISOString()),
    lastRecordedAt: String(activeSource.lastRecordedAt || activeSource.startedAt || new Date().toISOString()),
    accumulatedSeconds: Math.max(0, Math.round(Number(activeSource.accumulatedSeconds) || 0)),
    running: Boolean(activeSource.running),
    moduleId: String(activeSource.moduleId || ""),
    moduleTitle: String(activeSource.moduleTitle || "Freies Lernen"),
  } : null;
  return {
    ...initial,
    ...source,
    xp: Math.max(0, Number(source.xp) || 0),
    events: source.events && typeof source.events === "object" ? source.events : {},
    dailyUnits: source.dailyUnits && typeof source.dailyUnits === "object" ? source.dailyUnits : {},
    completedDays: source.completedDays && typeof source.completedDays === "object" ? source.completedDays : {},
    unlocked: source.unlocked && typeof source.unlocked === "object" ? source.unlocked : {},
    stats: {
      ...initial.stats,
      ...(source.stats && typeof source.stats === "object" ? source.stats : {}),
    },
    study: {
      ...initial.study,
      ...studySource,
      totalSeconds: Math.max(recordedSeconds, Math.max(0, Math.round(Number(studySource.totalSeconds) || 0))),
      dailySeconds,
      sessions: Array.isArray(studySource.sessions) ? studySource.sessions.filter(Boolean).slice(-365) : [],
      active,
    },
    settings: {
      ...initial.settings,
      ...(source.settings && typeof source.settings === "object" ? source.settings : {}),
    },
  };
}

export function splitStudyDuration(startInput, endInput) {
  const start = new Date(startInput);
  const end = new Date(endInput);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return {};
  const result = {};
  let cursor = new Date(start);
  while (cursor < end) {
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const boundary = nextDay < end ? nextDay : end;
    const seconds = Math.max(0, Math.floor((boundary - cursor) / 1000));
    const key = dateKey(cursor);
    result[key] = (result[key] || 0) + seconds;
    cursor = boundary;
  }
  return result;
}

export function getActivityDays(stateInput) {
  const state = normalizeMotivationState(stateInput);
  const days = { ...state.completedDays };
  for (const [key, seconds] of Object.entries(state.study.dailySeconds)) {
    if ((Number(seconds) || 0) >= STUDY_DAY_SECONDS) days[key] = true;
  }
  return days;
}

export function calculateBestStreak(daysInput) {
  const keys = Object.keys(daysInput && typeof daysInput === "object" ? daysInput : {})
    .filter((key) => daysInput[key] && /^\d{4}-\d{2}-\d{2}$/.test(key))
    .sort();
  let best = 0;
  let current = 0;
  let previous = null;
  for (const key of keys) {
    const date = new Date(key + "T12:00:00");
    if (previous) {
      const expected = new Date(previous);
      expected.setDate(expected.getDate() + 1);
      current = dateKey(expected) === key ? current + 1 : 1;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    previous = date;
  }
  return best;
}

export function getStudySummary(stateInput, now = new Date()) {
  const state = normalizeMotivationState(stateInput);
  const today = dateKey(now);
  let last7Seconds = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  for (let index = 0; index < 7; index += 1) {
    last7Seconds += Math.max(0, Number(state.study.dailySeconds[dateKey(cursor)]) || 0);
    cursor.setDate(cursor.getDate() - 1);
  }
  const activityDays = getActivityDays(state);
  return {
    todaySeconds: Math.max(0, Number(state.study.dailySeconds[today]) || 0),
    last7Seconds,
    totalSeconds: state.study.totalSeconds,
    sessions: state.study.sessions.length,
    currentStreak: calculateStreak(activityDays, now),
    bestStreak: calculateBestStreak(activityDays),
    activityDays,
  };
}

export function getLevelProgress(xp) {
  const points = Math.max(0, Number(xp) || 0);
  let current = LEVELS[0];
  let next = null;
  for (let index = 0; index < LEVELS.length; index += 1) {
    if (points >= LEVELS[index].xp) current = LEVELS[index];
    else {
      next = LEVELS[index];
      break;
    }
  }
  const start = current.xp;
  const end = next?.xp ?? current.xp;
  const percent = next ? Math.min(100, Math.round(((points - start) / (end - start)) * 100)) : 100;
  return { current, next, percent, remaining: next ? next.xp - points : 0 };
}

export function calculateStreak(completedDays, now = new Date()) {
  const days = completedDays && typeof completedDays === "object" ? completedDays : {};
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!days[dateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days[dateKey(cursor)]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function unlockAchievements(state, now) {
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (state.unlocked[achievement.id] || !achievement.test(state)) continue;
    state.unlocked[achievement.id] = now.toISOString();
    unlocked.push(achievement);
  }
  return unlocked;
}

export function awardMotivationEvent(stateInput, event, now = new Date()) {
  const state = normalizeMotivationState(stateInput);
  const id = String(event?.id || "").trim();
  if (!id || state.events[id]) return { state, awarded: false, xpAwarded: 0, dailyBonus: 0, unlocked: [], leveledUp: false };

  const beforeLevel = getLevelProgress(state.xp).current.level;
  const xp = Math.max(0, Math.round(Number(event.xp) || 0));
  const units = Math.max(0, Math.round(Number(event.units) || 0));
  const requestedDay = String(event?.day || "");
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : dateKey(now);
  state.events[id] = {
    xp,
    at: now.toISOString(),
    label: String(event.label || "Lernaktivität").slice(0, 120),
  };
  state.xp += xp;
  state.dailyUnits[today] = Math.max(0, Number(state.dailyUnits[today]) || 0) + units;

  if (event.kind === "card") state.stats.cardsReviewed += 1;
  if (event.kind === "homework") state.stats.homeworkCompleted += 1;
  if (event.kind === "module") state.stats.modulesCompleted += 1;
  if (event.kind === "study") state.stats.studyBlocks += 1;

  let dailyBonus = 0;
  if (state.dailyUnits[today] >= DAILY_GOAL && !state.completedDays[today]) {
    state.completedDays[today] = true;
    dailyBonus = 25;
    state.xp += dailyBonus;
    state.events["daily-goal:" + today] = {
      xp: dailyBonus,
      at: now.toISOString(),
      label: "Tagesziel erreicht",
    };
  }

  const unlocked = unlockAchievements(state, now);
  const afterLevel = getLevelProgress(state.xp).current.level;
  return {
    state,
    awarded: true,
    xpAwarded: xp,
    dailyBonus,
    unlocked,
    leveledUp: afterLevel > beforeLevel,
  };
}

function icsDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return String(date.getFullYear())
    + pad(date.getMonth() + 1)
    + pad(date.getDate())
    + "T"
    + pad(date.getHours())
    + pad(date.getMinutes())
    + "00";
}

export function buildDailyReminderIcs(time, now = new Date()) {
  const match = String(time || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const hours = Number(match?.[1] ?? 19);
  const minutes = Number(match?.[2] ?? 0);
  const start = new Date(now);
  start.setHours(hours, minutes, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 1);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DeutschMeister C1//Lernerinnerung//DE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:deutschmeister-daily-" + dateKey(now) + "@local",
    "DTSTAMP:" + stamp,
    "DTSTART:" + icsDate(start),
    "RRULE:FREQ=DAILY",
    "SUMMARY:DeutschMeister C1 – Tagesziel",
    "DESCRIPTION:Zeit für dein deutsches C1-Training. Erreiche heute dein Tagesziel.",
    "BEGIN:VALARM",
    "TRIGGER:PT0M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Dein DeutschMeister-Tagesziel wartet.",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
