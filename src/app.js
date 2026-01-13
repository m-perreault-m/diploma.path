// app.js
import { buildIndex, dependentClosure, courseIsUnlocked } from "./graph.js";

const CLICK_DELAY_MS = 200;

const state = {
  mode: "backward",
  courses: [],
  byCode: new Map(),
  dependents: new Map(),

  focusedCode: null,
  prereqSet: new Set(),
  prereqDirectSet: new Set(),
  focusFilterActive: false,

  completed: new Set(),
  unlocked: new Set(),

  plannedByGrade: new Map([
    [9, new Set()],
    [10, new Set()],
    [11, new Set()],
    [12, new Set()],
  ]),
  plannedSet: new Set(),

  hoveredCode: null,
  hoverSet: new Set(),
  search: "",

  // grade -> array of course codes in current display order (“wheel”)
  orderByGrade: new Map([
    [9, []],
    [10, []],
    [11, []],
    [12, []],
  ]),

  // grade -> immutable base order (used by “Show All Courses” spin reset)
  baseOrderByGrade: new Map([
    [9, []],
    [10, []],
    [11, []],
    [12, []],
  ]),

  draggingCode: null,
  draggingFrom: null,
};

const els = {
  tabBackward: document.getElementById("tab-backward"),
  tabForward: document.getElementById("tab-forward"),
  drawer: document.getElementById("drawer"),
  drawerToggle: document.getElementById("drawer-toggle"),
  hint: document.getElementById("mode-hint"),
  search: document.getElementById("search"),
  clear: document.getElementById("clear"), // Start Over
  showAll: document.getElementById("show-all"), // Show All Courses

  plan: document.getElementById("plan"),
  planWires: document.getElementById("plan-wires"),

  wires: document.getElementById("wires"),
  board: document.getElementById("board"),
  col9: document.getElementById("col-9"),
  col10: document.getElementById("col-10"),
  col11: document.getElementById("col-11"),
  col12: document.getElementById("col-12"),
};

boot();

async function boot() {
  const res = await fetch("./data/ontario_courses.json");
  const data = await res.json();
  state.courses = Array.isArray(data) ? data : (data.courses ?? []);

  // Clean up common issues without rewriting JSON on disk
  sanitizeCoursesInMemory(state.courses);

  const { byCode, dependents } = buildIndex(state.courses);
  state.byCode = byCode;
  state.dependents = dependents;

  initWheelOrder();
  wireEvents();

  renderBoard();
  renderPlan();
  applyStateToCards();
  drawBoardWires();
  drawPlanWires();
}

function sanitizeCoursesInMemory(courses) {
  for (const c of courses) {
    // Grade 9 should never have prereqs
    if (c.grade === 9) {
      c.prereqs = [];
      c.prereq_any_of = [];
      c.prereq_note = "";
      c.prereq_unresolved = false;
      continue;
    }

    c.prereqs = Array.isArray(c.prereqs) ? c.prereqs : [];
    c.prereq_any_of = Array.isArray(c.prereq_any_of) ? c.prereq_any_of : [];

    // Heuristic: if multiple prereqs provided but no OR groups,
    // treat as OR (Ontario is usually "this OR that")
    if (c.prereqs.length > 1 && c.prereq_any_of.length === 0) {
      c.prereq_any_of = [c.prereqs.slice()];
      c.prereqs = [];
    }
  }
}

