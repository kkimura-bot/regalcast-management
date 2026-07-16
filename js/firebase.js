// ============================================================
// Firebase configuration and initialization
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import {
  getFunctions,
  httpsCallable
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

const firebaseConfig = {
  apiKey: "AIzaSyCzzyVqRLG_G9kU2qjQ3yx0aznQBKuK4Vg",
  authDomain: "regalcast-app.firebaseapp.com",
  projectId: "regalcast-app",
  storageBucket: "regalcast-app.firebasestorage.app",
  messagingSenderId: "937984277929",
  appId: "1:937984277929:web:e923791a191d1ffe8718b8",
  measurementId: "G-15KDF2DFKP"
};

const app = initializeApp(firebaseConfig);
export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const storage   = getStorage(app);
export const functions = getFunctions(app);
export { firebaseConfig, httpsCallable };

// Re-export Firebase functions so modules import from here, not CDN
export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  sendPasswordResetEmail,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
};
