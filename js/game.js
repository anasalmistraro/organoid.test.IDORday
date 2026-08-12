/* ============================================================================
 * game.js — Camada de teste/jogo em torno do visualizador
 *
 * Fluxo: Tela inicial -> 5 organoides aleatórios -> classificação -> resultado
 * O gabarito vem SEMPRE do CSV (nada de classificações hardcoded aqui).
 * ==========================================================================*/

/* ----------------------------------------------------------------------------
 * CONFIGURAÇÃO  (o único lugar que você precisa editar)
 * --------------------------------------------------------------------------*/
const CONFIG = {
  // Fonte do gabarito. Por padrão usa o CSV de DEMONSTRAÇÃO (rótulos aleatórios,
  // só para testar a mecânica). Quando tiver o gabarito real dos especialistas,
  // preencha a coluna Classification em data/organoids.csv e troque aqui:
  //   csvUrl: "data/organoids.csv",
  //   demo:   false,
  csvUrl: "data/organoids.demo.csv",
  demo: true,

  roundSize: 5, // quantos organoides por partida

  // Detecção flexível das colunas (não assume nomes exatos).
  idColumnCandidates: [
    "id organoide form", "id organoide", "id", "organoid", "organoide",
    "nome", "name", "form",
  ],
  classColumnCandidates: [
    "classification", "classificacao", "classificação", "gabarito",
    "expert", "especialista", "especialistas", "label", "rotulo",
    "rótulo", "quality", "qualidade", "class",
  ],
};

// Vocabulário canônico e sinônimos aceitos na coluna de classificação.
const LABELS = {
  ACCEPTABLE: "Acceptable",
  NOT_ACCEPTABLE: "Not Acceptable",
  UNCERTAIN: "Uncertain",
};
const LABEL_PT = {
  [LABELS.ACCEPTABLE]: "Aceitável",
  [LABELS.NOT_ACCEPTABLE]: "Não Aceitável",
};

/* ----------------------------------------------------------------------------
 * ESTADO DA PARTIDA
 * --------------------------------------------------------------------------*/
const state = {
  pool: [],       // [{id, plate, truth}] elegíveis (Acceptable/Not Acceptable)
  round: [],      // 5 organoides sorteados desta partida
  answers: [],    // respostas do estudante (canônicas), alinhadas a round[]
  index: 0,       // organoide atual (0..4)
};

/* ----------------------------------------------------------------------------
 * UTILIDADES
 * --------------------------------------------------------------------------*/
const $ = (sel) => document.querySelector(sel);

function norm(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove acentos
}

// Mapeia qualquer valor da coluna para um rótulo canônico (ou null).
function canonLabel(raw) {
  const n = norm(raw);
  if (!n) return null;
  if (["acceptable", "aceitavel", "aceito", "aceita", "ok", "good", "boa"].includes(n))
    return LABELS.ACCEPTABLE;
  if (["not acceptable", "unacceptable", "nao aceitavel", "nao aceita",
       "reject", "rejeitado", "ruim", "bad"].includes(n))
    return LABELS.NOT_ACCEPTABLE;
  if (["uncertain", "incerto", "indeterminado", "duvida", "duvidoso"].includes(n))
    return LABELS.UNCERTAIN;
  return null; // valor desconhecido -> tratado como não-classificado
}

