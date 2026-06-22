import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

window.firebaseAuth = auth;
window.firebaseLogin = (email, password) => signInWithEmailAndPassword(auth, email, password);
window.firebaseLogout = () => signOut(auth);
window.firebaseOnAuthChange = (cb) => onAuthStateChanged(auth, cb);

window.firebaseLoadDoc = async (uid) => {
  const snap = await getDoc(doc(db, "farmData", uid));
  return snap.exists() ? snap.data() : null;
};
window.firebaseSaveDoc = (uid, data) => setDoc(doc(db, "farmData", uid), data);
window.firebaseWatchDoc = (uid, cb) =>
  onSnapshot(doc(db, "farmData", uid), (snap) => { if (snap.exists()) cb(snap.data()); });

window.firebaseReady = true;
window.dispatchEvent(new Event("firebase-ready"));
