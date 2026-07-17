const DB_NAME = "aspekte-c1-lehrer";
const STORE_NAME = "files";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveBook(buffer) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(buffer, "book");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadBook() {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get("book");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function deleteBook() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete("book");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem("aspekte-progress") || "{}");
  } catch {
    return {};
  }
}

export function saveProgress(progress) {
  localStorage.setItem("aspekte-progress", JSON.stringify(progress));
}
