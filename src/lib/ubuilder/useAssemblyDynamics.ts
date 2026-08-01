/**
 * Live subscription to the signed-in user's U Builder assemblies, reduced to the dynamic
 * response `getCLTD` needs. See ./assemblyDynamics for why the resolution exists at all.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, auth, onAuthStateChanged } from '../firebase';
import { toDynamicsMap, type AssemblyDynamicsMap } from './assemblyDynamics';

/**
 * Self-contained on auth rather than taking a userId prop — the Load Calculator has no user
 * context of its own, and threading one through would put the CLTD damping back at the mercy
 * of whichever component remembered to pass it. Permission errors are swallowed: no assembly
 * library means no damping, which is the pre-existing light-construction behaviour.
 */
export function useAssemblyDynamics(): AssemblyDynamicsMap {
  const [uid, setUid] = useState<string | undefined>(() => auth.currentUser?.uid);
  const [docs, setDocs] = useState<Array<{ id: string; data: Record<string, any> }>>([]);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid)), []);

  useEffect(() => {
    if (!uid) { setDocs([]); return; }
    const q = query(collection(db, 'u_assemblies'), where('userId', '==', uid));
    return onSnapshot(
      q,
      (snap) => setDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
      () => { /* permission denied — fall back to no damping */ },
    );
  }, [uid]);

  return useMemo(() => toDynamicsMap(docs), [docs]);
}
