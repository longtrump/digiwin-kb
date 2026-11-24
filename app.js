(function () {
  var TYPE_LABEL = { card: "知識卡片", field: "欄位字典", error: "錯誤訊息", pdf: "PDF 全文" };
  var Y_LABEL = { error: "錯誤", howto: "步驟", explain: "說明", other: "其他" };
  var LABELS = {
    title: "標題", name: "名稱", body: "內容", content: "內容", description: "說明", desc: "說明",
    summary: "摘要", question: "問題描述", problem: "問題描述", cause: "原因", reason: "原因",
    solution: "解決方式", answer: "解決方式", resolve: "解決方式", keywords: "關鍵字", keyword: "關鍵字",
    tags: "標籤", version: "版本", ver: "版本", module: "模組", program: "程式代號", programCode: "程式代號",
    product: "產品", topic: "主題", category: "分類", url: "連結", link: "連結", href: "連結",
    message: "錯誤訊息", error: "錯誤訊息", errorMessage: "錯誤訊息", field: "欄位", fieldName: "欄位名稱",
    table: "資料表", screen: "畫面", filename: "檔名", fileName: "檔名", text: "全文",
    attachments: "附件", attachment: "附件", videos: "影片", video: "影片", remark: "備註", note: "備註",
    steps: "步驟", id: "編號", parentId: "所屬卡片"
  };
  var ORDER = ["錯誤訊息", "message", "errorMessage", "問題描述", "question", "內容", "content", "body", "說明", "description", "desc", "原因", "cause", "reason", "解決方式", "solution", "answer", "步驟", "steps", "全文", "text"];
  var loadedScripts = new Map();
  var manifest = null;
  var topicById = {};
  var searchGen = 0;
  var shown = 20;
  var lastHits = [];
  var lastQuery = "";
  var worker = null;
  var workerBroken = false;
  var ftLoaded = new Set();
  var composing = false;

  var main = document.getElementById("main");
  var qInput = document.getElementById("q");
  var verSelect = document.getElementById("ver");
  var topicClear = document.getElementById("topic-clear");

  function $(sel) { return document.querySelector(sel); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function num(n) { return Number(n || 0).toLocaleString("zh-Hant"); }
  function labelOf(key) { return LABELS[key] || key; }

  function loadScript(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("無法載入 " + src)); };
      document.head.appendChild(s);
    });
    loadedScripts.set(src, p);
    return p;
  }

  function parseHash() {
    var raw = (location.hash || "#/").replace(/^#/, "");
    if (!raw) raw = "/";
    var parts = raw.split("?");
    return { path: parts[0] || "/", params: new URLSearchParams(parts[1] || "") };
  }

  function filtersFrom(params) {
    var ty = params.get("ty");
    var types = ty ? ty.split(",").filter(Boolean) : ["card", "field", "error", "pdf"];
    return { types: types, ver: params.get("ver") || "", topic: params.get("topic") || "", y: params.get("y") || "" };
  }

  function syncControls(params, query) {
    var filters = filtersFrom(params);
    var set = {};
    filters.types.forEach(function (t) { set[t] = true; });
    document.querySelectorAll(".type-btn").forEach(function (btn) {
      btn.setAttribute("aria-pressed", set[btn.dataset.ty] ? "true" : "false");
    });
    var known = Array.prototype.some.call(verSelect.options, function (o) { return o.value === filters.ver; });
    if (known) verSelect.value = filters.ver;
    var ctype = document.getElementById("ctype");
    if (ctype) ctype.value = filters.y || "";
    if (query != null) qInput.value = query;
    topicClear.hidden = !filters.topic;
    topicClear.textContent = filters.topic ? ("清除主題：" + (topicById[filters.topic] || filters.topic)) : "清除主題";
    document.getElementById("clear-q").hidden = !qInput.value;
  }

  function selectedTypes() {
    var list = [];
    document.querySelectorAll('.type-btn[aria-pressed="true"]').forEach(function (btn) { list.push(btn.dataset.ty); });
    return list;
  }

  function buildSearchHash(query, topic) {
    var p = new URLSearchParams();
    if (query) p.set("q", query);
    var types = selectedTypes();
    if (types.length && types.length < 4) p.set("ty", types.join(","));
    if (verSelect.value) p.set("ver", verSelect.value);
    var ctype = document.getElementById("ctype");
    if (ctype && ctype.value) p.set("y", ctype.value);
    if (topic) p.set("topic", topic);
    var qs = p.toString();
    return "#/s" + (qs ? "?" + qs : "");
  }

  function setNav(path) {
    document.querySelectorAll(".nav a").forEach(function (a) {
      var on = (path === "/" || path === "/s") && a.dataset.nav === "home"
        || path === "/topics" && a.dataset.nav === "topics"
        || path.indexOf("/topic") === 0 && a.dataset.nav === "topics"
        || path === "/videos" && a.dataset.nav === "videos"
        || path === "/stats" && a.dataset.nav === "stats";
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function needles(query) {
    var raw = String(query || "").trim();
    var list = [];
    if (raw.length >= 2) list.push(raw);
    var bare = raw.replace(/[\[\]【】〔〕（）()\s\u3000]/g, "");
    if (bare.length >= 2) list.push(bare);
    raw.split(/[\s\u3000]+/).forEach(function (part) { if (part.length >= 2) list.push(part); });
    var seen = {};
    var out = [];
    list.sort(function (a, b) { return b.length - a.length; });
    list.forEach(function (item) {
      var k = item.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push(item);
    });
    return out;
  }

  function highlight(text, query) {
    var esc = escapeHtml(text);
    var ns = needles(query).map(escapeHtml);
    if (!ns.length) return esc;
    var re = new RegExp(ns.map(escapeReg).join("|"), "gi");
    return esc.replace(re, function (m) { return "<mark>" + m + "</mark>"; });
  }

  function highlightIn(el, query) {
    var ns = needles(query);
    if (!ns.length || !el) return;
    var re = new RegExp(ns.map(escapeReg).join("|"), "gi");
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) {
      var parent = walker.currentNode.parentNode;
      if (parent && parent.tagName === "MARK") continue;
      if (parent && parent.closest && parent.closest("script,style")) continue;
      nodes.push(walker.currentNode);
    }
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text || !re.test(text)) { re.lastIndex = 0; return; }
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0;
      var m;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mark = document.createElement("mark");
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
        if (m[0].length === 0) break;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    var first = el.querySelector("mark");
    if (!first) return;
    var rect = first.getBoundingClientRect();
    var visible = rect.bottom > 80 && rect.top < window.innerHeight - 24;
    if (!visible) first.scrollIntoView({ block: "nearest" });
  }

  function badge(ty) {
    return '<span class="badge ' + ty + '">' + TYPE_LABEL[ty] + "</span>";
  }

  function topicNames(field) {
    if (!field) return "";
    return field.split("|").map(function (id) { return topicById[id] || id; }).join("、");
  }

  function renderHits(hits, query) {
    if (!hits.length) {
      return '<p class="empty">找不到符合的資料。可以改用較短的詞、拿掉版本篩選，或直接貼上錯誤訊息原文。</p>';
    }
    var html = '<div class="hit-list">';
    hits.slice(0, shown).forEach(function (hit) {
      var href = "#/d?id=" + encodeURIComponent(hit.id) + (query ? "&q=" + encodeURIComponent(query) : "");
      var bits = [TYPE_LABEL[hit.ty] || hit.ty];
      if (hit.y && Y_LABEL[hit.y]) bits.push(Y_LABEL[hit.y]);
      if (hit.ver) bits.push(hit.ver);
      var tn = topicNames(hit.topic);
      if (tn) bits.push(tn);
      html += '<a class="hit" data-ty="' + hit.ty + '" href="' + href + '">'
        + '<div class="hit-title">' + badge(hit.ty) + highlight(hit.title, query) + "</div>"
        + '<div class="hit-meta">' + escapeHtml(bits.join(" · ")) + "</div>"
        + (hit.snippet ? '<p class="snippet">' + highlight(hit.snippet, query) + "</p>" : "")
        + "</a>";
    });
    html += "</div>";
    if (hits.length > shown) {
      html += '<button type="button" class="more" id="more">再顯示 ' + num(Math.min(20, hits.length - shown)) + " 筆</button>";
    }
    return html;
  }

  function statusText(phase, info) {
    if (phase === "short") return "請再輸入至少兩個字。";
    if (phase === "empty-type") return "請至少選擇一種資料類型。";
    if (phase === "loading") return "正在載入搜尋索引…";
    if (phase === "hot") return "索引符合 " + num(info.total) + " 筆，已先列出相關度較高的結果。正在補搜內文與 PDF…";
    if (phase === "progress") return "正在搜尋內文與 PDF（" + info.done + "/" + info.total + "）…";
    if (phase === "done") {
      var extra = info.ftExtra ? "，內文與 PDF 另補上 " + num(info.ftExtra) + " 筆" : "";
      return "搜尋完成，約 " + num(info.ms) + " 毫秒。索引符合 " + num(info.hotTotal) + " 筆" + extra + "。";
    }
    if (phase === "error") return info;
    return "";
  }

  function homeHtml() {
    var c = manifest.counts || {};
    var cards = [
      ["card", "知識卡片", c.card],
      ["field", "欄位字典", c.field],
      ["error", "錯誤訊息", c.error],
      ["pdf", "PDF 全文", c.pdf]
    ];
    var html = '<p class="home-lead">查欄位怎麼填、錯誤訊息怎麼解、原廠卡片與附件裡寫過的句子。</p>';
    html += '<div class="stats-row">';
    cards.forEach(function (item) {
      html += '<a class="stat" href="#/s?ty=' + item[0] + '"><b>' + num(item[2]) + '</b><span>' + item[1] + "</span></a>";
    });
    html += "</div>";
    html += "<h2>主題</h2>";
    var topics = (manifest.topics || []).filter(function (t) { return t.count > 0; }).slice(0, 12);
    if (!topics.length) topics = (manifest.topics || []).slice(0, 12);
    html += '<div class="topic-grid">';
    topics.forEach(function (t) {
      html += '<a class="topic-card" href="#/topic?id=' + encodeURIComponent(t.id) + '"><span>'
        + (t.parent ? '<small class="parent">' + escapeHtml(t.parent) + " / </small>" : "")
        + escapeHtml(t.name) + '</span><span class="count-pill">' + num(t.count) + "</span></a>";
    });
    html += '</div><p><a href="#/topics">看全部 ' + num((manifest.topics || []).length) + " 個主題</a></p>";
    return html;
  }

  function topicsHtml(filterText) {
    var q = (filterText || "").trim().toLowerCase();
    var list = manifest.topics || [];
    var html = "<h1>主題</h1><p class=\"kicker\">共 " + num(list.length) + " 個。點進去看這個主題底下的資料。</p>";
    html += '<div class="topic-tools"><label class="sr-only" for="topic-filter">篩選主題</label><input id="topic-filter" class="topic-filter" type="search" placeholder="篩選主題名稱" value="' + escapeHtml(filterText || "") + '"></div>';
    html += '<div class="topic-grid">';
    var n = 0;
    list.forEach(function (t) {
      var blob = (t.parent + " " + t.name).toLowerCase();
      if (q && blob.indexOf(q) < 0) return;
      n++;
      html += '<a class="topic-card" href="#/topic?id=' + encodeURIComponent(t.id) + '"><span>'
        + (t.parent ? '<small class="parent">' + escapeHtml(t.parent) + "<br></small>" : "")
        + escapeHtml(t.name) + '</span><span class="count-pill">' + num(t.count) + "</span></a>";
    });
    html += "</div>";
    if (!n) html += '<p class="empty">沒有名稱符合的主題。</p>';
    return html;
  }

  function filterVideos(q, topic, ver) {
    var list = manifest.videos || [];
    var query = (q || "").trim().toLowerCase();
    return list.filter(function (v) {
      if (topic && v.topic !== topic) return false;
      if (ver && v.ver !== ver) return false;
      if (!query) return true;
      var blob = (v.title + " " + v.topic + " " + v.ver + " " + v.sourceId + " " + v.url).toLowerCase();
      return blob.indexOf(query) >= 0;
    });
  }
  function videoKindLabel(kind) {
    return { mp4: "MP4，可直接播放", kbshare: "雲管家影片頁", youtube: "YouTube", youku: "優酷", bilibili: "嗶哩嗶哩", vimeo: "Vimeo", file: "影片檔" }[kind] || kind;
  }
  function videoCards(list) {
    if (!list.length) return '<p class="empty" id="video-empty">沒有符合的影片。</p>';
    var html = "";
    list.forEach(function (v) {
      html += '<article class="video-card">';
      html += "<h2>" + escapeHtml(v.title || "影片") + "</h2>";
      html += '<p class="meta">' + escapeHtml([v.topic || "未標主題", v.ver || "未標版本", videoKindLabel(v.kind)].filter(Boolean).join(" · ")) + "</p>";
      if (v.cardId) html += '<p><a href="#/d?id=' + encodeURIComponent(v.cardId) + '">知識卡片 #' + escapeHtml(v.sourceId || "") + "</a></p>";
      else if (v.recordId) html += '<p><a href="#/d?id=' + encodeURIComponent(v.recordId) + '">相關資料 #' + escapeHtml(v.sourceId || "") + "</a></p>";
      if (v.kind === "mp4" || v.kind === "file") {
        html += '<video controls preload="none" src="' + escapeHtml(v.url) + '"></video>';
      }
      html += '<a class="textish" href="' + escapeHtml(v.url) + '" target="_blank" rel="noopener noreferrer">在新分頁開啟</a>';
      html += "</article>";
    });
    return html;
  }
  function videosHtml() {
    var list = manifest.videos || [];
    var bd = manifest.videoBreakdown || {};
    var topics = [];
    var vers = [];
    var seenT = {};
    var seenV = {};
    list.forEach(function (v) {
      if (v.topic && !seenT[v.topic]) { seenT[v.topic] = 1; topics.push(v.topic); }
      if (v.ver && !seenV[v.ver]) { seenV[v.ver] = 1; vers.push(v.ver); }
    });
    topics.sort(function (a, b) { return a.localeCompare(b, "zh-Hant"); });
    vers.sort(function (a, b) { return a.localeCompare(b, "zh-Hant"); });
    var html = "<h1>影片區</h1>";
    html += '<p class="kicker">實際收錄 ' + num(list.length) + " 支。其中 MP4 " + num(bd.mp4 || 0) + " 支（kb.mjs 認定的影音，都在 es.digiwin.com/kbvideos），雲管家影片頁 " + num(bd.kbshare || 0) + " 支。YouTube 與其他影音站是 0。SKILL.md 寫 341，這份 jsonl 裡沒有那麼多影片網址。</p>";
    html += '<div class="topic-tools">';
    html += '<label class="sr-only" for="video-q">搜尋影片</label><input id="video-q" class="topic-filter" type="search" placeholder="搜尋標題、編號、主題">';
    html += '<label class="ver-label">主題 <select id="video-topic"><option value="">全部主題</option>';
    topics.forEach(function (t) { html += '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + "</option>"; });
    html += '</select></label><label class="ver-label">版本 <select id="video-ver"><option value="">全部版本</option>';
    vers.forEach(function (v) { html += '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + "</option>"; });
    html += "</select></label></div>";
    html += '<p class="status" id="video-count">顯示 ' + num(list.length) + " / " + num(list.length) + " 支</p>";
    html += '<div class="video-grid" id="video-grid">' + videoCards(list) + "</div>";
    return html;
  }
  function applyVideoFilter() {
    var qEl = document.getElementById("video-q");
    if (!qEl) return;
    var filtered = filterVideos(qEl.value, document.getElementById("video-topic").value, document.getElementById("video-ver").value);
    var grid = document.getElementById("video-grid");
    if (grid) grid.innerHTML = videoCards(filtered);
    var note = document.getElementById("video-count");
    if (note) note.textContent = "顯示 " + num(filtered.length) + " / " + num((manifest.videos || []).length) + " 支";
  }

  function statsHtml() {
    var c = manifest.counts || {};
    var when = manifest.builtAt ? new Date(manifest.builtAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "";
    var html = "<h1>統計</h1>";
    html += '<div class="callout"><strong>資料截止日：2026-11-21。</strong> 此日期之後新增或改版的鼎新文件，不在這份離線庫裡。</div>';
    html += '<div class="stats-row" style="margin-top:12px">';
    [["知識卡片", c.card], ["欄位字典", c.field], ["錯誤訊息", c.error], ["PDF 全文", c.pdf]].forEach(function (item) {
      html += '<div class="stat"><b>' + num(item[1]) + "</b><span>" + item[0] + "</span></div>";
    });
    html += "</div>";
    html += '<div class="panel"><h2>這份索引</h2><dl class="fields">';
    html += "<dt>知識卡片</dt><dd>" + num(c.card) + "</dd>";
    html += "<dt>欄位字典</dt><dd>" + num(c.field) + "</dd>";
    html += "<dt>錯誤訊息</dt><dd>" + num(c.error) + "</dd>";
    html += "<dt>主題</dt><dd>" + num((manifest.topics || []).length) + "</dd>";
    html += "<dt>PDF 全文</dt><dd>" + num(manifest.pdfTexts || c.pdf) + " 份抽出文字</dd>";
    html += "<dt>PDF 連結</dt><dd>" + num(manifest.pdfLinks) + "</dd>";
    html += "<dt>影片</dt><dd>" + num(manifest.videoLinks) + " 支（<a href=\"#/videos\">開啟影片區</a>）</dd>";
    html += "<dt>版本寫法</dt><dd>" + num((manifest.versions || []).length) + " 種</dd>";
    html += "<dt>建置時間</dt><dd>" + escapeHtml(when) + "（台北時間）</dd>";
    html += "</dl></div>";
    if (manifest.versions && manifest.versions.length) {
      html += "<h2>版本</h2><table class=\"ver-table\"><thead><tr><th>版本</th><th>筆數</th></tr></thead><tbody>";
      manifest.versions.forEach(function (v) {
        html += '<tr><td><a href="#/s?ver=' + encodeURIComponent(v.ver) + '">' + escapeHtml(v.ver) + "</a></td><td>" + num(v.count) + "</td></tr>";
      });
      html += "</tbody></table>";
    }
    if (manifest.sourceIndex && typeof manifest.sourceIndex === "object") {
      html += "<h2>原始 index.json 裡的摘要</h2><div class=\"panel\"><dl class=\"fields\">";
      Object.keys(manifest.sourceIndex).forEach(function (k) {
        var v = manifest.sourceIndex[k];
        var text = typeof v === "object" ? JSON.stringify(v) : String(v);
        html += "<dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(text) + "</dd>";
      });
      html += "</dl></div>";
    }
    html += '<p class="kicker">直接雙擊 index.html 時，搜尋在這個分頁裡進行。用 IIS 或本機伺服器開啟時，內文搜尋改在背景工作進行。</p>';
    return html;
  }

  function isEmpty(value) {
    if (value == null || value === "") return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return true;
    return false;
  }

  function looksHtml(s) { return /<\/?[a-z][\s\S]*>/i.test(s); }

  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString(String(html), "text/html");
    var blocked = { script: 1, style: 1, iframe: 1, object: 1, embed: 1, link: 1, meta: 1, form: 1, input: 1, button: 1, textarea: 1, select: 1, base: 1 };
    function clean(node) {
      Array.prototype.slice.call(node.children).forEach(function (ch) {
        var tag = ch.tagName.toLowerCase();
        if (blocked[tag]) { ch.remove(); return; }
        Array.prototype.slice.call(ch.attributes).forEach(function (attr) {
          var n = attr.name.toLowerCase();
          if (n.indexOf("on") === 0 || n === "srcdoc") ch.removeAttribute(attr.name);
          else if ((n === "href" || n === "src") && /^\s*javascript:/i.test(attr.value)) ch.removeAttribute(attr.name);
        });
        if (tag === "a") {
          var href = ch.getAttribute("href") || "";
          if (href && !/^(https?:|mailto:|#)/i.test(href)) ch.removeAttribute("href");
          ch.setAttribute("rel", "nofollow noopener noreferrer");
          ch.setAttribute("target", "_blank");
        }
        if (tag === "img") {
          var src = ch.getAttribute("src") || "";
          if (src && !/^(https?:|data:image\/)/i.test(src)) ch.removeAttribute("src");
        }
        clean(ch);
      });
    }
    clean(doc.body);
    return doc.body.innerHTML;
  }

  function linkify(escaped) {
    return escaped.replace(/https?:\/\/[^\s<]+/g, function (url) {
      var clean = url.replace(/[.,;]+$/, "");
      var tail = url.slice(clean.length);
      return '<a href="' + clean + '" target="_blank" rel="nofollow noopener noreferrer">' + clean + "</a>" + tail;
    });
  }

  function renderPlain(s) {
    return '<div class="plain">' + linkify(escapeHtml(s)) + "</div>";
  }

  function renderValue(value, depth) {
    if (isEmpty(value)) return "";
    if (typeof value === "string") {
      if (value.length > 180 || value.indexOf("\n") >= 0 || looksHtml(value)) {
        if (looksHtml(value)) return '<div class="prose">' + sanitizeHtml(value) + "</div>";
        return renderPlain(value);
      }
      return '<div class="plain">' + linkify(escapeHtml(value)) + "</div>";
    }
    if (typeof value === "number" || typeof value === "boolean") return escapeHtml(String(value));
    if (Array.isArray(value)) {
      if (value.every(function (v) { return typeof v === "string" || typeof v === "number"; })) {
        return "<ul class=\"link-list\">" + value.map(function (v) { return "<li>" + linkify(escapeHtml(v)) + "</li>"; }).join("") + "</ul>";
      }
      return value.map(function (v) { return '<div class="nested">' + renderValue(v, depth + 1) + "</div>"; }).join("");
    }
    if (typeof value === "object") {
      if (depth > 5) return "<pre class=\"plain\">" + escapeHtml(JSON.stringify(value, null, 2)) + "</pre>";
      var keys = Object.keys(value).filter(function (k) { return !isEmpty(value[k]); });
      keys.sort(function (a, b) {
        var ia = ORDER.indexOf(a);
        var ib = ORDER.indexOf(b);
        if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return a.localeCompare(b, "zh-Hant");
      });
      var html = '<dl class="fields">';
      keys.forEach(function (k) {
        html += "<dt>" + escapeHtml(labelOf(k)) + "</dt><dd>" + renderValue(value[k], depth + 1) + "</dd>";
      });
      html += "</dl>";
      return html;
    }
    return escapeHtml(String(value));
  }

  function collectLinks(value, hint, acc, depth) {
    if (value == null || depth > 8) return;
    if (typeof value === "string") {
      var re = /https?:\/\/[^\s<>"'，。、）)】\]]+/g;
      var m;
      while ((m = re.exec(value))) {
        acc.push({ url: m[0].replace(/[.,;]+$/, ""), name: hint || m[0], hint: hint || "" });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (v) { collectLinks(v, hint, acc, depth + 1); });
      return;
    }
    if (typeof value === "object") {
      var url = value.url || value.href || value.link || value["連結"] || value["網址"];
      var name = value.name || value.title || value.filename || value.fileName || value["檔名"] || value["名稱"] || hint || url;
      if (typeof url === "string" && /^https?:/i.test(url)) acc.push({ url: url, name: String(name || url), hint: hint || "" });
      Object.keys(value).forEach(function (k) {
        if (["url", "href", "link", "連結", "網址"].indexOf(k) >= 0) return;
        collectLinks(value[k], k, acc, depth + 1);
      });
    }
  }

  function classifyLink(link) {
    var u = link.url.toLowerCase();
    var h = ((link.hint || "") + " " + (link.name || "")).toLowerCase();
    if (/\.pdf(\?|#|$)/.test(u) || /附件|attach/.test(h)) return "pdf";
    if (/youtu\.be|youtube\.com|vimeo\.com|youku\.com|bilibili\.com|\.mp4(\?|#|$)|\.m3u8|影片|video/.test(u + " " + h)) return "video";
    return "web";
  }

  function detailHtml(rec, query) {
    var qlink = query ? "&q=" + encodeURIComponent(query) : "";
    var bits = [TYPE_LABEL[rec.ty] || rec.ty];
    if (rec.y && Y_LABEL[rec.y]) bits.push(Y_LABEL[rec.y]);
    if (rec.ver) bits.push("版本 " + rec.ver);
    var html = '<p class="kicker">' + escapeHtml(bits.join(" · ")) + "</p>";
    html += "<h1>" + escapeHtml(rec.title || rec.id) + "</h1>";
    var tn = topicNames(rec.topic);
    html += '<p class="meta">知識編號 #' + escapeHtml(rec.sourceId || rec.id) + (tn ? " · 主題 " + escapeHtml(tn) : "") + (rec.job ? " · 作業 " + escapeHtml(rec.job) : "") + "</p>";
    html += '<div class="actions">';
    html += '<button type="button" class="textish" id="copy-id" data-id="' + escapeHtml(rec.sourceId || rec.id) + '">複製編號</button>';
    var back = "";
    try { back = sessionStorage.getItem("kb-last") || ""; } catch (e) { back = ""; }
    if (back) html += '<a class="textish" href="' + escapeHtml(back) + '" style="padding:8px 12px;border-radius:9px;text-decoration:none">回搜尋結果</a>';
    html += "</div>";
    if (rec.keywords && rec.keywords.length) {
      html += '<ul class="keywords">';
      rec.keywords.forEach(function (kw) {
        html += '<li><a href="#/s?q=' + encodeURIComponent(kw) + '">' + escapeHtml(kw) + "</a></li>";
      });
      html += "</ul>";
    }
    if (rec.code) html += '<p class="meta">欄位代號 ' + escapeHtml(rec.code) + "</p>";
    if (rec.links && rec.links.length) {
      html += '<section class="panel"><h2>連結</h2><ul class="link-list">';
      rec.links.forEach(function (link) {
        html += '<li><strong>' + escapeHtml(link.kind) + '</strong> <a href="' + escapeHtml(link.url) + '" target="_blank" rel="nofollow noopener noreferrer">' + escapeHtml(link.url) + "</a></li>";
      });
      html += "</ul></section>";
    }
    if (rec.parents && rec.parents.length) {
      html += '<section class="panel"><h2>所屬知識卡片</h2><ul class="link-list">';
      rec.parents.forEach(function (pid) {
        html += '<li><a href="#/d?id=' + encodeURIComponent(pid) + qlink + '">#' + escapeHtml(String(pid).replace(/^card:/, "")) + "</a></li>";
      });
      html += "</ul></section>";
    }
    html += '<section class="panel" id="article"><h2>' + (rec.ty === "error" ? "對照" : rec.ty === "field" ? "欄位說明" : rec.ty === "pdf" ? "PDF 全文" : "答案") + "</h2>";
    if (rec.ty === "error") {
      html += '<dl class="fields"><dt>訊息</dt><dd class="answer">' + escapeHtml(rec.title || "") + "</dd>";
      html += "<dt>原因</dt><dd class=\"answer\">" + escapeHtml(rec.cause || "（原文未明述）") + "</dd>";
      html += "<dt>解法</dt><dd class=\"answer\">" + escapeHtml(rec.solution || "（原文未提供）") + "</dd></dl>";
    } else {
      html += '<div class="answer">' + escapeHtml(rec.answer || "（無內文）") + "</div>";
    }
    html += "</section>";
    if (rec.pdfText) {
      html += '<section class="panel"><h2>PDF 附件文字' + (rec.pdfPages ? "（" + num(rec.pdfPages) + " 頁）" : "") + '</h2><div class="answer">' + escapeHtml(rec.pdfText) + "</div></section>";
    }
    if (rec.merged && rec.merged.length > 1) {
      html += '<p class="meta">同標題合併的知識編號：' + rec.merged.map(function (n) { return "#" + escapeHtml(n); }).join("、") + "</p>";
    }
    var rel = rec.topic && manifest.related ? manifest.related[rec.topic] : null;
    if (rel && rel.length) {
      var others = rel.filter(function (item) { return item.id !== rec.id; });
      if (others.length) {
        html += '<section class="panel"><h2>同主題</h2><ul class="link-list">';
        others.forEach(function (item) {
          html += '<li>' + badge(item.ty) + '<a href="#/d?id=' + encodeURIComponent(item.id) + '">' + escapeHtml(item.title) + "</a></li>";
        });
        html += "</ul></section>";
      }
    }
    return html;
  }

  async function loadHot() {
    if (self.KB_HOT) return self.KB_HOT;
    await loadScript("idx/hot.js");
    return self.KB_HOT || [];
  }

  function runLocalSearch(query, filters, gen) {
    main.querySelector(".status").textContent = statusText("loading");
    return self.KBSearch.executeSearch({
      query: query,
      filters: filters,
      loadHot: loadHot,
      loadFtCount: async function () { return manifest.ftShards || 0; },
      loadFt: async function (i) {
        if (!ftLoaded.has(i)) {
          await loadScript("idx/ft/" + i + ".js");
          ftLoaded.add(i);
        }
        return (self.KB_FT && self.KB_FT[i]) || [];
      },
      onHot: function (res) {
        if (gen !== searchGen) return;
        lastHits = res.hits;
        shown = 20;
        paintResults(query, statusText("hot", res));
      },
      onProgress: function (res) {
        if (gen !== searchGen) return;
        lastHits = res.hits;
        paintResults(query, statusText("progress", res));
      },
      shouldStop: function () { return gen !== searchGen; }
    });
  }

  function paintResults(query, status) {
    if (parseHash().path !== "/s") return;
    var html = '<p class="status" aria-live="polite">' + escapeHtml(status) + "</p>";
    html += renderHits(lastHits, query);
    main.innerHTML = html;
  }

  function startSearch(query, filters) {
    searchGen++;
    var gen = searchGen;
    lastQuery = query;
    shown = 20;
    lastHits = [];
    try { sessionStorage.setItem("kb-last", location.hash); } catch (e) {}
    if (self.KBSearch.analyze(query).phrase.length < 2) {
      main.innerHTML = '<p class="status">' + statusText("short") + "</p>";
      return;
    }
    if (!filters.types.length) {
      main.innerHTML = '<p class="status">' + statusText("empty-type") + "</p>";
      return;
    }
    main.innerHTML = '<p class="status" aria-live="polite">' + statusText("loading") + "</p>";
    if (worker && !workerBroken) {
      worker.onmessage = function (e) {
        var msg = e.data || {};
        if (msg.gen !== gen) return;
        if (msg.type === "hot") {
          lastHits = msg.hits || [];
          shown = 20;
          paintResults(query, statusText("hot", msg));
        } else if (msg.type === "progress") {
          lastHits = msg.hits || lastHits;
          paintResults(query, statusText("progress", msg));
        } else if (msg.type === "done") {
          lastHits = msg.hits || lastHits;
          paintResults(query, statusText("done", msg));
        } else if (msg.type === "error") {
          workerBroken = true;
          runLocalSearch(query, filters, gen).then(function (res) {
            if (gen !== searchGen || !res || res.cancelled) return;
            lastHits = res.hits || [];
            paintResults(query, statusText("done", res));
          });
        }
      };
      worker.postMessage({ type: "search", gen: gen, query: query, filters: filters });
      return;
    }
    runLocalSearch(query, filters, gen).then(function (res) {
      if (gen !== searchGen || !res || res.cancelled) return;
      if (res.tooShort) {
        main.innerHTML = '<p class="status">' + statusText("short") + "</p>";
        return;
      }
      lastHits = res.hits || [];
      paintResults(query, statusText("done", res));
    }).catch(function (err) {
      if (gen !== searchGen) return;
      main.innerHTML = '<p class="status">' + escapeHtml(err.message || String(err)) + "</p>";
    });
  }

  async function showTopic(id) {
    var name = topicById[id] || id;
    main.innerHTML = "<h1>" + escapeHtml(name) + '</h1><p class="status">正在載入這個主題的資料…</p>';
    var rows = await loadHot();
    var hits = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if ((row[3] || "") !== id) continue;
      if (verSelect.value && row[2] !== verSelect.value) continue;
      var ctype = document.getElementById("ctype");
      if (ctype && ctype.value && row[8] !== ctype.value) continue;
      var types = selectedTypes();
      if (types.length && types.indexOf(row[1]) < 0) continue;
      hits.push({ id: row[0], ty: row[1], ver: row[2], topic: row[3], title: row[4], y: row[8] || "", snippet: String(row[6] || "").replace(/\s+/g, " ").slice(0, 140), score: 0 });
    }
    shown = 20;
    lastHits = hits;
    lastQuery = "";
    var html = "<h1>" + escapeHtml(name) + "</h1>";
    html += '<p class="status">這個主題有 ' + num(hits.length) + " 筆。" + (verSelect.value ? "已套用版本篩選。" : "") + "</p>";
    html += hits.length ? renderHits(hits, "") : '<p class="empty">這個主題在目前的類型與版本篩選下沒有資料。</p>';
    main.innerHTML = html;
  }

  async function showDetail(id, query) {
    main.innerHTML = '<p class="status">正在開啟資料…</p>';
    var shard = self.KBSearch.shardFor(id, manifest.contentShards);
    await loadScript("idx/c/" + shard + ".js");
    var rec = self.KB_CONTENT && self.KB_CONTENT[id];
    if (!rec) {
      main.innerHTML = '<p class="empty">找不到這筆資料（' + escapeHtml(id) + "）。</p>";
      return;
    }
    document.title = (rec.title || "資料") + " · 鼎新 Workflow ERP 知識庫";
    main.innerHTML = detailHtml(rec, query);
    window.scrollTo(0, 0);
    if (query) highlightIn(document.getElementById("article"), query);
  }

  function fillVersions() {
    var current = verSelect.value;
    var html = '<option value="">全部版本</option>';
    (manifest.versions || []).forEach(function (v) {
      html += '<option value="' + escapeHtml(v.ver) + '">' + escapeHtml(v.ver) + "（" + num(v.count) + "）</option>";
    });
    verSelect.innerHTML = html;
    verSelect.value = current;
  }

  async function render() {
    if (!manifest) return;
    window.scrollTo(0, 0);
    var loc = parseHash();
    setNav(loc.path);
    document.title = "鼎新 Workflow ERP 知識庫";
    try {
      if (loc.path === "/" || loc.path === "") {
        syncControls(loc.params, null);
        main.innerHTML = homeHtml();
        return;
      }
      if (loc.path === "/topics") {
        syncControls(loc.params, null);
        main.innerHTML = topicsHtml("");
        var box = document.getElementById("topic-filter");
        if (box) box.focus();
        return;
      }
      if (loc.path === "/videos") {
        syncControls(loc.params, null);
        main.innerHTML = videosHtml();
        return;
      }
      if (loc.path === "/stats") {
        syncControls(loc.params, null);
        main.innerHTML = statsHtml();
        return;
      }
      if (loc.path === "/topic") {
        syncControls(loc.params, null);
        await showTopic(loc.params.get("id") || "");
        return;
      }
      if (loc.path === "/d") {
        syncControls(loc.params, loc.params.get("q"));
        await showDetail(loc.params.get("id") || "", loc.params.get("q") || "");
        return;
      }
      if (loc.path === "/s") {
        var query = loc.params.get("q") || "";
        syncControls(loc.params, query);
        var filters = filtersFrom(loc.params);
        startSearch(query, filters);
        return;
      }
      main.innerHTML = homeHtml();
    } catch (err) {
      main.innerHTML = '<p class="empty">' + escapeHtml(err.message || String(err)) + "</p>";
    }
  }

  document.getElementById("search-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var loc = parseHash();
    var topic = loc.params.get("topic") || "";
    if (loc.path === "/topic") topic = loc.params.get("id") || topic;
    location.hash = buildSearchHash(qInput.value.trim(), topic);
  });

  qInput.addEventListener("compositionstart", function () { composing = true; });
  qInput.addEventListener("compositionend", function () { composing = false; document.getElementById("clear-q").hidden = !qInput.value; });
  qInput.addEventListener("input", function () {
    document.getElementById("clear-q").hidden = !qInput.value;
  });
  document.getElementById("clear-q").addEventListener("click", function () {
    qInput.value = "";
    qInput.focus();
    this.hidden = true;
  });
  document.querySelectorAll(".type-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var on = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", on ? "false" : "true");
      var loc = parseHash();
      if (loc.path === "/s") {
        location.hash = buildSearchHash(qInput.value.trim(), loc.params.get("topic") || "");
      }
    });
  });
  verSelect.addEventListener("change", function () {
    var loc = parseHash();
    if (loc.path === "/s") location.hash = buildSearchHash(qInput.value.trim(), loc.params.get("topic") || "");
    else if (loc.path === "/topic") render();
  });
  main.addEventListener("change", function (e) {
    if (e.target && (e.target.id === "video-topic" || e.target.id === "video-ver")) applyVideoFilter();
  });
  document.getElementById("ctype").addEventListener("change", function () {
    var loc = parseHash();
    if (loc.path === "/s") location.hash = buildSearchHash(qInput.value.trim(), loc.params.get("topic") || "");
    else if (loc.path === "/topic") render();
  });
  topicClear.addEventListener("click", function () {
    location.hash = buildSearchHash(qInput.value.trim(), "");
  });
  main.addEventListener("click", function (e) {
    var more = e.target.closest && e.target.closest("#more");
    if (more) {
      shown += 20;
      var loc = parseHash();
      var query = loc.path === "/s" ? (loc.params.get("q") || "") : lastQuery;
      var wrap = document.createElement("div");
      wrap.innerHTML = renderHits(lastHits, query);
      var list = main.querySelector(".hit-list");
      var next = wrap.querySelector(".hit-list");
      if (list && next) list.replaceWith(next);
      more.remove();
      var newMore = wrap.querySelector("#more");
      if (newMore) (list && list.parentNode ? list.parentNode : main).appendChild(newMore);
    }
    var copy = e.target.closest && e.target.closest("#copy-id");
    if (copy) {
      var text = copy.getAttribute("data-id") || "";
      var done = function () { copy.textContent = "已複製"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else done();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== qInput && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      qInput.focus();
    }
  });
  main.addEventListener("input", function (e) {
    if (e.target && e.target.id === "video-q") { applyVideoFilter(); return; }
    if (composing || !e.target || e.target.id !== "topic-filter") return;
    var value = e.target.value;
    var pos = e.target.selectionStart;
    var grid = main.querySelector(".topic-grid");
    var empty = main.querySelector(".empty");
    if (!grid) return;
    var holder = document.createElement("div");
    holder.innerHTML = topicsHtml(value);
    var nextGrid = holder.querySelector(".topic-grid");
    var nextEmpty = holder.querySelector(".empty");
    grid.replaceWith(nextGrid);
    if (empty) empty.remove();
    if (nextEmpty) main.appendChild(nextEmpty);
    var again = document.getElementById("topic-filter");
    if (again) {
      again.focus();
      if (pos != null) again.setSelectionRange(value.length, value.length);
    }
  });
  window.addEventListener("hashchange", function () {
    searchGen++;
    if (worker) worker.postMessage({ type: "cancel" });
    render();
  });

  try {
    if (location.protocol !== "file:") worker = new Worker(new URL("worker.js", document.baseURI));
  } catch (e) {
    worker = null;
  }
  if (worker) {
    worker.onerror = function () { workerBroken = true; };
  }

  loadScript("idx/manifest.js").then(function () {
    manifest = self.KB_MANIFEST;
    (manifest.topics || []).forEach(function (t) { topicById[t.id] = t.name; });
    fillVersions();
    render();
  }).catch(function (err) {
    main.innerHTML = '<p class="empty">讀不到索引。請先解壓縮整個資料夾，再用 Chrome 或 Edge 開啟裡面的 index.html。' + escapeHtml(err.message || "") + "</p>";
  });
})();
