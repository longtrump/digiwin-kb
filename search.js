/* 搜尋計分對齊 bin/kb.mjs：卡片標題 10、關鍵字 6、內文 3；錯誤全文 20、訊息 8、原因 3、解法 2。
   這裡乘 10，方便和欄位字典、PDF 排在同一份結果裡。比對是字串 includes，不做斷詞。 */
(function (root) {
  function analyze(query) {
    var raw = String(query || "").trim();
    var terms = raw.split(/\s+/).filter(Boolean);
    return { raw: raw, terms: terms, phrase: raw };
  }

  function shardFor(id, n) {
    var h = 2166136261;
    var s = String(id);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % n;
  }

  function has(hay, needle) {
    return !!needle && String(hay || "").indexOf(needle) >= 0;
  }

  function pass(row, filters) {
    if (!filters) return true;
    if (filters.types && filters.types.length && filters.types.indexOf(row[1]) < 0) return false;
    if (filters.ver && row[2] !== filters.ver) return false;
    if (filters.topic && String(row[3] || "") !== filters.topic) return false;
    if (filters.y && row[1] === "card" && row[8] !== filters.y) return false;
    if (filters.y && row[1] !== "card") return false;
    return true;
  }

  function score(row, analyzed) {
    var terms = analyzed.terms;
    var query = analyzed.raw;
    if (!terms.length) return 0;
    var ty = row[1];
    var title = row[4] || "";
    var keys = row[5] || "";
    var body = row[6] || "";
    var extra = row[7] || "";
    var s = 0;
    if (ty === "card") {
      for (var i = 0; i < terms.length; i++) {
        var term = terms[i];
        if (has(title, term)) s += 100;
        if (has(keys, term)) s += 60;
        if (has(body, term)) s += 30;
      }
      if (s > 0 && title.length < 30) s += 10;
      if (/^\d+$/.test(query) && (row[0] === "card:" + query || has(extra, query))) s += 500;
    } else if (ty === "field") {
      for (var j = 0; j < terms.length; j++) {
        var f = terms[j];
        if (title === f) s += 140;
        else if (has(title, f)) s += 100;
        if (extra && extra.toUpperCase().indexOf(f.toUpperCase()) >= 0) s += 90;
        if (has(keys, f)) s += 60;
        if (has(body, f)) s += 30;
      }
      if (s > 0 && title.length < 30) s += 10;
    } else if (ty === "error") {
      if (title === query || (query.length >= 8 && has(title, query))) s += 200;
      for (var k = 0; k < terms.length; k++) {
        var e = terms[k];
        if (has(title, e)) s += 80;
        if (has(keys, e)) s += 30;
        if (has(body, e)) s += 20;
      }
    } else if (ty === "pdf") {
      for (var p = 0; p < terms.length; p++) {
        var t = terms[p];
        if (has(title, t)) s += 80;
        if (has(body, t)) s += 25;
      }
    }
    return s;
  }

  function makeSnippet(original, analyzed) {
    var text = String(original || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    var needles = analyzed.terms.slice();
    if (analyzed.raw && needles.indexOf(analyzed.raw) < 0) needles.unshift(analyzed.raw);
    var at = -1;
    var n = "";
    for (var i = 0; i < needles.length; i++) {
      var pos = text.indexOf(needles[i]);
      if (pos >= 0) { at = pos; n = needles[i]; break; }
    }
    if (at < 0) return text.slice(0, 160);
    var start = Math.max(0, at - 36);
    var end = Math.min(text.length, at + n.length + 100);
    var out = text.slice(start, end);
    if (start > 0) out = "…" + out;
    if (end < text.length) out += "…";
    return out;
  }

  function toHit(row, sc, analyzed) {
    var blob = (row[4] || "") + " " + (row[5] || "") + " " + (row[6] || "");
    return {
      id: row[0],
      ty: row[1],
      ver: row[2] || "",
      topic: row[3] || "",
      title: row[4] || row[0],
      y: row[8] || "",
      seq: row[9] || 0,
      score: sc,
      snippet: makeSnippet(blob, analyzed)
    };
  }

  function sortHits(hits) {
    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (a.seq || 0) - (b.seq || 0);
    });
    return hits;
  }

  function searchHot(rows, analyzed, filters) {
    var hits = [];
    var total = 0;
    if (!rows || !analyzed.terms.length) return { total: 0, hits: [] };
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!pass(row, filters)) continue;
      var sc = score(row, analyzed);
      if (sc <= 0) continue;
      total++;
      hits.push(toHit(row, sc, analyzed));
    }
    sortHits(hits);
    return { total: total, hits: hits.slice(0, 80) };
  }

  function searchFt() { return { total: 0, hits: [] }; }

  function yieldThread() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  async function executeSearch(opts) {
    var analyzed = analyze(opts.query);
    if (!analyzed.terms.length || analyzed.raw.length < 2) {
      return { tooShort: true, hits: [], total: 0, done: true };
    }
    var t0 = Date.now();
    var hot = await opts.loadHot();
    var hotRes = searchHot(hot, analyzed, opts.filters);
    if (opts.onHot) opts.onHot({ hits: hotRes.hits, total: hotRes.total, ms: Date.now() - t0 });
    var ftCount = await opts.loadFtCount();
    for (var s = 0; s < ftCount; s++) {
      if (opts.shouldStop && opts.shouldStop()) return { cancelled: true };
      await opts.loadFt(s);
      if (opts.onProgress) opts.onProgress({ done: s + 1, total: ftCount, hits: hotRes.hits, ms: Date.now() - t0 });
      await yieldThread();
    }
    return { done: true, hits: hotRes.hits, hotTotal: hotRes.total, ftExtra: 0, ms: Date.now() - t0 };
  }

  root.KBSearch = {
    analyze: analyze,
    shardFor: shardFor,
    searchHot: searchHot,
    searchFt: searchFt,
    executeSearch: executeSearch,
    makeSnippet: makeSnippet,
    score: score
  };
})(typeof self !== "undefined" ? self : globalThis);
