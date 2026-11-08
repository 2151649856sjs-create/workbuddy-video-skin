const { ClassicLevel } = require('classic-level');
const DB = process.argv[2];
const verbose = process.argv.includes('--all');
const dec = (v) => v[0] === 0 ? Buffer.from(v.slice(1)).toString('utf16le') : Buffer.from(v.slice(1)).toString('utf8');
(async () => {
  const db = new ClassicLevel(DB, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db.open();
  for await (const [k, v] of db.iterator()) {
    const s = Buffer.from(k).toString('latin1');
    const name = s.replace(/^_file:\/\/\u0000\u0001/, '');
    if (!verbose && !name.includes('appearance') && !name.includes('agent-ui-theme')) continue;
    console.log('KEY:', name, '| vlen', v.length, '| mode', v[0]);
    const t = dec(v);
    console.log('VAL:', t.length > 600 ? t.slice(0, 600) + ' …[' + t.length + ' chars]' : t);
    console.log('---');
  }
  await db.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
