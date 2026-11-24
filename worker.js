importScripts("search.js");

let manifest = null;
let hot = null;
const ftLoaded = new Set();
let jobGen = 0;

function ensureManifest() {
  if (!manifest) {
    importScripts("idx/manifest.js");
    manifest = self.KB_MANIFEST;
  }
  return manifest;
}

function ensureHot() {
  if (!hot) {
    importScripts("idx/hot.js");
    hot = self.KB_HOT || [];
  }
  return hot;
}

self.onmessage = function (e) {
  const data = e.data || {};
  if (data.type === "cancel") {
    jobGen = -1;
    return;
  }
  if (data.type === "search") {
    jobGen = data.gen;
    const gen = data.gen;
    self.KBSearch.executeSearch({
      query: data.query,
      filters: data.filters,
      loadHot: async function () { return ensureHot(); },
      loadFtCount: async function () { return ensureManifest().ftShards || 0; },
      loadFt: async function (i) {
        if (!ftLoaded.has(i)) {
          importScripts("idx/ft/" + i + ".js");
          ftLoaded.add(i);
        }
        return (self.KB_FT && self.KB_FT[i]) || [];
      },
      onHot: function (res) { postMessage(Object.assign({ type: "hot", gen: gen }, res)); },
      onProgress: function (res) { postMessage(Object.assign({ type: "progress", gen: gen }, res)); },
      shouldStop: function () { return gen !== jobGen; }
    }).then(function (res) {
      if (gen === jobGen) postMessage(Object.assign({ type: "done", gen: gen }, res));
    }).catch(function (err) {
      postMessage({ type: "error", gen: gen, message: String(err && err.message || err) });
    });
  }
};
