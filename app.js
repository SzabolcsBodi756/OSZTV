(() => {
  const MAX_KERDES = 20;

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

  // Állapot
  let allKerdesek = [];
  let quiz = [];
  let idx = 0;
  let pont = 0;
  let locked = false;
  let activeTimeout = null;

  // válasznapló (review-hoz)
  // { kerdes, valaszok[], helyesSet(Set), userSet(Set) }
  let attempts = [];

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

  // ---- TXT/JSON parser ----
  // Elfogad:
  // 1) JSON tömb: [ { kerdes:"", valaszok:[...], helyes:2 }, ... ]
  // 2) JS-szerű: const kerdesek = [ ... ];
  // 3) "helyes" lehet szám vagy tömb (több helyes válasz)
  function parseKerdesekFromText(text) {
    const t = String(text || "").trim();
    if (!t) throw new Error("Üres fájl.");

    // tiszta JSON tömb
    if (t.startsWith("[")) {
      const data = JSON.parse(t);
      validateKerdesek(data);
      return normalizeKerdesek(data);
    }

    // JS-szerű: kivágjuk a [ ... ] részt
    const start = t.indexOf("[");
    const end = t.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Nem találok tömböt a fájlban. Használj JSON tömböt vagy 'const kerdesek = [ ... ]' formát.");
    }

    const arrText = t.slice(start, end + 1);

    // Megpróbáljuk JSON-ná alakítani: idézőjelek és kulcsok JS-ben is idézősek nálad, ez jó.
    // Lehetnek trailing comma-k -> eltávolítjuk óvatosan.
    const cleaned = arrText
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}");

    const data = JSON.parse(cleaned);
    validateKerdesek(data);
    return normalizeKerdesek(data);
  }

  function validateKerdesek(data) {
    if (!Array.isArray(data)) throw new Error("A kérdéslista nem tömb.");
    data.forEach((q, i) => {
      if (!q || typeof q !== "object") throw new Error(`Hibás elem a(z) #${i + 1}. helyen.`);
      if (typeof q.kerdes !== "string" || !q.kerdes.trim()) throw new Error(`Hiányzó/hibás 'kerdes' a(z) #${i + 1}. elemnél`);
      if (!Array.isArray(q.valaszok) || q.valaszok.length < 2) throw new Error(`Hiányzó/hibás 'valaszok' a(z) #${i + 1}. elemnél`);
      if (!("helyes" in q)) throw new Error(`Hiányzó 'helyes' a(z) #${i + 1}. elemnél`);

      const h = q.helyes;
      const maxIdx = q.valaszok.length - 1;

      if (typeof h === "number") {
        if (!Number.isInteger(h) || h < 0 || h > maxIdx) throw new Error(`Hibás 'helyes' index a(z) #${i + 1}. elemnél`);
      } else if (Array.isArray(h)) {
        if (h.length < 1) throw new Error(`Üres 'helyes' tömb a(z) #${i + 1}. elemnél`);
        h.forEach(v => {
          if (!Number.isInteger(v) || v < 0 || v > maxIdx) throw new Error(`Hibás 'helyes' index a(z) #${i + 1}. elemnél`);
        });
      } else {
        throw new Error(`A 'helyes' szám vagy tömb lehet a(z) #${i + 1}. elemnél`);
      }
    });
  }

  function normalizeKerdesek(data) {
    // helyes -> mindig tömb (Set-hez)
    return data.map(q => ({
      kerdes: q.kerdes,
      valaszok: q.valaszok,
      helyes: Array.isArray(q.helyes) ? q.helyes : [q.helyes]
    }));
  }

  async function loadDefaultFile() {
    // relatív út, működik GitHub Pages subfolderben is
    const resp = await fetch("./kerdesek.txt", { cache: "no-store" });
    if (!resp.ok) throw new Error("Nem találom a kerdesek.txt fájlt a repo gyökerében.");
    const text = await resp.text();
    return parseKerdesekFromText(text);
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

  function clearTimers() {
    if (activeTimeout) {
      clearTimeout(activeTimeout);
      activeTimeout = null;
    }
  }

  function showQuestion() {
    clearTimers();
    locked = false;
    elAnswers.innerHTML = "";
    elMultiHint.textContent = "";

    if (idx >= quiz.length) {
      return showResults();
    }

    elCounter.textContent = `Kérdés ${idx + 1} / ${quiz.length}`;

    const q = quiz[idx];
    elQuestion.textContent = q.kerdes;

    const helyesSet = new Set(q.helyes);
    const isMulti = helyesSet.size > 1;
    elMultiHint.textContent = isMulti ? "Megjegyzés: ennél a kérdésnél több helyes válasz is lehet." : "";

    // válaszok keverése, de a helyes indexeket át kell képezni
    // Ezt úgy csináljuk, hogy párokat készítünk: { text, originalIndex }
    const pairs = q.valaszok.map((text, originalIndex) => ({ text, originalIndex }));
    const shuffledPairs = shuffle(pairs);

    // felhasználó választása: multi esetén kattintással toggle-öl, és van "Véglegesítés" gomb
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

      div.addEventListener("click", () => {
        if (locked) return;

        if (!isMulti) {
          // single-choice: azonnal értékelünk
          locked = true;
          evaluateSingle(div, p, shuffledPairs, helyesSet);
          return;
        }

        // multi-choice: toggle
        if (userSet.has(p.originalIndex)) {
          userSet.delete(p.originalIndex);
          div.classList.remove("correct"); // csak vizuális jelölésre használjuk itt
        } else {
          userSet.add(p.originalIndex);
          div.classList.add("correct");
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

    // nincs automatikus tovább lépés (az volt a bug forrása)
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
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
      // jelöljük meg a helyes(eke)t zölddel
      [...elAnswers.children].forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        const text = child.textContent;
        const pair = shuffledPairs.find(x => x.text === text);
        if (pair && helyesSet.has(pair.originalIndex)) {
          child.classList.add("correct");
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

    // végleges színezés: helyesek zöld, rosszak piros, amit nem jelölt, de helyes -> zöld
    const answerDivs = [...elAnswers.querySelectorAll(".answer")];

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

    // Review lista
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

        // jelölések: ✅ helyes / ❌ rossz / (te jelölted)
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
  btnReload.addEventListener("click", () => location.reload());
  btnRestart.addEventListener("click", () => location.reload());

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseKerdesekFromText(text);
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
      // Ha nincs fájl, maradjon a loader + hibával
      show(elLoader);
      hide(elQuiz);
      hide(elResult);
      setError(err?.message || "Nem sikerült betölteni a kérdéseket.");
    }
  })();
})();
