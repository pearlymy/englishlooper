import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  projectId: "englishlooper",
  appId: "1:338944452273:web:9552160ba31000b3282490",
  storageBucket: "englishlooper.firebasestorage.app",
  apiKey: "AIzaSyCjJsTBKIlJwG0B_6cxiinMqbArH7MMBjA",
  authDomain: "englishlooper.firebaseapp.com",
  messagingSenderId: "338944452273"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
