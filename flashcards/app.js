const state = {
  manifest: null,
  deck: null,
  deckId: "",
  idx: 0,
  marks: {},
  answerOpen: false,
  filtered: [],
  speaking: false
};

const $ = id => document.getElementById(id);

async function init() {
  state.manifest = getEmbeddedManifest() || await loadJson("decks/manifest.json");
  $("deckSelect").innerHTML = state.manifest.decks
    .map(deck => `<option value="${deck.id}">${deck.title}</option>`)
    .join("");
  bindEvents();
  setTheme(localStorage.getItem("fc_theme") || "dark");
  setView(localStorage.getItem("fc_view") || "auto");
  setMobileTools(localStorage.getItem("fc_mobile_tools") || "expanded");
  const requestedDeck = new URLSearchParams(location.search).get("deck");
  const savedDeck = localStorage.getItem("fc_deck");
  await loadDeck(requestedDeck || savedDeck || state.manifest.decks[0].id);
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`无法加载 ${url}`);
  return response.json();
}

async function loadDeck(deckId) {
  stopSpeech();
  const meta = state.manifest.decks.find(deck => deck.id === deckId) || state.manifest.decks[0];
  state.deck = getEmbeddedDeck(meta.id) || await loadJson(meta.file);
  state.deckId = meta.id;
  state.idx = Number(localStorage.getItem(key("idx")) || 0);
  state.marks = JSON.parse(localStorage.getItem(key("marks")) || "{}");
  state.answerOpen = false;
  $("deckSelect").value = meta.id;
  $("appTitle").textContent = state.deck.title;
  $("deckDescription").textContent = state.deck.description || "选择闪卡开始复习";
  localStorage.setItem("fc_deck", meta.id);
  initSections();
  applyFilters();
}

function getEmbeddedManifest() {
  return window.FLASHCARD_LIBRARY && window.FLASHCARD_LIBRARY.manifest;
}

function getEmbeddedDeck(deckId) {
  return window.FLASHCARD_LIBRARY &&
    window.FLASHCARD_LIBRARY.decks &&
    window.FLASHCARD_LIBRARY.decks[deckId];
}

function key(name) {
  return `fc_${state.deckId}_${name}`;
}

function initSections() {
  const sections = [...new Set(state.deck.cards.map(card => card.s))];
  $("section").innerHTML = '<option value="">全部章节</option>' +
    sections.map(section => `<option value="${escapeAttr(section)}">${section}</option>`).join("");
}

function applyFilters() {
  stopSpeech();
  const query = $("search").value.trim().toLowerCase();
  const section = $("section").value;
  const status = $("status").value;
  const cards = state.deck.cards;
  state.filtered = cards.map((card, index) => ({ card, index })).filter(({ card, index }) => {
    const mark = state.marks[index] || "new";
    const text = [
      String(index + 1).padStart(3, "0"),
      card.s, card.q, card.t,
      ...(card.p || []),
      ...(card.m || []),
      card.k || ""
    ].join(" ").toLowerCase();
    return (!query || text.includes(query)) &&
      (!section || card.s === section) &&
      (!status || mark === status);
  }).map(item => item.index);
  if (!state.filtered.includes(state.idx)) state.idx = state.filtered[0] ?? 0;
  state.answerOpen = false;
  render();
}

function render() {
  if (!state.deck) return;
  localStorage.setItem(key("idx"), state.idx);
  const cards = state.deck.cards;
  const good = Object.values(state.marks).filter(value => value === "good").length;
  const bad = Object.values(state.marks).filter(value => value === "bad").length;
  $("totalCount").textContent = state.filtered.length;
  $("goodCount").textContent = good;
  $("badCount").textContent = bad;
  $("meter").style.width = `${Math.round(good / cards.length * 100)}%`;
  renderList();
  renderStage();
  updateSpeakButton();
}

function renderList() {
  $("cardList").innerHTML = state.filtered.map(index => {
    const card = state.deck.cards[index];
    const mark = state.marks[index] || "new";
    return `<button class="${index === state.idx ? "active" : ""}" data-index="${index}">
      <span class="num">${String(index + 1).padStart(3, "0")}</span>
      <span class="q">${escapeHtml(card.q)}</span>
      <span class="dot ${mark === "good" ? "good" : mark === "bad" ? "bad" : ""}"></span>
    </button>`;
  }).join("");
  document.querySelectorAll("#cardList button").forEach(button => {
    button.onclick = () => {
      state.idx = Number(button.dataset.index);
      state.answerOpen = false;
      render();
    };
  });
}

function renderStage() {
  if (!state.filtered.length) {
    $("stage").innerHTML = `<div class="empty">没有匹配的闪卡</div>`;
    return;
  }
  const card = state.deck.cards[state.idx];
  $("stage").innerHTML = `<article class="card">
    <div class="head">
      <div>
        <div class="section">${escapeHtml(card.s)}</div>
        <div class="small">闪卡 ${String(state.idx + 1).padStart(3, "0")} / ${state.deck.cards.length}</div>
      </div>
      <div class="small">${state.filtered.indexOf(state.idx) + 1} / ${state.filtered.length}</div>
    </div>
    <div class="question"><h2>${escapeHtml(card.q)}</h2></div>
    <div class="answer ${state.answerOpen ? "open" : ""}">${renderAnswer(card)}</div>
  </article>`;
  $("show").textContent = state.answerOpen ? "隐藏答案" : "显示答案";
}