function wireEvents() {
  els.tabBackward?.addEventListener("click", () => setMode("backward"));
  els.tabForward?.addEventListener("click", () => setMode("forward"));
  els.drawerToggle?.addEventListener("click", () => {
    const isOpen = els.drawer?.classList.toggle("is-open");
    document.body.classList.toggle("drawer-open", isOpen);
    els.drawerToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  els.search?.addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();

    // Searching resets focus/filter so all columns start “fresh”
    resetFocusOnly();

    renderBoard();
    renderPlan();
    applyStateToCards();
    drawBoardWires();
    drawPlanWires();
  });

  // Show all courses: reset focus/filter, keep plan, and spin columns back to base order
  els.showAll?.addEventListener("click", async () => {
    resetFocusOnly();

    // Spin all columns back to the original base ordering
    await spinAllColumnsToBase();

    // Re-render and redraw after the motion
    renderBoard();
    applyStateToCards();
    drawBoardWires();
    drawPlanWires();

    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Start over: wipe everything
  els.clear?.addEventListener("click", () => {
    state.focusedCode = null;
    state.prereqSet = new Set();
    state.prereqDirectSet = new Set();
    state.focusFilterActive = false;

    state.completed = new Set();
    state.unlocked = new Set();

    state.plannedByGrade = new Map([
      [9, new Set()],
      [10, new Set()],
      [11, new Set()],
      [12, new Set()],
    ]);
    state.plannedSet = new Set();

    state.hoveredCode = null;
    state.hoverSet = new Set();
    state.draggingCode = null;
    state.draggingFrom = null;

    els.search.value = "";
    state.search = "";

    initWheelOrder();
    renderBoard();
    renderPlan();
    applyStateToCards();
    drawBoardWires();
    drawPlanWires();

    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener("resize", () => {
    drawBoardWires();
    drawPlanWires();
  });

  setupPlanDropZones();
}

function resetFocusOnly() {
  state.focusedCode = null;
  state.prereqSet = new Set();
  state.prereqDirectSet = new Set();
  state.focusFilterActive = false;
}

function setMode(mode) {
  state.mode = mode;

  els.tabBackward?.classList.toggle("active", mode === "backward");
  els.tabForward?.classList.toggle("active", mode === "forward");

  els.hint.textContent =
    mode === "backward"
      ? "Backward mode: click a Grade 12 course to focus prereqs. Drag courses into the Plan."
      : "Forward mode: mark completed courses; eligible ones light up. Drag into Plan still works.";

  resetFocusOnly();

  if (mode === "forward") state.unlocked = computeUnlocked();

  renderBoard();
  renderPlan();
  applyStateToCards();
  drawBoardWires();
  drawPlanWires();
}

function initWheelOrder() {
  const groups = { 9: [], 10: [], 11: [], 12: [] };

  for (const c of state.courses) {
    if (![9, 10, 11, 12].includes(c.grade)) continue;
    groups[c.grade].push(c);
  }

  // stable-ish base order
  for (const g of Object.keys(groups)) {
    groups[g].sort((a, b) => {
      const sa = (a.subject ?? "").localeCompare(b.subject ?? "");
      if (sa !== 0) return sa;
      return (a.code ?? "").localeCompare(b.code ?? "");
    });
  }

  for (const g of [9, 10, 11, 12]) {
    const base = groups[g].map((c) => c.code);
    state.baseOrderByGrade.set(g, base.slice());
    state.orderByGrade.set(g, base.slice());
  }
}

function renderBoard() {
  renderGradeColumn(9);
  renderGradeColumn(10);
  renderGradeColumn(11);
  renderGradeColumn(12);
  bindBoardCardHandlers();
}

function renderGradeColumn(grade) {
  const colEl = getColumnEl(grade);
  if (!colEl) return;

  const codes = state.orderByGrade.get(grade) ?? [];
  const cards = [];

  const filterActive =
    state.mode === "backward" &&
    state.focusFilterActive &&
    state.focusedCode &&
    grade !== 12;

  for (const code of codes) {
    const c = state.byCode.get(code);
    if (!c) continue;

    if (state.search) {
      const hay = `${c.code} ${c.name}`.toLowerCase();
      if (!hay.includes(state.search)) continue;
    }

    if (filterActive && !state.prereqSet.has(code)) continue;

    cards.push(renderCourseCard(c));
  }

  colEl.innerHTML = cards.join("");
}

function renderCourseCard(c) {
  const subject = c.subject ?? "other";
  const prereqText = formatPrereqText(c);

  // Any visible course is draggable
  return `
    <button class="course-card subject-${escapeHtml(subject)}"
      draggable="true"
      data-code="${escapeHtml(c.code)}"
      data-grade="${c.grade}">
      <div class="course-top">
        <div class="course-code">${escapeHtml(c.code)}</div>
        <div class="course-level">${escapeHtml(c.level ?? "")}</div>
      </div>
      <div class="course-name">${escapeHtml(c.name ?? "")}</div>
      <div class="course-meta">${escapeHtml(prereqText)}</div>
    </button>
  `;
}

function renderPlan() {
  // rebuild plannedSet
  state.plannedSet = new Set();
  for (const g of [9, 10, 11, 12]) {
    for (const code of state.plannedByGrade.get(g) ?? new Set()) {
      state.plannedSet.add(code);
    }
  }

  const grades = [9, 10, 11, 12];

  els.plan.innerHTML = grades
    .map((g) => {
      const set = state.plannedByGrade.get(g) ?? new Set();
      const codes = [...set].sort();

      const body = codes.length
        ? codes
            .map((code) => {
              const c = state.byCode.get(code);
              if (!c) return "";
              return renderPlanCard(c, g);
            })
            .join("")
        : `<div class="plan-empty">Drag any visible course card into this box.</div>`;

      return `
      <div class="plan-col" data-plan-grade="${g}">
        <div class="plan-col-title">
          <div>Grade ${g}</div>
          <div class="plan-col-subtitle">${codes.length} selected</div>
        </div>
        <div class="plan-col-body">${body}</div>
      </div>
    `;
    })
    .join("");

  bindPlanHandlers();
  setupPlanDropZones();
}

function renderPlanCard(c, placedGrade) {
  const subject = c.subject ?? "other";
  const prereqText = formatPrereqText(c);

  const missing = !prereqsSatisfied(c, state.plannedSet);
  const needs = missing ? "needs-prereq" : "";

  return `
    <button class="plan-card subject-${escapeHtml(subject)} ${needs}"
      draggable="true"
      data-code="${escapeHtml(c.code)}"
      data-placed-grade="${placedGrade}">
      <div class="course-top">
        <div class="course-code">${escapeHtml(c.code)}</div>
        <div class="course-level">${escapeHtml(c.level ?? "")}</div>
      </div>
      <div class="course-name">${escapeHtml(c.name ?? "")}</div>
      <div class="course-meta">${escapeHtml(prereqText)}</div>
    </button>
  `;
}

// ----------------------
// Wheel roll (column spin)
// ----------------------

function rotateArrayToFront(arr, value) {
  const idx = arr.indexOf(value);
  if (idx <= 0) return arr;
  return arr.slice(idx).concat(arr.slice(0, idx));
}

async function rollCourseToTop(code) {
  const c = state.byCode.get(code);
  if (!c) return;

  const grade = c.grade;
  const colEl = getColumnEl(grade);
  if (!colEl) return;

  const cardEl = colEl.querySelector(`.course-card[data-code="${cssEscape(code)}"]`);
  if (!cardEl) return; // not visible (filtered/search)

  const y = cardEl.offsetTop;

  // Already near top: just rotate order (no animation)
  if (y <= 2) {
    const codes = state.orderByGrade.get(grade) ?? [];
    state.orderByGrade.set(grade, rotateArrayToFront(codes, code));
    return;
  }

  // Slide the column up so the clicked card reaches the top (visual roll)
  await colEl
    .animate(
      [{ transform: "translateY(0px)" }, { transform: `translateY(${-y}px)` }],
      { duration: 360, easing: "cubic-bezier(.22,.61,.36,1)" }
    )
    .finished;

  // Rotate the underlying order
  const codes = state.orderByGrade.get(grade) ?? [];
  state.orderByGrade.set(grade, rotateArrayToFront(codes, code));

  // Re-render the column, then animate back to neutral
  colEl.style.transform = `translateY(${y}px)`;
  renderGradeColumn(grade);
  bindBoardCardHandlers();
  applyStateToCards();

  await new Promise(requestAnimationFrame);

  await colEl
    .animate(
      [{ transform: `translateY(${y}px)` }, { transform: "translateY(0px)" }],
      { duration: 420, easing: "cubic-bezier(.22,.61,.36,1)" }
    )
    .finished;

  colEl.style.transform = "";
}

// Base spin reset helpers

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function spinColumnToBase(grade) {
  const colEl = getColumnEl(grade);
  if (!colEl) return;

  const base = state.baseOrderByGrade.get(grade) ?? [];
  const cur = state.orderByGrade.get(grade) ?? [];

  if (arraysEqual(cur, base)) return;

  const h = Math.min(colEl.scrollHeight || 600, 700);
  const spinDist = Math.max(180, Math.floor(h * 0.35));

  await colEl
    .animate(
      [{ transform: "translateY(0px)" }, { transform: `translateY(${-spinDist}px)` }],
      { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" }
    )
    .finished;

  state.orderByGrade.set(grade, base.slice());

  colEl.style.transform = `translateY(${spinDist}px)`;
  renderGradeColumn(grade);
  bindBoardCardHandlers();
  applyStateToCards();

  await new Promise(requestAnimationFrame);

  await colEl
    .animate(
      [{ transform: `translateY(${spinDist}px)` }, { transform: "translateY(0px)" }],
      { duration: 320, easing: "cubic-bezier(.22,.61,.36,1)" }
    )
    .finished;

  colEl.style.transform = "";
}

async function spinAllColumnsToBase() {
  await Promise.all([9, 10, 11, 12].map((g) => spinColumnToBase(g)));
}

// ----------------------
// Board handlers
// ----------------------

function bindBoardCardHandlers() {
  let clickTimer = null;

  for (const card of document.querySelectorAll(".course-card")) {
    const code = card.dataset.code;
    if (card.dataset.bound === "1") continue;
    card.dataset.bound = "1";

    card.addEventListener("mouseenter", () => onHover(code));
    card.addEventListener("mouseleave", () => onHover(null));

    card.addEventListener("click", (e) => {
      e.preventDefault();
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickTimer = null;
        onBoardClick(code); // async ok
      }, CLICK_DELAY_MS);
    });

    card.addEventListener("dragstart", (e) => {
      state.draggingCode = code;
      state.draggingFrom = "board";
      card.classList.add("dragging");

      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", JSON.stringify({ code, from: "board" }));

      const c = state.byCode.get(code);
      if (c && !prereqsSatisfied(c, state.plannedSet)) card.classList.add("drag-warning");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging", "drag-warning");
      state.draggingCode = null;
      state.draggingFrom = null;
      clearPlanDropHighlights();
    });
  }
}

async function onBoardClick(code) {
  const c = state.byCode.get(code);
  if (!c) return;

  // Spin/roll that column so the clicked course rises to the top
  await rollCourseToTop(code);

  state.focusedCode = code;

  // Backward focus filtering only when clicking a Grade 12 course
  if (state.mode === "backward" && c.grade === 12) {
    // toggle off if clicking the focused course again
    if (state.focusFilterActive && state.focusedCode === code && state.prereqSet.size) {
      resetFocusOnly();
    } else {
      state.prereqSet = prereqClosure(code);
      state.prereqDirectSet = new Set(getDirectPrereqCodes(c));
      state.focusFilterActive = true;
    }
  } else if (state.mode === "backward") {
    state.prereqDirectSet = new Set(getDirectPrereqCodes(c));
  }

  // Re-render after order update
  renderBoard();
  applyStateToCards();

  // Draw wires after motion finishes (reduces visual jitter)
  drawBoardWires();
  drawPlanWires();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ----------------------
// Plan handlers + DnD
// ----------------------

function bindPlanHandlers() {
  for (const card of document.querySelectorAll(".plan-card")) {
    const code = card.dataset.code;
    if (card.dataset.bound === "1") continue;
    card.dataset.bound = "1";

    card.addEventListener("mouseenter", () => onHover(code));
    card.addEventListener("mouseleave", () => onHover(null));

    // Double-click in plan removes it
    card.addEventListener("dblclick", (e) => {
      e.preventDefault();
      removeFromPlanEverywhere(code);
      renderPlan();
      applyStateToCards();
      drawBoardWires();
      drawPlanWires();
    });

    card.addEventListener("dragstart", (e) => {
      state.draggingCode = code;
      state.draggingFrom = "plan";
      card.classList.add("dragging");

      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ code, from: "plan" }));
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      state.draggingCode = null;
      state.draggingFrom = null;
      clearPlanDropHighlights();
    });
  }
}

function setupPlanDropZones() {
  const cols = document.querySelectorAll(".plan-col");
  for (const col of cols) {
    if (col.dataset.dropBound === "1") continue;
    col.dataset.dropBound = "1";

    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drop-hover");
      e.dataTransfer.dropEffect = state.draggingFrom === "plan" ? "move" : "copy";
    });

    col.addEventListener("dragleave", () => col.classList.remove("drop-hover"));

    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop-hover");

      let payload = null;
      try {
        payload = JSON.parse(e.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      if (!payload?.code) return;

      const targetGrade = Number(col.getAttribute("data-plan-grade"));
      onDropIntoPlan(payload.code, payload.from, targetGrade);
    });
  }
}

