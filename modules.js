import { getModuleStudyProfile } from "./study-data.js";

export const chapters = [
  {
    number: 1,
    title: "Alltägliches",
    start: 8,
    modules: [
      ["Auftakt", "Kurze Geschichten", 8, 9, "Über kurze Geschichten sprechen"],
      ["Modul 1", "Zeitgefühl", 10, 11, "Zeitempfinden zusammenfassen; Konnektoren"],
      ["Modul 2", "Vereine heute", 12, 13, "Engagement verstehen und überzeugen"],
      ["Modul 3", "Zuletzt online …", 14, 15, "Handynutzung; trennbare und untrennbare Verben"],
      ["Modul 4", "Unser Zuhause", 16, 19, "WG-Probleme lösen und Beschwerdebrief schreiben"],
      ["Rückschau", "Grammatik", 21, 21, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 2,
    title: "Hast du Worte?",
    start: 24,
    modules: [
      ["Auftakt", "Witze und Cartoons", 24, 25, "Über Humor sprechen"],
      ["Modul 1", "Immer erreichbar", 26, 27, "Medien; Möglichkeiten der Redewiedergabe"],
      ["Modul 2", "Gib Contra!", 28, 29, "Schlagfertigkeit verstehen und trainieren"],
      ["Modul 3", "Sprachen lernen", 30, 31, "Fachtext kommentieren; Nominal- und Verbalstil"],
      ["Modul 4", "Sag mal was!", 32, 35, "Dialekte verstehen, diskutieren und Leserbrief schreiben"],
      ["Rückschau", "Grammatik", 37, 37, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 3,
    title: "An die Arbeit!",
    start: 40,
    modules: [
      ["Auftakt", "Berufe", 40, 41, "Qualifikationen für Berufe"],
      ["Modul 1", "Ein bunter Lebenslauf", 42, 43, "Bewerbung; Subjekt- und Objektsätze"],
      ["Modul 2", "Probieren geht über Studieren?", 44, 45, "Studium, Ausbildung und Beratung"],
      ["Modul 3", "Multitasking", 46, 47, "Artikel zusammenfassen; weiterführende Nebensätze"],
      ["Modul 4", "Soft Skills", 48, 51, "Aktiv zuhören, Vorträge halten und Schreibplan nutzen"],
      ["Rückschau", "Grammatik", 53, 53, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 4,
    title: "Wirtschaftsgipfel",
    start: 56,
    modules: [
      ["Auftakt", "Wirtschaft", 56, 57, "Wirtschaftswortschatz klären"],
      ["Modul 1", "Vom Kohlenpott …", 58, 59, "Vortrag halten; Temporalsätze umformen"],
      ["Modul 2", "Mit gutem Gewissen?", 60, 61, "Gewissensfragen diskutieren"],
      ["Modul 3", "Die Welt ist ein Dorf", 62, 63, "Globalisierung; Kausal- und Modalsätze umformen"],
      ["Modul 4", "Wer soll das bezahlen?", 64, 67, "Crowdfunding, Projektidee und Bankgespräch"],
      ["Rückschau", "Grammatik", 69, 69, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 5,
    title: "Ziele",
    start: 72,
    modules: [
      ["Auftakt", "Ziele formulieren", 72, 73, "Ziele in einem Blogeintrag"],
      ["Modul 1", "Vernetzt", 74, 75, "Soziale Netzwerke; negative Konsekutivsätze"],
      ["Modul 2", "Der Weg ist das Ziel", 76, 77, "Berufliche Ziele verstehen"],
      ["Modul 3", "Ab morgen!", 78, 79, "Vorsätze; Konzessiv- und Finalsätze umformen"],
      ["Modul 4", "Ehrenamtlich", 80, 83, "Aufsatz schreiben und Engagement zusammenfassen"],
      ["Rückschau", "Grammatik", 85, 85, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 6,
    title: "Gesund und munter",
    start: 88,
    modules: [
      ["Auftakt", "Gesundheitstest", 88, 89, "Über Gesundheit sprechen"],
      ["Modul 1", "Zu Risiken und Nebenwirkungen …", 90, 91, "Placebo; Infinitivsätze"],
      ["Modul 2", "Gesünder leben", 92, 93, "Gesundheitsentwicklung verstehen"],
      ["Modul 3", "Schmeckt’s noch?", 94, 95, "Lebensmittelsicherheit; Konditionalsätze umformen"],
      ["Modul 4", "Rundum gesund", 96, 99, "Wellness kommentieren und Referat halten"],
      ["Rückschau", "Grammatik", 101, 101, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 7,
    title: "Recht so!",
    start: 104,
    modules: [
      ["Auftakt", "Recht", 104, 105, "Juristische Begriffe zuordnen"],
      ["Modul 1", "Dumm gelaufen", 106, 107, "Verbrechen berichten; Besonderheiten des Passivs"],
      ["Modul 2", "Jugendsünden?!", 108, 109, "Grafiken und Diskussion verstehen"],
      ["Modul 3", "Da lacht Justitia …", 110, 111, "Kuriose Gesetze; modales Partizip"],
      ["Modul 4", "Kriminell", 112, 115, "Krimis zusammenfassen und Entscheidung aushandeln"],
      ["Rückschau", "Grammatik", 117, 117, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 8,
    title: "Du bist, was du bist",
    start: 120,
    modules: [
      ["Auftakt", "Emotionen", 120, 121, "Über die Darstellung von Emotionen sprechen"],
      ["Modul 1", "Wussten Sie schon …?", 122, 123, "Experimente; subjektive Modalverben für Behauptungen"],
      ["Modul 2", "Von Anfang an anders?", 124, 125, "Hirnforschung und Forumsbeitrag"],
      ["Modul 3", "Voll auf Zack!", 126, 127, "Hochbegabung; Vermutungen ausdrücken"],
      ["Modul 4", "Kindertage … schönste Jahre!?", 128, 131, "Erziehung, Glück und Diskussion"],
      ["Rückschau", "Grammatik", 133, 133, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 9,
    title: "Die schöne Welt der Künste",
    start: 136,
    modules: [
      ["Auftakt", "Kunst", 136, 137, "Über Kunstbereiche sprechen"],
      ["Modul 1", "Kreativ", 138, 139, "Kreativität; Präpositionalergänzungen umformen"],
      ["Modul 2", "Kino, Kino", 140, 141, "Filme zusammenfassen und Grafik beschreiben"],
      ["Modul 3", "Ein Leben für die Kunst", 142, 143, "Kommentieren, Ratschläge und Konnektoren"],
      ["Modul 4", "Leseratten", 144, 147, "Autobiografischen Text und Interview verstehen"],
      ["Rückschau", "Grammatik", 149, 149, "Grammatik des Kapitels wiederholen"],
    ],
  },
  {
    number: 10,
    title: "Erinnerungen",
    start: 152,
    modules: [
      ["Auftakt", "Zeitlich einordnen", 152, 153, "Kurztexte und Ereignisse einordnen"],
      ["Modul 1", "Erinnern und Vergessen", 154, 155, "Gedächtnis; Besonderheiten von Konditionalsätzen"],
      ["Modul 2", "Falsche Erinnerungen", 156, 157, "Forumsbeitrag zu einer Radiosendung"],
      ["Modul 3", "Kennen wir uns …?", 158, 159, "Gesichtsblindheit; Modalitätsverben"],
      ["Modul 4", "Vergangene Tage", 160, 163, "Literarischen Text erschließen und über Erinnerungen schreiben"],
      ["Rückschau", "Grammatik", 165, 165, "Grammatik des Kapitels wiederholen"],
    ],
  },
].map((chapter) => ({
  ...chapter,
  modules: chapter.modules.map(([kind, title, pageStart, pageEnd, goal], index) => {
    const id = `k${chapter.number}-m${index}`;
    return {
      id,
      kind,
      title,
      pageStart,
      pageEnd,
      goal,
      study: getModuleStudyProfile(id),
      // The scanned file has one unnumbered page before printed page 1.
      pdfStart: pageStart + 1,
      pdfEnd: pageEnd + 1,
    };
  }),
}));

export const defaultSelection = chapters[0].modules[1];
