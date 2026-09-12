(() => {
  // web/src/state.js
  var $ = (s, r = document) => r.querySelector(s);
  var $$ = (s, r = document) => [...r.querySelectorAll(s)];
  var esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var api = async (path, params) => {
    const u = new URL(path, location.origin);
    for (const [k, v] of Object.entries(params || {}))
      if (v !== undefined && v !== "")
        u.searchParams.set(k, v);
    const r = await fetch(u);
    const j = await r.json();
    if (j.error)
      throw new Error(j.error);
    return j;
  };
  var debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  var MOD = isMac ? "metaKey" : "ctrlKey";
  var LH = 20;
  var CHUNK = 1000;
  var OVERSCAN = 24;
  var S2 = {
    meta: null,
    tabs: [],
    active: -1,
    hist: [],
    histIdx: -1,
    find: null,
    occ: null,
    lastWord: "",
    at: null,
    link: null,
    hover: null,
    hoverAnchor: null,
    lsp: { servers: [], state: "off", server: "" },
    gen: 0,
    chW: 7.8,
    wrap: true,
    lineNumbers: true
  };
  var doc_ = () => S2.active >= 0 ? S2.tabs[S2.active] : null;

  // web/src/ui.js
  var vp = $("#viewport");
  var sizer = $("#sizer");
  var rowsEl = $("#rows");
  var editor = $("#editor");
  var refmenu = $("#refmenu");
  var toastEl = $("#toast");
  var toastTimer = 0;
  function showToast(accentText, text) {
    if (!toastEl)
      return;
    toastEl.innerHTML = (accentText ? '<span class="toast-accent">' + esc(accentText) + "</span> " : "") + esc(text);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2200);
  }
  async function copyToClipboard(text, notify = "Copied to clipboard") {
    try {
      await navigator.clipboard.writeText(text);
      showToast("✓", notify);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast("✓", notify);
      } catch (err) {
        showToast("!", "Failed to copy to clipboard");
      }
      document.body.removeChild(ta);
    }
  }

  // web/src/renderer.js
  function measure() {
    const m = $("#measure");
    m.textContent = "x".repeat(100);
    S2.chW = m.getBoundingClientRect().width / 100 || 7.8;
  }
  function layout() {
    const d = doc_();
    if (!d)
      return;
    const digits = String(d.total).length;
    editor.style.setProperty("--gw", digits);
    const gutter = S2.lineNumbers ? digits * S2.chW + 30 : 16;
    const w = S2.wrap ? vp.clientWidth : Math.max(vp.clientWidth, gutter + (d.maxCols + 4) * S2.chW);
    sizer.style.height = d.total * LH + Math.max(120, vp.clientHeight * 0.5) + "px";
    sizer.style.width = w + "px";
    rowsEl.style.width = w + "px";
  }
  function toggleWordWrap(forced) {
    S2.wrap = typeof forced === "boolean" ? forced : !S2.wrap;
    document.body.classList.toggle("word-wrap", S2.wrap);
    try {
      localStorage.setItem("px0.wrap", S2.wrap ? "true" : "false");
    } catch {}
    updateEditorOptionControls();
    layout();
    render();
  }
  function toggleLineNumbers(forced) {
    S2.lineNumbers = typeof forced === "boolean" ? forced : !S2.lineNumbers;
    document.body.classList.toggle("hide-lines", !S2.lineNumbers);
    try {
      localStorage.setItem("px0.lineNumbers", S2.lineNumbers ? "true" : "false");
    } catch {}
    updateEditorOptionControls();
    layout();
    render();
  }
  function updateEditorOptionControls() {
    const wrapBtn = $('[data-action="wrap"]');
    if (wrapBtn)
      wrapBtn.classList.toggle("active", !!S2.wrap);
    const linesBtn = $('[data-action="line-numbers"]');
    if (linesBtn)
      linesBtn.classList.toggle("active", !!S2.lineNumbers);
  }
  var raf = 0;
  function render() {
    if (raf)
      return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }
  function paint() {
    const d = doc_();
    if (!d)
      return;
    const top = vp.scrollTop;
    const first = Math.max(0, Math.floor(top / LH) - OVERSCAN);
    const count = Math.ceil(vp.clientHeight / LH) + OVERSCAN * 2;
    const last = Math.min(d.total, first + count);
    ensureChunks(d, first, last);
    let html = "";
    for (let i = first;i < last; i++) {
      const n = i + 1;
      const body = d.lines[i];
      html += '<div class="row' + (n === d.cur ? " cur" : "") + '" data-l="' + n + '">' + '<div class="g">' + n + '</div><div class="c">' + (body === undefined ? "" : body) + "</div></div>";
    }
    rowsEl.style.transform = "translateY(" + first * LH + "px)";
    rowsEl.innerHTML = html;
    decorate(first, last);
  }
  function decorate(first, last) {
    const d = doc_();
    if (S2.occ) {
      for (const row of rowsEl.children)
        markNodes($(".c", row), S2.occ, true, "occ");
    }
    if (S2.link) {
      const row = rowFor(S2.link.line);
      if (row)
        wrapRange($(".c", row), S2.link.col, S2.link.col + S2.link.word.length, "link");
    }
    if (S2.find && S2.find.hits.length) {
      const byLine = S2.find.byLine;
      const act = S2.find.hits[S2.find.active];
      for (const row of rowsEl.children) {
        const n = +row.dataset.l;
        if (!byLine.has(n))
          continue;
        const marks = markNodes($(".c", row), S2.find.q, S2.find.ci, "mark");
        if (act && act.line === n && marks[act.n])
          marks[act.n].classList.add("on");
      }
    }
  }
  function markNodes(el, needle, caseSensitive, cls) {
    if (!el || !needle)
      return [];
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode();n; n = walker.nextNode())
      texts.push(n);
    for (const node of texts) {
      const raw = node.nodeValue;
      const hay = caseSensitive ? raw : raw.toLowerCase();
      const nd = caseSensitive ? needle : needle.toLowerCase();
      let i = hay.indexOf(nd), at = 0;
      if (i < 0)
        continue;
      const frag = document.createDocumentFragment();
      while (i >= 0) {
        if (i > at)
          frag.appendChild(document.createTextNode(raw.slice(at, i)));
        const mk = document.createElement(cls === "mark" ? "mark" : "span");
        if (cls !== "mark")
          mk.className = cls;
        mk.textContent = raw.slice(i, i + nd.length);
        frag.appendChild(mk);
        out.push(mk);
        at = i + nd.length;
        i = hay.indexOf(nd, at);
      }
      if (at < raw.length)
        frag.appendChild(document.createTextNode(raw.slice(at)));
      node.parentNode.replaceChild(frag, node);
    }
    return out;
  }
  function wrapRange(el, from, to, cls) {
    if (!el || to <= from)
      return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode();n; n = walker.nextNode())
      nodes.push(n);
    let at = 0, out = null;
    for (const node of nodes) {
      const len = node.nodeValue.length;
      const s = Math.max(from, at), e = Math.min(to, at + len);
      if (s < e) {
        const a = s - at, b = e - at;
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = node.nodeValue.slice(a, b);
        const frag = document.createDocumentFragment();
        if (a > 0)
          frag.appendChild(document.createTextNode(node.nodeValue.slice(0, a)));
        frag.appendChild(span);
        if (b < len)
          frag.appendChild(document.createTextNode(node.nodeValue.slice(b)));
        node.parentNode.replaceChild(frag, node);
        out = out || span;
      }
      at += len;
      if (at >= to)
        break;
    }
    return out;
  }
  function rowFor(line) {
    for (const r of rowsEl.children)
      if (+r.dataset.l === line)
        return r;
    return null;
  }
  function ensureChunks(d, first, last) {
    const c0 = Math.floor(first / CHUNK), c1 = Math.floor(Math.max(first, last - 1) / CHUNK);
    for (let c = c0;c <= c1; c++) {
      if (d.chunks.has(c) || d.pending.has(c))
        continue;
      d.pending.add(c);
      const gen = d.gen;
      api("/api/file", { path: d.path, start: c * CHUNK, count: CHUNK }).then((j) => {
        if (gen !== d.gen)
          return;
        for (let i = 0;i < j.lines.length; i++)
          d.lines[j.start + i] = j.lines[i];
        d.chunks.add(c);
        d.pending.delete(c);
        if (doc_() === d)
          render();
        if (j.refine)
          refineChunk(d, c);
      }).catch(() => d.pending.delete(c));
    }
  }
  function refineChunk(d, c, delay = 800, tries = 0) {
    if (tries === 0) {
      if (d.refining.has(c))
        return;
      d.refining.add(c);
    }
    setTimeout(async () => {
      if (!S2.tabs.includes(d) || tries > 6) {
        d.refining.delete(c);
        return;
      }
      let j;
      try {
        j = await api("/api/file", { path: d.path, start: c * CHUNK, count: CHUNK });
      } catch {
        d.refining.delete(c);
        return;
      }
      if (!S2.tabs.includes(d)) {
        d.refining.delete(c);
        return;
      }
      if (!j.exact) {
        refineChunk(d, c, Math.min(delay * 1.6, 5000), tries + 1);
        return;
      }
      d.refining.delete(c);
      let changed = false;
      for (let i = 0;i < j.lines.length; i++) {
        if (d.lines[j.start + i] !== j.lines[i]) {
          d.lines[j.start + i] = j.lines[i];
          changed = true;
        }
      }
      if (changed && doc_() === d)
        render();
    }, delay);
  }
  function initRenderer() {
    vp.addEventListener("scroll", render, { passive: true });
    new ResizeObserver(() => {
      layout();
      render();
    }).observe(editor);
  }

  // web/src/status.js
  function updateStatus() {
    const d = doc_();
    const sizeEl = $("#st-size");
    if (sizeEl)
      sizeEl.textContent = d ? fmtBytes(d.size) : "";
    const idxEl = $("#st-index");
    if (idxEl && S2.meta) {
      idxEl.textContent = S2.meta.indexMs + "ms";
      idxEl.title = `Workspace Indexing: took ${S2.meta.indexMs}ms to index ${S2.meta.files.toLocaleString()} files (${S2.meta.ready ? "ready" : "in progress"})`;
    }
    const verEl = $("#st-ver");
    if (verEl && S2.meta?.version) {
      verEl.textContent = "v" + S2.meta.version;
      verEl.title = `px0 v${S2.meta.version} (Click for shortcuts & help)`;
    }
    drawLspStatus();
  }
  function setStatusNote(msg) {
    const el = $("#st-pos");
    if (el)
      el.textContent = msg;
  }
  function fmtBytes(n) {
    if (n < 1024)
      return n + " B";
    if (n < 1048576)
      return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function setLspState(j) {
    if (!j || !j.state)
      return;
    S2.lsp.state = j.state;
    S2.lsp.server = j.server || S2.lsp.server;
    drawLspStatus();
  }
  function drawLspStatus() {
    const el = $("#st-lsp");
    const { state, server } = S2.lsp;
    if (!server || state === "off") {
      el.textContent = "";
      el.removeAttribute("data-state");
      return;
    }
    el.dataset.state = state;
    el.textContent = state === "ready" ? server : server + " " + state;
  }
  function updateMetricsDisplay(m) {
    if (!m)
      return;
    const cpuEl = $("#st-cpu");
    const ramEl = $("#st-ram");
    const contEl = $("#st-metrics");
    if (cpuEl)
      cpuEl.textContent = `CPU ${m.cpuUsage.toFixed(1)}%`;
    if (ramEl)
      ramEl.textContent = `RAM ${fmtBytes(m.rssBytes)}`;
    if (contEl) {
      contEl.title = `Editor OS Process Usage:
• Resident RAM (RSS): ${fmtBytes(m.rssBytes)}
• CPU Usage: ${m.cpuUsage.toFixed(1)}%
• Active Goroutines: ${m.goroutines || 0}`;
    }
  }
  async function refreshMetrics() {
    try {
      const m = await api("/api/metrics");
      updateMetricsDisplay(m);
    } catch {}
  }
  function initMetrics() {
    refreshMetrics();
    setInterval(refreshMetrics, 2500);
  }

  // web/src/history.js
  function pushHistory(path, line) {
    const top = S2.hist[S2.histIdx];
    if (top && top.path === path && Math.abs(top.line - line) < 2)
      return;
    S2.hist = S2.hist.slice(0, S2.histIdx + 1);
    S2.hist.push({ path, line });
    if (S2.hist.length > 120)
      S2.hist.shift();
    S2.histIdx = S2.hist.length - 1;
  }
  function go(delta) {
    const i = S2.histIdx + delta;
    if (i < 0 || i >= S2.hist.length)
      return;
    S2.histIdx = i;
    const h = S2.hist[i];
    openFile(h.path, { line: h.line, push: false });
  }

  // web/src/outline.js
  async function loadOutline() {
    const d = doc_();
    const el = $("#outline");
    if (!d) {
      if (el)
        el.innerHTML = '<div class="hint">No file open.</div>';
      return;
    }
    if (!d.outline) {
      try {
        d.outline = (await api("/api/outline", { path: d.path })).symbols || [];
      } catch {
        d.outline = [];
      }
    }
    drawOutline();
    upgradeOutline(d);
  }
  async function upgradeOutline(d) {
    if (d.outlineLSP || S2.lsp.state === "off" || S2.lsp.state === "failed")
      return;
    d.outlineLSP = true;
    let j;
    try {
      j = await api("/api/lsp/symbols", { path: d.path, wait: 20000 });
    } catch {
      d.outlineLSP = false;
      return;
    }
    setLspState(j);
    if (!j.symbols || !j.symbols.length) {
      d.outlineLSP = false;
      return;
    }
    d.outline = j.symbols;
    d.outlineSource = j.server;
    if (doc_() === d && $("#panel-outline")?.classList.contains("active"))
      drawOutline();
  }
  function drawOutline() {
    const d = doc_();
    const el = $("#outline");
    const rel = $("#right-symbols-list");
    if (!d || !d.outline) {
      if (el)
        el.innerHTML = '<div class="hint">No symbols found.</div>';
      if (rel)
        rel.innerHTML = '<div class="hint">No symbols found.</div>';
      return;
    }
    const f = ($("#outline-filter")?.value || "").toLowerCase();
    const rf = ($("#right-symbols-filter")?.value || "").toLowerCase();
    const syms = f ? d.outline.filter((s) => s.name.toLowerCase().includes(f)) : d.outline;
    const rsyms = rf ? d.outline.filter((s) => s.name.toLowerCase().includes(rf)) : d.outline;
    const renderSymHtml = (items) => {
      if (!items.length)
        return '<div class="hint">No symbols found.</div>';
      const base = Math.min(...items.map((s) => s.indent));
      return (d.outlineSource ? '<div class="hint"><span class="src">' + esc(d.outlineSource) + "</span> · " + items.length + " symbols</div>" : "") + items.map((s) => '<div class="sym" data-n="' + s.line + '" style="padding-left:' + (10 + Math.min(s.indent - base, 16) * 5) + 'px" title="Jump to ' + esc(s.name) + " at line " + s.line + '">' + '<span class="kd" data-k="' + esc(s.kind) + '">' + esc(kindLabel(s.kind)) + "</span>" + '<span class="sn">' + esc(s.name) + '</span><span class="sl">' + s.line + "</span></div>").join("");
    };
    if (el)
      el.innerHTML = renderSymHtml(syms);
    if (rel)
      rel.innerHTML = renderSymHtml(rsyms);
  }
  var KIND_LABEL = {
    func: "fn",
    method: "fn",
    fn: "fn",
    def: "fn",
    defp: "fn",
    defmacro: "mac",
    class: "cls",
    struct: "str",
    interface: "int",
    trait: "trt",
    impl: "impl",
    type: "typ",
    typealias: "typ",
    enum: "enm",
    record: "rec",
    object: "obj",
    const: "cst",
    var: "var",
    let: "var",
    val: "var",
    module: "mod",
    mod: "mod",
    namespace: "ns",
    defmodule: "mod",
    package: "pkg",
    macro: "mac",
    extension: "ext",
    protocol: "int",
    union: "uni",
    heading: "h",
    sym: "·"
  };
  function kindLabel(k) {
    return KIND_LABEL[k] || k.slice(0, 3);
  }
  function initOutline() {
    $("#outline")?.addEventListener("click", (e) => {
      const s = e.target.closest(".sym");
      if (!s)
        return;
      $$(".sym.sel").forEach((x) => x.classList.remove("sel"));
      s.classList.add("sel");
      const d = doc_();
      if (!d)
        return;
      d.cur = +s.dataset.n;
      centerLine(d.cur);
      render();
      updateStatus();
      pushHistory(d.path, d.cur);
    });
    $("#outline-filter")?.addEventListener("input", drawOutline);
  }

  // web/src/tree.js
  var treeEl = $("#tree");
  var openDirs = new Set;
  async function drawTree(dir, container, depth) {
    let j;
    try {
      j = await api("/api/tree", { dir });
    } catch {
      return;
    }
    container.innerHTML = j.children.map((c) => {
      const pad = 8 + depth * 12;
      if (c.dir) {
        return '<div class="tw"><div class="tr dir" data-dir="' + esc(c.path) + '" style="padding-left:' + pad + 'px" title="Folder: ' + esc(c.path) + '">' + '<span class="ar"></span><span class="nm">' + esc(c.name) + "</span></div>" + '<div class="kids" data-kids="' + esc(c.path) + '"></div></div>';
      }
      return '<div class="tr file" data-file="' + esc(c.path) + '" style="padding-left:' + (pad + 12) + 'px" title="Open ' + esc(c.path) + '">' + '<span class="ic" data-t="' + fileKind(c.name) + '"></span><span class="nm">' + esc(c.name) + "</span></div>";
    }).join("");
  }
  var FILE_KIND = {
    go: "code",
    js: "code",
    mjs: "code",
    cjs: "code",
    ts: "code",
    tsx: "code",
    jsx: "code",
    py: "code",
    rb: "code",
    rs: "code",
    java: "code",
    kt: "code",
    c: "code",
    h: "code",
    cc: "code",
    cpp: "code",
    hpp: "code",
    cs: "code",
    php: "code",
    swift: "code",
    lua: "code",
    ex: "code",
    exs: "code",
    scala: "code",
    dart: "code",
    sh: "code",
    bash: "code",
    zsh: "code",
    sql: "code",
    json: "data",
    yaml: "data",
    yml: "data",
    toml: "data",
    ini: "data",
    xml: "data",
    csv: "data",
    env: "data",
    lock: "data",
    mod: "data",
    sum: "data",
    md: "doc",
    markdown: "doc",
    txt: "doc",
    rst: "doc",
    adoc: "doc",
    html: "web",
    htm: "web",
    css: "web",
    scss: "web",
    less: "web",
    svg: "web",
    vue: "web",
    png: "img",
    jpg: "img",
    jpeg: "img",
    gif: "img",
    webp: "img",
    ico: "img",
    avif: "img"
  };
  function fileKind(name) {
    const i = name.lastIndexOf(".");
    return i > 0 && FILE_KIND[name.slice(i + 1).toLowerCase()] || "other";
  }
  async function revealDir(dir) {
    const parts = dir.split("/");
    for (let i = 0;i < parts.length; i++) {
      const p = parts.slice(0, i + 1).join("/");
      const row = treeEl.querySelector('[data-dir="' + CSS.escape(p) + '"]');
      if (!row)
        break;
      if (!row.classList.contains("open"))
        row.click();
      await new Promise((r) => setTimeout(r, 30));
    }
    const last = treeEl.querySelector('[data-dir="' + CSS.escape(dir) + '"]');
    if (last)
      last.scrollIntoView({ block: "center" });
  }
  async function revealFile(path) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir)
      await revealDir(dir);
    const row = treeEl.querySelector('[data-file="' + CSS.escape(path) + '"]');
    if (row) {
      $$(".tr.sel", treeEl).forEach((x) => x.classList.remove("sel"));
      row.classList.add("sel");
      row.scrollIntoView({ block: "center" });
    }
  }
  function initTree() {
    treeEl.addEventListener("click", async (e) => {
      const dirRow = e.target.closest("[data-dir]");
      if (dirRow) {
        const path = dirRow.dataset.dir;
        const kids = treeEl.querySelector('[data-kids="' + CSS.escape(path) + '"]');
        const open = dirRow.classList.toggle("open");
        kids.classList.toggle("open", open);
        if (open) {
          openDirs.add(path);
          if (!kids.dataset.loaded) {
            kids.dataset.loaded = "1";
            await drawTree(path, kids, path.split("/").length);
          }
        } else
          openDirs.delete(path);
        return;
      }
      const f = e.target.closest("[data-file]");
      if (f) {
        $$(".tr.sel", treeEl).forEach((x) => x.classList.remove("sel"));
        f.classList.add("sel");
        openFile(f.dataset.file);
      }
    });
  }

  // web/src/panels.js
  function showPanel(name) {
    document.body.classList.remove("side-hidden");
    layout();
    render();
  }
  function initPanels() {
    $("#btn-reindex").addEventListener("click", async () => {
      $("#st-index").textContent = "reindexing…";
      const j = await api("/api/reindex");
      S2.meta.files = j.files;
      S2.meta.indexMs = j.indexMs;
      treeEl.innerHTML = "";
      openDirs.clear();
      await drawTree("", treeEl, 0);
      updateStatus();
    });
    (() => {
      const rz = $("#resizer");
      let dragging = false;
      rz.addEventListener("mousedown", (e) => {
        dragging = true;
        rz.classList.add("drag");
        e.preventDefault();
      });
      addEventListener("mousemove", (e) => {
        if (!dragging)
          return;
        $("#side").style.width = Math.max(170, Math.min(620, e.clientX)) + "px";
      });
      addEventListener("mouseup", () => {
        if (dragging) {
          dragging = false;
          rz.classList.remove("drag");
          layout();
          render();
        }
      });
    })();
  }

  // web/src/search.js
  var resultsEl = $("#results");
  var lastResults = null;
  var runSearch = debounce(async () => {
    const qEl = $("#q");
    if (!qEl || !resultsEl)
      return;
    const q = qEl.value;
    if (!q.trim()) {
      resultsEl.innerHTML = "";
      return;
    }
    resultsEl.innerHTML = '<div class="hint">searching…</div>';
    const params = {
      q,
      glob: $("#glob")?.value || "",
      case: $("#o-case")?.classList.contains("on") ? 1 : "",
      word: $("#o-word")?.classList.contains("on") ? 1 : "",
      re: $("#o-re")?.classList.contains("on") ? 1 : ""
    };
    try {
      const j = await api("/api/search", params);
      renderResults(j);
    } catch (e) {
      resultsEl.innerHTML = '<div class="hint">' + esc(e.message) + "</div>";
    }
  }, 160);
  function renderResults(j) {
    lastResults = j;
    if (!resultsEl)
      return;
    if (!j.results || !j.results.length) {
      resultsEl.innerHTML = '<div class="hint">No results.</div>';
      return;
    }
    const head = j.header || j.total.toLocaleString() + " result" + (j.total === 1 ? "" : "s") + " in " + j.files.toLocaleString() + " file" + (j.files === 1 ? "" : "s") + (j.truncated ? " (truncated)" : "");
    let html = '<div class="hint">' + esc(head) + "</div>";
    for (const f of j.results) {
      html += '<div class="rfile" data-toggle="' + esc(f.path) + '" title="' + esc(f.path) + '">' + '<span class="ar">&#9660;</span>' + (f.ext ? '<span class="ext">ext</span>' : "") + '<span class="fp">' + esc(displayPath(f.path)) + "</span>" + '<span class="cnt">' + f.matches.length + "</span></div>" + '<div data-group="' + esc(f.path) + '">';
      for (const m of f.matches) {
        html += '<div class="rline" data-p="' + esc(f.path) + '" data-n="' + m.line + '" title="Jump to ' + esc(f.path) + ":" + m.line + '">' + '<span class="rn">' + m.line + '</span><span class="rt">' + esc(m.pre) + "<mark>" + esc(m.mid) + "</mark>" + esc(m.post) + "</span></div>";
      }
      html += "</div>";
    }
    resultsEl.innerHTML = html;
  }
  function displayPath(p) {
    if (p.length <= 48)
      return p;
    const parts = p.split("/");
    return "…/" + parts.slice(-3).join("/");
  }
  function initSearch() {
    if (!resultsEl)
      return;
    resultsEl.addEventListener("click", (e) => {
      const t = e.target.closest("[data-toggle]");
      if (t) {
        const g = resultsEl.querySelector('[data-group="' + CSS.escape(t.dataset.toggle) + '"]');
        const hidden = g.style.display === "none";
        g.style.display = hidden ? "" : "none";
        $(".ar", t).innerHTML = hidden ? "&#9660;" : "&#9654;";
        return;
      }
      const r = e.target.closest(".rline");
      if (r) {
        $$(".rline.sel", resultsEl).forEach((x) => x.classList.remove("sel"));
        r.classList.add("sel");
        openFile(r.dataset.p, { line: +r.dataset.n });
        const q = $("#q").value;
        if (q)
          flashFind(q);
      }
    });
    $("#q").addEventListener("input", runSearch);
    $("#glob").addEventListener("input", runSearch);
    $$(".opt").forEach((b) => b.addEventListener("click", () => {
      b.classList.toggle("on");
      runSearch();
    }));
    $("#q").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const f = $(".rline", resultsEl);
        if (f)
          f.click();
      }
    });
  }

  // web/src/inspector.js
  function showRightInspector(tab = "refs") {
    document.body.classList.remove("right-hidden");
    setRightInspectorTab(tab);
    layout();
    render();
  }
  function hideRightInspector() {
    document.body.classList.add("right-hidden");
    layout();
    render();
  }
  function setRightInspectorTab(tab) {
    $$(".inspector-tab").forEach((b) => b.classList.toggle("active", b.dataset.itab === tab));
    $("#pane-right-refs")?.classList.toggle("active", tab === "refs");
    $("#pane-right-symbols")?.classList.toggle("active", tab === "symbols");
    if (tab === "symbols") {
      loadOutline();
      $("#right-symbols-filter")?.focus();
    }
  }
  function renderRightResults(word, hits, server, isExact) {
    const targetEl = $("#right-ref-target");
    const badgeEl = $("#right-ref-badge");
    const listEl = $("#right-refs-list");
    if (!targetEl || !badgeEl || !listEl)
      return;
    targetEl.textContent = word;
    badgeEl.textContent = hits.length;
    if (!hits.length) {
      listEl.innerHTML = '<div class="hint">No references found for "<b>' + esc(word) + '</b>".</div>';
      return;
    }
    const grouped = groupHits(hits);
    const head = hits.length + " reference" + (hits.length === 1 ? "" : "s") + (server ? " · " + esc(server) : " · text search");
    let html = '<div class="hint">' + head + "</div>";
    for (const f of grouped) {
      html += '<div class="rfile" data-toggle="r-' + esc(f.path) + '" title="' + esc(f.path) + '">' + '<span class="ar">&#9660;</span>' + '<span class="fp">' + esc(displayPath(f.path)) + "</span>" + '<span class="cnt">' + f.matches.length + "</span></div>" + '<div data-group="r-' + esc(f.path) + '">';
      for (const m of f.matches) {
        html += '<div class="rline" data-p="' + esc(f.path) + '" data-n="' + m.line + '" title="Jump to ' + esc(f.path) + ":" + m.line + '">' + '<span class="rn">' + m.line + '</span><span class="rt">' + esc(m.pre) + "<mark>" + esc(m.mid || word) + "</mark>" + esc(m.post) + "</span></div>";
      }
      html += "</div>";
    }
    listEl.innerHTML = html;
  }
  async function inspectReferences(arg) {
    const d = doc_();
    const at = arg && arg.word ? arg : positionNow(typeof arg === "string" ? arg : S.lastWord);
    if (!d || !at || !at.word)
      return;
    showRightInspector("refs");
    const targetEl = $("#right-ref-target");
    const badgeEl = $("#right-ref-badge");
    const listEl = $("#right-refs-list");
    if (targetEl)
      targetEl.textContent = at.word;
    if (badgeEl)
      badgeEl.textContent = "…";
    if (listEl)
      listEl.innerHTML = '<div class="hint">Finding references for "' + esc(at.word) + '"…</div>';
    if (canAskServer(at)) {
      setStatusNote("references to " + at.word + "…");
      try {
        const j = await lspCall("refs", at, 30000);
        updateStatus();
        if (j && j.hits && j.hits.length) {
          renderRightResults(at.word, j.hits, j.server, true);
          return;
        }
      } catch {
        updateStatus();
      }
    }
    setStatusNote("searching references to " + at.word + "…");
    try {
      const j = await api("/api/search", { q: at.word, word: true, case: true });
      updateStatus();
      const hits = [];
      if (j.results) {
        for (const f of j.results) {
          for (const m of f.matches) {
            hits.push({ path: f.path, line: m.line, pre: m.pre, mid: m.mid, post: m.post });
          }
        }
      }
      renderRightResults(at.word, hits, "", false);
    } catch (err) {
      updateStatus();
      if (listEl)
        listEl.innerHTML = '<div class="hint">Search error: ' + esc(err.message) + "</div>";
    }
  }
  function initInspector() {
    $$(".inspector-tab").forEach((btn) => btn.addEventListener("click", () => {
      setRightInspectorTab(btn.dataset.itab);
    }));
    $("#btn-close-right")?.addEventListener("click", hideRightInspector);
    (() => {
      const rrz = $("#right-resizer");
      if (!rrz)
        return;
      let dragging = false;
      rrz.addEventListener("mousedown", (e) => {
        dragging = true;
        rrz.classList.add("drag");
        e.preventDefault();
      });
      addEventListener("mousemove", (e) => {
        if (!dragging)
          return;
        const w = Math.max(200, Math.min(700, window.innerWidth - e.clientX));
        $("#right-side").style.width = w + "px";
      });
      addEventListener("mouseup", () => {
        if (dragging) {
          dragging = false;
          rrz.classList.remove("drag");
          layout();
          render();
        }
      });
    })();
    $("#right-symbols-list")?.addEventListener("click", (e) => {
      const s = e.target.closest(".sym");
      if (!s)
        return;
      $$("#right-symbols-list .sym.sel, #outline .sym.sel").forEach((x) => x.classList.remove("sel"));
      s.classList.add("sel");
      const d = doc_();
      if (!d)
        return;
      d.cur = +s.dataset.n;
      centerLine(d.cur);
      render();
      updateStatus();
      pushHistory(d.path, d.cur);
    });
    $("#right-symbols-filter")?.addEventListener("input", drawOutline);
    $("#right-refs-list")?.addEventListener("click", (e) => {
      const t = e.target.closest("[data-toggle]");
      if (t) {
        const listEl = $("#right-refs-list");
        const g = listEl.querySelector('[data-group="' + CSS.escape(t.dataset.toggle) + '"]');
        if (!g)
          return;
        const hidden = g.style.display === "none";
        g.style.display = hidden ? "" : "none";
        $(".ar", t).innerHTML = hidden ? "&#9660;" : "&#9654;";
        return;
      }
      const r = e.target.closest(".rline");
      if (r) {
        $$("#right-refs-list .rline.sel").forEach((x) => x.classList.remove("sel"));
        r.classList.add("sel");
        openFile(r.dataset.p, { line: +r.dataset.n });
        const targetEl = $("#right-ref-target");
        if (targetEl && targetEl.textContent)
          flashFind(targetEl.textContent);
      }
    });
  }

  // web/src/lsp.js
  function positionNow(word) {
    const d = doc_();
    if (!d)
      return null;
    if (S2.at && S2.at.word && S2.at.path === d.path)
      return S2.at;
    if (word)
      return { word, line: d.cur, col: 0, imprecise: true };
    return null;
  }
  function canAskServer(at) {
    return !at.imprecise && (S2.lsp.state === "ready" || S2.lsp.state === "indexing");
  }
  async function warmLSP(d, tries = 0) {
    if (!d.lsp || d.lsp.state === "off" || d.lsp.state === "ready" || d.lsp.state === "failed")
      return;
    if (tries > 20)
      return;
    let j;
    try {
      j = await api("/api/lsp/warm", { path: d.path, wait: tries === 0 ? 1 : 1200 });
    } catch {
      return;
    }
    if (!S2.tabs.includes(d))
      return;
    d.lsp = { state: j.state, server: j.server };
    if (doc_() === d)
      setLspState(j);
    if (j.state === "starting" || j.state === "indexing") {
      setTimeout(() => warmLSP(d, tries + 1), 900);
    }
  }
  async function lspCall(kind, at, waitMs) {
    const d = doc_();
    if (!d)
      return null;
    try {
      const j = await api("/api/lsp/" + kind, { path: d.path, line: at.line, col: at.col, wait: waitMs });
      setLspState(j);
      return j;
    } catch {
      return null;
    }
  }
  async function gotoDefinition(arg) {
    const d = doc_();
    const at = arg && arg.word ? arg : positionNow(typeof arg === "string" ? arg : S2.lastWord);
    if (!d || !at)
      return;
    if (canAskServer(at)) {
      setStatusNote("definition of " + at.word + "…");
      const j = await lspCall("def", at, S2.lsp.state === "ready" ? 5000 : 20000);
      updateStatus();
      if (j && j.hits && j.hits.length) {
        acceptHits(at.word, j.hits, j.server, "definition");
        return;
      }
    } else if (!at.imprecise && S2.lsp.state === "starting") {
      lspCall("def", at, 60000).then((j) => {
        if (j && j.hits && j.hits.length)
          showHits(at.word, j.hits, j.server, "definition");
      });
    }
    setStatusNote("searching for " + at.word + "…");
    let rx;
    try {
      rx = await api("/api/def", { sym: at.word, path: d.path });
    } catch (e) {
      setStatusNote(e.message);
      return;
    }
    updateStatus();
    if (rx.lsp)
      setLspState(rx.lsp);
    if (!rx.defs || !rx.defs.length) {
      showPanel("search");
      const q = $("#q");
      if (q) {
        q.value = at.word;
        $("#o-word")?.classList.add("on");
        runSearch();
      }
      return;
    }
    acceptHits(at.word, rx.defs, null, "definition", rx.refCount);
  }
  async function findReferences(arg) {
    const d = doc_();
    const at = arg && arg.word ? arg : positionNow(typeof arg === "string" ? arg : S2.lastWord);
    if (!d || !at)
      return;
    inspectReferences(at);
  }
  function acceptHits(word, hits, server, noun, refCount) {
    if (hits.length === 1) {
      const h = hits[0];
      openFile(h.path, { line: h.line });
      flashFind(h.mid || word);
      setStatusNote(server ? server + " · " + h.path + ":" + h.line : h.path + ":" + h.line);
      return;
    }
    showHits(word, hits, server, noun, refCount);
  }
  function showHits(word, hits, server, noun, refCount) {
    const n = hits.length;
    let head = n + " " + noun + (n === 1 ? "" : "s") + ' of "' + word + '"';
    head += server ? "  ·  " + server : "  ·  text match, no language server";
    if (refCount)
      head += "  ·  " + refCount + " other references";
    renderResults({ results: groupHits(hits), files: 0, total: n, header: head, exact: !!server });
    showPanel("search");
  }
  function groupHits(hits) {
    const byPath = new Map;
    for (const h of hits) {
      if (!byPath.has(h.path))
        byPath.set(h.path, { path: h.path, ext: h.ext, matches: [] });
      byPath.get(h.path).matches.push(h);
    }
    return [...byPath.values()];
  }
  function flashFind(q) {
    const d = doc_();
    if (!d || !q)
      return;
    S2.find = { q, ci: true, hits: [{ line: d.cur, n: 0 }], byLine: new Set([d.cur]), active: 0 };
    setTimeout(paint, 0);
  }

  // web/src/cursor.js
  var WORD = /[A-Za-z0-9_$]/;
  function wordAtPoint(x, y) {
    let node, off;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p)
        return null;
      node = p.offsetNode;
      off = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r)
        return null;
      node = r.startContainer;
      off = r.startOffset;
    } else
      return null;
    if (!node || node.nodeType !== 3)
      return null;
    const code = node.parentElement && node.parentElement.closest(".c");
    const row = code && code.closest(".row");
    if (!code || !row)
      return null;
    let col = 0;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode();n; n = walker.nextNode()) {
      if (n === node) {
        col += off;
        break;
      }
      col += n.nodeValue.length;
    }
    const full = code.textContent;
    let a = Math.min(col, full.length), b = a;
    while (a > 0 && WORD.test(full[a - 1]))
      a--;
    while (b < full.length && WORD.test(full[b]))
      b++;
    if (a === b)
      return null;
    const d = doc_();
    return { word: full.slice(a, b), line: +row.dataset.l, col: a, path: d && d.path };
  }
  function moveCursor(delta) {
    const d = doc_();
    if (!d)
      return;
    d.cur = Math.max(1, Math.min(d.total, d.cur + delta));
    const y = (d.cur - 1) * LH;
    if (y < vp.scrollTop)
      vp.scrollTop = y - LH;
    else if (y > vp.scrollTop + vp.clientHeight - LH * 2)
      vp.scrollTop = y - vp.clientHeight + LH * 3;
    render();
    updateStatus();
  }
  function initCursor() {
    vp.addEventListener("mousedown", (e) => {
      const row = e.target.closest(".row");
      if (!row)
        return;
      const d = doc_();
      if (!d)
        return;
      d.cur = +row.dataset.l;
      updateStatus();
      const w = wordAtPoint(e.clientX, e.clientY);
      if (e[MOD] && w) {
        e.preventDefault();
        findReferences(w);
        return;
      }
      for (const r of rowsEl.children)
        r.classList.toggle("cur", +r.dataset.l === d.cur);
    });
    vp.addEventListener("dblclick", (e) => {
      const w = wordAtPoint(e.clientX, e.clientY);
      if (w) {
        S2.at = w;
        S2.lastWord = w.word;
      }
      S2.occ = w && w.word.length > 1 ? w.word : null;
      paint();
    });
  }

  // web/src/refmenu.js
  function hideRefMenu() {
    if (refmenu && !refmenu.hidden) {
      refmenu.hidden = true;
      refmenu.innerHTML = "";
    }
  }
  function getSelectedRangeInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount)
      return null;
    const d = doc_();
    if (!d)
      return null;
    const range = sel.getRangeAt(0);
    if (!vp.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== vp) {
      return null;
    }
    const text = sel.toString().trim();
    if (!text)
      return null;
    let startEl = range.startContainer;
    if (startEl.nodeType !== 1)
      startEl = startEl.parentElement;
    let endEl = range.endContainer;
    if (endEl.nodeType !== 1)
      endEl = endEl.parentElement;
    const startRow = startEl ? startEl.closest(".row") : null;
    const endRow = endEl ? endEl.closest(".row") : null;
    let l1 = d.cur || 1, l2 = d.cur || 1;
    if (startRow && startRow.dataset.l)
      l1 = +startRow.dataset.l;
    if (endRow && endRow.dataset.l)
      l2 = +endRow.dataset.l;
    if (l1 > l2) {
      const tmp = l1;
      l1 = l2;
      l2 = tmp;
    }
    const rect = range.getBoundingClientRect();
    return { text, l1, l2, rect, path: d.path };
  }
  function updateSelectionMenu() {
    const info = getSelectedRangeInfo();
    if (!info || !info.text) {
      hideRefMenu();
      return;
    }
    const { text, l1, l2, rect, path } = info;
    const refPath = path + ":" + (l1 === l2 ? l1 : l1 + "-" + l2);
    refmenu.innerHTML = '<button id="rm-copy-ref" title="Copy file and line number">Copy Ref</button>' + '<button id="rm-copy-claude" title="Copy formatted code snippet for AI Agent / LLM harness">Copy for Agent</button>' + '<button id="rm-find-refs" title="Find all occurrences across workspace">Find Usages</button>';
    const btnRef = refmenu.querySelector("#rm-copy-ref");
    const btnClaude = refmenu.querySelector("#rm-copy-claude");
    const btnFind = refmenu.querySelector("#rm-find-refs");
    if (btnRef)
      btnRef.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(refPath, "Copied " + refPath);
        hideRefMenu();
      };
    if (btnClaude)
      btnClaude.onclick = (e) => {
        e.stopPropagation();
        const ext = path.split(".").pop() || "";
        const formatted = "### Reference: " + refPath + "\n```" + ext + `
` + text + "\n```";
        copyToClipboard(formatted, "Copied snippet for Agent (" + refPath + ")");
        hideRefMenu();
      };
    if (btnFind)
      btnFind.onclick = (e) => {
        e.stopPropagation();
        hideRefMenu();
        const q = text.split(/\s+/)[0] || text;
        findReferences(q);
      };
    const edRect = editor.getBoundingClientRect();
    refmenu.hidden = false;
    const mRect = refmenu.getBoundingClientRect();
    let left = rect.left - edRect.left + (rect.width - mRect.width) / 2;
    left = Math.max(10, Math.min(edRect.width - mRect.width - 10, left));
    let top = rect.top - edRect.top - mRect.height - 8;
    if (top < 10) {
      top = rect.bottom - edRect.top + 8;
    }
    refmenu.style.left = left + "px";
    refmenu.style.top = top + "px";
  }
  function initRefMenu() {
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        hideRefMenu();
      }
    });
    vp.addEventListener("mouseup", () => {
      setTimeout(updateSelectionMenu, 20);
    });
    vp.addEventListener("keyup", (e) => {
      if (e.shiftKey)
        setTimeout(updateSelectionMenu, 20);
    });
  }

  // web/src/hover.js
  var hovercard = $("#hovercard");
  var HOVER_DELAY = 380;
  var HOVER_KEEP = 26;
  var hoverTimer = 0;
  var hoverSeq = 0;
  var moveRAF = 0;
  var pendingMove = null;
  var pointerAt = null;
  var sameWord = (a, b) => !!a && !!b && a.line === b.line && a.col === b.col && a.word === b.word;
  function onMove({ x, y, mod }) {
    if (mod) {
      const at = doc_() ? wordAtPoint(x, y) : null;
      if (!sameWord(at, S2.link)) {
        S2.link = at;
        vp.classList.toggle("linking", !!at);
        paint();
      }
      clearTimeout(hoverTimer);
      hideHover();
      return;
    }
    if (S2.link) {
      S2.link = null;
      vp.classList.remove("linking");
      paint();
    }
    if (S2.hoverAnchor) {
      if (!hovercard.hidden) {
        const rect = hovercard.getBoundingClientRect();
        if (x >= rect.left - 4 && x <= rect.right + 4 && y >= rect.top - 4 && y <= rect.bottom + 4)
          return;
      }
      const dx = x - S2.hoverAnchor.x, dy = y - S2.hoverAnchor.y;
      if (dx * dx + dy * dy > HOVER_KEEP * HOVER_KEEP)
        hideHover();
      else
        return;
    }
    if (S2.lsp.state !== "ready" && S2.lsp.state !== "indexing")
      return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => hoverAt(x, y), HOVER_DELAY);
  }
  function hoverAt(x, y) {
    const at = doc_() ? wordAtPoint(x, y) : null;
    if (at && at.word)
      showHover(at, x, y);
  }
  async function showHover(at, x, y) {
    const d = doc_();
    if (!d || at.path !== d.path)
      return;
    const seq = ++hoverSeq;
    let j;
    try {
      j = await api("/api/lsp/hover", { path: d.path, line: at.line, col: at.col, wait: 4000 });
    } catch {
      return;
    }
    if (seq !== hoverSeq || doc_() !== d)
      return;
    setLspState(j);
    if (!j || j.empty || !j.signature && !j.doc)
      return;
    S2.hover = at;
    S2.hoverAnchor = { x, y };
    const refPath = d.path + ":" + at.line;
    hovercard.innerHTML = (j.signature ? '<div class="sig">' + j.signature + "</div>" : "") + (j.doc ? '<div class="doc">' + esc(j.doc) + "</div>" : "") + '<div class="actions">' + '<button id="hc-copy-ref" title="Copy file and line reference">Copy Ref</button>' + '<button id="hc-copy-ai" title="Copy snippet with file path for AI Agent / LLMs">Copy for Agent</button>' + '<button id="hc-find-refs" title="Find all usages across codebase">Usages</button>' + "</div>" + '<div class="foot"><b>' + esc(j.server || "lsp") + "</b>" + "<span>" + (isMac ? "⌘" : "Ctrl") + "+click usages</span>" + "<span>Shift+F12 references</span></div>";
    const btnRef = hovercard.querySelector("#hc-copy-ref");
    const btnAi = hovercard.querySelector("#hc-copy-ai");
    const btnRefs = hovercard.querySelector("#hc-find-refs");
    if (btnRef)
      btnRef.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(refPath, "Copied " + refPath);
      };
    if (btnAi)
      btnAi.onclick = (e) => {
        e.stopPropagation();
        const lineText = d.lines[at.line - 1] || at.word || "";
        const ext = d.path.split(".").pop() || "";
        const text = "### Reference: " + refPath + "\n```" + ext + `
` + lineText + "\n```";
        copyToClipboard(text, "Copied snippet for Agent (" + refPath + ")");
      };
    if (btnRefs)
      btnRefs.onclick = (e) => {
        e.stopPropagation();
        hideHover();
        findReferences(at.word);
      };
    hovercard.hidden = false;
    placeHover(x, y);
  }
  function placeHover(x, y) {
    const host = editor.getBoundingClientRect();
    const card = hovercard.getBoundingClientRect();
    let left = x - host.left + 6;
    let top = y - host.top + 20;
    if (left + card.width > host.width - 12)
      left = Math.max(8, host.width - card.width - 12);
    if (top + card.height > host.height - 8) {
      const above = y - host.top - card.height - 12;
      top = above > 8 ? above : Math.max(8, host.height - card.height - 8);
    }
    hovercard.style.left = left + "px";
    hovercard.style.top = top + "px";
  }
  function hideHover() {
    hoverSeq++;
    S2.hover = null;
    S2.hoverAnchor = null;
    if (!hovercard.hidden) {
      hovercard.hidden = true;
      hovercard.innerHTML = "";
    }
  }
  function clearLink() {
    clearTimeout(hoverTimer);
    hideHover();
    if (S2.link) {
      S2.link = null;
      vp.classList.remove("linking");
      paint();
    }
  }
  function initHover() {
    vp.addEventListener("mousemove", (e) => {
      pointerAt = { x: e.clientX, y: e.clientY };
      pendingMove = { x: e.clientX, y: e.clientY, mod: e[MOD] };
      if (moveRAF)
        return;
      moveRAF = requestAnimationFrame(() => {
        moveRAF = 0;
        const m = pendingMove;
        pendingMove = null;
        if (m)
          onMove(m);
      });
    });
    vp.addEventListener("mouseleave", () => {
      pointerAt = null;
      clearLink();
    });
    vp.addEventListener("scroll", () => {
      clearTimeout(hoverTimer);
      hideHover();
      hideRefMenu();
    }, { passive: true });
    vp.addEventListener("mousedown", (e) => {
      if (e.target.closest("#hovercard") || e.target.closest("#refmenu"))
        return;
      hideHover();
      hideRefMenu();
    });
    addEventListener("keydown", (e) => {
      if ((e.key === "Control" || e.key === "Meta") && pointerAt)
        onMove({ ...pointerAt, mod: true });
    });
    addEventListener("keyup", (e) => {
      if (e.key === "Control" || e.key === "Meta")
        clearLink();
    });
  }

  // web/src/find.js
  var findbar = $("#findbar");
  var findInput = $("#find-input");
  function openFind(seed) {
    if (!doc_())
      return;
    findbar.hidden = false;
    if (seed)
      findInput.value = seed;
    findInput.focus();
    findInput.select();
    if (findInput.value)
      runFind();
  }
  function clearFind() {
    findbar.hidden = true;
    S2.find = null;
    $("#find-count").textContent = "0";
    $("#minimap-hits").innerHTML = "";
    paint();
  }
  var runFind = debounce(async () => {
    const d = doc_();
    if (!d)
      return;
    const q = findInput.value;
    if (!q) {
      S2.find = null;
      $("#find-count").textContent = "0";
      $("#minimap-hits").innerHTML = "";
      paint();
      return;
    }
    let j;
    try {
      j = await api("/api/search", { q, glob: d.path });
    } catch {
      return;
    }
    const f = (j.results || []).find((r) => r.path === d.path);
    const hits = [];
    if (f) {
      let prevLine = -1, n = 0;
      for (const m of f.matches) {
        n = m.line === prevLine ? n + 1 : 0;
        prevLine = m.line;
        hits.push({ line: m.line, n });
      }
    }
    S2.find = { q, ci: false, hits, byLine: new Set(hits.map((h) => h.line)), active: hits.length ? 0 : -1 };
    $("#find-count").textContent = hits.length ? "1 / " + hits.length : "no results";
    drawMinimap(hits, d.total);
    if (hits.length)
      jumpToHit(0);
    else
      paint();
  }, 140);
  function drawMinimap(hits, total) {
    const mm = $("#minimap-hits");
    if (!hits.length) {
      mm.innerHTML = "";
      return;
    }
    const seen = new Set;
    mm.innerHTML = hits.filter((h) => !seen.has(h.line) && seen.add(h.line)).map((h) => '<i style="top:' + ((h.line - 1) / total * 100).toFixed(3) + '%"></i>').join("");
  }
  function jumpToHit(i) {
    const d = doc_();
    if (!d || !S2.find || !S2.find.hits.length)
      return;
    const n = S2.find.hits.length;
    S2.find.active = (i % n + n) % n;
    const h = S2.find.hits[S2.find.active];
    d.cur = h.line;
    const y = (h.line - 1) * LH;
    if (y < vp.scrollTop + LH * 2 || y > vp.scrollTop + vp.clientHeight - LH * 3)
      centerLine(h.line);
    $("#find-count").textContent = S2.find.active + 1 + " / " + n;
    render();
    updateStatus();
  }
  function initFind() {
    findInput.addEventListener("input", runFind);
    findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        jumpToHit(S2.find ? S2.find.active + (e.shiftKey ? -1 : 1) : 0);
      }
      if (e.key === "Escape") {
        clearFind();
        vp.focus();
      }
    });
    $("#find-next").addEventListener("click", () => jumpToHit(S2.find ? S2.find.active + 1 : 0));
    $("#find-prev").addEventListener("click", () => jumpToHit(S2.find ? S2.find.active - 1 : 0));
    $("#find-close").addEventListener("click", clearFind);
    $("#minimap-hits").addEventListener("click", (e) => {
      const r = $("#minimap-hits").getBoundingClientRect();
      const d = doc_();
      if (!d)
        return;
      centerLine(Math.round((e.clientY - r.top) / r.height * d.total));
      render();
    });
  }

  // web/src/tabs.js
  async function openFile(path, opts = {}) {
    const { line, push = true, col } = opts;
    let idx = S2.tabs.findIndex((t) => t.path === path);
    if (idx < 0) {
      let j;
      const start = line ? Math.max(0, Math.floor((line - 1) / CHUNK) * CHUNK) : 0;
      try {
        j = await api("/api/file", { path, start, count: CHUNK });
      } catch (e) {
        setStatusNote(path + ": " + e.message);
        return;
      }
      if (j.image) {
        showImage(path);
        return;
      }
      const d2 = {
        path,
        name: path.split("/").pop(),
        lang: j.lang,
        total: j.total,
        maxCols: j.maxCols,
        size: j.size,
        lines: new Array(j.total),
        chunks: new Set([start / CHUNK]),
        pending: new Set,
        refining: new Set,
        scrollTop: 0,
        cur: line || 1,
        outline: null,
        gen: 0
      };
      for (let i = 0;i < j.lines.length; i++)
        d2.lines[j.start + i] = j.lines[i];
      d2.lsp = j.lsp || { state: "off", server: "" };
      S2.tabs.push(d2);
      idx = S2.tabs.length - 1;
      if (j.refine)
        refineChunk(d2, start / CHUNK);
    }
    const prev = doc_();
    if (prev && prev !== S2.tabs[idx])
      prev.scrollTop = vp.scrollTop;
    S2.active = idx;
    const d = S2.tabs[idx];
    $("#empty").hidden = true;
    hideImage();
    if (!S2.at || S2.at.path !== d.path)
      S2.at = null;
    S2.lsp.state = d.lsp && d.lsp.state || "off";
    S2.lsp.server = d.lsp && d.lsp.server || "";
    warmLSP(d);
    drawTabs();
    drawCrumbs();
    layout();
    if (line) {
      d.cur = line;
      centerLine(line);
    } else
      vp.scrollTop = d.scrollTop;
    render();
    updateStatus();
    if ($("#panel-outline")?.classList.contains("active"))
      loadOutline();
    if (push)
      pushHistory(path, line || d.cur, col);
  }
  function centerLine(n) {
    const y = (n - 1) * LH - Math.max(0, vp.clientHeight / 2 - LH * 2);
    vp.scrollTop = Math.max(0, y);
  }
  function closeTab(i) {
    const [closed] = S2.tabs.splice(i, 1);
    if (closed) {
      if (closed.path) {
        api("/api/close", { path: closed.path }).then(() => refreshMetrics()).catch(() => {});
      }
      closed.lines = null;
      closed.chunks?.clear?.();
      closed.pending?.clear?.();
      closed.refining?.clear?.();
      closed.outline = null;
    }
    if (S2.tabs.length === 0) {
      S2.active = -1;
      rowsEl.innerHTML = "";
      sizer.style.height = "0px";
      $("#empty").hidden = false;
      drawCrumbs();
      drawTabs();
      updateStatus();
      return;
    }
    S2.active = Math.min(i, S2.tabs.length - 1);
    const d = doc_();
    drawTabs();
    drawCrumbs();
    layout();
    vp.scrollTop = d.scrollTop;
    render();
    updateStatus();
  }
  function drawTabs() {
    $("#tabs").innerHTML = S2.tabs.map((t, i) => '<div class="tab' + (i === S2.active ? " active" : "") + '" data-i="' + i + '" title="' + esc(t.path) + '">' + '<span class="tn">' + esc(t.name) + '</span><span class="x" data-close="' + i + '" title="Close tab (Ctrl+W / Alt+W)">&times;</span></div>').join("");
    const act = $("#tabs .tab.active");
    if (act)
      act.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function switchTab(i) {
    if (i === S2.active || !S2.tabs[i])
      return;
    clearLink();
    const prev = doc_();
    if (prev)
      prev.scrollTop = vp.scrollTop;
    S2.active = i;
    clearFind();
    S2.at = null;
    S2.lsp.state = S2.tabs[i].lsp && S2.tabs[i].lsp.state || "off";
    S2.lsp.server = S2.tabs[i].lsp && S2.tabs[i].lsp.server || "";
    warmLSP(S2.tabs[i]);
    drawTabs();
    drawCrumbs();
    layout();
    vp.scrollTop = S2.tabs[i].scrollTop;
    render();
    updateStatus();
    if ($("#panel-outline")?.classList.contains("active"))
      loadOutline();
    pushHistory(S2.tabs[i].path, S2.tabs[i].cur);
  }
  function drawCrumbs() {
    const el = $("#crumbs");
    if (el)
      el.innerHTML = "";
  }
  function showImage(path) {
    hideImage();
    const box = document.createElement("div");
    box.id = "imgview";
    box.innerHTML = '<img src="/api/raw?path=' + encodeURIComponent(path) + '" alt="">';
    editor.appendChild(box);
    $("#empty").hidden = true;
  }
  function hideImage() {
    const b = $("#imgview");
    if (b)
      b.remove();
  }
  function initTabs() {
    $("#tabs").addEventListener("click", (e) => {
      const x = e.target.closest("[data-close]");
      if (x) {
        closeTab(+x.dataset.close);
        return;
      }
      const t = e.target.closest(".tab");
      if (t)
        switchTab(+t.dataset.i);
    });
    $("#tabs").addEventListener("auxclick", (e) => {
      const t = e.target.closest(".tab");
      if (t && e.button === 1) {
        e.preventDefault();
        closeTab(+t.dataset.i);
      }
    });
    const crumbsEl = $("#crumbs");
    if (crumbsEl) {
      crumbsEl.addEventListener("click", (e) => {
        const c = e.target.closest("[data-dir]");
        if (c) {
          showPanel("files");
          revealDir(c.dataset.dir);
        }
      });
    }
  }

  // web/src/shortcuts.js
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("px0.theme", next);
    } catch {}
  }
  var SHORTCUTS = [
    ["Ctrl K", "Quick search / palette"],
    ["Ctrl P", "Go to file"],
    ["Ctrl Shift P", "Command palette"],
    ["Ctrl Shift O", "Go to symbol"],
    ["Ctrl Shift F", "Search in files"],
    ["Ctrl F", "Find in file"],
    ["Ctrl G", "Go to line"],
    ["Alt Z", "Toggle word wrap"],
    ["Enter / Shift Enter", "Next / previous match"],
    ["F12 or Ctrl Click", "Go to definition"],
    ["Shift F12", "Find all references"],
    ["Ctrl J", "Toggle right inspector (Symbols/Refs)"],
    ["Alt ←  /  Alt →", "Navigate back / forward"],
    ["Ctrl B", "Toggle sidebar"],
    ["Ctrl W / Alt W", "Close tab"],
    ["Ctrl Tab", "Next tab"],
    ["Alt 1 … 9", "Select tab"],
    ["Double click", "Highlight all occurrences"],
    ["Ctrl Home / End", "Top / bottom of file"],
    ["Esc", "Dismiss"]
  ];
  function showHelp() {
    const h = $("#helpsheet");
    const ver = S2.meta?.version ? ` <span class="help-version">v${esc(S2.meta.version)}</span>` : "";
    h.innerHTML = '<div class="help-card"><div class="help-header"><h2>Keyboard Shortcuts</h2>' + ver + '</div><dl class="help-grid">' + SHORTCUTS.map(([k, v]) => "<dt>" + k.split(" ").map((x) => "<kbd>" + esc(x.replace("Ctrl", isMac ? "⌘" : "Ctrl")) + "</kbd>").join("") + "</dt>" + "<dd>" + esc(v) + "</dd>").join("") + "</dl></div>";
    h.hidden = false;
  }
  var inField = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  function initShortcuts() {
    $("#btn-theme")?.addEventListener("click", toggleTheme);
    $("#btn-help")?.addEventListener("click", showHelp);
    $("#st-ver")?.addEventListener("click", showHelp);
    $("#helpsheet").addEventListener("click", () => {
      $("#helpsheet").hidden = true;
    });
    $("#footer-actions")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".footer-btn");
      if (!btn)
        return;
      const act = btn.dataset.action;
      if (act === "quick-open")
        openPalette("file");
      else if (act === "search") {
        showPanel("search");
        $("#q")?.select();
      } else if (act === "symbols")
        openPalette("symbol");
      else if (act === "find")
        openFind(S2.lastWord);
      else if (act === "goto")
        openPalette("line");
      else if (act === "wrap")
        toggleWordWrap();
      else if (act === "line-numbers")
        toggleLineNumbers();
      else if (act === "palette")
        openPalette("command");
      else if (act === "help")
        showHelp();
    });
    addEventListener("keydown", (e) => {
      const mod = e[MOD];
      if (e.key === "Escape") {
        if (!overlay.hidden) {
          closePalette();
          return;
        }
        if (!$("#helpsheet").hidden) {
          $("#helpsheet").hidden = true;
          return;
        }
        if (!hovercard.hidden) {
          clearLink();
          return;
        }
        if (!findbar.hidden) {
          clearFind();
          return;
        }
        if (!document.body.classList.contains("right-hidden")) {
          hideRightInspector();
          return;
        }
        if (S2.occ) {
          S2.occ = null;
          paint();
          return;
        }
        if (inField(document.activeElement))
          document.activeElement.blur();
        return;
      }
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        openPalette(e.shiftKey ? "command" : "file");
        return;
      }
      if (mod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        if (document.body.classList.contains("right-hidden"))
          showRightInspector("refs");
        else
          hideRightInspector();
        return;
      }
      if (mod && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        openPalette("command");
        return;
      }
      if (mod && e.shiftKey && (e.key === "O" || e.key === "o")) {
        e.preventDefault();
        showRightInspector("symbols");
        return;
      }
      if (mod && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        showPanel("search");
        $("#q")?.select();
        return;
      }
      if (mod && !e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        openPalette("file");
        return;
      }
      if (mod && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        openPalette("line");
        return;
      }
      if (mod && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        openFind(S2.lastWord);
        return;
      }
      if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        document.body.classList.toggle("side-hidden");
        layout();
        render();
        return;
      }
      if ((mod || e.altKey) && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        e.stopPropagation();
        if (S2.active >= 0)
          closeTab(S2.active);
        return;
      }
      if (e.key === "F12") {
        e.preventDefault();
        if (e.shiftKey)
          findReferences();
        else
          gotoDefinition();
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
        return;
      }
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (S2.tabs.length > 1)
          switchTab((S2.active + (e.shiftKey ? -1 : 1) + S2.tabs.length) % S2.tabs.length);
        return;
      }
      if (e.altKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        toggleWordWrap();
        return;
      }
      if (e.altKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        toggleLineNumbers();
        return;
      }
      if (inField(document.activeElement))
        return;
      if (e.key === "?") {
        e.preventDefault();
        showHelp();
        return;
      }
      const d = doc_();
      if (!d)
        return;
      if (mod && e.key === "Home") {
        e.preventDefault();
        vp.scrollTop = 0;
        d.cur = 1;
        render();
        updateStatus();
        return;
      }
      if (mod && e.key === "End") {
        e.preventDefault();
        vp.scrollTop = sizer.offsetHeight;
        d.cur = d.total;
        render();
        updateStatus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        moveCursor(1);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        moveCursor(-1);
        return;
      }
      if (e.key === "PageDown") {
        e.preventDefault();
        moveCursor(Math.floor(vp.clientHeight / LH) - 2);
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        moveCursor(-(Math.floor(vp.clientHeight / LH) - 2));
        return;
      }
    }, { capture: true });
    window.addEventListener("beforeunload", (e) => {
      if (S2.tabs.length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  // web/src/palette.js
  var overlay = $("#overlay");
  var palInput = $("#pal");
  var palList = $("#pal-list");
  var pal = null;
  var COMMANDS = [
    { name: "Go to File…", run: () => openPalette("file") },
    { name: "Go to Symbol in File…", run: () => openPalette("symbol") },
    { name: "Go to Line…", run: () => openPalette("line") },
    { name: "Search in Files", run: () => showPanel("search") },
    { name: "Find in Current File", run: () => openFind(S2.lastWord) },
    { name: "Go to Definition", run: () => gotoDefinition() },
    { name: "Find All References (Right Panel)", run: () => findReferences() },
    { name: "Toggle Right Inspector (Symbols & References)", run: () => {
      if (document.body.classList.contains("right-hidden"))
        showRightInspector("refs");
      else
        hideRightInspector();
    } },
    { name: "Show File Symbols (Right Panel)", run: () => showRightInspector("symbols") },
    { name: "Reveal Active File in Explorer", run: () => {
      const d = doc_();
      if (d) {
        showPanel("files");
        revealFile(d.path);
      }
    } },
    { name: "Toggle Word Wrap (Alt+Z)", run: () => toggleWordWrap() },
    { name: "Toggle Line Numbers", run: () => toggleLineNumbers() },
    { name: "Toggle Sidebar", run: () => document.body.classList.toggle("side-hidden") },
    { name: "Toggle Theme", run: toggleTheme },
    { name: "Re-index Workspace", run: () => $("#btn-reindex").click() },
    { name: "Close Tab", run: () => {
      if (S2.active >= 0)
        closeTab(S2.active);
    } },
    { name: "Close All Tabs", run: () => {
      while (S2.tabs.length)
        closeTab(0);
    } },
    { name: "Keyboard Shortcuts", run: showHelp }
  ];
  var PAL_MODES = {
    file: { tag: "File", hint: "Type to fuzzy-match any file. Prefix : for a line, @ for a symbol, > for a command." },
    symbol: { tag: "Symbol", hint: "Symbols in the active file." },
    line: { tag: "Line", hint: "Enter a line number." },
    command: { tag: "Command", hint: "" }
  };
  function openPalette(mode, seed) {
    pal = { mode, items: [], sel: 0 };
    overlay.hidden = false;
    palInput.value = seed !== undefined ? seed : { symbol: "@", line: ":", command: ">" }[mode] || "";
    $("#pal-mode").textContent = PAL_MODES[mode].tag;
    $("#pal-hint").textContent = PAL_MODES[mode].hint;
    palInput.focus();
    palInput.setSelectionRange(palInput.value.length, palInput.value.length);
    refreshPalette();
  }
  function closePalette() {
    overlay.hidden = true;
    pal = null;
  }
  var refreshPalette = debounce(async () => {
    if (!pal)
      return;
    let raw = palInput.value;
    let mode = "file";
    if (raw.startsWith(">")) {
      mode = "command";
      raw = raw.slice(1);
    } else if (raw.startsWith("@")) {
      mode = "symbol";
      raw = raw.slice(1);
    } else if (raw.startsWith(":")) {
      mode = "line";
      raw = raw.slice(1);
    }
    pal.mode = mode;
    $("#pal-mode").textContent = PAL_MODES[mode].tag;
    $("#pal-hint").textContent = PAL_MODES[mode].hint;
    const q = raw.trim();
    if (mode === "line") {
      const d = doc_();
      const n = parseInt(q, 10);
      pal.items = d && n > 0 ? [{ kind: "line", n: Math.min(n, d.total), label: "Line " + Math.min(n, d.total), sub: d.path }] : [];
    } else if (mode === "command") {
      const lq = q.toLowerCase();
      pal.items = COMMANDS.filter((c) => c.name.toLowerCase().includes(lq)).map((c) => ({ kind: "cmd", cmd: c, label: c.name, sub: "" }));
    } else if (mode === "symbol") {
      const d = doc_();
      if (d && !d.outline) {
        try {
          d.outline = (await api("/api/outline", { path: d.path })).symbols || [];
        } catch {
          d.outline = [];
        }
      }
      const lq = q.toLowerCase();
      pal.items = (d && d.outline || []).filter((s) => !lq || s.name.toLowerCase().includes(lq)).slice(0, 400).map((s) => ({ kind: "sym", n: s.line, label: s.name, sub: s.kind, right: String(s.line) }));
    } else {
      let j;
      try {
        j = await api("/api/find", { q, limit: 120 });
      } catch {
        return;
      }
      pal.items = j.results.map((r) => {
        const cut = r.path.length - r.name.length;
        return {
          kind: "file",
          path: r.path,
          label: fuzzyHTML(r.path.slice(cut), (r.pos || []).filter((p) => p >= cut).map((p) => p - cut)),
          sub: fuzzyHTML(r.path.slice(0, Math.max(0, cut - 1)), (r.pos || []).filter((p) => p < cut)),
          raw: true
        };
      });
    }
    pal.sel = 0;
    drawPalette();
  }, 40);
  function fuzzyHTML(text, pos) {
    if (!pos || !pos.length)
      return esc(text);
    const set = new Set(pos);
    let out = "", open = false;
    for (let i = 0;i < text.length; i++) {
      const hit = set.has(i);
      if (hit && !open) {
        out += "<b>";
        open = true;
      }
      if (!hit && open) {
        out += "</b>";
        open = false;
      }
      out += esc(text[i]);
    }
    return out + (open ? "</b>" : "");
  }
  function drawPalette() {
    if (!pal)
      return;
    if (!pal.items.length) {
      palList.innerHTML = '<div class="pi"><span class="pp">No matches</span></div>';
      return;
    }
    palList.innerHTML = pal.items.map((it, i) => '<div class="pi' + (i === pal.sel ? " sel" : "") + '" data-i="' + i + '">' + '<span class="pn">' + (it.raw ? it.label : esc(it.label)) + "</span>" + '<span class="pp">' + (it.raw ? it.sub : esc(it.sub || "")) + "</span>" + (it.right ? '<span class="pr">' + esc(it.right) + "</span>" : "") + "</div>").join("");
    const s = palList.children[pal.sel];
    if (s)
      s.scrollIntoView({ block: "nearest" });
  }
  function movePalette(delta) {
    if (!pal || !pal.items.length)
      return;
    pal.sel = (pal.sel + delta + pal.items.length) % pal.items.length;
    drawPalette();
  }
  function acceptPalette() {
    if (!pal || !pal.items.length)
      return;
    const it = pal.items[pal.sel];
    closePalette();
    if (it.kind === "file")
      openFile(it.path);
    else if (it.kind === "sym" || it.kind === "line") {
      const d = doc_();
      if (!d)
        return;
      d.cur = it.n;
      centerLine(it.n);
      render();
      updateStatus();
      pushHistory(d.path, it.n);
    } else if (it.kind === "cmd")
      it.cmd.run();
  }
  function initPalette() {
    palInput.addEventListener("input", refreshPalette);
    palInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.ctrlKey && e.key === "n") {
        e.preventDefault();
        movePalette(1);
      } else if (e.key === "ArrowUp" || e.ctrlKey && e.key === "p") {
        e.preventDefault();
        movePalette(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        acceptPalette();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      } else if (e.key === "Tab") {
        e.preventDefault();
        movePalette(e.shiftKey ? -1 : 1);
      }
    });
    palList.addEventListener("click", (e) => {
      const p = e.target.closest(".pi");
      if (p && p.dataset.i !== undefined) {
        pal.sel = +p.dataset.i;
        acceptPalette();
      }
    });
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay)
        closePalette();
    });
  }

  // web/src/main.js
  initRenderer();
  initTabs();
  initCursor();
  initHover();
  initRefMenu();
  initTree();
  initSearch();
  initOutline();
  initPanels();
  initInspector();
  initFind();
  initPalette();
  initShortcuts();
  initMetrics();
  (async function boot() {
    try {
      const t = localStorage.getItem("px0.theme");
      if (t)
        document.documentElement.dataset.theme = t;
      const wrapPref = localStorage.getItem("px0.wrap");
      S2.wrap = wrapPref !== null ? wrapPref === "true" : true;
      document.body.classList.toggle("word-wrap", S2.wrap);
      const linesPref = localStorage.getItem("px0.lineNumbers");
      S2.lineNumbers = linesPref !== null ? linesPref === "true" : true;
      document.body.classList.toggle("hide-lines", !S2.lineNumbers);
      updateEditorOptionControls();
    } catch {}
    if (isMac) {
      document.querySelectorAll(".mod-key").forEach((el) => el.textContent = "⌘");
    }
    measure();
    S2.meta = await api("/api/meta");
    if (S2.meta.metrics)
      updateMetricsDisplay(S2.meta.metrics);
    document.title = S2.meta.name + " - px0";
    $("#root-name").textContent = S2.meta.name;
    $("#root-name").title = S2.meta.root;
    if (S2.meta.version) {
      const emptyVerEl = $("#empty-ver");
      if (emptyVerEl)
        emptyVerEl.textContent = "v" + S2.meta.version;
    }
    updateStatus();
    await drawTree("", treeEl, 0);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        measure();
        layout();
        render();
      });
    }
    if (S2.meta && !S2.meta.ready) {
      const timer = setInterval(async () => {
        try {
          const m = await api("/api/meta");
          if (m.ready) {
            clearInterval(timer);
            S2.meta = m;
            updateStatus();
          }
        } catch {
          clearInterval(timer);
        }
      }, 150);
    }
  })();
})();