function clearPlanDropHighlights() {
  document.querySelectorAll(".plan-col").forEach((c) => c.classList.remove("drop-hover"));
}

function onDropIntoPlan(code, from, targetGrade) {
  if (![9, 10, 11, 12].includes(targetGrade)) return;
  const course = state.byCode.get(code);
  if (!course) return;

  if (from === "plan") removeFromPlanEverywhere(code);

  const set = state.plannedByGrade.get(targetGrade) ?? new Set();
  set.add(code);
  state.plannedByGrade.set(targetGrade, set);

  renderPlan();
  applyStateToCards();
  drawBoardWires();
  drawPlanWires();
}

function removeFromPlanEverywhere(code) {
  for (const g of [9, 10, 11, 12]) state.plannedByGrade.get(g)?.delete(code);
}

// ----------------------
// Hover + visual state
// ----------------------

function onHover(codeOrNull) {
  state.hoveredCode = codeOrNull;

  if (!codeOrNull) {
    state.hoverSet = new Set();
    applyStateToCards();
    drawBoardWires();
    drawPlanWires();
    return;
  }

  const hover = new Set([codeOrNull]);
  const c = state.byCode.get(codeOrNull);

  for (const p of getDirectPrereqCodes(c)) hover.add(p);

  const deps = dependentClosure(codeOrNull, state.dependents);
  for (const d of deps) hover.add(d);

  state.hoverSet = hover;
  applyStateToCards();
  drawBoardWires();
  drawPlanWires();
}