function setScreen(name) {
  document.body.dataset.screen = name;
  window.scrollTo({ top: 0, behavior: "auto" });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "Organoid_37" -> "#37" ; "Organoid_Acq3" -> "#Acq3"
function shortId(id) {
  return "#" + id.replace(/^Organoid_/i, "");
}

/* ----------------------------------------------------------------------------
 * CARREGAMENTO DO CSV
 * --------------------------------------------------------------------------*/
function detectColumn(fields, candidates) {
  const nf = fields.map((f) => ({ raw: f, n: norm(f) }));
  // 1) correspondência exata
  for (const c of candidates) {
    const hit = nf.find((f) => f.n === c);
    if (hit) return hit.raw;
  }
  // 2) correspondência parcial
  for (const c of candidates) {
    const hit = nf.find((f) => f.n.includes(c));
    if (hit) return hit.raw;
  }
  return null;
}

function loadCSV() {
  Papa.parse(CONFIG.csvUrl, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      try {
        buildPool(results);
      } catch (err) {
        showFatal(err.message);
      }
    },
    error: () => {
      showFatal(
        `Não foi possível carregar "${CONFIG.csvUrl}". ` +
          "Verifique se o arquivo existe e se o site está sendo servido por HTTP " +
          "(o GitHub Pages faz isso; abrir o index.html direto do disco não)."
      );
    },
  });
}

function buildPool(results) {
  const fields = results.meta.fields || [];
  const idCol = detectColumn(fields, CONFIG.idColumnCandidates);
  const classCol = detectColumn(fields, CONFIG.classColumnCandidates);

  if (!idCol) {
    throw new Error(
      "Não encontrei a coluna de ID do organoide no CSV. " +
        `Colunas lidas: ${fields.join(", ")}.`
    );
  }
  if (!classCol) {
    throw new Error(
      "O CSV não tem uma coluna de classificação (o gabarito). " +
        `Colunas lidas: ${fields.join(", ")}. ` +
        "Adicione uma coluna (ex.: Classification) com os valores " +
        "Acceptable / Not Acceptable / Uncertain."
    );
  }

  const pool = [];
  let uncertain = 0, unlabeled = 0;
  for (const row of results.data) {
    const id = (row[idCol] || "").trim();
    if (!id) continue;
    const truth = canonLabel(row[classCol]);
    if (truth === LABELS.UNCERTAIN) { uncertain++; continue; }   // excluir Uncertain
    if (truth === null) { unlabeled++; continue; }               // excluir não classificados
    pool.push({ id, plate: (row[classCol + "_plate"] || row["ID Organoide Placa"] || "").trim(), truth });
  }

  state.pool = pool;
  console.info(
    `[Teste] Colunas: ID="${idCol}", Classificação="${classCol}". ` +
      `Elegíveis: ${pool.length} | Uncertain excluídos: ${uncertain} | ` +
      `sem rótulo: ${unlabeled}.`
  );

  if (pool.length < CONFIG.roundSize) {
    throw new Error(
      `O gabarito tem apenas ${pool.length} organoide(s) classificado(s) como ` +
        "Acceptable/Not Acceptable — são necessários pelo menos " +
        `${CONFIG.roundSize}. Preencha a coluna de classificação no CSV.`
    );
  }

  // CSV pronto: habilita o botão Começar.
  const startBtn = $("#start-btn");
  startBtn.disabled = false;
  startBtn.textContent = "Começar o teste";
}

function showFatal(msg) {
  const box = $("#start-error");
  box.hidden = false;
  box.textContent = msg;
  const startBtn = $("#start-btn");
  startBtn.disabled = true;
  startBtn.textContent = "Indisponível";
}

/* ----------------------------------------------------------------------------
 * PARTIDA
 * --------------------------------------------------------------------------*/
function startRound() {
  state.round = shuffle(state.pool).slice(0, CONFIG.roundSize);
  state.answers = new Array(CONFIG.roundSize).fill(null);
  state.index = 0;
  buildProgressWells();
  setScreen("test");
  showOrganoid(0);
}

function showOrganoid(i) {
  state.index = i;
  const item = state.round[i];

  $("#counter-current").textContent = i + 1;
  $("#counter-total").textContent = CONFIG.roundSize;
  $("#specimen-id").textContent = shortId(item.id);
  $("#viewer-status").hidden = true;
  $("#viewer-status").textContent = "";

  // Reset dos controles
  setFocusUI(1);
  setGammaUI(false);

  // Estado dos botões de classificação (permite trocar antes de avançar)
  updateClassifyButtons(state.answers[i]);
  updateWells();

  OrganoidViewer.load(item.id, {
    onFail: () => {
      const s = $("#viewer-status");
      s.hidden = false;
      s.textContent =
        "A imagem deste organoide não carregou. Você ainda pode classificá-lo.";
    },
  });
}

