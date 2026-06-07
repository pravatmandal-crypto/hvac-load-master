/**
 * Igloo load breakdown — READ-ONLY. Dumps design conditions + analysis.totals
 * for each room in projects whose name contains "igloo", so we can size the
 * AHU (space-sensible recirc) vs TFA (fresh-air) coils on real numbers.
 * Usage: npx tsx scripts/igloo-loads-diag.ts
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin') as typeof import('firebase-admin');
import * as fs from 'fs';
import * as path from 'path';

const sa = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'service-account.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const TR = (btu: number) => (btu / 12000).toFixed(2);

async function main() {
  const projSnap = await db.collection('projects').get();
  const matches = projSnap.docs.filter(d =>
    String((d.data() as any).name ?? (d.data() as any).projectName ?? '').toLowerCase().includes('igloo'),
  );
  for (const proj of matches) {
    const pd = proj.data() as any;
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`PROJECT: ${pd.name ?? pd.projectName}  (id=${proj.id})`);
    // Find where design conditions live
    const dcKeys = Object.keys(pd).filter(k => /design|condition|indoor|outdoor|temp|humid|monsoon/i.test(k));
    console.log('  project-level design-ish keys:', dcKeys.join(', ') || '(none)');
    const dc = pd.designConditions ?? pd.design ?? pd.conditions ?? {};
    if (Object.keys(dc).length) {
      console.log('  designConditions:', JSON.stringify({
        indoorTemp: dc.indoorTemp, indoorHumidity: dc.indoorHumidity,
        outdoorTemp: dc.outdoorTemp, outdoorHumidity: dc.outdoorHumidity,
        monsoonOutdoorTemp: dc.monsoonOutdoorTemp, monsoonOutdoorHumidity: dc.monsoonOutdoorHumidity,
        altitude: dc.altitude, ventilationStrategy: dc.ventilationStrategy,
      }));
    }

    const rooms = await db.collection(`projects/${proj.id}/rooms`).get();
    for (const r of rooms.docs) {
      const d = r.data() as any;
      console.log(`\n  ── ${d.name ?? r.id} ──`);
      // dump any room-level design condition fields too
      const rdc = d.designConditions ?? d.design ?? {};
      if (Object.keys(rdc).length) {
        console.log('    room.designConditions:', JSON.stringify({
          indoorTemp: rdc.indoorTemp, indoorHumidity: rdc.indoorHumidity,
          outdoorTemp: rdc.outdoorTemp, outdoorHumidity: rdc.outdoorHumidity,
        }));
      }
      const t = d.analysis?.totals;
      if (t) {
        console.log(`    ERSH (space sensible)   = ${Math.round(t.ersh)} BTU/h  (${TR(t.ersh)} TR)`);
        console.log(`    ERLH (space latent)     = ${Math.round(t.erlh)} BTU/h  (${TR(t.erlh)} TR)`);
        console.log(`    OA sensible             = ${Math.round(t.oaSensible)} BTU/h  (${TR(t.oaSensible)} TR)`);
        console.log(`    OA latent               = ${Math.round(t.oaLatent)} BTU/h  (${TR(t.oaLatent)} TR)`);
        console.log(`    OA total                = ${Math.round(t.oaTotal)} BTU/h  (${TR(t.oaTotal)} TR)`);
        console.log(`    coilSensible            = ${Math.round(t.coilSensible)} BTU/h  (${TR(t.coilSensible)} TR)`);
        console.log(`    coilLatent              = ${Math.round(t.coilLatent)} BTU/h  (${TR(t.coilLatent)} TR)`);
        console.log(`    GRAND TOTAL             = ${Math.round(t.grandTotal)} BTU/h  (${TR(t.grandTotal)} TR)   RSHF=${(t.rshf??0).toFixed?.(3)}`);
      } else {
        console.log('    (no analysis.totals stored)  keys:', Object.keys(d).filter(k=>/calc|analysis|sensible|latent/i.test(k)).join(', '));
        console.log(`    _calcSensibleBTUH=${d._calcSensibleBTUH}  _calcLatentBTUH=${d._calcLatentBTUH}  _calcRequiredTR=${d._calcRequiredTR}  _calcDesignCFM=${d._calcDesignCFM}`);
      }
      console.log(`    facph=${d.facph}  achProfile=${d.achProfile}  activityType=${d.activityType}  people=${d.peopleCount}  designCFM=${d._calcDesignCFM}`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
