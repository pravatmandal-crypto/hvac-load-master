/**
 * Firestore Migration Script
 * Copies all data from the locked AI Studio database to the new (default) database.
 *
 * Usage:
 *   node migrate-firestore.cjs
 */

const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

const PROJECT_ID = 'gen-lang-client-0856391333';
const OLD_DB = 'ai-studio-42b87872-1a4f-4af0-9c2b-180552143b38';

// Initialize two app instances — one per database
const oldApp = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID },
  'old'
);
const newApp = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID },
  'new'
);

const oldDb = oldApp.firestore();
oldDb.settings({ databaseId: OLD_DB });

const newDb = newApp.firestore();
// newDb uses (default) automatically

let totalDocs = 0;

async function copyCollection(oldRef, newRef, indent = '') {
  const snapshot = await oldRef.get();
  if (snapshot.empty) return;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    await newRef.doc(docSnap.id).set(data);
    totalDocs++;
    console.log(`${indent}✓ ${newRef.path}/${docSnap.id}`);

    // Recursively copy subcollections
    const subCollections = await docSnap.ref.listCollections();
    for (const subCol of subCollections) {
      await copyCollection(
        oldRef.doc(docSnap.id).collection(subCol.id),
        newRef.doc(docSnap.id).collection(subCol.id),
        indent + '  '
      );
    }
  }
}

async function migrate() {
  console.log('Starting migration...\n');
  console.log(`FROM: ${OLD_DB}`);
  console.log(`TO:   (default)\n`);

  try {
    // Get all top-level collections from old database
    const collections = await oldDb.listCollections();

    if (collections.length === 0) {
      console.log('No collections found in the old database.');
      return;
    }

    for (const col of collections) {
      console.log(`\nMigrating collection: ${col.id}`);
      await copyCollection(oldDb.collection(col.id), newDb.collection(col.id));
    }

    console.log(`\n✅ Migration complete! ${totalDocs} documents copied.`);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await oldApp.delete();
    await newApp.delete();
  }
}

migrate();