function renderAnswer(card) {
  return `<div class="grid">
    <div class="block full"><h3>一句话结论</h3><div class="tagline">${escapeHtml(card.t)}</div></div>
    <div class="block"><h3>必须记住</h3><ul>${(card.p || []).map(point => `<li>${escapeHtml(point)}</li>`).join("")}</ul></div>
    <div class="block"><h3>容易误用</h3><ul>${(card.m || []).map(point => `<li>${escapeHtml(point)}</li>`).join("")}</ul></div>
    <div class="block full"><h3>记忆钩子</h3><div class="formula">${escapeHtml(card.k || "")}</div></div>
  </div>`;
}

function move(delta) {
  if (!state.filtered.length) return;
  stopSpeech();
  const pos = state.filtered.indexOf(state.idx);
  state.idx = state.filtered[(pos + delta + state.filtered.length) % state.filtered.length];
  state.answerOpen = false;
  render();
}

function mark(value) {
  state.marks[state.idx] = value;
  localStorage.setItem(key("marks"), JSON.stringify(state.marks));
  move(1);
}

function bindEvents() {
  $("deckSelect").onchange = event => loadDeck(event.target.value);
  $("search").oninput = applyFilters;
  $("section").onchange = applyFilters;
  $("status").onchange = applyFilters;
  $("show").onclick = () => {
    state.answerOpen = !state.answerOpen;
    stopSpeech();
    render();
  };
  $("speak").onclick = toggleSpeech;
  $("prev").onclick = () => move(-1);
  $("nextMobile").onclick = () => move(1);
  $("markGood").onclick = () => mark("good");
  $("markGoodMobile").onclick = () => mark("good");
  $("markBad").onclick = () => mark("bad");
  $("reviewBad").onclick = () => {
    $("status").value = "bad";
    applyFilters();
  };
  $("reset").onclick = () => {
    if (!confirm("确定清空当前卡组学习进度？")) return;
    state.marks = {};
    localStorage.removeItem(key("marks"));
    render();
  };
  $("darkBtn").onclick = () => setTheme("dark");
  $("lightBtn").onclick = () => setTheme("light");
  $("autoView").onclick = () => setView("auto");
  $("desktopView").onclick = () => setView("desktop");
  $("mobileView").onclick = () => setView("mobile");
  $("mobileToolsToggle").onclick = () => {
    const next = document.body.classList.contains("mobile-tools-collapsed") ? "expanded" : "collapsed";
    setMobileTools(next);
  };
  document.addEventListener("keydown", event => {
    if (["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
    if (event.key === " ") {
      event.preventDefault();
      state.answerOpen = !state.answerOpen;
      render();
    }
    if (event.key === "ArrowRight") move(1);
    if (event.key === "ArrowLeft") move(-1);
    if (event.key.toLowerCase() === "j") mark("good");
    if (event.key.toLowerCase() === "k") mark("bad");
  });
}

function toggleSpeech() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    alert("当前浏览器不支持语音朗读。");
    return;
  }
  if (state.speaking) {
    stopSpeech();
    return;
  }
  const card = state.deck && state.deck.cards[state.idx];
  if (!card) return;
  const text = buildSpeechText(card);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const chineseVoice = voices.find(voice => /zh|Chinese|Mandarin|普通话|中文/i.test(`${voice.lang} ${voice.name}`));
  if (chineseVoice) utterance.voice = chineseVoice;
  utterance.onend = () => {
    state.speaking = false;
    updateSpeakButton();
  };
  utterance.onerror = () => {
    state.speaking = false;
    updateSpeakButton();
  };
  window.speechSynthesis.cancel();
  state.speaking = true;
  updateSpeakButton();
  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.speaking = false;
  updateSpeakButton();
}

function updateSpeakButton() {
  const button = $("speak");
  if (!button) return;
  button.textContent = state.speaking ? "停止" : "朗读";
  button.classList.toggle("speaking", state.speaking);
}

function buildSpeechText(card) {
  const parts = [
    `章节：${card.s}`,
    `问题：${card.q}`
  ];
  if (state.answerOpen) {
    parts.push(`一句话结论：${card.t}`);
    if (card.p && card.p.length) parts.push(`必须记住：${card.p.join("。")}`);
    if (card.m && card.m.length) parts.push(`容易误用：${card.m.join("。")}`);
    if (card.k) parts.push(`记忆钩子：${card.k}`);
  }
  return parts.join("。");
}

function setMobileTools(mode) {
  const collapsed = mode === "collapsed";
  document.body.classList.toggle("mobile-tools-collapsed", collapsed);
  $("mobileToolsToggle").textContent = collapsed ? "设置" : "专注";
  $("mobileToolsToggle").setAttribute("aria-expanded", String(!collapsed));
  localStorage.setItem("fc_mobile_tools", mode);
}

function setTheme(mode) {
  document.body.classList.toggle("light", mode === "light");
  $("darkBtn").classList.toggle("active", mode === "dark");
  $("lightBtn").classList.toggle("active", mode === "light");
  localStorage.setItem("fc_theme", mode);
}

function setView(mode) {
  document.body.classList.toggle("desktop-forced", mode === "desktop");
  document.body.classList.toggle("mobile-forced", mode === "mobile");
  $("autoView").classList.toggle("active", mode === "auto");
  $("desktopView").classList.toggle("active", mode === "desktop");
  $("mobileView").classList.toggle("active", mode === "mobile");
  localStorage.setItem("fc_view", mode);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

init().catch(error => {
  $("stage").innerHTML = `<div class="empty">加载失败：${escapeHtml(error.message)}</div>`;
});
