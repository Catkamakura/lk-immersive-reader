# 轻读 · LightNovel 沉浸阅读 (Tampermonkey 用户脚本)

A single-file userscript that adds a **clean, distraction-free immersive reader** to the
existing **lightnovel.fun** site — without replacing the site. It reads through the site's own
API (same-origin `/proxy/api/...`), so there are no permissions or CORS to deal with.

File: `lightnovel-immersive-reader.user.js`

## Install
1. Install **Tampermonkey** (Chrome/Edge/Firefox) or **Violentmonkey**.
2. Open the Tampermonkey dashboard → **Utilities** → **Import from file**, or just open
   `lightnovel-immersive-reader.user.js` in the browser and Tampermonkey will offer to install.
   (Or: dashboard → **+** new script → paste the file contents → save.)
3. Visit any chapter page on `https://www.lightnovel.fun/detail/<id>`.

## Use
- **On a chapter page** (`/detail/<id>`): a floating **📖 沉浸阅读** button (bottom-right) opens the reader.
- **On any list / category page** (`/category/3/106…`, home, search, ranking): hover a book and a
  small **📖** button appears in the corner — click it to read that book immersively *without leaving
  the list*.
- Inside the reader (a clean, **Google-Docs-style layout** — **no top bar**; the outline lives on the
  page itself and the few controls sit in the corners, so reading stays distraction-free):
  - **Left outline** (like the Google-Docs document outline, **drawn on the page — not a floating
    layer**): the book **title** at the top, then **目录 / 书签 / 分卷** tabs, then the chapter list with
    the current chapter as a highlighted pill and a left guide line. It tracks the chapter you're
    reading, click to jump, and updates live. **Showing or hiding it never moves the text.** Default on
    (toggle in 设置); on phones it's hidden / opens as a drawer.
  - **Top-left menu** (a ☰ 3-line icon): the menu toggles the outline; hovering it slides out **⤓ download**
    and **⚙ settings** to its right. Everything lives in this one corner now — there's no top-right control
    (so nothing can overlap the minimap). ⚙ opens the settings panel and turns into ✕ to close it, in place.
  - **Exit** is a **bottom-right pill** (“✕ 退出”), the same spot/shape as the site's “📖 沉浸阅读” button.
    Both sit a little in from the edge so toggling the minimap never shifts them.
  - A faint **current-chapter chip** sits in the bottom-left (also the chapter indicator on phones).
  - **Side rail** (right): 上一章 / 下一章 / **回顶部** (a toggle — jump to top, press again to return).
  - **Minimap** (optional, desktop): turn on **右侧缩略图 Minimap** in 设置 for a Sublime-style map on the
    right edge. It's a `<canvas>` showing the book's **actual illustration thumbnails** (the real landmarks
    of an illustrated novel), text as **miniature striped lines** (with a shorter last line per paragraph,
    like real text — not a grey block), **chapters** as faint bands + indigo divider lines **with a small
    numbered tab on the left**, and **bookmarks** as a clear amber band. A neutral grey viewport box (kept
    deliberately *not* indigo so it doesn't blend with the chapter marks) shows where you are; for a long
    book the map **scrolls** and **dragging the box tracks your cursor instantly** (grab it anywhere, or
    click the track to jump). The **native browser scrollbar is kept** — the minimap simply sits just to
    its left, so you still have both.
  - **Manual split** is folded into the **目录** tab: when you're already on 目录, hover it (it turns
    amber, reading **✂️ 调整分章**) and click to enter split mode. (Right after you *switch* to 目录 it
    won't arm until you move the mouse off and back, so you can't trigger it by accident.) In split mode
    the tab bar becomes **✓ 完成调整** (red) + **↺ 重置**; click any paragraph to split, the in-text
    **✕ 取消分章** to merge.
  - **Bookmarks**: switch to the **书签** tab — marking is **on for as long as you stay on the tab** (no
    “done” button); click any paragraph to add/remove. The list is **grouped by chapter** (each chapter
    heading, then its bookmarks beneath). Deleting needs a deliberate step: hover a bookmark to reveal
    its **✕**, click it once (it turns red, **确认删除**), click again to delete.
  - **Settings** (⚙): **theme** — defaults to **跟随系统** (follows your OS light/dark), plus **纸白 / 护眼
    / 夜间** and **自定义** (type any base colour like `#AA4A44` and it derives a readable palette). Also
    font size, line height, page width, font family, **“显示目录侧栏”**, **“右侧缩略图 Minimap”**,
    **“进入详情页自动沉浸”**, and a **“📖 功能向导 / 使用说明”** button.
  - **Feature guide**: because the UI is intentionally minimal (a lot is tucked away), a stepped
    **guide** walks through every feature and **spotlights** the relevant control — the rest of the
    screen dims so your eye goes straight to it. It pops up once on first use, and you can re-open it any
    time from **设置 → 功能向导** if you forget how something works.
  - **Keyboard**: `←` previous chapter, `→` next chapter, `Esc` (closes the guide, then leaves split /
    bookmark mode, then an open panel, then the reader).
