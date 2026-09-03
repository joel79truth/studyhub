// src/lib/db.js
// Lightweight IndexedDB wrapper for offline-first content storage.
// Stores: notes, pastPapers, quizzes, sageResponses, syncQueue, meta
//
// npm i idb

import { openDB } from 'idb';

const DB_NAME = 'studyhub-db';
const DB_VERSION = 1;

let dbPromise;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pastPapers')) {
          db.createObjectStore('pastPapers', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('quizzes')) {
          db.createObjectStore('quizzes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sageResponses')) {
          // keyPath is a hash of the question text so repeat questions
          // (common exam questions) hit cache instantly, even offline
          db.createObjectStore('sageResponses', { keyPath: 'queryHash' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function putAll(storeName, items) {
  if (!items?.length) return;
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function getAll(storeName) {
  const db = await getDB();
  return db.getAll(storeName);
}

export async function getOne(storeName, key) {
  const db = await getDB();
  return db.get(storeName, key);
}

export async function putOne(storeName, item) {
  const db = await getDB();
  return db.put(storeName, item);
}

export async function setMeta(key, value) {
  const db = await getDB();
  return db.put('meta', { key, value, updatedAt: Date.now() });
}

export async function getMeta(key) {
  const db = await getDB();
  const row = await db.get('meta', key);
  return row?.value;
}

/** Simple string hash for keying cached Sage responses by question text. */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}