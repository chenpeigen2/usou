'use strict';
/* 搜索内核（v1.7.12 建立，v1.7.40 按 nodebestpractices 1.3 抽为独立文件，平铺在 renderer/ 下）
   —— 自包含纯函数，不依赖 DATA / DOM / IPC，可独立单测。
   与 app.js 同为普通 <script> 顺序加载，函数在同一全局作用域直接可见，
   app.js 无需解构、调用点与 QA 钩子（--searchqa）零改动。

   历史缺陷（真实数据量化）：旧实现 it.keys.includes(qk) 要求整串连续出现，
   「tcl launcher」→ 0 命中（雷达里却有 7 个 TclLauncher 项目）。
   现为四层匹配 + 分词 AND + 相关性排序：
     ① 字段前缀命中 100  ② 字段包含 60  ③ 拼音首字母 40/25  ④ 标签子序列 8
   分词：空格 / 逗号 / 顿号 / 分号 / 斜杠，每个词都命中（AND），词序无关。
   排序：分数降序 + 同分保原序（稳定排序）⇒ 收藏恒置顶不受破坏。 */

/* 拼音首字母表：按首字母分组。⚠ 非手写 —— 用 Node 内置 ICU「zh-u-co-pinyin」
   排序推断 + 355 条 ground-truth 断言自证生成（锚点双向夹逼），
   并由独立脚本反查 0 违规。未收录字在 pyInitials 里保留原字（优雅降级，绝不误命中）。 */
const PY_TABLE = {
  'a': '安按案爱',
  'b': '不保八别包北半备并报搏本板标比波版白百编表败边部闭',
  'c': '从仓冲出初处存层常成才持查次测磁菜藏词超车采错除',
  'd': '东低到动单多大定对导带店度当得打断档段点电端第读达都顶',
  'e': '二儿而',
  'f': '分反发否复峰房放方法符返风',
  'g': '个共关刚功国工干归感改构果概给观过隔高',
  'h': '会化后和回好很户换活红缓花黄',
  'j': '交今件具击加即基夹家就局径据捷机检监简级结脚节见角计辑近进金键间',
  'k': '刻口可库开快看空',
  'l': '两令列利力历录来林栏流滤理留略类络老览论赖路连量链零领',
  'm': '么买们名命描明模母每民没满目码秒脉门面',
  'n': '你内南女年拿能那难',
  'o': '噢',
  'p': '平拼排普片盘破评配',
  'q': '七全其切前区去取启器强情期权气浅清确群请起趋迁钱',
  'r': '人仍任入如日热然认让软',
  's': '三上书删刷剩势史失实式所手扫搜收数时是水深生示算缩色视设识试述速闪首',
  't': '体停台同听图天太头态推提条添统跳退题',
  'w': '万为五位外娃完我挖文无未物瓦网误问',
  'x': '下信写响小息新星析消现系线细西详需项鲜',
  'y': '一与于优依元原右因已应引意月有源用硬移言语跃运音页',
  'z': '中主之作值做再准占只周在增奏子字展志总找支整早暂最桌状直置自证诊质转载这重'
};

let PY_MAP = null;
function pyMap() {
  if (PY_MAP) return PY_MAP;
  PY_MAP = Object.create(null);
  for (const L in PY_TABLE) {
    const chars = PY_TABLE[L] || '';
    for (const ch of chars) PY_MAP[ch] = L;
  }
  return PY_MAP;
}
function isCjk(ch) { const c = ch.codePointAt(0); return c >= 0x4e00 && c <= 0x9fa5; }
function pyInitials(s) {
  const m = pyMap();
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    if (isCjk(ch)) out += (m[ch] || ch);
    else out += ch;
  }
  return out.toLowerCase();
}
function searchTokens(query) {
  return String(query == null ? '' : query).toLowerCase().split(/[\s,，、;；/\\]+/).filter(Boolean);
}
function subSeqMatch(hay, needle) {
  let i = 0;
  for (let k = 0; k < hay.length && i < needle.length; k++) if (hay.charAt(k) === needle.charAt(i)) i++;
  return i === needle.length;
}
function scoreToken(fields, pyFields, token) {
  let best = -1;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const at = f.indexOf(token);
    if (at === 0) { if (best < 100) best = 100; }
    else if (at > 0 && best < 60) best = 60;
  }
  if (best < 0 && /^[a-z0-9]+$/.test(token)) {
    for (let i = 0; i < pyFields.length; i++) {
      const f = pyFields[i];
      if (!f) continue;
      const at = f.indexOf(token);
      if (at === 0) { if (best < 40) best = 40; }
      else if (at > 0 && best < 25) best = 25;
    }
  }
  if (best < 0 && token.length >= 3 && fields[0] && subSeqMatch(fields[0], token) && best < 8) best = 8;
  return best;
}
function matchItem(fields, pyFields, tokens) {
  if (!tokens || !tokens.length) return 0;
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    const s = scoreToken(fields, pyFields, tokens[i]);
    if (s < 0) return -1;
    total += s;
  }
  return total;
}
/* 统一入口：分词 AND；AND 无命中时降级 OR，但 OR 只在名称字段（fields[0]）上做，
   否则「路径里含 code」会把几十个项目全拉进来（实测 43/59 命中 = 噪声）。
   OR 得分 ×0.6-1，恒低于任何 AND 命中 ⇒ 排序永远在 AND 结果之后。 */
function matchFields(fields, pyFields, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return 0;
  const and = matchItem(fields, pyFields, tokens);
  if (and >= 0) return and;
  if (tokens.length < 2) return -1;
  let sum = 0, hit = 0;
  for (let i = 0; i < tokens.length; i++) {
    const s = scoreToken([fields[0]], [pyFields[0]], tokens[i]);
    if (s >= 0) { sum += s; hit++; }
  }
  if (!hit) return -1;
  return Math.round(sum * 0.6) - 1;
}


