import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// TODO: fill with your real config before running
const firebaseConfig = {
  apiKey: "AIzaSyCeAmrlMyXhvDH67PCVaBy5QPEOL44ptiE",
  authDomain: "kanban-dpw-santos.firebaseapp.com",
  projectId: "kanban-dpw-santos",
  storageBucket: "kanban-dpw-santos.firebasestorage.app",
  messagingSenderId: "308206286763",
  appId: "1:308206286763:web:917e68208138845f9d44ee",
  measurementId: "G-XS9PJQ0SR9"
}

let app, db, auth

export function initFirebase() {
  if (!app) {
    app = initializeApp(firebaseConfig)
    db = getFirestore(app)
    auth = getAuth(app)
  }
  return { app, db, auth }
}

export async function ensureAnonAuth() {
  const { auth } = initFirebase()
  await signInAnonymously(auth)
}