function applyStateToCards() {
  for (const card of document.querySelectorAll(".course-card")) {
    const code = card.dataset.code;
    card.classList.remove(
      "muted",
      "prereq",
      "selected",
      "unlocked",
      "completed",
      "glow",
      "planned",
      "drag-warning"
    );

    if (state.plannedSet.has(code)) card.classList.add("planned");
    if (state.hoverSet.has(code)) card.classList.add("glow");
    if (state.focusedCode === code) card.classList.add("selected");

    if (state.mode === "backward") {
      if (state.focusedCode) {
        const inDirect = state.prereqDirectSet.has(code);
        const inChain = state.prereqSet.has(code);

        if (inDirect) card.classList.add("prereq");

        // When not filtering, dim irrelevant cards (keeps things calm)
        if (!state.focusFilterActive) {
          const grade = Number(card.dataset.grade);
          if (grade !== 12) {
            const relevant = state.focusedCode === code || inChain || inDirect;
            if (!relevant) card.classList.add("muted");
          }
        }
      }
    } else {
      if (state.completed.has(code)) card.classList.add("completed");
      if (state.unlocked.has(code)) card.classList.add("unlocked");
      if (!state.unlocked.has(code) && !state.completed.has(code)) card.classList.add("muted");
    }

    if (state.draggingCode === code && state.draggingFrom === "board") {
      const c = state.byCode.get(code);
      if (c && !prereqsSatisfied(c, state.plannedSet)) card.classList.add("drag-warning");
    }
  }

  for (const card of document.querySelectorAll(".plan-card")) {
    const code = card.dataset.code;
    card.classList.toggle("glow", state.hoverSet.has(code));
    const c = state.byCode.get(code);
    card.classList.toggle("needs-prereq", c && !prereqsSatisfied(c, state.plannedSet));
  }
}