function classify(canonAnswer) {
  state.answers[state.index] = canonAnswer;
  updateClassifyButtons(canonAnswer);
  updateWells();

  // Pequena pausa para o feedback visual antes de avançar.
  window.setTimeout(() => {
    if (state.index < CONFIG.roundSize - 1) {
      showOrganoid(state.index + 1);
    } else {
      finishRound();
    }
  }, 260);
}

/* ---- Controles do visualizador (UI) ---- */
function setFocusUI(level) {
  OrganoidViewer.setFocus(level);
  document.querySelectorAll(".focus-step").forEach((b) => {
    b.classList.toggle("is-active", parseInt(b.dataset.focus, 10) === level);
    b.setAttribute("aria-pressed", parseInt(b.dataset.focus, 10) === level);
  });
}
function setGammaUI(on) {
  OrganoidViewer.setGamma(on);
  const t = $("#gamma-toggle");
  t.checked = on;
  t.setAttribute("aria-checked", on);
}
function updateClassifyButtons(answer) {
  $("#btn-accept").classList.toggle("is-chosen", answer === LABELS.ACCEPTABLE);
  $("#btn-reject").classList.toggle(
    "is-chosen",
    answer === LABELS.NOT_ACCEPTABLE
  );
}

/* ---- Progresso: placa de poços (signature element) ---- */
function buildProgressWells() {
  const wrap = $("#wells");
  wrap.innerHTML = "";
  for (let i = 0; i < CONFIG.roundSize; i++) {
    const w = document.createElement("span");
    w.className = "well";
    w.dataset.i = i;
    w.title = `Organoide ${i + 1}`;
    wrap.appendChild(w);
  }
}
function updateWells() {
  document.querySelectorAll(".well").forEach((w) => {
    const i = parseInt(w.dataset.i, 10);
    w.classList.toggle("is-current", i === state.index);
    w.classList.toggle("is-done", state.answers[i] !== null);
  });
}

/* ----------------------------------------------------------------------------
 * RESULTADO
 * --------------------------------------------------------------------------*/
function finishRound() {
  OrganoidViewer.destroy();

  let correct = 0;
  state.round.forEach((item, i) => {
    if (state.answers[i] === item.truth) correct++;
  });
  const pct = Math.round((correct / CONFIG.roundSize) * 100);

  $("#score-value").textContent = `${correct} / ${CONFIG.roundSize}`;
  $("#score-pct").textContent = `${pct}% de acerto`;
  $("#score-value").dataset.tier =
    pct >= 80 ? "high" : pct >= 40 ? "mid" : "low";

  renderGabarito();
  setScreen("result");
}

function renderGabarito() {
  const tbody = $("#gabarito-body");
  tbody.innerHTML = "";

  state.round.forEach((item, i) => {
    const mine = state.answers[i];
    const ok = mine === item.truth;

    const tr = document.createElement("tr");

    // Thumbnail + ID
    const tdSpec = document.createElement("td");
    tdSpec.className = "cell-spec";
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    const idChip = document.createElement("span");
    idChip.className = "id-chip";
    idChip.textContent = shortId(item.id);
    tdSpec.append(thumb, idChip);

    OrganoidViewer.getThumbUrl(item.id).then((url) => {
      if (!url) return;
      const img = new Image();
      img.alt = item.id;
      img.onload = () => {
        thumb.style.backgroundImage = `url("${url}")`;
        thumb.classList.add("has-img");
      };
      img.src = url;
    });

    const tdMine = document.createElement("td");
    tdMine.textContent = mine ? LABEL_PT[mine] : "—";

    const tdTruth = document.createElement("td");
    tdTruth.textContent = LABEL_PT[item.truth];

    const tdRes = document.createElement("td");
    tdRes.className = "cell-result " + (ok ? "is-ok" : "is-wrong");
    tdRes.innerHTML = ok ? "&#10003;" : "&#10007;";
    tdRes.setAttribute("aria-label", ok ? "Correto" : "Incorreto");

    tr.append(tdSpec, tdMine, tdTruth, tdRes);
    tbody.appendChild(tr);
  });

  // Botão "Revisar erros" só faz sentido se houver erros.
  const wrongCount = state.round.filter(
    (item, i) => state.answers[i] !== item.truth
  ).length;
  $("#review-btn").hidden = wrongCount === 0;
}

