/**
 * Live subscription to the signed-in user's U Builder assemblies, reduced to the dynamic
 * response `getCLTD` needs. See ./assemblyDynamics for why the resolution exists at all.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, auth, onAuthStateChanged } from '../firebase';
import { toDynamicsMap, type AssemblyDynamicsMap } from './assemblyDynamics';

/**
 * Self-contained on auth rather than taking a userId prop — the Load Calculator has no user
 * context of its own, and threading one through would put the CLTD damping back at the mercy
 * of whichever component remembered to pass it. Permission errors are swallowed: no assembly
 * library means no damping, which is the pre-existing light-construction behaviour.
 *
 * NOT filtered by `userId`. An envelope element points at an assembly by document id, and
 * projects are shared across the team, so filtering the library by the SIGNED-IN user makes
 * the same project compute a different load depending on who opens it — silently, because an
 * unresolvable id reads as "no assembly" rather than as an error. TEZPUR GURT is owned by a
 * Design Team member while every assembly it references belongs to the Super admin, so its
 * earth-covered roof was charged the undamped 36.95°F CLTD instead of 18.46°F for the one
 * person actually working on it. `firestore.rules` already grants read on `u_assemblies` to
 * any authenticated user; the ownership filter was never a security boundary.
 */
export function useAssemblyDynamics(): AssemblyDynamicsMap {
  const [authed, setAuthed] = useState(() => !!auth.currentUser);
  const [docs, setDocs] = useState<Array<{ id: string; data: Record<string, any> }>>([]);

  useEffect(() => onAuthStateChanged(auth, (u) => setAuthed(!!u)), []);

  useEffect(() => {
    if (!authed) { setDocs([]); return; }
    return onSnapshot(
      collection(db, 'u_assemblies'),
      (snap) => setDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
      () => { /* permission denied — fall back to no damping */ },
    );
  }, [authed]);

  return useMemo(() => toDynamicsMap(docs), [docs]);
}