// ----------------------
// Wires
// ----------------------

function drawBoardWires() {
  const svg = els.wires;
  if (!svg) return;
  svg.innerHTML = "";

  const boardRect = els.board.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);
  svg.setAttribute("width", boardRect.width);
  svg.setAttribute("height", boardRect.height);

  const edges = [];

  // Board wires: only show prereqs for the focused course (keeps noise down)
  if (state.mode === "backward" && state.focusedCode) {
    const focused = state.byCode.get(state.focusedCode);
    if (focused) {
      for (const p of focused.prereqs ?? []) edges.push([p, focused.code, "and"]);
      for (const group of focused.prereq_any_of ?? [])
        for (const p of group) edges.push([p, focused.code, "or"]);
    }
  }

  drawEdgesOnSvg(svg, edges, boardRect, (code) =>
    document.querySelector(`.course-card[data-code="${cssEscape(code)}"]`)
  );
}

function drawPlanWires() {
  const svg = els.planWires;
  if (!svg) return;
  svg.innerHTML = "";

  const planRect = els.plan.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${planRect.width} ${planRect.height}`);
  svg.setAttribute("width", planRect.width);
  svg.setAttribute("height", planRect.height);

  const edges = [];

  // Plan wires: only connect planned->planned
  for (const code of state.plannedSet) {
    const c = state.byCode.get(code);
    if (!c) continue;

    for (const p of c.prereqs ?? []) {
      if (state.plannedSet.has(p)) edges.push([p, code, "and"]);
    }
    for (const group of c.prereq_any_of ?? []) {
      for (const p of group) {
        if (state.plannedSet.has(p)) edges.push([p, code, "or"]);
      }
    }
  }

  drawEdgesOnSvg(svg, edges, planRect, (code) =>
    document.querySelector(`.plan-card[data-code="${cssEscape(code)}"]`)
  );
}

function drawEdgesOnSvg(svg, edges, containerRect, getElByCode) {
  for (const [from, to, kind] of edges) {
    const a = getElByCode(from);
    const b = getElByCode(to);
    if (!a || !b) continue;

    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();

    const x1 = (ar.left + ar.right) / 2 - containerRect.left;
    const y1 = (ar.top + ar.bottom) / 2 - containerRect.top;
    const x2 = (br.left + br.right) / 2 - containerRect.left;
    const y2 = (br.top + br.bottom) / 2 - containerRect.top;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("class", kind === "or" ? "wire wire-or" : "wire");
    svg.appendChild(line);
  }
}

// ----------------------
// Prereq logic
// ----------------------

function computeUnlocked() {
  const unlocked = new Set();
  for (const c of state.courses) if (courseIsUnlocked(c, state.completed)) unlocked.add(c.code);
  for (const code of state.completed) unlocked.add(code);
  return unlocked;
}

function getDirectPrereqCodes(course) {
  if (!course) return [];
  const out = new Set();
  for (const p of course.prereqs ?? []) out.add(p);
  for (const group of course.prereq_any_of ?? []) for (const p of group) out.add(p);
  return [...out];
}

function prereqClosure(code) {
  const visited = new Set();
  const stack = [code];

  while (stack.length) {
    const cur = stack.pop();
    const c = state.byCode.get(cur);
    if (!c) continue;

    for (const p of getDirectPrereqCodes(c)) {
      if (!visited.has(p)) {
        visited.add(p);
        stack.push(p);
      }
    }
  }
  return visited;
}

// prereqs: AND list (rare); prereq_any_of: OR-groups (common)
function prereqsSatisfied(course, plannedSet) {
  if (!course) return true;

  const andList = course.prereqs ?? [];
  if (!andList.every((p) => plannedSet.has(p))) return false;

  const orGroups = course.prereq_any_of ?? [];
  for (const group of orGroups) {
    if (!group.some((p) => plannedSet.has(p))) return false;
  }

  return true;
}

function formatPrereqText(c) {
  const andPrereqs = c.prereqs ?? [];
  const orGroups = c.prereq_any_of ?? [];

  if (!andPrereqs.length && !orGroups.length) {
    if (c.prereq_unresolved && c.prereq_note) return `Prereq: ${c.prereq_note}`;
    return "No prerequisites";
  }

  if (andPrereqs.length && orGroups.length) {
    return `Prereqs: ${andPrereqs.join(", ")} + (${orGroups[0].join(" or ")})`;
  }
  if (andPrereqs.length) return `Prereqs: ${andPrereqs.join(", ")}`;
  if (orGroups.length) return `Prereqs: ${orGroups[0].join(" or ")}`;
  return "No prerequisites";
}

// ----------------------
// Helpers
// ----------------------

function getColumnEl(grade) {
  if (grade === 9) return els.col9;
  if (grade === 10) return els.col10;
  if (grade === 11) return els.col11;
  if (grade === 12) return els.col12;
  return null;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}
