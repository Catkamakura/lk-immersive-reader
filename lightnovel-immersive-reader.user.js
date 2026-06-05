// ==UserScript==
// @name         轻读 · LightNovel 沉浸阅读 (Immersive Reader)
// @namespace    https://lightnovel.fun/immersive-reader
// @version      1.8.0
// @description  为 lightnovel.fun 提供干净的沉浸式阅读：类 Google Docs 的左侧大纲（融入页面、开合不挤压正文，顶部显示书名，下载随 ▤ 出现）、整本连续滚动、当前章节指示；分章调整并入「目录」标签（在目录时再点即进入调整、完成/重置就地切换）；书签切到「书签」标签即生效、按章节分组、删除需悬停后二次确认；右上仅留设置（点开/✕ 同位切换），退出按钮回到右下与「沉浸阅读」同形同位；切换分卷后退出即停在该卷；←/→ 与上一章/下一章定位、回顶部/返回；可调字号/行距/页宽/字体、4 套护眼主题；列表页悬停即读；一键下载 EPUB（封面+插图+可点击目录）/ TXT。
// @author       masiro
// @match        https://www.lightnovel.fun/*
// @icon         https://www.lightnovel.fun/favicon.ico
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      lightnovel.fun
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ============================ config ============================ */
  const LS_SETTINGS = 'lkir_settings';
  const LS_IDS = 'lkir_ids';
  const DL_MIN_LEN = 3000;     // single-article download appears above this length
  const VOL_LEN = 25000;       // an article this long is treated as a "volume/book", not a chapter
  const MANY_CHAPTERS = 20;    // a series with this many items is treated as web-novel chapters

  const THEMES = {
    paper: { label: '纸白', bg: '#f5f5f7', surface: '#ffffff', text: '#1f2328', muted: '#8a9099', dark: false },
    sepia: { label: '护眼', bg: '#e9ddc7', surface: '#f3e9d6', text: '#5b4636', muted: '#9c8466', dark: false },
    green: { label: '青豆', bg: '#cce8cf', surface: '#d6efd8', text: '#33443a', muted: '#6f8a76', dark: false },
    dark: { label: '夜间', bg: '#15171a', surface: '#1d2024', text: '#c8ccd2', muted: '#6b7280', dark: true },
  };
  const FONTS = {
    system: 'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif',
    sans: '"Helvetica Neue","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif',
    serif: 'Georgia,"Songti SC","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif',
  };
  const DEFAULTS = { theme: 'system', customColor: '#f3ead6', fontSize: 19, lineHeight: 1.9, width: 740, font: 'system', autoOpen: false, showOutline: true, minimap: false };

  let settings = (() => { try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')); } catch { return Object.assign({}, DEFAULTS); } })();
  const saveSettings = () => localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));

  /* ====================== envelope ids / auth ====================== */
  function randId(p) { let s = p; const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 16; i++) s += c[(Math.random() * c.length) | 0]; return s; }
  const ids = (() => { try { return JSON.parse(localStorage.getItem(LS_IDS) || '{}'); } catch { return {}; } })();
  if (!ids.browser_id) ids.browser_id = randId('b_');
  ids.session_id = ids.session_id || randId('s_');
  localStorage.setItem(LS_IDS, JSON.stringify(ids));
  function findSecurityKey() {
    const re = /^[a-f0-9]{16,}:\d+:\d+$/;
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) || ''; if (re.test(v)) return v; const m = v.match(/"security_key":"([a-f0-9]+:\d+:\d+)"/); if (m) return m[1]; } } catch { /* */ }
    return null;
  }

  /* ============================== API ============================== */
  async function apiCall(path, d) {
    const sk = findSecurityKey();
    const body = { is_encrypted: 0, platform: 'pc', client: 'web', sign: '', gz: 0, d: Object.assign({ browser_id: ids.browser_id, session_id: ids.session_id }, sk ? { security_key: sk } : {}, d) };
    const r = await fetch('/proxy' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include' });
    const j = await r.json();
    if (j.code !== 0) throw new Error('code=' + j.code);
    return j.data;
  }
  const getDetail = (aid) => apiCall('/api/article/get-detail', { aid });
  const getContent = (aid) => apiCall('/api/article/get-content', { aid }).then((d) => d.content || '');
  const getSeries = (sid) => apiCall('/api/series/get-article-list', { sid }).then((l) => (l || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)));
  const addHistory = (aid) => apiCall('/api/history/add-history', { aid }).catch(() => {});
  function gmBytes(url) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({ method: 'GET', url, responseType: 'arraybuffer', timeout: 30000,
          onload: (r) => { if (r.status >= 200 && r.status < 300 && r.response) { const mime = ((r.responseHeaders || '').match(/content-type:\s*([^\r\n;]+)/i) || [, 'image/jpeg'])[1].trim(); resolve({ bytes: new Uint8Array(r.response), mime }); } else reject(new Error('img ' + r.status)); },
          onerror: () => reject(new Error('img error')), ontimeout: () => reject(new Error('img timeout')) });
      } catch (e) { reject(e); }
    });
  }

  /* ============================ helpers ============================ */
  const stripTags = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/[　]/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = (s) => (s || '').replace(/[\s　]/g, '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 0x30))   // full-width digits -> half
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));     // full-width letters -> half
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const decodeHtml = (s) => { if (!s || s.indexOf('&') < 0) return s || ''; const d = document.createElement('textarea'); d.innerHTML = s; return d.value; };
  const safeFile = (s) => (String(s || 'book').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'book');
  const cleanTitle = (t) => decodeHtml((t || '').replace(/\s*\[[^\]]*\]\s*$/g, '').trim() || (t || ''));
  function commonPrefix(strs) { if (strs.length < 2) return ''; let p = strs[0]; for (const t of strs) { let i = 0; while (i < p.length && i < t.length && p[i] === t[i]) i++; p = p.slice(0, i); if (!p) break; } return p; }
  function chapterLabels(titles) { const p = commonPrefix(titles); const out = p.length < 6 ? titles.slice() : titles.map((t) => (t.slice(p.length).replace(/^[\s·:：、\-—_.]+/, '').trim() || t)); return out.map(decodeHtml); }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => { [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }); });
    doc.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    doc.querySelectorAll('img').forEach((img) => { const s = img.getAttribute('src'); if (s && s.startsWith('//')) img.setAttribute('src', 'https:' + s); img.setAttribute('loading', 'lazy'); });
    return doc.body.innerHTML;
  }

  /* ====================== auto chapterizer ======================== */
  // Heading pattern is only a FALLBACK; primary detection uses the in-text 目錄 block (keyword-agnostic).
  const HEAD_RE = /^(?:第\s*[0-9０-９一二三四五六七八九十百千零〇兩两]+\s*[話话章回卷部節节]|序\s*(?:[章話话幕])?|終\s*[章話话]|最[終终]\s*[話话章]|幕\s*間|幕\s*间|間\s*章|间\s*章|楔\s*子|引\s*子|尾\s*[聲声]|後\s*記|后\s*记|あとがき|プロローグ|エピローグ|Chapter\s*\d+|Prologue|Epilogue|Part\s*\d+)/i;
  const TOC_MARKER = /^(?:CONTENTS?|目\s*[錄录次]|もくじ|Contents)$/i;
  const isHead = (t) => !!t && t.length <= 42 && HEAD_RE.test(t);
  function splitBlocks(html) { return html.split(/<br\s*\/?>|<\/?p[^>]*>|<\/?div[^>]*>|<\/?h[1-6][^>]*>/i).map((h) => ({ html: h, text: stripTags(h) })); }
  function chapterize(html) {
    const B = splitBlocks(html); const N = B.length;
    // 1) explicit TOC: a 目錄/CONTENTS marker followed by a run of short lines (works for any keyword)
    let marker = -1;
    for (let i = 0; i < Math.min(N, 500); i++) { if (TOC_MARKER.test(B[i].text.trim())) { marker = i; break; } }
    let tocTitles = null, tocEnd = -1, tocBlocks = [], tocEntries = [];
    if (marker >= 0) {
      const entries = []; let blanks = 0;
      for (let i = marker + 1; i < N; i++) {
        const t = B[i].text.trim();
        if (!t) { blanks++; if (blanks >= 3 && entries.length) break; continue; }
        blanks = 0; if (t.length > 48) break; entries.push(i); if (entries.length > 250) break;
      }
      if (entries.length >= 2) { tocTitles = new Set(entries.map((i) => norm(B[i].text))); tocEnd = entries[entries.length - 1]; tocBlocks = [marker, ...entries]; tocEntries = entries.map((i) => B[i].text.trim()); }
    }
    let boundaries = [];
    if (tocTitles) {
      const used = new Set();
      for (let i = tocEnd + 1; i < N; i++) { const t = B[i].text.trim(); if (!t || t.length > 60) continue; const nt = norm(t); if (tocTitles.has(nt) && !used.has(nt)) { boundaries.push(i); used.add(nt); } }
    }
    // 2) fallback: heading pattern + substantial body between headings
    if (boundaries.length < 2) {
      const H = []; B.forEach((b, i) => { if (isHead(b.text)) H.push(i); });
      boundaries = H.filter((h, k) => { const s = H[k] + 1, e = k + 1 < H.length ? H[k + 1] : N; let n = 0; for (let j = s; j < e; j++) n += B[j].text.length; return n >= 400; });
      tocBlocks = [];
    }
    // Return raw blocks + boundary block-indices (nothing deleted — the heading
    // lines stay inline; sections are derived from bounds and are user-editable).
    // tocEntries = the full chapter list from the in-text 目錄 (incl. ones with no body).
    return { blocks: B, bounds: boundaries.length >= 2 ? boundaries : [], tocEntries };
  }

  /* ================== EPUB / TXT (web-API content) ================ */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(entries) {
    const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = e.data, crc = crc32(data), size = data.length;
      const lh = new Uint8Array(30 + name.length); const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true); dv.setUint16(12, 0x21, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, name.length, true); lh.set(name, 30);
      parts.push(lh, data);
      const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, off, true); ch.set(name, 46);
      central.push(ch); off += lh.length + size;
    }
    let cs = 0; central.forEach((c) => (cs += c.length));
    const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cs, true); ev.setUint32(16, off, true);
    const all = [...parts, ...central, eocd]; let tot = 0; all.forEach((c) => (tot += c.length));
    const o = new Uint8Array(tot); let p = 0; for (const c of all) { o.set(c, p); p += c.length; } return o;
  }
  const U8 = (s) => new TextEncoder().encode(s);
  const extOf = (m) => (m.includes('png') ? 'png' : m.includes('gif') ? 'gif' : m.includes('webp') ? 'webp' : m.includes('svg') ? 'svg' : 'jpg');
  function uuid() { try { return crypto.randomUUID(); } catch { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }); } }
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,style').forEach((n) => n.remove());
    doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    doc.querySelectorAll('img').forEach((i) => i.replaceWith('［插图］'));
    doc.querySelectorAll('p,div,hr,h1,h2,h3,h4,li,tr').forEach((b) => b.append('\n'));
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  async function buildEpub(bookTitle, author, srcUrl, chapters, coverUrl, onP) {
    const urls = new Set();
    chapters.forEach((ch) => { const d = new DOMParser().parseFromString(ch.html, 'text/html'); d.querySelectorAll('img').forEach((img) => { let s = img.getAttribute('src') || ''; if (s.startsWith('//')) s = 'https:' + s; if (/^https?:/i.test(s)) urls.add(s); }); });
    const imgMap = new Map(); let idx = 0; const ul = [...urls];
    for (let i = 0; i < ul.length; i++) { onP && onP(`正在嵌入插图 ${i + 1}/${ul.length}…`); try { const { bytes, mime } = await gmBytes(ul[i]); imgMap.set(ul[i], { name: 'img_' + (idx++) + '.' + extOf(mime), bytes, mime }); } catch { /* remote */ } }
    // cover: prefer the book's cover field; else the first portrait-ish content image
    onP && onP('正在获取封面…');
    let coverImg = null, coverMeta = '';
    if (coverUrl) { let u = coverUrl.startsWith('//') ? 'https:' + coverUrl : coverUrl; try { const { bytes, mime } = await gmBytes(u); coverImg = { name: 'cover.' + extOf(mime), bytes, mime }; } catch { /* */ } }
    if (!coverImg) {
      outer: for (const ch of chapters) {
        const d = new DOMParser().parseFromString(ch.html, 'text/html');
        for (const img of d.querySelectorAll('img')) {
          const w = +(img.getAttribute('img-width') || img.getAttribute('width') || 0), h = +(img.getAttribute('img-height') || img.getAttribute('height') || 0);
          if (w && h && h < w * 1.15) continue; // skip landscape banners
          let s = img.getAttribute('src') || ''; if (s.startsWith('//')) s = 'https:' + s; if (!/^https?:/i.test(s)) continue;
          try { const { bytes, mime } = await gmBytes(s); coverImg = { name: 'cover.' + extOf(mime), bytes, mime }; break outer; } catch { /* */ }
        }
      }
    }
    onP && onP('正在打包 EPUB…');
    const labels = chapterLabels(chapters.map((c) => c.title));
    const bid = 'urn:uuid:' + uuid();
    const xhtmlOf = (ch, n) => {
      const d = new DOMParser().parseFromString('<div class="ch">' + ch.html + '</div>', 'text/html');
      d.querySelectorAll('script,style,iframe,object,embed').forEach((x) => x.remove());
      d.querySelectorAll('*').forEach((el) => { [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }); });
      d.querySelectorAll('img').forEach((img) => { let s = img.getAttribute('src') || ''; if (s.startsWith('//')) s = 'https:' + s; const l = imgMap.get(s); img.removeAttribute('loading'); if (l) img.setAttribute('src', 'images/' + l.name); else if (s) img.setAttribute('src', s); if (!img.getAttribute('alt')) img.setAttribute('alt', ''); });
      let bx; try { bx = new XMLSerializer().serializeToString(d.body.firstChild); } catch { bx = '<div>' + esc(htmlToText(ch.html)).replace(/\n/g, '<br/>') + '</div>'; }
      return '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>' + esc(labels[n] || ch.title) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>' + esc(ch.title) + '</h1>' + bx + '</body></html>';
    };
    const manifest = ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', '<item id="css" href="style.css" media-type="text/css"/>'];
    const spine = [], nav = [];
    const entries = [
      { name: 'mimetype', data: U8('application/epub+zip') },
      { name: 'META-INF/container.xml', data: U8('<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
      { name: 'OEBPS/style.css', data: U8('body{font-family:serif;line-height:1.8;margin:1em auto;max-width:42em;padding:0 1em}h1{font-size:1.3em;text-align:center;margin:1.2em 0;line-height:1.4}p{margin:.6em 0}img{max-width:100%;height:auto;display:block;margin:1em auto}hr{border:none;border-top:1px solid #ccc;margin:1.4em 0}ol.lkir-toc{list-style:decimal;line-height:2.1;padding-left:1.6em}ol.lkir-toc a{text-decoration:none;color:#3358cc}') },
    ];
    // a clickable in-content 目录 (table of contents) page, shown first
    const navLinks = chapters.map((ch, n) => '<li><a href="chap_' + n + '.xhtml">' + esc(labels[n] || ch.title) + '</a></li>').join('');
    entries.push({ name: 'OEBPS/nav.xhtml', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>目录</h1><ol class="lkir-toc">' + navLinks + '</ol></body></html>') });
    manifest.push('<item id="navpage" href="nav.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="navpage"/>');
    nav.push('<navPoint id="nptoc" playOrder="1"><navLabel><text>目录</text></navLabel><content src="nav.xhtml"/></navPoint>');
    chapters.forEach((ch, n) => { const f = 'chap_' + n + '.xhtml'; entries.push({ name: 'OEBPS/' + f, data: U8(xhtmlOf(ch, n)) }); manifest.push('<item id="ch' + n + '" href="' + f + '" media-type="application/xhtml+xml"/>'); spine.push('<itemref idref="ch' + n + '"/>'); nav.push('<navPoint id="np' + n + '" playOrder="' + (n + 2) + '"><navLabel><text>' + esc(labels[n] || ch.title) + '</text></navLabel><content src="' + f + '"/></navPoint>'); });
    imgMap.forEach((v) => { entries.push({ name: 'OEBPS/images/' + v.name, data: v.bytes }); manifest.push('<item id="' + v.name.replace(/\W/g, '_') + '" href="images/' + v.name + '" media-type="' + v.mime + '"/>'); });
    if (coverImg) {
      entries.push({ name: 'OEBPS/images/' + coverImg.name, data: coverImg.bytes });
      manifest.push('<item id="cover-img" href="images/' + coverImg.name + '" media-type="' + coverImg.mime + '" properties="cover-image"/>');
      entries.push({ name: 'OEBPS/cover.xhtml', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>封面</title></head><body style="margin:0;padding:0;text-align:center"><img src="images/' + coverImg.name + '" alt="cover" style="max-width:100%;height:auto"/></body></html>') });
      manifest.push('<item id="coverpage" href="cover.xhtml" media-type="application/xhtml+xml"/>');
      spine.unshift('<itemref idref="coverpage"/>');
      coverMeta = '<meta name="cover" content="cover-img"/>';
    }
    entries.push({ name: 'OEBPS/content.opf', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title>' + esc(bookTitle) + '</dc:title><dc:creator>' + esc(author) + '</dc:creator><dc:language>zh</dc:language><dc:identifier id="bookid">' + bid + '</dc:identifier><dc:source>' + esc(srcUrl) + '</dc:source>' + coverMeta + '</metadata><manifest>' + manifest.join('') + '</manifest><spine toc="ncx">' + spine.join('') + '</spine></package>') });
    entries.push({ name: 'OEBPS/toc.ncx', data: U8('<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="' + bid + '"/><meta name="dtb:depth" content="1"/></head><docTitle><text>' + esc(bookTitle) + '</text></docTitle><navMap>' + nav.join('') + '</navMap></ncx>') });
    return { bytes: makeZip(entries), name: safeFile(bookTitle) + '.epub' };
  }
  function buildTxt(bookTitle, author, srcUrl, chapters) {
    let out = bookTitle + '\n作者：' + author + '\n来源：' + srcUrl + '\n\n';
    chapters.forEach((ch) => { out += '\n\n========== ' + ch.title + ' ==========\n\n' + htmlToText(ch.html) + '\n'; });
    return { text: out, name: safeFile(bookTitle) + '.txt' };
  }
  function download(data, name, mime) { const b = new Blob([data], { type: mime }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }

  /* ============================== CSS ============================= */
  const CSS = `
:host { all: initial; } * { box-sizing: border-box; font-family: var(--ir-font); }
.overlay { position: fixed; inset: 0; z-index: 2147483000; background: var(--ir-bg); color: var(--ir-text); display: none; } .overlay.open { display: block; }
.cluster { position: absolute; top: 14px; z-index: 14; display: flex; align-items: center; gap: 6px; }
.cl-left { left: 14px; }
.cbtn { width: 36px; height: 36px; border: none; border-radius: 11px; background: color-mix(in srgb, var(--ir-surface) 70%, transparent); backdrop-filter: blur(8px); color: var(--ir-text); cursor: pointer; font-size: 17px; line-height: 1; display: flex; align-items: center; justify-content: center; opacity: .4; box-shadow: 0 1px 5px rgba(0,0,0,.12); transition: opacity .16s, background .16s, transform .16s; }
.cbtn:hover { opacity: 1; background: color-mix(in srgb, var(--ir-surface) 97%, transparent); }
.cl-left:hover #t-outline { opacity: .92; }
.cbtn.reveal { opacity: 0; pointer-events: none; transform: translateX(-6px); }
.cl-left:hover .cbtn.reveal { opacity: .85; pointer-events: auto; transform: none; }
.overlay.panel-open #t-set { opacity: 1 !important; pointer-events: auto !important; transform: none !important; }
/* 沉浸阅读 / 退出 sit clear of the right-edge minimap so toggling it never shifts them */
.exit-btn { position: absolute; right: 116px; bottom: 26px; z-index: 16; display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; cursor: pointer; border-radius: 999px; background: color-mix(in srgb, var(--ir-surface) 92%, transparent); color: var(--ir-text); font-size: 13.5px; font-weight: 700; box-shadow: 0 6px 22px rgba(0,0,0,.2); border: 1px solid color-mix(in srgb, var(--ir-muted) 18%, transparent); backdrop-filter: blur(8px); transition: transform .15s, color .15s; }
.exit-btn:hover { transform: translateY(-2px); color: #e0533d; }
.overlay.panel-open .exit-btn { display: none; }
.edit-float { display: none; }
.icon-btn { width: 36px; height: 36px; border: none; background: none; cursor: pointer; color: var(--ir-text); opacity: .72; border-radius: 9px; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; } .icon-btn:hover { opacity: 1; background: color-mix(in srgb, var(--ir-muted) 16%, transparent); }
.progress { position: absolute; top: 0; left: 0; height: 3px; background: #6366f1; z-index: 13; width: 0; transition: width .12s; }
.scroll { position: absolute; inset: 0; overflow-y: auto; }
.content { max-width: var(--ir-width); margin: 0 auto; padding: 64px 24px 96px; font-size: var(--ir-fs); line-height: var(--ir-lh); }
.content h1.t { font-size: 1.5em; font-weight: 800; text-align: center; margin: 0 0 12px; } .content .meta { text-align: center; color: var(--ir-muted); font-size: .72em; margin-bottom: 36px; }
.body p { margin: 0 0 .9em; } .body img { max-width: 100% !important; height: auto !important; display: block; margin: 1.3em auto; border-radius: 8px; } .body a { color: #6366f1; word-break: break-all; } .body hr { border: none; border-top: 1px solid color-mix(in srgb, var(--ir-muted) 35%, transparent); margin: 1.4em 0; } .body table { max-width: 100%; }
.foot { display: flex; gap: 12px; justify-content: space-between; margin-top: 50px; padding-top: 24px; border-top: 1px solid color-mix(in srgb, var(--ir-muted) 22%, transparent); }
.foot button { flex: 1; padding: 12px; border-radius: 12px; cursor: pointer; font-size: 14px; font-weight: 600; border: 1px solid color-mix(in srgb, var(--ir-muted) 30%, transparent); background: var(--ir-surface); color: var(--ir-text); } .foot button.primary { background: #6366f1; color: #fff; border-color: #6366f1; } .foot button:disabled { opacity: .35; cursor: not-allowed; }
.rail { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); z-index: 5; display: flex; flex-direction: column; gap: 2px; padding: 7px 5px; border-radius: 18px; background: color-mix(in srgb, var(--ir-surface) 90%, transparent); border: 1px solid color-mix(in srgb, var(--ir-muted) 18%, transparent); backdrop-filter: blur(10px); box-shadow: 0 8px 26px rgba(0,0,0,.16); }
.rail button { width: 52px; padding: 8px 4px; border: none; background: none; color: var(--ir-text); cursor: pointer; border-radius: 12px; opacity: .7; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; } .rail button:hover:not(:disabled) { opacity: 1; color: #6366f1; background: color-mix(in srgb, var(--ir-muted) 16%, transparent); } .rail button:disabled { opacity: .28; cursor: not-allowed; } .rail .ic { font-size: 16px; line-height: 1; } .rail .sep { height: 1px; margin: 3px 8px; background: color-mix(in srgb, var(--ir-muted) 20%, transparent); }
@media (max-width: 820px) { .rail { display: none; } }
.panel { position: absolute; top: 0; bottom: 0; width: 340px; z-index: 10; background: var(--ir-surface); color: var(--ir-text); box-shadow: 0 0 40px rgba(0,0,0,.3); display: flex; flex-direction: column; transition: transform .26s; } .panel.right { right: 0; transform: translateX(100%); } .panel.left { left: 0; transform: translateX(-100%); } .panel.show { transform: translateX(0); }
.panel h3 { margin: 0; padding: 18px 18px 12px; font-size: 15px; font-weight: 700; display: flex; align-items: center; } .panel h3 .x { margin-left: auto; } .panel .pbody { padding: 10px 14px 18px; overflow-y: auto; }
.ctabs { display: flex; gap: 6px; padding: 0 16px 12px; border-bottom: 1px solid color-mix(in srgb, var(--ir-muted) 18%, transparent); }
.ctabs button { flex: 1; padding: 7px; border: none; background: color-mix(in srgb, var(--ir-muted) 12%, transparent); color: var(--ir-text); border-radius: 9px; cursor: pointer; font-size: 13px; font-weight: 600; opacity: .7; } .ctabs button.active { background: #6366f1; color: #fff; opacity: 1; }
.grp { margin-bottom: 22px; } .grp .lbl { font-size: 13px; font-weight: 600; opacity: .8; margin-bottom: 10px; } .grp .lbl b { color: #6366f1; margin-left: 4px; }
.swatches { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; } .sw { height: 44px; border-radius: 10px; border: 2px solid transparent; cursor: pointer; font-size: 12px; font-weight: 600; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); } .sw.active { border-color: #6366f1; }
.custom-in { display: flex; align-items: center; gap: 8px; } .custom-in input { flex: 1; padding: 7px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--ir-muted) 32%, transparent); background: color-mix(in srgb, var(--ir-muted) 8%, transparent); color: var(--ir-text); font-size: 13px; font-family: ui-monospace, Menlo, Consolas, monospace; } .custom-sw { width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
input[type=range] { width: 100%; accent-color: #6366f1; }
.seg { display: inline-flex; border: 1px solid color-mix(in srgb, var(--ir-muted) 30%, transparent); border-radius: 9px; overflow: hidden; } .seg button { padding: 6px 14px; border: none; background: none; color: var(--ir-text); cursor: pointer; font-size: 13px; } .seg button.active { background: #6366f1; color: #fff; }
.toggle { display: flex; align-items: center; justify-content: space-between; }
.cat-item { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; border: none; background: none; color: inherit; cursor: pointer; padding: 9px 8px; border-radius: 8px; font-size: 13px; opacity: .8; } .cat-item:hover { background: color-mix(in srgb, var(--ir-muted) 14%, transparent); opacity: 1; } .cat-item.active { color: #6366f1; font-weight: 650; opacity: 1; background: color-mix(in srgb, #6366f1 12%, transparent); } .cat-item .n { flex-shrink: 0; min-width: 1.8em; text-align: right; opacity: .45; }
.scrim { position: absolute; inset: 0; z-index: 9; background: rgba(0,0,0,.25); display: none; } .scrim.show { display: block; }
.loading { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--ir-muted); font-size: 14px; }
.dlg { position: absolute; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.4); } .dlg.show { display: flex; } .dlg-card { width: 320px; background: var(--ir-surface); color: var(--ir-text); border-radius: 16px; padding: 22px; box-shadow: 0 16px 50px rgba(0,0,0,.4); text-align: center; } .dlg-card .t { font-size: 17px; font-weight: 800; margin-bottom: 6px; } .dlg-card .m { font-size: 13px; opacity: .65; margin-bottom: 18px; min-height: 1.2em; } .dlg-card .acts { display: flex; flex-direction: column; gap: 10px; } .dlg-card .acts button { padding: 12px; border-radius: 11px; border: none; cursor: pointer; font-size: 14px; font-weight: 700; } .dlg-card .acts .epub { background: #6366f1; color: #fff; } .dlg-card .acts .txt { background: color-mix(in srgb, var(--ir-muted) 18%, transparent); color: var(--ir-text); } .dlg-card .cancel { margin-top: 14px; border: none; background: none; color: var(--ir-muted); cursor: pointer; font-size: 13px; }
.ch-sep { height: 0; border-top: 1px dashed color-mix(in srgb, var(--ir-muted) 32%, transparent); margin: 2.4em auto 1.8em; max-width: 60%; }
.ch-inner { display: block; }
.body.editing .ch-inner { font-size: .94em; }
.blk { display: inline; border-radius: 4px; cursor: pointer; }
.body.editing .blk { box-shadow: -10px 0 0 -8px transparent; }
.body.editing .blk:hover { background: color-mix(in srgb, #6366f1 16%, transparent); box-shadow: -1.4em 0 0 -2px #6366f1; }
.body.editing .blk:hover::before { content: '＋分章'; position: relative; left: -1.3em; font-size: 10px; color: #fff; }
.ch-sep.edit { height: auto; max-width: 100%; margin: 1.4em 0 .8em; border: none; display: flex; align-items: center; gap: 10px; padding: 6px 8px; background: color-mix(in srgb, #6366f1 10%, transparent); border-radius: 8px; }
.sep-x { border: none; background: #e0533d; color: #fff; border-radius: 7px; padding: 4px 9px; cursor: pointer; font-size: 12px; font-weight: 600; }
.sep-t { font-size: 13px; font-weight: 700; opacity: .8; }
.r-tail { max-width: var(--ir-width); margin: 60px auto 0; text-align: center; }
.r-end { color: var(--ir-muted); font-size: .8em; margin-bottom: 14px; }
.r-tail-btn { border: 1px solid color-mix(in srgb, var(--ir-muted) 32%, transparent); background: var(--ir-surface); color: var(--ir-text); border-radius: 10px; padding: 8px 16px; cursor: pointer; font-size: 12.5px; opacity: .8; }
.r-tail-btn:hover { opacity: 1; }
.r-tail-box { margin-top: 14px; text-align: left; border: 1px dashed color-mix(in srgb, var(--ir-muted) 35%, transparent); border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.7; opacity: .85; }
.tail-h { font-size: 12px; opacity: .6; margin-bottom: 8px; }
.tail-l { white-space: pre-wrap; }
.cat-item.empty { opacity: .42; cursor: default; }
.cat-item.empty:hover { background: none; }
.cat-tag { margin-left: auto; font-size: 10px; padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--ir-muted) 24%, transparent); }
.cat-note { opacity: .5; font-size: 13px; padding: 8px 6px; }
.set-btn { width: 100%; border: 1px solid color-mix(in srgb, var(--ir-muted) 30%, transparent); background: color-mix(in srgb, #6366f1 8%, transparent); color: var(--ir-text); border-radius: 10px; padding: 10px; cursor: pointer; font-size: 13.5px; font-weight: 600; }
.set-hint { font-size: 11.5px; opacity: .5; margin-top: 7px; line-height: 1.5; }
.toast { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%) translateY(10px); z-index: 40; background: rgba(20,22,28,.94); color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.outline { position: absolute; left: 0; top: 0; bottom: 0; width: 312px; max-width: 86vw; z-index: 12; background: var(--ir-bg); display: flex; flex-direction: column; padding-top: 60px; transform: translateX(-100%); transition: transform .22s ease; }
.overlay.ol-on .outline { transform: none; }
.ol-title { padding: 12px 18px 16px; font-size: 14.5px; font-weight: 750; line-height: 1.4; max-height: 4.3em; overflow: hidden; }
.ol-title:empty { display: none; }
.ol-tabs { display: flex; gap: 6px; padding: 2px 14px 9px; }
.ol-tabs button { flex: 1; padding: 7px 6px; border: none; background: color-mix(in srgb, var(--ir-muted) 12%, transparent); color: var(--ir-text); border-radius: 8px; cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .68; white-space: nowrap; }
.ol-tabs button.active { background: #6366f1; color: #fff; opacity: 1; }
.ol-tabs .lbl-edit { display: none; }
.ol-tabs .tab-toc.active:hover { background: #e8902e; color: #fff; }
.ol-tabs .tab-toc.active:hover .lbl { display: none; }
.ol-tabs .tab-toc.active:hover .lbl-edit { display: inline; }
/* freshly-activated 目录 (mouse still on it after a click) must NOT immediately show the edit affordance */
.ol-tabs .tab-toc.active.no-edit-hover:hover { background: #6366f1; color: #fff; }
.ol-tabs .tab-toc.active.no-edit-hover:hover .lbl { display: inline; }
.ol-tabs .tab-toc.active.no-edit-hover:hover .lbl-edit { display: none; }
.ol-tabs .tab-done { background: #e0533d; color: #fff; opacity: 1; }
.ol-tabs .tab-done:hover { background: #cf4631; }
.ol-note { padding: 0 16px 8px; font-size: 11.5px; opacity: .58; line-height: 1.5; }
.ol-note:empty { display: none; }
.ol-list { flex: 1; overflow-y: auto; padding: 2px 12px 80px; position: relative; }
.ol-list::before { content: ''; position: absolute; left: 19px; top: 4px; bottom: 80px; width: 1.5px; background: color-mix(in srgb, var(--ir-muted) 20%, transparent); border-radius: 2px; }
.bm-grp { margin: 2px 0 4px; }
.bm-grp-h { font-weight: 650; opacity: .9 !important; }
.bm-grp-h .n { opacity: .5; }
.bm-item { padding-left: 24px !important; }
.bm-item .n { min-width: 1.4em; }
.bm-del { margin-left: auto; opacity: 0; padding: 1px 6px; border-radius: 6px; flex-shrink: 0; transition: opacity .14s; }
.bm-item:hover .bm-del { opacity: .55; }
.bm-del:hover { opacity: 1 !important; color: #e0533d; }
.bm-del.confirm { opacity: 1 !important; background: #e0533d; color: #fff; font-size: 11px; font-weight: 700; }
.cur-chip { position: absolute; left: 16px; bottom: 14px; z-index: 6; font-size: 11.5px; opacity: .5; background: color-mix(in srgb, var(--ir-surface) 82%, transparent); backdrop-filter: blur(6px); border: 1px solid color-mix(in srgb, var(--ir-muted) 16%, transparent); padding: 4px 11px; border-radius: 999px; max-width: 52%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; transition: opacity .2s; }
.cur-chip:hover { opacity: .92; } .cur-chip:empty { display: none; }
.bm-mark { color: #e8a33d; margin-right: 5px; cursor: pointer; font-size: .82em; vertical-align: .1em; }
.body.stream .blk.bm { background: color-mix(in srgb, #e8a33d 13%, transparent); border-radius: 4px; box-shadow: -3px 0 0 0 #e8a33d; }
.body.interactive .blk { cursor: pointer; border-radius: 4px; }
.body.interactive .blk:hover { background: color-mix(in srgb, #6366f1 15%, transparent); box-shadow: -1.3em 0 0 -2px #6366f1; }
.body.interactive.splitting .blk:hover::before { content: '＋分章'; position: relative; left: -1.25em; font-size: 10px; color: #fff; }
.body.interactive.marking .blk:hover::before { content: '＋书签'; position: relative; left: -1.25em; font-size: 10px; color: #fff; }
@media (max-width: 820px) {
  .outline { position: fixed; left: 0; top: 0; bottom: 0; width: 300px !important; z-index: 16; transform: translateX(-100%); transition: transform .2s ease; box-shadow: 0 0 44px rgba(0,0,0,.4); padding-top: 16px; }
  .overlay.ol-on .outline { transform: none; }
  .cur-chip { left: 12px; bottom: 10px; }
  .overlay.splitting .edit-float { display: inline-flex; position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 17; align-items: center; gap: 6px; padding: 10px 18px; border: none; border-radius: 999px; background: #e0533d; color: #fff; font-weight: 700; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.3); cursor: pointer; }
}
/* ----- minimap (opt-in, canvas — pagemap-style abstract map of the whole book) ----- */
.minimap { position: absolute; right: 0; top: 0; bottom: 0; width: 96px; z-index: 4; overflow: hidden; background: color-mix(in srgb, var(--ir-muted) 8%, transparent); border-left: 1px solid color-mix(in srgb, var(--ir-muted) 16%, transparent); cursor: pointer; touch-action: none; user-select: none; }
.mm-canvas { position: absolute; top: 0; left: 0; }
/* current-screen window: neutral (theme text colour), deliberately NOT indigo so it doesn't blend with chapter marks */
.mm-view { position: absolute; left: 0; right: 0; min-height: 12px; background: color-mix(in srgb, var(--ir-text) 9%, transparent); border-top: 2px solid color-mix(in srgb, var(--ir-text) 55%, transparent); border-bottom: 2px solid color-mix(in srgb, var(--ir-text) 55%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ir-bg) 40%, transparent); pointer-events: none; }
.minimap:active { cursor: grabbing; }
/* the native browser scrollbar is KEPT; JS positions the minimap just to its left (minimap right = scrollbar width) */
.overlay.mm-on .rail { right: 116px; }
@media (max-width: 820px) { .minimap { display: none !important; } .exit-btn { right: 16px; } .overlay.mm-on .rail { right: 16px; } }
/* ----- feature guide (re-openable from settings) ----- */
.guide { position: absolute; inset: 0; z-index: 21; display: none; pointer-events: none; }
.guide.show { display: block; }
.guide-card { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(560px, 88vw); background: var(--ir-surface); color: var(--ir-text); border-radius: 16px; box-shadow: 0 18px 54px rgba(0,0,0,.45); padding: 16px 20px 14px; pointer-events: auto; }
.guide-step { font-size: 11px; opacity: .5; font-weight: 700; letter-spacing: .05em; }
.guide-t { font-size: 16px; font-weight: 800; margin: 4px 0 6px; }
.guide-b { font-size: 13px; line-height: 1.7; opacity: .85; min-height: 3.4em; }
.guide-acts { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
.guide-acts button { border: none; border-radius: 10px; padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 700; background: color-mix(in srgb, var(--ir-muted) 16%, transparent); color: var(--ir-text); }
.guide-acts button.primary { background: #6366f1; color: #fff; }
.guide-dots { display: flex; flex: 1; justify-content: center; gap: 6px; }
.guide-dots span { width: 7px; height: 7px; border-radius: 50%; background: color-mix(in srgb, var(--ir-muted) 35%, transparent); }
.guide-dots span.on { background: #6366f1; }
.guide-skip { position: absolute; top: 12px; right: 14px; border: none; background: none; color: var(--ir-muted); cursor: pointer; font-size: 12px; }
.guide-hl { outline: 3px solid #6366f1 !important; outline-offset: 2px; border-radius: 8px; }
.guide-spot { position: absolute; border-radius: 10px; border: 2px solid color-mix(in srgb, #6366f1 85%, transparent); box-shadow: 0 0 0 9999px rgba(0,0,0,.55); pointer-events: none; display: none; transition: top .18s ease, left .18s ease, width .18s ease, height .18s ease; }
.guide.show .guide-spot { display: block; }
.overlay.guide-dl #t-dlCorner { opacity: .92; pointer-events: auto; transform: none; }
.launch { position: fixed; right: 116px; bottom: 26px; z-index: 2147482000; display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; border: none; cursor: pointer; border-radius: 999px; background: linear-gradient(120deg,#6366f1,#a855f7); color: #fff; font-size: 14px; font-weight: 700; box-shadow: 0 8px 24px rgba(99,102,241,.45); font-family: system-ui,sans-serif; transition: transform .15s; } .launch:hover { transform: translateY(-2px); }
@media (max-width: 820px) { .launch { right: 16px; } }
`;

  const host = document.createElement('div'); host.id = 'lkir-host'; document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <button class="launch" id="launch">📖 沉浸阅读</button>
    <div class="overlay" id="overlay">
      <div class="progress" id="progress"></div>
      <div class="cluster cl-left" id="clLeft">
        <button class="cbtn" id="t-outline" title="目录 / 大纲"><svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
        <button class="cbtn reveal" id="t-dlCorner" title="下载整本（EPUB / TXT）" style="display:none">⤓</button>
        <button class="cbtn reveal" id="t-set" title="阅读设置">⚙</button>
      </div>
      <div class="scroll" id="scroll"><div class="content" id="content"><div class="loading">加载中…</div></div></div>
      <aside class="outline" id="outline">
        <div class="ol-title" id="outlineTitle"></div>
        <div class="ol-tabs" id="outlineTabs"></div>
        <div class="ol-note" id="outlineNote"></div>
        <div class="ol-list" id="outlineList"></div>
      </aside>
      <div class="minimap" id="minimap" style="display:none"><canvas class="mm-canvas" id="mmCanvas"></canvas><div class="mm-view" id="mmView"></div></div>
      <div class="cur-chip" id="curChip"></div>
      <button class="exit-btn" id="close" title="退出沉浸阅读 (Esc)">✕ 退出</button>
      <button class="edit-float" id="editFloat">✓ 完成调整</button>
      <div class="rail" id="rail">
        <button id="r-prev" title="上一章"><span class="ic">▲</span><span>上一章</span></button>
        <button id="r-next" title="下一章"><span class="ic">▼</span><span>下一章</span></button>
        <div class="sep"></div>
        <button id="r-top" title="回到顶部"><span class="ic">↑</span><span class="lb">顶部</span></button>
      </div>
      <div class="scrim" id="scrim"></div>
      <div class="panel right" id="setPanel"><h3>阅读设置 <button class="icon-btn x" id="setClose">✕</button></h3><div class="pbody" id="setBody"></div></div>
      <div class="dlg" id="dlg"><div class="dlg-card"><div class="t">下载整本</div><div class="m" id="dlgMsg">选择导出格式</div><div class="acts" id="dlgActs"><button class="epub" id="dl-epub">📚 EPUB（封面+插图）</button><button class="txt" id="dl-txt">📄 TXT（纯文本）</button></div><button class="cancel" id="dlgClose">取消</button></div></div>
      <div class="guide" id="guide"><div class="guide-spot" id="guideSpot"></div><div class="guide-card"><button class="guide-skip" id="guideSkip">跳过</button><div class="guide-step" id="guideStep"></div><div class="guide-t" id="guideTitle"></div><div class="guide-b" id="guideBody"></div><div class="guide-acts"><button id="guidePrev">‹ 上一步</button><div class="guide-dots" id="guideDots"></div><button id="guideNext" class="primary">下一步 ›</button></div></div></div>
      <div class="toast" id="toast"></div>
    </div>`;
  const $ = (id) => root.getElementById(id);

  /* =========================== state ============================= */
  // mode 'stream' (one article, chapterized into editable sections) | 'series' (web-novel, paged per aid)
  // mode2 'read' | 'split' | 'bookmark' (interactive sub-modes for stream)
  let S = {};
  let savedScroll = null;
  let pageAid = null;        // the aid the underlying site page is showing (null if opened from a list)
  let suppressOpen = false;  // briefly ignore auto-open right after we sync the site URL on close
  let suppressTocHover = false; // after clicking onto 目录, don't show the 调整分章 hover until the mouse leaves
  function resetState(aid) {
    S = { aid, detail: null, raw: '', rawLen: 0, author: '', bookTitle: '', busy: false, mode: 'stream', mode2: 'read',
      blocks: [], bclean: [], bounds: [], tocEntries: [], sections: [], secLabels: [], cat: [], catLabels: [], manualSplit: false,
      bookmarks: [], bmConfirm: null, outlineTab: 'toc', toc: [], idx: 0, volumes: [], volLabels: [], downloadable: false };
  }
  resetState(null);
  const lightClean = (s) => (s || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
  const textLen = (h) => stripTags(h).length;
  const isMobile = () => !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
  const SPLIT_KEY = (aid) => 'lkir_split_' + aid;
  const BM_KEY = (aid) => 'lkir_bm_' + aid;
  function loadSplit(aid) { try { const v = JSON.parse(localStorage.getItem(SPLIT_KEY(aid)) || 'null'); return v && Array.isArray(v.bounds) ? v : null; } catch { return null; } }
  function saveSplit() { try { localStorage.setItem(SPLIT_KEY(S.aid), JSON.stringify({ bounds: S.bounds })); } catch { /* */ } S.manualSplit = true; }
  function clearSplit() { try { localStorage.removeItem(SPLIT_KEY(S.aid)); } catch { /* */ } S.manualSplit = false; }
  function loadBM(aid) { try { const v = JSON.parse(localStorage.getItem(BM_KEY(aid)) || 'null'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function saveBM() { try { localStorage.setItem(BM_KEY(S.aid), JSON.stringify(S.bookmarks)); } catch { /* */ } }
  function flashToast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1800); }

  // theme resolution: 'system' follows the OS, 'custom' derives a palette from one base colour
  const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec((h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lumOf = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  function deriveTheme(hex) {
    const bg = hexRgb(hex) || hexRgb('#f3ead6'); const dark = lumOf(bg) < 0.42;
    const text = dark ? [221, 225, 231] : [31, 35, 40];
    const surface = dark ? mixRgb(bg, [255, 255, 255], 0.08) : mixRgb(bg, [255, 255, 255], 0.5);
    return { label: '自定义', bg: toHex(bg), surface: toHex(surface), text: toHex(text), muted: toHex(mixRgb(bg, text, 0.45)), dark };
  }
  const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  function resolveTheme() {
    if (settings.theme === 'custom') return deriveTheme(settings.customColor);
    if (settings.theme === 'system') return systemDark() ? THEMES.dark : THEMES.paper;
    return THEMES[settings.theme] || THEMES.paper;
  }
  function applyTheme() { const t = resolveTheme(); const o = $('overlay'); o.style.setProperty('--ir-bg', t.bg); o.style.setProperty('--ir-surface', t.surface); o.style.setProperty('--ir-text', t.text); o.style.setProperty('--ir-muted', t.muted); o.style.setProperty('--ir-font', FONTS[settings.font]); o.style.setProperty('--ir-fs', settings.fontSize + 'px'); o.style.setProperty('--ir-lh', settings.lineHeight); o.style.setProperty('--ir-width', settings.width + 'px'); scheduleMinimap(220); }

  /* ----- stream model ----- */
  const secTop = (el) => el.getBoundingClientRect().top - $('scroll').getBoundingClientRect().top + $('scroll').scrollTop;
  function blockHtml(i) { if (S.bclean[i] == null) { let h = lightClean(S.blocks[i].html); h = h.replace(/(<img\b[^>]*?\bsrc\s*=\s*["'])\/\//gi, '$1https://').replace(/<img\b/gi, '<img loading="lazy" '); S.bclean[i] = h; } return S.bclean[i]; }
  function buildSections() {
    const B = S.blocks, bd = S.bounds, secs = [];
    if (!bd.length) { secs.push({ title: S.bookTitle || '正文', start: 0, end: B.length, head: false }); }
    else {
      if (bd[0] > 0) secs.push({ title: '卷首', start: 0, end: bd[0], head: false });
      for (let i = 0; i < bd.length; i++) { const s = bd[i], e = i + 1 < bd.length ? bd[i + 1] : B.length; secs.push({ title: B[s].text.trim() || '章节', start: s, end: e, head: true }); }
    }
    S.sections = secs; S.secLabels = chapterLabels(secs.map((s) => s.title));
    const cat = []; const hasPre = secs[0] && secs[0].title === '卷首';
    const real = new Map(); secs.forEach((s, i) => { if (s.head) real.set(norm(s.title), i); });
    if (hasPre) cat.push({ title: '卷首', sec: 0, empty: false });
    if (S.tocEntries.length && !S.manualSplit) {
      S.tocEntries.forEach((t) => { const si = real.get(norm(t)); cat.push({ title: t, sec: si == null ? null : si, empty: si == null }); });
    } else { secs.forEach((s, i) => { if (i === 0 && hasPre) return; cat.push({ title: s.title, sec: i, empty: false }); }); }
    S.cat = cat; S.catLabels = chapterLabels(cat.map((c) => c.title));
  }
  function renderStream(keep) {
    buildSections();
    const inter = S.mode2 !== 'read'; const bm = new Set(S.bookmarks.map((b) => b.bi));
    const y = keep ? $('scroll').scrollTop : 0;
    let html = '';
    S.sections.forEach((sec, si) => {
      let inner = '';
      for (let bi = sec.start; bi < sec.end; bi++) {
        const isBm = bm.has(bi); const mark = isBm ? `<span class="bm-mark" data-jump="${bi}">🔖</span>` : '';
        inner += `<span class="blk${isBm ? ' bm' : ''}" data-bi="${bi}">${mark}${blockHtml(bi)}</span><br/>`;
      }
      let sep = '';
      if (si > 0) sep = S.mode2 === 'split'
        ? `<div class="ch-sep edit"><button class="sep-x" data-bi="${sec.start}">✕ 取消分章</button><span class="sep-t">${esc(S.secLabels[si] || sec.title)}</span></div>`
        : '<div class="ch-sep"></div>';
      html += `<section class="ch" id="ch-${si}">${sep}<div class="ch-inner">${inner}</div></section>`;
    });
    html += `<div class="r-tail"><div class="r-end">— 全书完 · 共 ${S.sections.length} 段 —</div><button class="r-tail-btn" id="tailBtn">核对原文末尾（确认未删减）</button><div class="r-tail-box" id="tailBox" style="display:none"></div></div>`;
    $('content').innerHTML = `<div class="body stream${inter ? ' interactive' : ''}${S.mode2 === 'split' ? ' splitting' : ''}${S.mode2 === 'bookmark' ? ' marking' : ''}">${html}</div>`;
    if (keep) $('scroll').scrollTop = y; else { $('scroll').scrollTop = 0; savedScroll = null; }
    $('progress').style.width = '0';
    $('overlay').classList.toggle('splitting', S.mode2 === 'split');
    $('overlay').classList.toggle('marking', S.mode2 === 'bookmark');
    const tb = $('content').querySelector('#tailBtn'); if (tb) tb.onclick = showTail;
    $('content').querySelector('.body').addEventListener('click', onBodyClick);
    updateChrome();
    buildMinimap(); scheduleMinimap(700);
  }
  function showTail() {
    const box = $('content').querySelector('#tailBox'); if (!box) return;
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    const tail = S.blocks.map((b) => b.text).filter((t) => t).slice(-12);
    box.innerHTML = '<div class="tail-h">原文最后 ' + tail.length + ' 行（与上方正文结尾一致，未删减）：</div>' + tail.map((t) => '<div class="tail-l">' + esc(t) + '</div>').join('');
    box.style.display = '';
  }
  function onBodyClick(e) {
    if (S.mode2 === 'split') { const x = e.target.closest('.sep-x'); if (x) { e.preventDefault(); removeBound(Number(x.dataset.bi)); return; } const blk = e.target.closest('.blk'); if (blk) { e.preventDefault(); addBound(Number(blk.dataset.bi)); } return; }
    if (S.mode2 === 'bookmark') { const blk = e.target.closest('.blk'); if (blk) { e.preventDefault(); toggleBookmark(Number(blk.dataset.bi)); } }
  }
  function keepRender() { const y = $('scroll').scrollTop; renderStream(true); $('scroll').scrollTop = y; }
  function addBound(bi) { if (bi <= 0 || S.bounds.includes(bi)) return; S.bounds = [...S.bounds, bi].sort((a, b) => a - b); saveSplit(); keepRender(); renderOutline(); }
  function removeBound(bi) { S.bounds = S.bounds.filter((b) => b !== bi); saveSplit(); keepRender(); renderOutline(); }
  function resetSplit() { clearSplit(); const det = chapterize(S.raw); S.bounds = det.bounds; keepRender(); renderOutline(); }
  function toggleBookmark(bi) {
    const i = S.bookmarks.findIndex((b) => b.bi === bi);
    if (i >= 0) { S.bookmarks.splice(i, 1); flashToast('已移除书签'); }
    else { S.bookmarks.push({ bi, label: (S.blocks[bi].text || '［图片］').slice(0, 30) }); S.bookmarks.sort((a, b) => a.bi - b.bi); flashToast('已添加书签'); }
    saveBM(); keepRender(); renderOutline();
  }
  function jumpToBlock(bi) { const el = $('content').querySelector('.blk[data-bi="' + bi + '"]'); if (el) $('scroll').scrollTo({ top: Math.max(0, secTop(el) - 40), behavior: 'smooth' }); }

  /* ----- interactive modes ----- */
  function enterMode(m) {
    if (S.mode !== 'stream') { flashToast(m === 'split' ? '该书由站点分章，无需手动调整' : '该模式暂不支持'); return; }
    if (S.mode2 === m) { exitMode(); return; }
    S.mode2 = m; S.bmConfirm = null;
    S.outlineTab = m === 'split' ? 'toc' : 'bm'; keepRender(); if (!isMobile()) openOutline(true); renderOutline();
  }
  function exitMode() { if (S.mode2 === 'read') return; S.mode2 = 'read'; S.bmConfirm = null; suppressTocHover = true; if (S.mode === 'stream') keepRender(); renderOutline(); }

  /* ----- series (paged) ----- */
  async function ensureHtml(i) { const c = S.toc[i]; if (c.html == null) { try { c.html = await getContent(c.aid); } catch { c.html = '<p>本章无法获取（可能仅限 App）。</p>'; } } return c.html; }
  async function renderChapter(i) {
    S.idx = i; savedScroll = null; updateTopBtn();
    const c = S.toc[i]; $('scroll').scrollTop = 0; $('progress').style.width = '0';
    if (c.html == null) $('content').innerHTML = '<div class="loading">加载中…</div>';
    const html = await ensureHtml(i); if (S.idx !== i) return;
    addHistory(c.aid); if (pageAid != null) { try { history.replaceState(history.state, '', '/detail/' + c.aid); } catch { /* */ } }
    $('content').innerHTML = '<h1 class="t">' + esc(S.labels[i] || c.title) + '</h1>' +
      '<div class="meta">' + esc(S.author) + (S.toc.length > 1 ? ' · 第 ' + (i + 1) + ' / ' + S.toc.length + ' 章' : '') + '</div>' +
      '<div class="body">' + sanitize(html) + '</div>' +
      '<div class="foot"><button id="f-prev">‹ 上一章</button><button id="f-cat">目录</button><button id="f-next" class="primary">下一章 ›</button></div>';
    const fp = $('content').querySelector('#f-prev'); if (fp) fp.onclick = goPrev;
    const fn = $('content').querySelector('#f-next'); if (fn) fn.onclick = goNext;
    const fc = $('content').querySelector('#f-cat'); if (fc) fc.onclick = () => { S.outlineTab = 'toc'; openOutline(true); renderOutline(); };
    updateChrome();
    buildMinimap(); scheduleMinimap(700);
  }

  /* ----- navigation ----- */
  function streamCur() { const secs = [...$('content').querySelectorAll('section.ch')]; const y = $('scroll').scrollTop + 90; let cur = 0; secs.forEach((s, i) => { if (secTop(s) <= y) cur = i; }); return cur; }
  function scrollToSec(i) { const s = $('content').querySelector('#ch-' + i); if (!s) return; $('scroll').scrollTo({ top: Math.max(0, secTop(s) - 10), behavior: 'smooth' }); }
  function goPrev() { if (S.mode === 'series') { if (S.idx > 0) renderChapter(S.idx - 1); return; } const c = streamCur(); const s = $('content').querySelector('#ch-' + c); const atTop = s && secTop(s) >= $('scroll').scrollTop - 16; scrollToSec(atTop ? Math.max(0, c - 1) : c); }
  function goNext() { if (S.mode === 'series') { if (S.idx < S.toc.length - 1) renderChapter(S.idx + 1); return; } const c = streamCur(); if (c < S.sections.length - 1) scrollToSec(c + 1); }

  function updateChrome() {
    if (S.mode === 'series') { $('r-prev').disabled = S.idx <= 0; $('r-next').disabled = S.idx >= S.toc.length - 1; } else { $('r-prev').disabled = false; $('r-next').disabled = false; }
    if (S.mode === 'stream') S.downloadable = S.sections.length > 1 || S.rawLen >= DL_MIN_LEN;
    $('t-dlCorner').style.display = S.downloadable ? '' : 'none';
    renderOutline(); updateCurrent();
  }

  /* ----- left outline (chapters / bookmarks / volumes) ----- */
  function openOutline(on) { $('overlay').classList.toggle('ol-on', on); updateScrim(); }
  function toggleOutline() { openOutline(!$('overlay').classList.contains('ol-on')); }
  function updateScrim() { const need = $('setPanel').classList.contains('show') || (isMobile() && $('overlay').classList.contains('ol-on')); $('scrim').classList.toggle('show', need); }
  // switching the outline tab also drives the interactive mode: 书签 tab = bookmark mode, others = read mode
  function selectOutlineTab(t) {
    if (t === 'bm') {
      S.outlineTab = 'bm';
      if (S.mode === 'stream' && S.mode2 !== 'bookmark') enterMode('bookmark'); else renderOutline();
      return;
    }
    if (t === S.outlineTab && S.mode2 === 'read') return;
    if (S.mode2 !== 'read') exitMode();
    S.outlineTab = t; renderOutline();
  }
  function renderOutline() {
    $('outlineTitle').textContent = S.bookTitle || (S.detail && S.detail.title) || '';
    const tabsWrap = $('outlineTabs');
    if (S.mode2 === 'split') {
      // split (manual chapter editing) repurposes the tab bar: red 完成 where 目录 was, 重置 where 书签 was
      tabsWrap.innerHTML = `<button class="tab-done" data-act="done">✓ 完成调整</button><button class="tab-reset" data-act="reset">↺ 重置</button>`;
      tabsWrap.querySelector('[data-act="done"]').onclick = exitMode;
      tabsWrap.querySelector('[data-act="reset"]').onclick = resetSplit;
      $('outlineNote').textContent = '点击任意段落＝在此分章；点击正文里「✕ 取消分章」可合并相邻章节。';
    } else {
      const tabs = [['toc', '目录']]; if (S.mode === 'stream') tabs.push(['bm', '书签']); if (S.volumes.length > 1) tabs.push(['vol', '分卷']);
      if (!tabs.some((t) => t[0] === S.outlineTab)) S.outlineTab = 'toc';
      const canSplit = S.mode === 'stream';
      tabsWrap.innerHTML = tabs.map(([k, l]) => {
        const a = S.outlineTab === k ? ' active' : '';
        if (k === 'toc' && canSplit) return `<button class="tab-toc${a}${(a && suppressTocHover) ? ' no-edit-hover' : ''}" data-t="toc"><span class="lbl">目录</span><span class="lbl-edit">✂️ 调整分章</span></button>`;
        return `<button class="${a}" data-t="${k}">${l}</button>`;
      }).join('');
      tabsWrap.querySelectorAll('button').forEach((b) => {
        if (b.dataset.t === 'toc' && canSplit) {
          b.onmouseleave = () => { suppressTocHover = false; b.classList.remove('no-edit-hover'); };
          b.onclick = () => { if (S.outlineTab === 'toc' && S.mode2 === 'read' && !b.classList.contains('no-edit-hover')) enterMode('split'); else { suppressTocHover = true; selectOutlineTab('toc'); } };
        } else b.onclick = () => selectOutlineTab(b.dataset.t);
      });
      $('outlineNote').textContent =
        S.outlineTab === 'bm' ? '书签模式：点击正文段落即可添加 / 移除；下方按所在章节分组。'
        : (S.outlineTab === 'toc' && canSplit && S.cat.length > 1 ? '提示：当前在「目录」，再点一次「目录」即可调整分章。' : '');
    }
    const list = $('outlineList');
    if (S.outlineTab === 'vol') {
      list.innerHTML = S.volumes.map((v, i) => `<button class="cat-item ${v.aid === S.aid ? 'active' : ''}" data-aid="${v.aid}" title="${esc(v.title)}"><span class="n">${i + 1}</span><span>${esc(S.volLabels[i] || v.title)}</span></button>`).join('');
      list.querySelectorAll('.cat-item').forEach((b) => (b.onclick = () => { if (isMobile()) openOutline(false); openArticle(Number(b.dataset.aid)); }));
    } else if (S.outlineTab === 'bm') {
      renderBookmarks(list);
    } else if (S.mode === 'series') {
      list.innerHTML = S.toc.map((c, i) => `<button class="cat-item ${i === S.idx ? 'active' : ''}" data-i="${i}" title="${esc(c.title)}"><span class="n">${i + 1}</span><span>${esc(S.labels[i] || c.title)}</span></button>`).join('');
      list.querySelectorAll('.cat-item').forEach((b) => (b.onclick = () => { if (isMobile()) openOutline(false); renderChapter(Number(b.dataset.i)); }));
    } else if (S.cat.length <= 1) {
      list.innerHTML = '<div class="cat-note">本篇为单段内容。再点一次上方「目录」即可进入分章调整、自行划分。</div>';
    } else {
      const cur = streamCur();
      list.innerHTML = S.cat.map((c, i) => `<button class="cat-item ${c.empty ? 'empty' : ''} ${c.sec === cur ? 'active' : ''}" data-sec="${c.sec == null ? '' : c.sec}" title="${esc(c.title)}"><span class="n">${i + 1}</span><span>${esc(S.catLabels[i] || c.title)}</span>${c.empty ? '<span class="cat-tag">未完成</span>' : ''}</button>`).join('');
      list.querySelectorAll('.cat-item').forEach((b) => (b.onclick = () => { const sec = b.dataset.sec; if (sec === '') { flashToast('本章暂无内容（可能未翻译）'); return; } if (isMobile()) openOutline(false); scrollToSec(Number(sec)); }));
    }
    updateCurrent();
  }
  // 书签 list grouped under the chapter each bookmark sits in; delete needs a hover + confirm
  function renderBookmarks(list) {
    if (!S.bookmarks.length) { list.innerHTML = '<div class="cat-note">还没有书签。当前为书签模式——点击正文任意段落即可添加。</div>'; return; }
    const secOf = (bi) => { for (let i = 0; i < S.sections.length; i++) { const s = S.sections[i]; if (bi >= s.start && bi < s.end) return i; } return Math.max(0, S.sections.length - 1); };
    const groups = new Map();
    S.bookmarks.forEach((b) => { const si = secOf(b.bi); if (!groups.has(si)) groups.set(si, []); groups.get(si).push(b); });
    let html = '';
    [...groups.keys()].sort((a, b) => a - b).forEach((si) => {
      const t = S.secLabels[si] || (S.sections[si] && S.sections[si].title) || '正文';
      html += `<div class="bm-grp"><button class="cat-item bm-grp-h" data-sec="${si}" title="${esc(t)}"><span class="n">▎</span><span>${esc(t)}</span></button>`;
      groups.get(si).sort((a, b) => a.bi - b.bi).forEach((b) => {
        const cf = S.bmConfirm === b.bi;
        html += `<button class="cat-item bm-item" data-jump="${b.bi}" title="${esc(b.label)}"><span class="n">🔖</span><span>${esc(b.label)}</span><span class="bm-del${cf ? ' confirm' : ''}" data-del="${b.bi}">${cf ? '确认删除' : '✕'}</span></button>`;
      });
      html += `</div>`;
    });
    list.innerHTML = html;
    list.querySelectorAll('.bm-grp-h').forEach((b) => (b.onclick = () => { if (isMobile()) openOutline(false); scrollToSec(Number(b.dataset.sec)); }));
    list.querySelectorAll('.bm-item').forEach((b) => (b.onclick = (e) => {
      const del = e.target.closest('.bm-del');
      if (del) {
        e.stopPropagation(); const bi = Number(del.dataset.del);
        if (S.bmConfirm === bi) { S.bmConfirm = null; toggleBookmark(bi); }
        else { S.bmConfirm = bi; renderOutline(); clearTimeout(S._bmT); S._bmT = setTimeout(() => { if (S.bmConfirm === bi) { S.bmConfirm = null; renderOutline(); } }, 2800); }
        return;
      }
      S.bmConfirm = null; if (isMobile()) openOutline(false); jumpToBlock(Number(b.dataset.jump));
    }));
  }
  function updateCurrent() {
    const list = $('outlineList');
    if (S.mode === 'series') { $('curChip').textContent = (S.labels && S.labels[S.idx]) || S.bookTitle || ''; if (list) list.querySelectorAll('.cat-item').forEach((it) => it.classList.toggle('active', it.dataset.i === String(S.idx))); return; }
    const cur = streamCur(); const sec = S.sections[cur];
    $('curChip').textContent = sec ? (S.secLabels[cur] || sec.title) : '';
    if (list && S.outlineTab === 'toc') { let any = false; list.querySelectorAll('.cat-item').forEach((it) => { const on = it.dataset.sec === String(cur); it.classList.toggle('active', on); any = any || on; }); }
  }

  function sampleOthers(series, aid, n) { const o = series.filter((s) => s.aid !== aid); if (o.length <= n) return o.map((s) => s.aid); const out = []; const step = Math.max(1, Math.floor(o.length / n)); for (let i = 0; i < n; i++) out.push(o[Math.min(o.length - 1, i * step)].aid); return [...new Set(out)]; }

  async function openArticle(aid) {
    resetState(aid); exitMode();
    // keep the address bar in step with what's open (so closing lands on the right book/volume),
    // but only when we were launched from a real detail page — never hijack a list page's URL.
    if (pageAid != null && aid !== currentAid()) { try { history.replaceState(history.state, '', '/detail/' + aid); } catch { /* */ } }
    $('content').innerHTML = '<div class="loading">加载中…</div>'; $('t-dlCorner').style.display = 'none';
    let raw, detail;
    try { [raw, detail] = await Promise.all([getContent(aid), getDetail(aid)]); }
    catch { $('content').innerHTML = '<div class="loading">无法加载该内容（可能仅限 App 或已删除）。</div>'; return; }
    if (S.aid !== aid) return;
    S.detail = detail; S.raw = raw; S.rawLen = textLen(raw); S.author = (detail.author && detail.author.nickname) || ''; S.bookTitle = cleanTitle(detail.title);
    S.bookmarks = loadBM(aid);
    const det = chapterize(raw); S.blocks = det.blocks; S.tocEntries = det.tocEntries || [];
    const saved = loadSplit(aid);
    if (det.bounds.length >= 2 || (saved && saved.bounds.length)) {
      S.mode = 'stream';
      if (saved && saved.bounds.length) { S.bounds = saved.bounds.filter((b) => b > 0 && b < S.blocks.length); S.manualSplit = true; } else S.bounds = det.bounds;
      renderStream(); addHistory(aid);
      if ((detail.sid || 0) > 0) getSeries(detail.sid).then((s) => { if (S.aid !== aid) return; if (s.length > 1) { S.volumes = s; S.volLabels = chapterLabels(s.map((x) => x.title)); updateChrome(); } }).catch(() => {});
      return;
    }
    S.mode = 'stream'; S.bounds = []; renderStream(); addHistory(aid);
    if ((detail.sid || 0) > 0) {
      const series = await getSeries(detail.sid).catch(() => []);
      if (S.aid !== aid || !series.length) return;
      let kind = 'series';
      if (series.length <= 1) kind = 'volumes';
      else if (series.length < MANY_CHAPTERS) { let maxLen = S.rawLen; for (const sa of sampleOthers(series, aid, 2)) { try { maxLen = Math.max(maxLen, textLen(await getContent(sa))); } catch { /* */ } if (maxLen >= VOL_LEN) break; } kind = maxLen >= VOL_LEN ? 'volumes' : 'series'; }
      if (S.aid !== aid) return;
      if (kind === 'series') {
        S.mode = 'series'; S.toc = series.map((s) => ({ aid: s.aid, title: s.title, html: null }));
        const ci = S.toc.findIndex((t) => t.aid === aid); S.idx = ci < 0 ? 0 : ci; if (ci >= 0) S.toc[ci].html = raw;
        S.labels = chapterLabels(S.toc.map((c) => c.title)); S.bookTitle = cleanTitle(commonPrefix(series.map((s) => s.title))) || cleanTitle(detail.title); S.downloadable = true;
        renderChapter(S.idx);
      } else { S.volumes = series; S.volLabels = chapterLabels(series.map((s) => s.title)); updateChrome(); }
    } else updateChrome();
  }

  /* ===================== settings panel ======================= */
  function renderSettings() {
    const body = $('setBody');
    body.innerHTML =
      `<div class="grp"><div class="lbl">主题</div><div class="swatches" id="sw"></div>
         <div id="customRow" style="${settings.theme === 'custom' ? '' : 'display:none'};margin-top:10px"><div class="lbl">自定义底色（如 #AA4A44）</div><div class="custom-in"><input type="text" id="s-custom" maxlength="7" value="${esc(settings.customColor)}" placeholder="#AA4A44"><span class="custom-sw" id="customSw" style="background:${esc(settings.customColor)}"></span></div></div>
       </div>
       <div class="grp"><div class="lbl">字号 <b id="v-fs">${settings.fontSize}</b></div><input type="range" id="s-fs" min="14" max="28" step="1" value="${settings.fontSize}"></div>
       <div class="grp"><div class="lbl">行距 <b id="v-lh">${settings.lineHeight.toFixed(1)}</b></div><input type="range" id="s-lh" min="1.4" max="2.6" step="0.1" value="${settings.lineHeight}"></div>
       <div class="grp"><div class="lbl">页宽 <b id="v-w">${settings.width}</b></div><input type="range" id="s-w" min="560" max="1000" step="20" value="${settings.width}"></div>
       <div class="grp"><div class="lbl">字体</div><div class="seg" id="s-font"><button data-f="system" class="${settings.font === 'system' ? 'active' : ''}">系统</button><button data-f="sans" class="${settings.font === 'sans' ? 'active' : ''}">黑体</button><button data-f="serif" class="${settings.font === 'serif' ? 'active' : ''}">宋体</button></div></div>
       <div class="grp toggle"><div class="lbl" style="margin:0">显示目录侧栏（电脑端）</div><input type="checkbox" id="s-outline" ${settings.showOutline ? 'checked' : ''}></div>
       <div class="grp toggle"><div class="lbl" style="margin:0">右侧缩略图 Minimap（电脑端）</div><input type="checkbox" id="s-minimap" ${settings.minimap ? 'checked' : ''}></div>
       <div class="grp toggle"><div class="lbl" style="margin:0">进入详情页自动沉浸</div><input type="checkbox" id="s-auto" ${settings.autoOpen ? 'checked' : ''}></div>
       <div class="grp"><button class="set-btn" id="s-guide">📖 功能向导 / 使用说明</button><div class="set-hint">界面做了精简、很多功能被收了起来；忘记某个功能怎么用时，随时点这里重看分步引导。</div></div>`;
    const sw = body.querySelector('#sw');
    const swatches = [['system', '跟随系统'], ['paper', '纸白'], ['sepia', '护眼'], ['dark', '夜间'], ['custom', '自定义']];
    sw.innerHTML = swatches.map(([k, label]) => {
      let style;
      if (k === 'system') style = 'background:linear-gradient(135deg,#f5f5f7 0 50%,#15171a 50% 100%);color:#9aa';
      else { const t = k === 'custom' ? deriveTheme(settings.customColor) : THEMES[k]; style = `background:${t.surface};color:${t.text}`; }
      return `<button class="sw ${settings.theme === k ? 'active' : ''}" data-k="${k}" style="${style}">${label}</button>`;
    }).join('');
    sw.querySelectorAll('.sw').forEach((b) => (b.onclick = () => { settings.theme = b.dataset.k; saveSettings(); applyTheme(); renderSettings(); }));
    const ci = body.querySelector('#s-custom');
    if (ci) ci.oninput = (e) => { let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) { settings.customColor = v; const swp = body.querySelector('#customSw'); if (swp) swp.style.background = v; saveSettings(); if (settings.theme === 'custom') applyTheme(); } };
    const bind = (id, key, vid, fmt) => { body.querySelector(id).oninput = (e) => { settings[key] = key === 'lineHeight' ? parseFloat(e.target.value) : Number(e.target.value); body.querySelector(vid).textContent = fmt ? fmt(settings[key]) : settings[key]; saveSettings(); applyTheme(); }; };
    bind('#s-fs', 'fontSize', '#v-fs'); bind('#s-lh', 'lineHeight', '#v-lh', (v) => v.toFixed(1)); bind('#s-w', 'width', '#v-w');
    body.querySelectorAll('#s-font button').forEach((b) => (b.onclick = () => { settings.font = b.dataset.f; saveSettings(); applyTheme(); renderSettings(); }));
    body.querySelector('#s-auto').onchange = (e) => { settings.autoOpen = e.target.checked; saveSettings(); };
    body.querySelector('#s-outline').onchange = (e) => { settings.showOutline = e.target.checked; saveSettings(); openOutline(e.target.checked && !isMobile()); };
    body.querySelector('#s-minimap').onchange = (e) => { settings.minimap = e.target.checked; saveSettings(); buildMinimap(); };
    body.querySelector('#s-guide').onclick = () => { togglePanel(false); openGuide(0); };
  }

  /* ===================== download flow ======================= */
  function openDlg() { $('dlg').classList.add('show'); $('dlgMsg').textContent = '选择导出格式'; $('dlgActs').style.display = ''; }
  function closeDlg() { if (!S.busy) $('dlg').classList.remove('show'); }
  async function gatherBook(onP) {
    if (S.mode === 'series') { const out = []; for (let i = 0; i < S.toc.length; i++) { onP && onP(`正在下载章节 ${i + 1}/${S.toc.length}…`); out.push({ title: S.toc[i].title, html: await ensureHtml(i) }); } return out; }
    buildSections();
    return S.sections.map((s) => { const start = s.head ? s.start + 1 : s.start; return { title: s.title, html: S.blocks.slice(start, s.end).map((b) => b.html).join('<br/>') }; });
  }
  async function doExport(kind) {
    if (S.busy || !S.detail) return; S.busy = true; $('dlgActs').style.display = 'none';
    const onP = (m) => ($('dlgMsg').textContent = m);
    try {
      onP('正在准备…');
      const chapters = await gatherBook(onP);
      const src = 'https://www.lightnovel.fun/detail/' + S.aid;
      const cover = (S.detail && (S.detail.cover || S.detail.banner)) || '';
      if (kind === 'txt') { const { text, name } = buildTxt(S.bookTitle, S.author || '未知', src, chapters); download(text, name, 'text/plain;charset=utf-8'); }
      else { const { bytes, name } = await buildEpub(S.bookTitle, S.author || '未知', src, chapters, cover, onP); download(bytes, name, 'application/epub+zip'); }
      onP('完成 ✓'); setTimeout(() => { S.busy = false; $('dlg').classList.remove('show'); }, 900);
    } catch (e) { onP('导出失败：' + (e && e.message || e)); S.busy = false; setTimeout(() => ($('dlgActs').style.display = ''), 100); }
  }

  /* ===================== open/close + events ================= */
  function openReader(aid) { pageAid = currentAid(); applyTheme(); $('overlay').classList.add('open'); document.documentElement.style.overflow = 'hidden'; openOutline(settings.showOutline && !isMobile()); openArticle(aid); maybeAutoGuide(); }
  function closeReader() {
    const landing = S.aid;
    $('overlay').classList.remove('open', 'splitting', 'marking', 'mm-on'); $('minimap').style.display = 'none'; document.documentElement.style.overflow = ''; exitMode(); togglePanel(false); openOutline(false); if ($('guide').classList.contains('show')) closeGuide();
    // if we were launched from a detail page and the reader walked to a different book/volume,
    // navigate the underlying site to it now (on exit) so the page behind matches what was read.
    if (pageAid != null && landing && landing !== pageAid) {
      suppressOpen = true;
      try { history.replaceState(history.state, '', '/detail/' + landing); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); } catch { /* */ }
      pageAid = landing;
      setTimeout(() => { suppressOpen = false; }, 1800);
    }
  }
  function togglePanel(show) { $('setPanel').classList.toggle('show', show); $('overlay').classList.toggle('panel-open', show); $('t-set').textContent = show ? '✕' : '⚙'; $('t-set').title = show ? '关闭设置' : '阅读设置'; updateScrim(); }
  function updateTopBtn() { const el = $('scroll'); const atTop = el.scrollTop <= 60; const ic = $('r-top').querySelector('.ic'); const lb = $('r-top').querySelector('.lb'); if (atTop && savedScroll != null) { ic.textContent = '↓'; lb.textContent = '返回'; } else { ic.textContent = '↑'; lb.textContent = '顶部'; } }
  function toggleTop() { const el = $('scroll'); if (el.scrollTop > 60) { savedScroll = el.scrollTop; el.scrollTo({ top: 0, behavior: 'smooth' }); } else if (savedScroll != null) { el.scrollTo({ top: savedScroll, behavior: 'smooth' }); savedScroll = null; } setTimeout(updateTopBtn, 50); }

  /* ===================== minimap (Sublime-style: offscreen full map drawn once, visible slice blitted on scroll) ======================= */
  // Enriched: real image thumbnails + faint per-chapter bands + chapter divider lines + amber bookmark ticks.
  // For tall books the map SCROLLS (offset) and the viewport box stays grabbable; drag follows the cursor (grab offset).
  let mmDrag = false, mmGrab = 0, mmRAF = 0, mmTimer = 0;
  const minimapOn = () => settings.minimap && S.mode === 'stream' && !isMobile() && $('overlay').classList.contains('open');
  const cssVar = (n, fb) => { try { return getComputedStyle($('overlay')).getPropertyValue(n).trim() || fb; } catch { return fb; } };
  const rgba = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'rgba(120,120,120,' + a + ')'; const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  function buildMinimap() {
    const mm = $('minimap'), ov = $('overlay'), content = $('content');
    const body = content && content.querySelector('.body');
    if (!minimapOn() || !body) { mm.style.display = 'none'; ov.classList.remove('mm-on'); mm._full = null; return; }
    mm.style.display = ''; ov.classList.add('mm-on');
    const sc = $('scroll');
    const sbw = Math.max(0, sc.offsetWidth - sc.clientWidth); mm.style.right = sbw + 'px'; // sit just LEFT of the native scrollbar (kept, Sublime-style)
    const W = Math.round(mm.clientWidth), H = Math.round(mm.clientHeight), docH = sc.scrollHeight || 1, cw = content.offsetWidth || settings.width;
    if (!W || !H) return;
    let scale = W / cw, mapH = docH * scale;
    const MAXH = 24000; if (mapH > MAXH) { scale *= MAXH / mapH; mapH = MAXH; }
    mapH = Math.max(1, Math.round(mapH)); // integer so the blit source rect never overruns full.height
    mm._scale = scale; mm._mapH = mapH;
    const full = document.createElement('canvas'); full.width = W; full.height = mapH;
    const fx = full.getContext('2d');
    const scTop = sc.getBoundingClientRect().top, scScroll = sc.scrollTop;
    const yOf = (el) => (el.getBoundingClientRect().top - scTop + scScroll) * scale;
    const txtCol = cssVar('--ir-text', '#333');
    const lhPx = (settings.fontSize || 19) * (settings.lineHeight || 1.9), lhMap = Math.max(1.2, lhPx * scale);
    const cpl = Math.max(8, (cw * 0.84) / (settings.fontSize || 19)); // ~chars per line, for last-line length
    // faint alternating per-chapter bands
    [...body.querySelectorAll('section.ch')].forEach((sec, i) => { if (i % 2) { fx.fillStyle = rgba(txtCol, 0.04); fx.fillRect(0, yOf(sec), W, Math.max(1, sec.offsetHeight * scale)); } });
    // text → mini striped "lines" with a shorter last line (Sublime-ish), not a solid block
    fx.fillStyle = rgba(txtCol, 0.34);
    const xPad = W * 0.12, lineW = W * 0.76, lineH = Math.max(0.7, lhMap * 0.52);
    body.querySelectorAll('.blk').forEach((el) => {
      if (el.querySelector('img')) return; const r = el.getBoundingClientRect(); if (!r.height) return;
      const top = (r.top - scTop + scScroll) * scale, h = r.height * scale, tlen = (el.textContent || '').trim().length; if (!tlen) return;
      const nLines = Math.max(1, Math.round(h / lhMap) || 1);
      for (let i = 0; i < nLines; i++) { let frac = 1; if (i === nLines - 1) frac = Math.max(0.16, Math.min(1, (tlen - i * cpl) / cpl)); fx.fillRect(xPad, top + i * lhMap, lineW * frac, lineH); }
    });
    // images → real thumbnails (the visual landmarks of an illustrated novel)
    body.querySelectorAll('img').forEach((img) => {
      if (!img.offsetHeight) return; const y = yOf(img), h = Math.max(2, img.offsetHeight * scale);
      const iw = Math.min(W * 0.92, (img.offsetWidth || cw) * scale), x = (W - iw) / 2;
      try { if (img.complete && img.naturalWidth) fx.drawImage(img, x, y, iw, h); else { fx.fillStyle = rgba(cssVar('--ir-muted', '#888'), 0.45); fx.fillRect(x, y, iw, h); } }
      catch { fx.fillStyle = rgba(cssVar('--ir-muted', '#888'), 0.45); fx.fillRect(x, y, iw, h); }
    });
    // chapter divider lines + a small numbered label tab on the left (vivid & informative)
    fx.textBaseline = 'middle'; fx.textAlign = 'center'; fx.font = '600 9px system-ui,-apple-system,sans-serif';
    let lastLbl = -999;
    [...body.querySelectorAll('section.ch')].forEach((sec, i) => {
      const top = yOf(sec);
      if (i > 0) { fx.fillStyle = '#6366f1'; fx.fillRect(0, top, W, 1.6); }
      if (top - lastLbl >= 14) { lastLbl = top; const n = String(i + 1), tw = n.length > 2 ? 22 : 18; fx.fillStyle = '#6366f1'; fx.fillRect(0, top + 1, tw, 12); fx.fillStyle = '#fff'; fx.fillText(n, tw / 2, top + 7.5); }
    });
    // bookmarks → bigger/clearer: faint full-width band + a bright amber tab on the right
    body.querySelectorAll('.blk.bm').forEach((el) => {
      const y = yOf(el), h = Math.max(6, el.getBoundingClientRect().height * scale);
      fx.fillStyle = 'rgba(232,163,61,0.26)'; fx.fillRect(0, y, W, Math.max(2, h));
      fx.fillStyle = '#e8a33d'; fx.fillRect(W - 9, y - 1, 9, Math.max(8, h + 2));
    });
    mm._full = full;
    // late-loading images → rebuild so their thumbnails appear
    body.querySelectorAll('img').forEach((img) => { if (!img.complete) img.addEventListener('load', () => scheduleMinimap(180), { once: true }); });
    syncMinimap();
  }
  function syncMinimap() {
    const mm = $('minimap'); if (!minimapOn() || !mm._full) return;
    const canvas = $('mmCanvas'), view = $('mmView'), sc = $('scroll');
    const W = Math.round(mm.clientWidth), H = Math.round(mm.clientHeight), scale = mm._scale, mapH = mm._mapH;
    const docH = sc.scrollHeight, vh = sc.clientHeight, st = sc.scrollTop;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const viewHmap = Math.max(14, vh * scale);
    const maxIndTop = Math.max(0, (mapH > H ? H : mapH) - viewHmap);
    const prog = (docH - vh) > 0 ? st / (docH - vh) : 0;
    const indTop = prog * maxIndTop;
    const offset = mapH > H ? Math.max(0, Math.min(mapH - H, st * scale - indTop)) : 0;
    ctx.drawImage(mm._full, 0, offset, W, Math.min(H, mapH - offset), 0, 0, W, Math.min(H, mapH - offset));
    view.style.top = indTop + 'px'; view.style.height = viewHmap + 'px';
    mm._indTop = indTop; mm._maxIndTop = maxIndTop; mm._viewHmap = viewHmap;
  }
  function minimapDragTo(clientY) {
    const mm = $('minimap'), sc = $('scroll'), rect = mm.getBoundingClientRect();
    const maxIndTop = mm._maxIndTop || 0;
    const indTop = Math.max(0, Math.min(maxIndTop, (clientY - rect.top) - mmGrab));
    const prog = maxIndTop > 0 ? indTop / maxIndTop : 0;
    sc.scrollTop = prog * Math.max(0, sc.scrollHeight - sc.clientHeight); // instant (no smooth) so it tracks the cursor
  }
  const scheduleMinimap = (d) => { clearTimeout(mmTimer); mmTimer = setTimeout(buildMinimap, d == null ? 250 : d); };

  /* ===================== feature guide (re-openable from 设置) ======================= */
  const GUIDE = [
    { t: '左侧大纲（▤）', b: '点左上角的 ▤ 打开 / 收起左侧大纲。它直接画在页面上、不会挤动正文：顶部是书名，下面是目录、书签、分卷，当前章节会高亮。', hl: '#t-outline' },
    { t: '下载整本（⤓）', b: '把鼠标移到左上角的 ▤ 上，右侧会浮出 ⤓ —— 点它即可导出 EPUB（含封面 / 插图）或 TXT。只有够长的书才会出现。', hl: '#clLeft', showDl: true },
    { t: '目录 · 手动分章', b: '在「目录」标签上再点一次（它会变橙色「✂️ 调整分章」）即进入分章模式：点正文段落＝在此分章，正文里的「✕ 取消分章」＝合并。完成 / 重置就在标签栏。', hl: '.tab-toc', open: true },
    { t: '书签', b: '切到「书签」标签就进入书签模式：点正文任意段落＝添加 / 移除。书签按所在章节分组；删除时先把鼠标移到书签上、点 ✕ 变红后再点一次确认。', hl: '[data-t="bm"]', open: true },
    { t: '分卷', b: '多卷作品可在「分卷」标签之间切换；切到别卷后退出沉浸阅读，网站会停在你正在读的那一卷。', hl: '[data-t="vol"]', open: true },
    { t: '阅读定位', b: '右侧浮条：上一章 / 下一章 / 回顶部（再点返回原处）；键盘 ← → 也能翻章。想快速跳转，可在设置里打开右侧「缩略图 Minimap」，拖动即可。', hl: '#rail' },
    { t: '设置与退出', b: '右上角 ⚙ 打开 / 关闭设置（主题、字号、行距、页宽、字体、缩略图，以及随时重看本向导）。读完点右下角「✕ 退出」离开沉浸阅读。', hl: '#t-set' },
  ];
  let guideIdx = 0;
  const clearGuideHl = () => root.querySelectorAll('.guide-hl').forEach((el) => el.classList.remove('guide-hl'));
  function openGuide(i) { guideIdx = i || 0; $('guide').classList.add('show'); showGuideStep(); }
  function closeGuide() { $('guide').classList.remove('show'); $('overlay').classList.remove('guide-dl'); $('guideSpot').style.display = 'none'; clearGuideHl(); try { localStorage.setItem('lkir_guided', '1'); } catch { /* */ } }
  function placeSpot(sel) {
    clearGuideHl(); const el = sel && root.querySelector(sel); const spot = $('guideSpot');
    if (!el) { spot.style.display = 'none'; return; }
    el.classList.add('guide-hl'); const r = el.getBoundingClientRect(); const pad = 6;
    spot.style.display = 'block'; spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
  }
  function showGuideStep() {
    const s = GUIDE[guideIdx]; if (!s) return;
    $('guideStep').textContent = (guideIdx + 1) + ' / ' + GUIDE.length;
    $('guideTitle').textContent = s.t; $('guideBody').textContent = s.b;
    $('guidePrev').style.visibility = guideIdx === 0 ? 'hidden' : '';
    $('guideNext').textContent = guideIdx === GUIDE.length - 1 ? '完成 ✓' : '下一步 ›';
    $('guideDots').innerHTML = GUIDE.map((_, i) => `<span class="${i === guideIdx ? 'on' : ''}"></span>`).join('');
    $('overlay').classList.toggle('guide-dl', !!s.showDl);
    // tab targets live in the outline → open it, then place the spotlight after the slide-in settles
    if (s.open && !isMobile()) { openOutline(true); $('guideSpot').style.display = 'none'; setTimeout(() => placeSpot(s.hl), 280); }
    else placeSpot(s.hl);
  }
  function maybeAutoGuide() { try { if (!localStorage.getItem('lkir_guided')) setTimeout(() => { if ($('overlay').classList.contains('open') && !$('guide').classList.contains('show')) openGuide(0); }, 1500); } catch { /* */ } }

  $('launch').onclick = () => { const a = currentAid(); if (a) openReader(a); };
  $('close').onclick = closeReader;
  $('scrim').onclick = () => { togglePanel(false); if (isMobile()) openOutline(false); };
  $('t-set').onclick = () => { if ($('setPanel').classList.contains('show')) { togglePanel(false); } else { renderSettings(); togglePanel(true); } };
  $('setClose').onclick = () => togglePanel(false);
  $('t-outline').onclick = toggleOutline;
  $('curChip').onclick = () => { selectOutlineTab('toc'); openOutline(true); };
  $('r-prev').onclick = goPrev; $('r-next').onclick = goNext; $('r-top').onclick = toggleTop;
  $('t-dlCorner').onclick = openDlg;
  $('dlgClose').onclick = closeDlg; $('dl-epub').onclick = () => doExport('epub'); $('dl-txt').onclick = () => doExport('txt');
  $('editFloat').onclick = exitMode;
  $('guidePrev').onclick = () => { if (guideIdx > 0) { guideIdx--; showGuideStep(); } };
  $('guideNext').onclick = () => { if (guideIdx < GUIDE.length - 1) { guideIdx++; showGuideStep(); } else closeGuide(); };
  $('guideSkip').onclick = closeGuide;
  // pointer capture → the drag follows the cursor reliably even over the host site's own handlers
  $('minimap').addEventListener('pointerdown', (e) => {
    const mm = $('minimap'), y = e.clientY - mm.getBoundingClientRect().top;
    const indTop = mm._indTop || 0, viewH = mm._viewHmap || 0;
    mmGrab = (y >= indTop && y <= indTop + viewH) ? (y - indTop) : viewH / 2; // keep grab point under cursor; clicking the track centers
    mmDrag = true; try { mm.setPointerCapture(e.pointerId); } catch { /* */ } minimapDragTo(e.clientY); e.preventDefault();
  });
  $('minimap').addEventListener('pointermove', (e) => { if (mmDrag) minimapDragTo(e.clientY); });
  $('minimap').addEventListener('pointerup', (e) => { mmDrag = false; try { $('minimap').releasePointerCapture(e.pointerId); } catch { /* */ } });
  $('minimap').addEventListener('pointercancel', () => { mmDrag = false; });
  window.addEventListener('resize', () => { if (minimapOn()) scheduleMinimap(120); if ($('guide').classList.contains('show')) placeSpot(GUIDE[guideIdx] && GUIDE[guideIdx].hl); });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system' && $('overlay').classList.contains('open')) applyTheme(); }); } catch { /* */ }

  let lastScroll = 0, curTick = 0;
  $('scroll').addEventListener('scroll', () => {
    const el = $('scroll'); const top = el.scrollTop; const max = el.scrollHeight - el.clientHeight;
    $('progress').style.width = (max > 0 ? Math.min(100, (top / max) * 100) : 0) + '%';
    lastScroll = top; updateTopBtn();
    if (minimapOn() && !mmRAF) mmRAF = requestAnimationFrame(() => { mmRAF = 0; syncMinimap(); });
    if (S.mode === 'stream' && Date.now() - curTick > 120) { curTick = Date.now(); updateCurrent(); }
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (!$('overlay').classList.contains('open')) return;
    if (/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
    if (e.key === 'Escape') { if ($('guide').classList.contains('show')) closeGuide(); else if (S.mode2 === 'split') exitMode(); else if (S.mode2 === 'bookmark') selectOutlineTab('toc'); else if ($('dlg').classList.contains('show')) closeDlg(); else if ($('setPanel').classList.contains('show')) togglePanel(false); else if (isMobile() && $('overlay').classList.contains('ol-on')) openOutline(false); else closeReader(); }
    else if (e.key === 'ArrowLeft') goPrev(); else if (e.key === 'ArrowRight') goNext();
  });

  /* ============== per-card 📖 buttons on list pages =============== */
  const currentAid = () => { const m = location.pathname.match(/\/detail\/(\d+)/); return m ? Number(m[1]) : null; };
  function injectCardButtons() {
    const groups = {};
    document.querySelectorAll('a[href^="/detail/"]').forEach((a) => { const m = (a.getAttribute('href') || '').match(/\/detail\/(\d+)/); if (m) (groups[m[1]] = groups[m[1]] || []).push(a); });
    Object.keys(groups).forEach((aid) => {
      const list = groups[aid]; if (list.some((a) => a.__lkir)) return;
      let target = list.find((a) => a.querySelector('img')); if (!target) target = list.slice().sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!target) return; const w = target.clientWidth, h = target.clientHeight; if (w < 40 || h < 16) return;
      target.__lkir = true; if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
      const cover = !!target.querySelector('img') || h > 70;
      const btn = document.createElement('div'); btn.textContent = '📖'; btn.title = '沉浸阅读';
      btn.style.cssText = 'position:absolute;right:6px;z-index:50;width:28px;height:28px;border-radius:8px;background:rgba(99,102,241,.95);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;opacity:0;transition:opacity .15s;box-shadow:0 2px 8px rgba(0,0,0,.35);' + (cover ? 'top:6px;' : 'top:50%;transform:translateY(-50%);');
      target.addEventListener('mouseenter', () => (btn.style.opacity = '1')); target.addEventListener('mouseleave', () => (btn.style.opacity = '0'));
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openReader(Number(aid)); });
      target.appendChild(btn);
    });
  }
  let injTimer = null; const scheduleInject = () => { clearTimeout(injTimer); injTimer = setTimeout(injectCardButtons, 300); };
  new MutationObserver(scheduleInject).observe(document.documentElement, { childList: true, subtree: true });

  /* ===================== SPA route awareness ====================== */
  let lastPath = '';
  function onRoute() {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname; const aid = currentAid();
      $('launch').style.display = aid ? '' : 'none';
      if (aid && settings.autoOpen && !suppressOpen && !$('overlay').classList.contains('open')) openReader(aid);
      if (!aid && $('overlay').classList.contains('open')) closeReader();
    }
    scheduleInject();
  }
  ['pushState', 'replaceState'].forEach((m) => { const orig = history[m]; history[m] = function () { const r = orig.apply(this, arguments); setTimeout(onRoute, 30); return r; }; });
  window.addEventListener('popstate', () => setTimeout(onRoute, 30));
  setInterval(onRoute, 800); onRoute(); injectCardButtons();
})();
