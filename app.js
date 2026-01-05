(() => {
  const MAX_KERDES = 20;

  // ---- Elems ----
  const elLoader = document.getElementById("loader");
  const elQuiz = document.getElementById("quiz");
  const elResult = document.getElementById("result");

  const elCounter = document.getElementById("counter");
  const elQuestion = document.getElementById("question");
  const elAnswers = document.getElementById("answers");
  const elScore = document.getElementById("score");
  const elMultiHint = document.getElementById("multiHint");

  const elResPoints = document.getElementById("resPoints");
  const elResPercent = document.getElementById("resPercent");
  const elReview = document.getElementById("review");

  const elLoadError = document.getElementById("loadError");
  const btnReload = document.getElementById("btnReload");
  const btnRestart = document.getElementById("btnRestart");
  const fileInput = document.getElementById("fileInput");

  // Ha valami ID hiányzik, ne némán haljon el:
  const must = [
    ["loader", elLoader], ["quiz", elQuiz], ["result", elResult],
    ["counter", elCounter], ["question", elQuestion], ["answers", elAnswers],
    ["score", elScore], ["multiHint", elMultiHint],
    ["resPoints", elResPoints], ["resPercent", elResPercent], ["review", elReview],
    ["loadError", elLoadError], ["fileInput", fileInput]
  ];
  for (const [id, el] of must) {
    if (!el) {
      // eslint-disable-next-line no-alert
      alert(`Hiányzó elem az index.html-ben: #${id}`);
      return;
    }
  }

  // ---- State ----
  let allKerdesek = [];
  let quiz = [];
  let idx = 0;
  let pont = 0;
  let locked = false;
  let activeTimeout = null;

  // review-hoz: { kerdes, valaszok[], helyesSet(Set), userSet(Set) }
  let attempts = [];

  // ---- Utils ----
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function setError(msg) {
    if (!msg) {
      elLoadError.textContent = "";
      elLoadError.classList.add("hidden");
      return;
    }
    elLoadError.textContent = msg;
    elLoadError.classList.remove("hidden");
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function clearTimers() {
    if (activeTimeout) {
      clearTimeout(activeTimeout);
      activeTimeout = null;
    }
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  // ---- Normalizálás / Validálás ----
  function normalizeKerdesek(list) {
    if (!Array.isArray(list)) throw new Error("A kérdéslista nem tömb.");

    return list.map((q, i) => {
      if (!q || typeof q !== "object") {
        throw new Error(`Hibás elem (#${i + 1}): nem objektum.`);
      }

      const kerdes = String(q.kerdes ?? "").trim();
      const valaszok = Array.isArray(q.valaszok) ? q.valaszok.map(v => String(v)) : null;

      if (!kerdes) throw new Error(`Hiányzó 'kerdes' (#${i + 1}).`);
      if (!valaszok || valaszok.length < 2) throw new Error(`Hiányzó/hibás 'valaszok' (#${i + 1}).`);
      if (!("helyes" in q)) throw new Error(`Hiányzó 'helyes' (#${i + 1}).`);

      let helyes = q.helyes;

      if (Array.isArray(helyes)) helyes = helyes.map(Number);
      else helyes = [Number(helyes)];

      if (helyes.length < 1) throw new Error(`Üres 'helyes' (#${i + 1}).`);
      if (helyes.some(n => !Number.isInteger(n))) {
        throw new Error(`Hibás 'helyes' (#${i + 1}): csak index(ek) lehet(nek).`);
      }

      const maxIdx = valaszok.length - 1;
      for (const n of helyes) {
        if (n < 0 || n > maxIdx) {
          throw new Error(`Hibás 'helyes' index (#${i + 1}): ${n} (0..${maxIdx})`);
        }
      }

      helyes = [...new Set(helyes)];
      return { kerdes, valaszok, helyes };
    });
  }

  // ---- Parser: a TE formádhoz (const kerdesek = [ ... ]) ----
  function parseKerdesekSmart(text) {
    const raw = String(text ?? "").trim();
    if (!raw) throw new Error("Üres fájl.");

    const cleaned = raw.replace(/^\uFEFF/, "");

    // 1) JSON próbálkozás (ha valaki JSON-t töltene fel)
    try {
      const json = JSON.parse(cleaned);
      return normalizeKerdesek(json);
    } catch {
      // nem JSON
    }

    // 2) JS: const kerdesek = [ ... ];
    // FONTOS: nem deklarálunk előre kerdesek-et, mert akkor ütközik a "const kerdesek" miatt
    let list = null;
    try {
      const fn = new Function(
        '"use strict";\n' +
        cleaned + "\n" +
        "return (typeof kerdesek !== 'undefined' ? kerdesek : (typeof questions !== 'undefined' ? questions : null));"
      );
      list = fn();
    } catch (e) {
      throw new Error(
        "A kerdesek.txt nem JSON és JS-ként sem futtatható.\n" +
        "Részlet: " + (e?.message || e)
      );
    }

    if (!list) throw new Error("Nem találok 'kerdesek' tömböt a kerdesek.txt-ben.");
    return normalizeKerdesek(list);
  }

  // ---- Fájl betöltés (repo gyökérből) ----
  async function loadDefaultFile() {
    const resp = await fetch("./kerdesek.txt", { cache: "no-store" });
    if (!resp.ok) throw new Error("Nem találom a kerdesek.txt fájlt a repo gyökerében.");
    const text = await resp.text();
    return parseKerdesekSmart(text);
  }

  function resetQuiz(newList) {
    allKerdesek = newList;
    quiz = shuffle(allKerdesek).slice(0, Math.min(MAX_KERDES, allKerdesek.length));
    idx = 0;
    pont = 0;
    locked = false;
    attempts = [];
    elScore.textContent = "0";
    setError("");
    hide(elResult);
    show(elQuiz);
    showQuestion();
  }

  // ---- MULTI kijelölés fallback (ha a CSS nem látszik) ----
  function applyPickedVisual(div, isPicked) {
    div.classList.toggle("picked", isPicked);

    // Inline fallback: ha a CSS-ed bármiért nem érvényesül, ez akkor is látszik
    if (isPicked) {
      div.style.borderColor = "rgba(255,255,255,0.95)";
      div.style.background = "rgba(255,255,255,0.08)";
      div.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.35) inset";
    } else {
      div.style.borderColor = "";
      div.style.background = "";
      div.style.boxShadow = "";
    }
  }

  function showQuestion() {
    clearTimers();
    locked = false;

    elAnswers.innerHTML = "";
    elMultiHint.textContent = "";

    if (idx >= quiz.length) return showResults();

    elCounter.textContent = `Kérdés ${idx + 1} / ${quiz.length}`;

    const q = quiz[idx];
    elQuestion.textContent = q.kerdes;

    const helyesSet = new Set(q.helyes);
    const isMulti = helyesSet.size > 1;
    elMultiHint.textContent = isMulti ? "Megjegyzés: ennél a kérdésnél több helyes válasz is lehet." : "";

    const pairs = q.valaszok.map((text, originalIndex) => ({ text, originalIndex }));
    const shuffledPairs = shuffle(pairs);

    const userSet = new Set();

    if (isMulti) {
      const info = document.createElement("div");
      info.className = "small";
      info.textContent = "Jelöld be az összes helyes választ, majd kattints a „Véglegesítés” gombra.";
      elAnswers.appendChild(info);
    }

    shuffledPairs.forEach((p) => {
      const div = document.createElement("div");
      div.className = "answer";
      div.textContent = p.text;

      // accessibility + állapot
      div.setAttribute("role", "button");
      div.setAttribute("aria-pressed", "false");

      div.addEventListener("click", () => {
        if (locked) return;

        if (!isMulti) {
          locked = true;
          evaluateSingle(div, p, shuffledPairs, helyesSet);
          return;
        }

        // multi: toggle
        const picked = userSet.has(p.originalIndex);
        if (picked) {
          userSet.delete(p.originalIndex);
          div.setAttribute("aria-pressed", "false");
          applyPickedVisual(div, false);
        } else {
          userSet.add(p.originalIndex);
          div.setAttribute("aria-pressed", "true");
          applyPickedVisual(div, true);
        }
      });

      elAnswers.appendChild(div);
    });

    if (isMulti) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = "Véglegesítés";

      btn.addEventListener("click", () => {
        if (locked) return;
        locked = true;
        evaluateMulti(shuffledPairs, helyesSet, userSet);
      });

      elAnswers.appendChild(btn);
    }
  }

  function evaluateSingle(clickedDiv, clickedPair, shuffledPairs, helyesSet) {
    const userSet = new Set([clickedPair.originalIndex]);
    const correct = helyesSet.has(clickedPair.originalIndex);

    if (correct) {
      clickedDiv.classList.add("correct");
      pont++;
      elScore.textContent = String(pont);
    } else {
      clickedDiv.classList.add("wrong");
      const answerDivs = [...elAnswers.querySelectorAll(".answer")];
      answerDivs.forEach((div) => {
        const text = div.textContent;
        const pair = shuffledPairs.find(x => x.text === text);
        if (pair && helyesSet.has(pair.originalIndex)) div.classList.add("correct");
      });
    }

    attempts.push({
      kerdes: quiz[idx].kerdes,
      valaszok: quiz[idx].valaszok,
      helyesSet: new Set(helyesSet),
      userSet
    });

    activeTimeout = setTimeout(() => {
      idx++;
      showQuestion();
    }, 450);
  }

  function evaluateMulti(shuffledPairs, helyesSet, userSet) {
    const correctAll = setsEqual(userSet, helyesSet);

    const answerDivs = [...elAnswers.querySelectorAll(".answer")];

    answerDivs.forEach((div) => {
      const text = div.textContent;
      const pair = shuffledPairs.find(x => x.text === text);
      if (!pair) return;

      const isCorrect = helyesSet.has(pair.originalIndex);
      const chosen = userSet.has(pair.originalIndex);

      div.classList.remove("correct", "wrong");
      // picked vizuált ne hagyjuk bent értékelés után
      applyPickedVisual(div, false);

      if (isCorrect) div.classList.add("correct");
      if (chosen && !isCorrect) div.classList.add("wrong");
    });

    if (correctAll) {
      pont++;
      elScore.textContent = String(pont);
    }

    attempts.push({
      kerdes: quiz[idx].kerdes,
      valaszok: quiz[idx].valaszok,
      helyesSet: new Set(helyesSet),
      userSet: new Set(userSet)
    });

    activeTimeout = setTimeout(() => {
      idx++;
      showQuestion();
    }, 650);
  }

  function showResults() {
    clearTimers();
    hide(elQuiz);
    show(elResult);

    const total = quiz.length || 1;
    const percent = Math.round((pont / total) * 100);

    elResPoints.textContent = `Eredmény: ${pont} / ${quiz.length}`;
    elResPercent.textContent = `${percent}%`;

    elReview.innerHTML = "";

    attempts.forEach((a, i) => {
      const item = document.createElement("div");
      item.className = "reviewItem";

      const q = document.createElement("div");
      q.className = "reviewQ";
      q.textContent = `${i + 1}. ${a.kerdes}`;
      item.appendChild(q);

      const answersBox = document.createElement("div");
      answersBox.className = "reviewAnswers";

      a.valaszok.forEach((txt, idx2) => {
        const div = document.createElement("div");
        div.className = "reviewAns";

        const isCorrect = a.helyesSet.has(idx2);
        const chosen = a.userSet.has(idx2);

        if (isCorrect) div.classList.add("ok");
        if (chosen && !isCorrect) div.classList.add("bad");

        let prefix = "";
        if (isCorrect) prefix += "✅ ";
        if (chosen && !isCorrect) prefix += "❌ ";
        if (chosen && isCorrect) prefix += "✔ Te ezt jelölted: ";

        div.textContent = prefix ? `${prefix}${txt}` : txt;
        answersBox.appendChild(div);
      });

      item.appendChild(answersBox);

      const ok = setsEqual(a.userSet, a.helyesSet);
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.innerHTML = ok
        ? `<span class="tagOk">✔ Helyes</span>`
        : `<span class="tagBad">✖ Hibás</span><span class="small">– a helyes(ek) zölddel jelölve</span>`;
      item.appendChild(badge);

      elReview.appendChild(item);
    });
  }

  // ---- UI events ----
  btnReload?.addEventListener("click", () => location.reload());
  btnRestart?.addEventListener("click", () => location.reload());

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseKerdesekSmart(text);
      hide(elLoader);
      resetQuiz(parsed);
    } catch (err) {
      setError(err?.message || "Nem sikerült beolvasni a fájlt.");
    } finally {
      fileInput.value = "";
    }
  });

  // Globális hibák a piros dobozba (hogy ne legyen néma)
  window.addEventListener("error", (e) => {
    setError("JS hiba: " + (e?.message || "ismeretlen hiba"));
  });
  window.addEventListener("unhandledrejection", (e) => {
    setError("Promise hiba: " + (e?.reason?.message || e?.reason || "ismeretlen hiba"));
  });

  // ---- boot ----
  (async () => {
    try {
      const list = await loadDefaultFile();
      hide(elLoader);
      resetQuiz(list);
    } catch (err) {
      show(elLoader);
      hide(elQuiz);
      hide(elResult);
      setError(err?.message || "Nem sikerült betölteni a kérdéseket.");
    }
  })();
})();
