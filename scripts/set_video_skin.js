/**
 * WorkBuddy 视频动效皮肤 —— 持久化补丁（方案 B）
 *
 * 做的事（幂等，可反复跑）：
 *   1) 把磁盘上的 skin.v2.css（含视频壁纸规则）写进 localStorage 的 CSS 缓存键，
 *      让冷启动 applyCachedCssSync 一上来就注入它；
 *   2) 把外观快照里的 zipUrl 改成不可信域名 —— assertSafeThemeResourceUrl 会拒掉，
 *      启动那次 zip 应用就失败且不动 <style> 表，缓存里的皮肤得以保留；
 *   3) agent-ui-theme 钉成 light：这套皮肤大量规则带 :not(.vscode-dark)，
 *      深色偏好会让它只套上一半。
 *
 * 必须在 WorkBuddy 完全退出后运行（关窗口只是收进托盘；LevelDB 有 LOCK）。
 * 用法：node set_video_skin.js [--restore]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ClassicLevel } = require('classic-level');

const HOME = os.homedir();
const DB = process.env.LSDB || path.join(HOME, '.workbuddy', 'app', 'session', 'Local Storage', 'leveldb');
const THEME_DIR = path.join(HOME, '.workbuddy', 'appearance-resources', 'theme-tkbera-1789703092000');
const CSS_SRC = path.join(THEME_DIR, 'skin.v2.css');
const RESOURCE_KEY = 'theme-tkbera';
const BAD_ZIP = 'https://untrusted-skin.invalid/package.zip';

const KEY_PREFIX = Buffer.from('_file://\x00\x01', 'latin1');
const CSS_KEY = 'workbuddy.appearance.lastApplied.css';
const SNAP_BASE = 'workbuddy.appearance.lastApplied';
const SNAP_PREFIX = 'workbuddy.appearance.lastApplied::';
const UI_THEME_KEY = 'agent-ui-theme';
const UI_THEME_LIGHT = JSON.stringify({
  theme: 'light', followSystem: false,
  vsCodeThemeName: 'IDE Light', vsCodeThemeKind: 'vscode-light',
});
const dec = (v) => (v[0] === 0 ? Buffer.from(v.slice(1)).toString('utf16le') : Buffer.from(v.slice(1)).toString('utf8'));
function enc(text, mode) {
  if (mode === 0) {
    const b = Buffer.alloc(1 + Buffer.byteLength(text, 'utf16le'));
    b[0] = 0; b.write(text, 1, 'utf16le'); return b;
  }
  const b = Buffer.alloc(1 + Buffer.byteLength(text, 'latin1'));
  b[0] = 1; b.write(text, 1, 'latin1'); return b;
}

(async () => {
  if (!fs.existsSync(DB)) throw new Error('找不到 Local Storage 目录: ' + DB);
  if (!fs.existsSync(CSS_SRC)) throw new Error('找不到皮肤 CSS: ' + CSS_SRC);
  const css = fs.readFileSync(CSS_SRC, 'utf8');
  if (!css.includes('--wb-home-bg-video')) {
    console.log('⚠ 磁盘 CSS 里没有 --wb-home-bg-video，先确认皮肤文件是否被覆盖。');
  }

  const db = new ClassicLevel(DB, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db.open();

  let cssEntry = null, uiEntry = null, identityVal = '';
  const snaps = [];
  for await (const [k, v] of db.iterator()) {
    const name = Buffer.from(k).toString('latin1').replace(/^_file:\/\/\u0000\u0001/, '');
    if (name === CSS_KEY) cssEntry = { key: Buffer.from(k), val: Buffer.from(v) };
    else if (name === UI_THEME_KEY) uiEntry = { key: Buffer.from(k), val: Buffer.from(v) };
    else if (name === SNAP_PREFIX + '__identity') identityVal = dec(Buffer.from(v));
    else if (name === SNAP_BASE || name.startsWith(SNAP_PREFIX)) snaps.push({ name, key: Buffer.from(k), val: Buffer.from(v) });
  }

  // 1) CSS 缓存
  const cssKey = cssEntry ? cssEntry.key : Buffer.concat([KEY_PREFIX, Buffer.from(CSS_KEY, 'latin1')]);
  const cssMode = cssEntry ? cssEntry.val[0] : 0;
  const id = identityVal || '6a820445-5dd6-4229-bd82-72d8ea5d9851::::personal';
  const payload = JSON.stringify({ resourceKey: RESOURCE_KEY, css, identity: id });
  await db.put(cssKey, enc(payload, cssMode));
  console.log((cssEntry ? '已更新' : '已新建') + ' CSS 缓存：' + css.length + ' 字符，identity=' + id);

  // 2) 快照 zipUrl
  for (const s of snaps) {
    if (s.name === SNAP_PREFIX + '__identity') continue;
    let obj;
    try { obj = JSON.parse(dec(s.val)); } catch { continue; }
    if (!obj || typeof obj !== 'object' || typeof obj.zipUrl !== 'string') continue;
    const before = obj.zipUrl;
    obj.zipUrl = BAD_ZIP;
    if (obj.resourceKey !== RESOURCE_KEY) { console.log('跳过（主题不是 ' + RESOURCE_KEY + '）:', s.name); continue; }
    await db.put(s.key, enc(JSON.stringify(obj), s.val[0]));
    console.log('已改写快照：' + s.name + '\n    zipUrl: ' + String(before).slice(0, 70) + '\n         → ' + obj.zipUrl);
  }

  // 3) UI 主题
  if (uiEntry) {
    await db.put(uiEntry.key, enc(UI_THEME_LIGHT, uiEntry.val[0]));
    console.log('UI 主题 → ' + UI_THEME_LIGHT);
  } else {
    await db.put(Buffer.concat([KEY_PREFIX, Buffer.from(UI_THEME_KEY, 'latin1')]), enc(UI_THEME_LIGHT, 1));
    console.log('UI 主题键不存在，已新建 → ' + UI_THEME_LIGHT);
  }

  // 4) 回读校验 —— 等 db 完全落盘后重开一次，模拟应用下次启动的真实读取路径
  await db.close();
  const db2 = new ClassicLevel(DB, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db2.open();
  console.log('\n—— 回读校验（重扫整库） ——');
  let seenCss = null, seenSnaps = 0, seenUi = null;
  for await (const [k, v] of db2.iterator()) {
    const name = Buffer.from(k).toString('latin1').replace(/^_file:\/\/\u0000\u0001/, '');
    if (name === CSS_KEY) {
      try { seenCss = JSON.parse(dec(Buffer.from(v))); } catch { seenCss = null; }
    } else if (name === UI_THEME_KEY) {
      try { seenUi = dec(Buffer.from(v)); } catch { seenUi = null; }
    } else if (name === SNAP_BASE || (name.startsWith(SNAP_PREFIX) && name !== SNAP_PREFIX + '__identity')) {
      try {
        const o = JSON.parse(dec(Buffer.from(v)));
        if (o.zipUrl === BAD_ZIP) seenSnaps += 1;
        else console.log('⚠ 快照仍是原值:', name.slice(-24), '→', String(o.zipUrl).slice(0, 60));
      } catch { console.log('⚠ 快照解析失败:', name.slice(-24)); }
    }
  }
  await db2.close();
  console.log(seenCss
    ? `CSS 缓存 ✓ ${seenCss.css.length} 字符${seenCss.css.includes('--wb-home-bg-video') ? '，含视频规则' : '，⚠ 不含视频规则'}`
    : '⚠ CSS 缓存回读失败 —— 这次写入没有生效，别启动应用，把上面输出发给阿岚');
  console.log(seenSnaps > 0 ? `快照 zipUrl ✓ ${seenSnaps} 处已断开` : '⚠ 没有任何快照被断开');
  console.log(seenUi && seenUi.includes('"light"') ? 'UI 主题 ✓ light' : '⚠ UI 主题未写成 light');

  const allOk = seenCss && seenSnaps > 0 && seenUi && seenUi.includes('"light"');
  if (!allOk) process.exitCode = 2;
  console.log(allOk
    ? '\n完成。启动 WorkBuddy，视频壁纸应该直接生效。'
    : '\n有未通过的检查项（见上），启动前先解决。');
})().catch((e) => { console.error('失败:', e && e.message); process.exit(1); });
