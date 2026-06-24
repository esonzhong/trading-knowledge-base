const state = {
  manifest: null,
  deck: null,
  deckId: "",
  idx: 0,
  marks: {},
  answerOpen: false,
  filtered: [],
  speaking: false,
  aiSpeaking: false,
  aiAudio: null,
  wakeLock: null
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
  stopAllSpeech();
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
  stopAllSpeech();
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
  updateAiSpeakButton();
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
  stopAllSpeech();
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
    stopAllSpeech();
    render();
  };
  $("speak").onclick = toggleSpeech;
  $("aiSpeak").onclick = toggleAiSpeech;
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
  stopAiSpeech();
  const segments = buildSpeechSegments(card);
  const voice = chooseChineseVoice();
  window.speechSynthesis.cancel();
  state.speaking = true;
  updateSpeakButton();
  speakSegments(segments, voice, 0);
}

async function toggleAiSpeech() {
  if (state.aiSpeaking) {
    await stopAiSpeech();
    return;
  }
  const card = state.deck && state.deck.cards[state.idx];
  if (!card) return;
  const endpoint = getAiTtsEndpoint();
  if (!endpoint) return;
  stopSpeech();
  await requestWakeLock();
  state.aiSpeaking = true;
  updateAiSpeakButton("生成中");
  try {
    const payload = {
      deckId: state.deckId,
      cardId: currentCardNumber(),
      answerOpen: state.answerOpen,
      text: buildAiSpeechText(card)
    };
    const cacheKey = aiAudioCacheKey(payload);
    let audioUrl = localStorage.getItem(cacheKey);
    if (!audioUrl) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`AI朗读服务返回 ${response.status}`);
      const data = await response.json();
      if (!data.audioUrl) throw new Error("AI朗读服务没有返回音频地址");
      audioUrl = normalizeAudioUrl(data.audioUrl);
      localStorage.setItem(cacheKey, audioUrl);
    }
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audio.playsInline = true;
    state.aiAudio = audio;
    updateAiSpeakButton();
    audio.onended = () => stopAiSpeech();
    audio.onerror = () => {
      stopAiSpeech();
      localStorage.removeItem(cacheKey);
      alert("AI音频播放失败，请检查服务地址或音频链接。");
    };
    await audio.play();
  } catch (error) {
    stopAiSpeech();
    alert(error.message);
  }
}

function getAiTtsEndpoint() {
  const configured = window.FLASHCARD_AI_TTS_ENDPOINT || localStorage.getItem("fc_ai_tts_endpoint");
  if (configured) return configured;
  const endpoint = prompt("请输入AI朗读服务地址，例如：https://你的域名/tts");
  if (!endpoint) return "";
  localStorage.setItem("fc_ai_tts_endpoint", endpoint.trim());
  return endpoint.trim();
}

function stopAllSpeech() {
  stopSpeech();
  stopAiSpeech();
}

function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.speaking = false;
  updateSpeakButton();
}

function stopAiSpeech() {
  if (state.aiAudio) {
    state.aiAudio.pause();
    state.aiAudio.currentTime = 0;
    state.aiAudio = null;
  }
  state.aiSpeaking = false;
  updateAiSpeakButton();
  releaseWakeLock();
}

function updateSpeakButton() {
  const button = $("speak");
  if (!button) return;
  button.textContent = state.speaking ? "停止" : "朗读";
  button.classList.toggle("speaking", state.speaking);
}

function updateAiSpeakButton(label) {
  const button = $("aiSpeak");
  if (!button) return;
  button.textContent = label || (state.aiSpeaking ? "停止AI" : "AI朗读");
  button.classList.toggle("speaking", state.aiSpeaking);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch (error) {
    state.wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!state.wakeLock) return;
  const lock = state.wakeLock;
  state.wakeLock = null;
  lock.release().catch(() => {});
}

function chooseChineseVoice() {
  const voices = window.speechSynthesis.getVoices();
  const preferred = [
    /Xiaoxiao|Xiaoyi|Yunxi|Yunjian|Huihui|Kangkang|Yaoyao/i,
    /Ting-Ting|Sin-ji|Meijia|Li-mu|Yu-shu/i,
    /zh-CN|Mandarin|Chinese|普通话|中文/i
  ];
  for (const pattern of preferred) {
    const voice = voices.find(item => pattern.test(`${item.lang} ${item.name}`));
    if (voice) return voice;
  }
  return voices.find(item => /^zh/i.test(item.lang));
}

function speakSegments(segments, voice, index) {
  if (!state.speaking) return;
  if (index >= segments.length) {
    state.speaking = false;
    updateSpeakButton();
    return;
  }
  const segment = segments[index];
  const utterance = new SpeechSynthesisUtterance(segment.text);
  utterance.lang = "zh-CN";
  utterance.rate = segment.rate;
  utterance.pitch = segment.pitch;
  utterance.volume = 1;
  if (voice) utterance.voice = voice;
  utterance.onend = () => speakSegments(segments, voice, index + 1);
  utterance.onerror = () => {
    state.speaking = false;
    updateSpeakButton();
  };
  window.speechSynthesis.speak(utterance);
}

function buildSpeechSegments(card) {
  const segments = [
    speechSegment(`第 ${String(currentCardNumber()).padStart(3, "0")} 张。${card.s}。`, 0.9, 0.96),
    speechSegment(`问题是：${card.q}`, 0.86, 1.02)
  ];
  if (state.answerOpen) {
    segments.push(speechSegment(`一句话结论。${card.t}`, 0.84, 0.98));
    if (card.p && card.p.length) segments.push(speechSegment(`必须记住。${card.p.join("。")}`, 0.88, 1));
    if (card.m && card.m.length) segments.push(speechSegment(`容易误用。${card.m.join("。")}`, 0.9, 0.96));
    if (card.k) segments.push(speechSegment(`记忆钩子。${card.k}`, 0.86, 1.01));
  }
  return segments;
}

function buildAiSpeechText(card) {
  const parts = [
    `第 ${String(currentCardNumber()).padStart(3, "0")} 张`,
    `章节：${card.s}`,
    `问题：${card.q}`
  ];
  if (state.answerOpen) {
    parts.push(`一句话结论：${card.t}`);
    if (card.p && card.p.length) parts.push(`必须记住：${card.p.join("。")}`);
    if (card.m && card.m.length) parts.push(`容易误用：${card.m.join("。")}`);
    if (card.k) parts.push(`记忆钩子：${card.k}`);
  }
  return normalizeSpeechText(parts.join("。"));
}

function aiAudioCacheKey(payload) {
  return `fc_ai_audio_v2_${state.deckId}_${payload.cardId}_${payload.answerOpen ? "answer" : "question"}_${simpleHash(payload.text)}`;
}

function normalizeAudioUrl(url) {
  return String(url).replace(/^http:\/\//, "https://");
}

function currentCardNumber() {
  return state.idx + 1;
}

function simpleHash(value) {
  let hash = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function speechSegment(text, rate, pitch) {
  return {
    text: normalizeSpeechText(text),
    rate,
    pitch
  };
}

function normalizeSpeechText(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/([。！？；])\s*/g, "$1 ")
    .replace(/：/g, "，")
    .trim();
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
