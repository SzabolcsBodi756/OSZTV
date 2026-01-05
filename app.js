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

  // ---- State ----
  let allKerdesek = [];
  let quiz = [];
  let idx = 0;
  let pont = 0;
  let locked = false;
  let activeTimeout = null;

  // review-hoz
  // { kerdes, valaszok[], helyesSet(Set), userSet(Set) }
  let attempts = [];

  // ---- Utils ----
  function show(el) {
    el?.classList.remove("hidden");
  }
  function hide(el) {
    el?.classList.add("hidden");
  }

  function setError(msg) {
    if (!elLoadError) return;
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
      if (!valaszok || valaszok.length < 2) {
        throw new Error(`Hiányzó/hibás 'valaszok' (#${i + 1}).`);
      }
      if (!("helyes" in q)) throw new Error(`Hiányzó 'helyes' (#${i + 1}).`);

      let helyes = q.helyes;

      // helyes lehet szám / tömb / szám-szerű string
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

      // duplikált indexek kiszűrése
      helyes = [...new Set(helyes)];

      return { kerdes, valaszok, helyes };
    });
  }

  /**
   * Parser, ami KIFEJEZETTEN a te kerdesek.txt formádat is megeszi:
   * - A fájl így néz ki: const kerdesek = [ { kerdes: "...", valaszok:[...], helyes: 1 }, ... ]
   * - Nem JSON (kulcsok nincsenek idézőjelezve) -> JSON.parse elbukna
   *
   * Megoldás: nem futtatjuk le a "const kerdesek = ..." részt változóként,
   * hanem kiszedjük belőle a [ ... ] tömb literált, és azt értékeljük ki:
   *   return ( [ ... ] );
   *
   * Így NINCS "Identifier 'kerdesek' has already been declared" hiba.
   */
  function parseKerdesekSmart(text) {
    const raw = String(text ?? "");
    const cleaned = raw.replace(/^\uFEFF/, "").trim();
    if (!cleaned) throw new Error("Üres fájl.");

    // 1) Ha valaki mégis tiszta JSON tömböt adna
    try {
      const json = JSON.parse(cleaned);
      return normalizeKerdesek(json);
    } catch {
      // nem JSON -> tovább
    }

    // 2) A te formád: const kerdesek = [ ... ];
    // Kiszedjük a legelső [ és legutolsó ] közti részt, és azt értékeljük ki JS-ként.
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(
        "Nem találok [ ... ] tömböt a kerdesek.txt-ben. " +
          "Maradjon ez a forma: const kerdesek = [ ... ]"
      );
    }

    const arrText = cleaned.slice(start, end + 1);

    let list;
    try {
      // zárójelbe tesszük, hogy expression legyen
      list = new Function('"use strict"; return (' + arrText + ');')();
    } catch (e) {
      throw new Error(
        "A kerdesek.txt tömb része nem értékelhető ki.\n" +
          "Részlet: " + (e?.message || e)
      );
    }

    return normalizeKerdesek(list);
  }

  // ---- Fájl betöltés (repo gyökérből) ----
  async function loadDefaultFile() {
    // GitHub Pages-en jó: a kerdesek.txt a repo rootban van
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
    if (elScore) elScore.textContent = "0";
    setError("");
    hide(elResult);
    show(elQuiz);
    showQuestion();
  }

  function showQuestion() {
    clearTimers();
    locked = false;

    if (elAnswers) elAnswers.innerHTML = "";
    if (elMultiHint) elMultiHint.textContent = "";

    if (idx >= quiz.length) {
      return showResults();
    }

    if (elCounter) elCounter.textContent = `Kérdés ${idx + 1} / ${quiz.length}`;

    const q = quiz[idx];
    if (elQuestion) elQuestion.textContent = q.kerdes;

    const helyesSet = new Set(q.helyes);
    const isMulti = helyesSet.size > 1;
    if (elMultiHint) {
      elMultiHint.textContent = isMulti
        ? "Megjegyzés: ennél a kérdésnél több helyes válasz is lehet."
        : "";
    }

    // válaszok keverése (az eredeti indexet visszük tovább)
    const pairs = q.valaszok.map((text, originalIndex) => ({ text, originalIndex }));
    const shuffledPairs = shuffle(pairs);

    const userSet = new Set();

    if (isMulti && elAnswers) {
      const info = document.createElement("div");
      info.className = "small";
      info.textContent = "Jelöld be az összes helyes választ, majd kattints a „Véglegesítés” gombra.";
      elAnswers.appendChild(info);
    }

    shuffledPairs.forEach((p) => {
      const div = document.createElement("div");
      div.className = "answer";
      div.textContent = p.text;

      div.addEventListener("click", () => {
        if (locked) return;

        if (!isMulti) {
          locked = true;
          evaluateSingle(div, p, shuffledPairs, helyesSet);
          return;
        }

        // multi: toggle
        // multi-choice: toggle
        if (userSet.has(p.originalIndex)) {
            userSet.delete(p.originalIndex);
            div.classList.remove("picked");
            div.setAttribute("aria-pressed", "false");
        } else {
            userSet.add(p.originalIndex);
            div.classList.add("picked");
            div.setAttribute("aria-pressed", "true");
        }


      elAnswers?.appendChild(div);
    });

    if (isMulti && elAnswers) {
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
      if (elScore) elScore.textContent = String(pont);
    } else {
      clickedDiv.classList.add("wrong");

      // helyes(ek) megjelölése
      const answerDivs = [...(elAnswers?.querySelectorAll(".answer") ?? [])];
      answerDivs.forEach((div) => {
        const text = div.textContent;
        const pair = shuffledPairs.find(x => x.text === text);
        if (pair && helyesSet.has(pair.originalIndex)) {
          div.classList.add("correct");
        }
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

    // végleges színezés
    const answerDivs = [...(elAnswers?.querySelectorAll(".answer") ?? [])];

    answerDivs.forEach((div) => {
      const text = div.textContent;
      const pair = shuffledPairs.find(x => x.text === text);
      if (!pair) return;

      const isCorrect = helyesSet.has(pair.originalIndex);
      const chosen = userSet.has(pair.originalIndex);

      div.classList.remove("correct", "wrong");

      if (isCorrect) div.classList.add("correct");
      if (chosen && !isCorrect) div.classList.add("wrong");
    });

    if (correctAll) {
      pont++;
      if (elScore) elScore.textContent = String(pont);
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

    if (elResPoints) elResPoints.textContent = `Eredmény: ${pont} / ${quiz.length}`;
    if (elResPercent) elResPercent.textContent = `${percent}%`;

    if (!elReview) return;
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

  fileInput?.addEventListener("change", async (e) => {
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


