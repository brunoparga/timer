/*
 * Firebase project identifiers.
 *
 * These are NOT secrets. They identify the project to Google's servers; they
 * grant nothing on their own. Access is decided entirely by the Realtime
 * Database rules in database.rules.json, which confine the public to the
 * /timer node and validate its shape. That is why this is safe to commit.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyB5twf1Shzp26XeAZfOUgSOH8AsGq3fikg",
  authDomain: "goblin-timer.firebaseapp.com",
  databaseURL: "https://goblin-timer-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "goblin-timer",
  storageBucket: "goblin-timer.firebasestorage.app",
  messagingSenderId: "7466420447",
  appId: "1:7466420447:web:d37ccf4b4711f803f7416a"
};
