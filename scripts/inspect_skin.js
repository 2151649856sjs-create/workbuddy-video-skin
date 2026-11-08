const { ClassicLevel } = require('classic-level');
const DB = process.argv[2];
const dec = (v) => (v[0] === 0 ? Buffer.from(v.slice(1)).toString('utf16le') : Buffer.from(v.slice(1)).toString('utf8'));
const PFX = Buffer.from('_file://\x00\x01', 'latin1').toString('latin1');
(async () => {
  const db = new ClassicLevel(DB, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db.open();
  for await (const [k, v] of db.iterator()) {
    let n = Buffer.from(k).toString('latin1');
    if (n.startsWith(PFX)) n = n.slice(PFX.length);
    if (n === 'workbuddy.appearance.lastApplied.css') {
      const o = JSON.parse(dec(v));
      console.log('CACHE css chars =', o.css.length,
        '| video rule:', o.css.includes('--wb-home-bg-video'),
        '| sidebar rule:', o.css.includes('claw-workspace'),
        '| identity:', o.identity);
    } else if (n.startsWith('workbuddy.appearance.lastApplied') && n !== 'workbuddy.appearance.lastApplied::__identity') {
      const o = JSON.parse(dec(v));
      console.log('SNAP', n === 'workbuddy.appearance.lastApplied' ? '(base)' : n.slice('workbuddy.appearance.lastApplied'.length),
        '->', o.zipUrl);
    }
  }
  await db.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