- Settings persist in `localStorage`. If you're logged in, reading a chapter is also recorded to
  your site history (best-effort).

## Continuous reading, editable chapters, nothing deleted
- The reader is a **continuous scroll** of the whole book — chapters are seamless sections, not pages.
  **上一章 / 下一章** (and ←/→) jump the scroll to the previous/next chapter; the chapter headings stay
  **inline in the text** (we never delete them), so even an imperfect auto-split loses nothing.
- **Manual split** (left outline → 手动调整分章, or 设置): click any paragraph to start a new chapter there,
  or ✕ to merge one away — the view stays where you are (no jump to top), and the outline updates live.
  Your splits are remembered per book (localStorage).
- **核对原文末尾**: a button at the very end shows the last lines of the *raw* original, so you can
  confirm the viewer didn't drop anything.
- **Unfinished chapters** (listed in the book's 目录 but not yet translated/uploaded) are kept in the
  catalog, **greyed out and tagged 未完成**.

## Two-layer navigation: 分卷 (volumes) vs 目录 (chapters)
LK books are uploaded inconsistently, so the reader normalizes them:

- **Single big article uploaded as one "chapter"** (e.g. `/detail/1144697`, `/detail/1144700`): it's
  **auto-split into a real 目录**. Detection is **keyword-agnostic** — it finds the in-text
  `目錄/CONTENTS` block, takes those entries as the chapter titles, and splits the body where each one
  reappears (full-width/half-width digits are normalized, so `第１章` matches `第1章`). That handles
  unusual chapter words like `1訪談` / `訪談幕間` too. If there's no TOC block it falls back to
  heading-pattern + body-length detection. Images stay with their chapter.
- **Web novel already split by chapter** (e.g. `/detail/1144698`, 60+ chapters): the site's own list is
  used directly as the **目录**.
- **A series that groups separate volumes/books** (the site's original list): kept as **分卷**. A
  **目录 / 分卷** tab appears in the catalog drawer.
- **上一章 / 下一章** (and ←/→) move within the **目录** (chapters of the current book). To switch to a
  different volume/book, use **分卷**.
- When a book has both, the side rail shows **分卷** and **目录** as separate buttons (and the catalog
  drawer also has 目录 / 分卷 tabs). The shared name prefix is stripped in both lists so entries are
  distinguishable.
- Note: if a volume is only partially uploaded, its 目录 only contains the chapters that are actually in
  the content — use **分卷** to reach the complete volumes.
- **Exit lands on the volume you read**: when you switch to another volume via **分卷**, the reader keeps
  the address bar in step, and the moment you **close** the reader it navigates the underlying site to
  that volume — so leaving the reader drops you on exactly the book you were reading (no jarring reload
  mid-read; the switch happens on exit). Opening the reader from a *list* page leaves that list untouched.

## Download (EPUB / TXT)
- The **⤓** button appears only when there's a real book to export — a multi-chapter 目录, or a single
  article above a length threshold. Short notice/intro posts (e.g. `/detail/1143066`, ~900 chars) don't
  show it.
- Download is **per book**: a chapterized single article exports its chapters; a web novel exports all
  its chapters combined; reading one volume of a 分卷 series exports just that volume.
- **EPUB**: includes a **封面 cover** (the book's cover image, or the first portrait image if it has
  none), a **clickable 目录** page (tap a title to jump) plus the reader's native TOC (ncx), chapters as
  proper XHTML, and **all images embedded** so they display offline. Images are fetched via `GM_xmlhttpRequest`
  (that's the only `@grant` the script needs — `res.lightnovel.fun` blocks normal cross-origin
  fetches), and `<img src>` is rewritten to the bundled copy.
- **TXT**: a clean plain-text export (images become `［插图］` markers).
- A progress line shows download/embed status; a valid EPUB opens in Apple Books, Calibre,
  KOReader, etc.

## Notes
- Some chapters are marked **[仅APP]** (app-only) and won't return text on the web; the reader shows
  a friendly message instead of failing.
- On the first EPUB download Tampermonkey may ask you to **allow the cross-domain request** to
  `res.lightnovel.fun` (for the images) — choose *Always allow*.
- It's fully self-contained (no external libraries — EPUB zipping is hand-rolled) and runs in an
  isolated Shadow DOM, so the site's CSS can't interfere with the reader and vice-versa.
- API reads go through the site's own `/proxy/...` (same-origin); the only `@grant` is
  `GM_xmlhttpRequest`, used solely to fetch images for EPUB embedding.