/* ----------------------------------------------------------------------------
 * REVISÃO DE ERROS (opcional) — reabre no visualizador só os que você errou
 * --------------------------------------------------------------------------*/
const review = { list: [], pos: 0 };

function startReview() {
  review.list = state.round
    .map((item, i) => ({ item, mine: state.answers[i] }))
    .filter((r) => r.mine !== r.item.truth);
  if (review.list.length === 0) return;
  review.pos = 0;
  setScreen("review");
  showReview(0);
}

function showReview(pos) {
  review.pos = pos;
  const { item, mine } = review.list[pos];
  $("#review-counter").textContent = `Erro ${pos + 1} de ${review.list.length}`;
  $("#review-id").textContent = shortId(item.id);
  $("#review-mine").textContent = mine ? LABEL_PT[mine] : "—";
  $("#review-truth").textContent = LABEL_PT[item.truth];
  $("#review-prev").disabled = pos === 0;
  $("#review-next").disabled = pos === review.list.length - 1;

  setReviewFocusUI(1);
  setReviewGammaUI(false);
  OrganoidViewer.load(item.id);
}
function setReviewFocusUI(level) {
  OrganoidViewer.setFocus(level);
  document.querySelectorAll("#review-focus .focus-step").forEach((b) => {
    b.classList.toggle("is-active", parseInt(b.dataset.focus, 10) === level);
  });
}
function setReviewGammaUI(on) {
  OrganoidViewer.setGamma(on);
  $("#review-gamma").checked = on;
}

/* ----------------------------------------------------------------------------
 * WIRING (eventos)
 * --------------------------------------------------------------------------*/
window.addEventListener("DOMContentLoaded", () => {
  // Aviso de modo demonstração
  $("#demo-banner").hidden = !CONFIG.demo;

  // Tela inicial
  const startBtn = $("#start-btn");
  startBtn.disabled = true;
  startBtn.textContent = "Carregando dados…";
  startBtn.addEventListener("click", startRound);

  // Tela do teste — foco
  document.querySelectorAll("#focus-steps .focus-step").forEach((b) => {
    b.addEventListener("click", () =>
      setFocusUI(parseInt(b.dataset.focus, 10))
    );
  });
  // Gamma
  $("#gamma-toggle").addEventListener("change", (e) =>
    setGammaUI(e.target.checked)
  );
  // Classificação
  $("#btn-accept").addEventListener("click", () =>
    classify(LABELS.ACCEPTABLE)
  );
  $("#btn-reject").addEventListener("click", () =>
    classify(LABELS.NOT_ACCEPTABLE)
  );

  // Tela final
  $("#again-btn").addEventListener("click", startRound);
  $("#review-btn").addEventListener("click", startReview);

  // Tela de revisão
  document.querySelectorAll("#review-focus .focus-step").forEach((b) => {
    b.addEventListener("click", () =>
      setReviewFocusUI(parseInt(b.dataset.focus, 10))
    );
  });
  $("#review-gamma").addEventListener("change", (e) =>
    setReviewGammaUI(e.target.checked)
  );
  $("#review-prev").addEventListener("click", () =>
    showReview(Math.max(0, review.pos - 1))
  );
  $("#review-next").addEventListener("click", () =>
    showReview(Math.min(review.list.length - 1, review.pos + 1))
  );
  $("#review-back").addEventListener("click", () => setScreen("result"));

  // Começa carregando o gabarito
  loadCSV();
});
