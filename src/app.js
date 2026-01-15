// app.js
import { buildIndex, dependentClosure, courseIsUnlocked } from "./graph.js";

const CLICK_DELAY_MS = 200;
const SAVE_COOKIE_KEY = "pathwaySaves";
const SAVE_COOKIE_MAX_AGE_DAYS = 365;
const SAVE_COOKIE_CHAR_LIMIT = 3500;
const SAVE_COOKIE_MAX_ENTRIES = 8;
const SAVE_NAME_MAX = 20;
const CUSTOM_COOKIE_KEY = "customCourses";
const CUSTOM_COOKIE_MAX_AGE_DAYS = 365;
const CUSTOM_COOKIE_CHAR_LIMIT = 3500;
const SHARE_PAYLOAD_VERSION = 1;
const CUSTOM_SUBJECT_OPTIONS = [
  { value: "english", label: "English" },
  { value: "math", label: "Math" },
  { value: "science", label: "Science" },
  { value: "tech-ed", label: "Tech Ed" },
  { value: "business", label: "Business" },
  { value: "compsci", label: "Computer Science" },
  { value: "arts", label: "Arts" },
  { value: "fsl", label: "French" },
  { value: "hpe", label: "Health & Physical Ed" },
  { value: "guidance", label: "Guidance" },
  { value: "coop", label: "Co-op" },
  { value: "social-science-humanities", label: "Social Sciences & Humanities" },
  { value: "other", label: "Other" },
];
const CUSTOM_SUBJECT_VALUES = new Set(
  CUSTOM_SUBJECT_OPTIONS.map((option) => option.value)
);
const OSSD_CONFIG = {
  // Assumption: Native Languages substitution for French is off by default because
  // the planner does not know a student's elementary pathway. Set true to allow.
  allowNativeLanguagesForFrench: false,
};
const SUBJECT_SEARCH_TERMS = {
  arts: ["arts", "art"],
  business: ["business", "entrepreneurship", "accounting"],
  compsci: ["computer science", "computing", "programming", "coding"],
  csil: ["classical", "classical civilization", "latin", "language", "languages", "world languages"],
  cws: [
    "canadian",
    "world",
    "studies",
    "civics",
    "cws",
    "canadian and world studies",
    "geography",
    "history",
    "social",
    "humanities",
  ],
  english: ["english", "literature", "language arts"],
  "fnmi-studies": [
    "indigenous",
    "first nations",
    "metis",
    "inuit",
    "fnmi",
    "native studies",
  ],
  fsl: ["french", "fsl", "language", "languages", "world languages"],
  guidance: ["guidance", "career", "learning strategies","civics"],
  hpe: ["health", "physical education", "phys ed", "hpe", "fitness"],
  math: ["math", "mathematics", "calculus", "functions", "advanced functions"],
  other: ["other"],
  science: ["science", "biology", "bio", "chemistry", "chem", "physics", "phys"],
  "social-science-humanities": [
    "social",
    "social science",
    "social sciences",
    "humanities",
    "psychology",
    "sociology",
  ],
  "tech-ed": ["tech", "technology", "tech ed", "trades", "construction", "manufacturing"],
};

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
  pathwayFilter: "all",

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

  savedPaths: [],
  activeSaveId: null,

  customCourses: [],
  customDrafts: [],
};

const els = {
  tabBackward: document.getElementById("tab-backward"),
  tabForward: document.getElementById("tab-forward"),
  drawer: document.getElementById("drawer"),
  drawerToggle: document.getElementById("drawer-toggle"),
  drawerScrim: document.getElementById("drawer-scrim"),
  ossdDrawer: document.getElementById("ossd-drawer"),
  ossdToggle: document.getElementById("ossd-toggle"),
  ossdList: document.getElementById("ossd-list"),
  hint: document.getElementById("mode-hint"),
  search: document.getElementById("search"),
  pathwayFilter: document.getElementById("pathway-filter"),
  clear: document.getElementById("clear"), // Start Over
  printPathway: document.getElementById("print-pathway"),
  savePathway: document.getElementById("save-pathway"),
  sharePathway: document.getElementById("share-pathway"),
  showAll: document.getElementById("show-all"), // Show All Courses
  savedList: document.getElementById("saved-list"),
  loadingOverlay: document.getElementById("loading-overlay"),

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

  const sharedPayload = readSharedPayloadFromLocation();
  state.customCourses = sharedPayload
    ? normalizeSharedCustomCourses(sharedPayload.customCourses)
    : loadCustomCourses();
  registerCustomCourses();
  if (sharedPayload) {
    persistCustomCourses(state.customCourses);
  }

  initWheelOrder();
  wireEvents();
  state.savedPaths = loadSavedPathways();
  renderSavedList();

  if (sharedPayload) {
    applySharedPayload(sharedPayload);
    clearShareParamFromLocation();
    return;
  }

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
    const isOpen = !els.drawer?.classList.contains("is-open");
    setDrawerOpen(isOpen);
  });
  els.drawerScrim?.addEventListener("click", () => {
    setDrawerOpen(false);
  });
  els.ossdToggle?.addEventListener("click", () => {
    const isOpen = !document.body.classList.contains("ossd-open");
    setOssdDrawerOpen(isOpen);
  });
  els.printPathway?.addEventListener("click", () => {
    setDrawerOpen(false);
    window.print();
  });
  els.savePathway?.addEventListener("click", () => {
    const name = promptForSaveName();
    if (!name) return;
    saveCurrentPathway(name);
  });
  els.sharePathway?.addEventListener("click", async () => {
    const payload = buildSharePayload();
    const encoded = encodeSharePayload(payload);
    if (!encoded) {
      showToast("Unable to build a share link right now.");
      return;
    }
    const shareUrl = `${location.origin}${location.pathname}#share=${encoded}`;
    const copied = await copyToClipboard(shareUrl);
    showToast(
      copied
        ? "Share link copied to your clipboard."
        : "Share link ready. Copy it from your address bar."
    );
  });
  els.savedList?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".saved-delete");
    if (deleteButton) {
      const id = deleteButton.dataset.saveId;
      if (!id) return;
      const entry = state.savedPaths.find((item) => item.id === id);
      if (!entry) return;
      const confirmed = window.confirm(
        `Are you sure you want to delete the saved pathway "${entry.name}"?`
      );
      if (!confirmed) return;
      const updated = state.savedPaths.filter((item) => item.id !== id);
      persistSavedPathways(updated);
      if (state.activeSaveId === id) state.activeSaveId = null;
      renderSavedList();
      return;
    }

    const button = event.target.closest(".saved-load");
    if (!button) return;
    const id = button.dataset.saveId;
    if (!id) return;
    const entry = state.savedPaths.find((item) => item.id === id);
    if (!entry) return;
    if (
      hasActiveSelections() &&
      !window.confirm(
        "Are you sure you want to load this pathway? This will clear your current selections."
      )
    ) {
      return;
    }
    state.activeSaveId = id;
    renderSavedList();
    showLoadingOverlay();
    requestAnimationFrame(() => {
      try {
        applySavedPathway(entry);
      } finally {
        hideLoadingOverlaySoon();
      }
    });
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

  els.pathwayFilter?.addEventListener("change", (e) => {
    state.pathwayFilter = e.target.value;

    renderBoard();
    applyStateToCards();
    drawBoardWires();
    drawPlanWires();
  });

  // Show all courses: reset focus/filter, keep plan, and spin columns back to base order
  els.showAll?.addEventListener("click", async () => {
    resetFocusOnly();
    if (els.search) {
      els.search.value = "";
    }
    state.search = "";
    resetPathwayFilter();

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
    if (
      hasActiveSelections() &&
      !window.confirm("Are you sure you want to clear your selections?")
    ) {
      return;
    }
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
    resetPathwayFilter();

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

function setDrawerOpen(isOpen) {
  els.drawer?.classList.toggle("is-open", isOpen);
  els.drawerToggle?.classList.toggle("is-open", isOpen);
  els.drawerScrim?.toggleAttribute("hidden", !isOpen);
  els.drawerToggle?.setAttribute("aria-expanded", isOpen ? "true" : "false");
  els.drawerToggle?.setAttribute(
    "aria-label",
    isOpen ? "Close menu" : "Open menu"
  );
}

function setOssdDrawerOpen(isOpen) {
  document.body.classList.toggle("ossd-open", isOpen);
  els.ossdToggle?.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function hasActiveSelections() {
  if (state.completed.size) return true;
  for (const set of state.plannedByGrade.values()) {
    if (set.size) return true;
  }
  return false;
}

function loadSavedPathways() {
  const raw = readCookie(SAVE_COOKIE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? "").trim(),
        savedAt: String(item.savedAt ?? ""),
        data: item.data ?? {},
      }))
      .filter((item) => item.id && item.name)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

function persistSavedPathways(list) {
  let trimmed = list
    .slice()
    .sort((a, b) => String(b.savedAt ?? "").localeCompare(String(a.savedAt ?? "")))
    .slice(0, SAVE_COOKIE_MAX_ENTRIES);
  let encoded = encodeURIComponent(JSON.stringify(trimmed));
  while (encoded.length > SAVE_COOKIE_CHAR_LIMIT && trimmed.length > 1) {
    trimmed = trimmed.slice(0, -1);
    encoded = encodeURIComponent(JSON.stringify(trimmed));
  }
  writeCookie(SAVE_COOKIE_KEY, encoded, SAVE_COOKIE_MAX_AGE_DAYS);
  state.savedPaths = trimmed;
}

function renderSavedList() {
  if (!els.savedList) return;
  if (!state.savedPaths.length) {
    els.savedList.innerHTML = `<div class="saved-empty">No saved pathways yet.</div>`;
    return;
  }
  els.savedList.innerHTML = state.savedPaths
    .map((entry) => {
      const date = entry.savedAt ? new Date(entry.savedAt) : null;
      const label = date
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "Saved";
      return `
        <div class="saved-item ${state.activeSaveId === entry.id ? "is-active" : ""}" data-save-id="${escapeHtml(entry.id)}">
          <button class="saved-load" type="button" data-save-id="${escapeHtml(entry.id)}">
            <span>${escapeHtml(entry.name)}</span>
            <time datetime="${escapeHtml(entry.savedAt ?? "")}">${escapeHtml(label)}</time>
          </button>
          <button class="saved-delete" type="button" data-save-id="${escapeHtml(entry.id)}" aria-label="Delete saved pathway ${escapeHtml(entry.name)}">✕</button>
        </div>
      `;
    })
    .join("");
}

function promptForSaveName() {
  const hint = `Name this pathway (1-${SAVE_NAME_MAX} characters; 15-20 recommended).`;
  while (true) {
    const input = window.prompt(hint);
    if (input === null) return null;
    const name = input.trim();
    if (!name) {
      window.alert("Please enter a name for your pathway.");
      continue;
    }
    if (name.length > SAVE_NAME_MAX) {
      window.alert(`Please keep the name under ${SAVE_NAME_MAX} characters.`);
      continue;
    }
    return name;
  }
}

function saveCurrentPathway(name) {
  const entry = {
    id: `save_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    name,
    savedAt: new Date().toISOString(),
    data: serializePathway(),
  };
  const withoutName = state.savedPaths.filter(
    (item) => item.name.toLowerCase() !== name.toLowerCase()
  );
  const updated = [entry, ...withoutName];
  persistSavedPathways(updated);
  renderSavedList();
}

function buildSharePayload() {
  return {
    version: SHARE_PAYLOAD_VERSION,
    data: serializePathway(),
    customCourses: state.customCourses,
  };
}

function encodeSharePayload(payload) {
  try {
    const json = JSON.stringify(payload);
    return toBase64Url(json);
  } catch {
    return "";
  }
}

function decodeSharePayload(encoded) {
  if (!encoded) return null;
  try {
    const json = fromBase64Url(encoded);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function readSharedPayloadFromLocation() {
  const shareParam = getShareParamFromLocation();
  if (!shareParam) return null;
  return decodeSharePayload(shareParam);
}

function getShareParamFromLocation() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(location.search);
  return hashParams.get("share") ?? searchParams.get("share");
}

function clearShareParamFromLocation() {
  const url = new URL(window.location.href);
  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    if (hashParams.has("share")) {
      hashParams.delete("share");
      const nextHash = hashParams.toString();
      url.hash = nextHash ? `#${nextHash}` : "";
    }
  }
  if (url.searchParams.has("share")) {
    url.searchParams.delete("share");
  }
  history.replaceState(null, document.title, url.pathname + url.search + url.hash);
}

function normalizeSharedCustomCourses(courses) {
  if (!Array.isArray(courses)) return [];
  return courses.map((course) => normalizeCustomCourse(course)).filter(Boolean);
}

function applySharedPayload(payload) {
  const data = payload?.data ?? {};
  applySavedPathway({ data });
}

function toBase64Url(value) {
  const utf8 = encodeUtf8(value);
  const base64 = btoa(utf8);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return decodeUtf8(binary);
}

function encodeUtf8(value) {
  return encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function decodeUtf8(value) {
  const escaped = [...value]
    .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .join("");
  return decodeURIComponent(escaped);
}

function serializePathway() {
  return {
    mode: state.mode,
    completed: [...state.completed],
    plannedByGrade: {
      9: [...(state.plannedByGrade.get(9) ?? new Set())],
      10: [...(state.plannedByGrade.get(10) ?? new Set())],
      11: [...(state.plannedByGrade.get(11) ?? new Set())],
      12: [...(state.plannedByGrade.get(12) ?? new Set())],
    },
  };
}

function applySavedPathway(entry) {
  const payload = entry?.data ?? {};
  state.completed = new Set(payload.completed ?? []);
  state.plannedByGrade = new Map([
    [9, new Set(payload.plannedByGrade?.[9] ?? [])],
    [10, new Set(payload.plannedByGrade?.[10] ?? [])],
    [11, new Set(payload.plannedByGrade?.[11] ?? [])],
    [12, new Set(payload.plannedByGrade?.[12] ?? [])],
  ]);
  state.search = "";
  if (els.search) els.search.value = "";
  state.hoveredCode = null;
  state.hoverSet = new Set();
  state.focusedCode = null;
  state.prereqSet = new Set();
  state.prereqDirectSet = new Set();
  state.focusFilterActive = false;
  initWheelOrder();
  setMode(payload.mode ?? "backward");
  if (els.drawer?.classList.contains("is-open")) {
    setDrawerOpen(false);
  }
  renderBoard();
  renderPlan();
  applyStateToCards();
  drawBoardWires();
  drawPlanWires();
}

function resetFocusOnly() {
  state.focusedCode = null;
  state.prereqSet = new Set();
  state.prereqDirectSet = new Set();
  state.focusFilterActive = false;
}

function setMode(mode) {
  const nextMode = mode === "forward" ? "backward" : mode;
  state.mode = nextMode;

  els.tabBackward?.classList.toggle("active", nextMode === "backward");
  els.tabForward?.classList.toggle("active", nextMode === "forward");

  const hintText =
    nextMode === "backward"
      ? "Backward mode: click a Grade 12 course to focus prereqs. Drag courses into the Plan."
      : "Forward mode: mark completed courses; eligible ones light up. Drag into Plan still works.";
  if (els.hint) els.hint.textContent = hintText;

  resetFocusOnly();

  if (nextMode === "forward") state.unlocked = computeUnlocked();

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
  bindCustomCourseHandlers();
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
      const hay = buildSearchHaystack(c);
      if (!hay.includes(state.search)) continue;
    }

    if (!isCourseAllowedByPathway(c, grade)) continue;

    if (filterActive && !state.prereqSet.has(code)) continue;

    cards.push(renderCourseCard(c));
  }

  let customSection = "";
  if (grade === 9) {
    customSection = renderCustomCoursesSection();
  }

  colEl.innerHTML = `${cards.join("")}${customSection}`;
}

function getTypeLetter(code) {
  if (!code) return null;
  const match = String(code).match(/([A-Z])(?!.*[A-Z])/);
  return match ? match[1] : null;
}

function isCourseAllowedByPathway(course, grade = course?.grade) {
  const filter = state.pathwayFilter;
  if (!filter || filter === "all") return true;

  const typeLetter = getTypeLetter(course?.code);
  if (!typeLetter) return true;

  const type = typeLetter.toUpperCase();
  const level = Number(grade);

  if (level === 9) {
    return type === "W" || type === "O";
  }

  if (level === 10) {
    if (filter === "university") return ["D", "O"].includes(type);
    if (filter === "college") return ["D", "P", "O"].includes(type);
    if (filter === "undecided") return ["D", "P", "O"].includes(type);
    if (filter === "workplace") return ["P", "O"].includes(type);
  }

  if (level === 11 || level === 12) {
    if (filter === "university") return ["U", "M"].includes(type);
    if (filter === "college") return ["C", "M"].includes(type);
    if (filter === "undecided") return ["U", "C", "M"].includes(type);
    if (filter === "workplace") return ["E", "O"].includes(type);
  }

  return true;
}

function resetPathwayFilter() {
  state.pathwayFilter = "all";
  if (els.pathwayFilter) {
    els.pathwayFilter.value = "all";
  }
}

function buildSearchHaystack(course) {
  const subject = course.subject ?? "other";
  const subjectTerms = SUBJECT_SEARCH_TERMS[subject] ?? [];
  const tokens = [
    course.code,
    course.name,
    subject,
    ...subjectTerms,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens;
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
        : `<div class="plan-empty">Drag courses here, or double click to add</div>`;

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
  updateOssdChecklist();
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

    card.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      const course = state.byCode.get(code);
      if (!course) return;
      const from = state.plannedSet.has(code) ? "plan" : "board";
      onDropIntoPlan(code, from, course.grade);
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

function bindCustomCourseHandlers() {
  const addButton = document.querySelector(".custom-add");
  if (addButton && addButton.dataset.bound !== "1") {
    addButton.dataset.bound = "1";
    addButton.addEventListener("click", () => {
      addCustomDraft();
    });
  }

  for (const builder of document.querySelectorAll(".custom-builder")) {
    if (builder.dataset.bound === "1") continue;
    builder.dataset.bound = "1";
    const builderId = builder.dataset.builderId;

    const codeInput = builder.querySelector(".custom-code-input");
    const nameInput = builder.querySelector(".custom-name-input");
    const subjectSelect = builder.querySelector(".custom-subject-select");
    const createButton = builder.querySelector(".custom-create");
    const removeButton = builder.querySelector(".custom-remove");

    codeInput?.addEventListener("input", () => {
      const value = normalizeCourseCode(codeInput.value);
      codeInput.value = value;
      updateCustomDraft(builderId, { code: value });
      const predicted = guessSubjectFromCode(value);
      if (predicted && subjectSelect?.dataset.manual !== "true") {
        subjectSelect.value = predicted;
        updateCustomDraft(builderId, { subject: predicted });
      }
    });

    nameInput?.addEventListener("input", () => {
      updateCustomDraft(builderId, { name: nameInput.value });
    });

    subjectSelect?.addEventListener("change", () => {
      if (subjectSelect) subjectSelect.dataset.manual = "true";
      updateCustomDraft(builderId, { subject: subjectSelect?.value ?? "other" });
    });

    createButton?.addEventListener("click", () => {
      const draft = state.customDrafts.find((item) => item.id === builderId);
      if (!draft) return;
      const code = normalizeCourseCode(draft.code);
      const name = String(draft.name ?? "").trim();
      const subject = draft.subject ?? "other";
      if (!code || !name) {
        window.alert("Please enter both a course code and course name.");
        return;
      }
      const existing = state.byCode.get(code);
      if (existing && !existing.custom) {
        window.alert("That course code already exists in the catalog.");
        return;
      }
      if (existing && existing.custom) {
        window.alert("That custom course already exists.");
        return;
      }
      addCustomCourse({ code, name, subject });
      removeCustomDraft(builderId);
    });

    removeButton?.addEventListener("click", () => {
      removeCustomDraft(builderId);
    });
  }

  for (const card of document.querySelectorAll(".custom-course-card")) {
    const code = card.dataset.code;
    if (!code || card.dataset.bound === "1") continue;
    card.dataset.bound = "1";

    card.addEventListener("mouseenter", () => onHover(code));
    card.addEventListener("mouseleave", () => onHover(null));

    card.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const targetGrade = guessTargetGradeFromCode(code);
      onDropIntoPlan(code, "custom", targetGrade);
    });

    card.addEventListener("dragstart", (e) => {
      state.draggingCode = code;
      state.draggingFrom = "custom";
      card.classList.add("dragging");

      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", JSON.stringify({ code, from: "custom" }));
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
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

  for (const card of document.querySelectorAll(".custom-course-card")) {
    const code = card.dataset.code;
    card.classList.toggle("glow", state.hoverSet.has(code));
    card.classList.toggle("planned", state.plannedSet.has(code));
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

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const result = document.execCommand("copy");
    document.body.removeChild(textarea);
    return result;
  } catch {
    document.body.removeChild(textarea);
    return false;
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add("toast--visible");
  });
  window.setTimeout(() => {
    toast.classList.remove("toast--visible");
    toast.addEventListener(
      "transitionend",
      () => {
        toast.remove();
      },
      { once: true }
    );
  }, 2600);
}

function readCookie(name) {
  const prefix = `${name}=`;
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return "";
}

function writeCookie(name, encodedValue, maxAgeDays) {
  const maxAgeSeconds = Math.floor(maxAgeDays * 24 * 60 * 60);
  document.cookie = `${name}=${encodedValue}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax`;
}

function loadCustomCourses() {
  const raw = readCookie(CUSTOM_COOKIE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => normalizeCustomCourse(item))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function persistCustomCourses(list) {
  let trimmed = list.slice();
  let encoded = encodeURIComponent(JSON.stringify(trimmed));
  while (encoded.length > CUSTOM_COOKIE_CHAR_LIMIT && trimmed.length > 1) {
    trimmed = trimmed.slice(0, -1);
    encoded = encodeURIComponent(JSON.stringify(trimmed));
  }
  writeCookie(CUSTOM_COOKIE_KEY, encoded, CUSTOM_COOKIE_MAX_AGE_DAYS);
  state.customCourses = trimmed;
}

function normalizeCustomCourse(item) {
  const code = normalizeCourseCode(item.code ?? "");
  const name = String(item.name ?? "").trim();
  const subject = normalizeCustomSubject(item.subject);
  if (!code || !name) return null;
  return {
    code,
    name,
    subject,
    level: "Custom",
    grade: null,
    prereqs: [],
    prereq_any_of: [],
    prereq_note: "",
    prereq_unresolved: false,
    custom: true,
  };
}

function normalizeCustomSubject(subject) {
  const trimmed = String(subject ?? "").trim();
  if (trimmed === "social-sciences-humanities") return "social-science-humanities";
  if (CUSTOM_SUBJECT_VALUES.has(trimmed)) return trimmed;
  return "other";
}

function registerCustomCourses() {
  const filtered = [];
  for (const course of state.customCourses) {
    if (!course?.code) continue;
    if (state.byCode.has(course.code)) continue;
    filtered.push(course);
    state.byCode.set(course.code, course);
  }
  if (filtered.length !== state.customCourses.length) {
    persistCustomCourses(filtered);
  }
}

function addCustomCourse(payload) {
  const normalized = normalizeCustomCourse(payload);
  if (!normalized) return;
  state.customCourses.push(normalized);
  state.byCode.set(normalized.code, normalized);
  persistCustomCourses(state.customCourses);
  renderBoard();
  applyStateToCards();
  drawBoardWires();
  drawPlanWires();
}

function addCustomDraft() {
  const draft = {
    id: `draft_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    code: "",
    name: "",
    subject: "other",
  };
  state.customDrafts.push(draft);
  renderBoard();
  requestAnimationFrame(() => {
    const input = document.querySelector(
      `.custom-builder[data-builder-id="${cssEscape(draft.id)}"] .custom-code-input`
    );
    input?.focus();
  });
}

function updateCustomDraft(id, updates) {
  const idx = state.customDrafts.findIndex((item) => item.id === id);
  if (idx === -1) return;
  state.customDrafts[idx] = { ...state.customDrafts[idx], ...updates };
}

function removeCustomDraft(id) {
  state.customDrafts = state.customDrafts.filter((item) => item.id !== id);
  renderBoard();
  applyStateToCards();
  drawBoardWires();
  drawPlanWires();
}

function renderCustomCoursesSection() {
  const builders = state.customDrafts.map(renderCustomBuilder).join("");
  const courses = state.customCourses.map(renderCustomCourseCard).join("");
  const empty = state.customCourses.length
    ? ""
    : `<div class="custom-empty">No custom courses yet.</div>`;

  return `
    <div class="custom-courses">
      <div class="custom-header">
        <div>
          <div class="custom-title">Custom courses</div>
          <div class="custom-subtitle">Add your own course cards below.</div>
        </div>
        <button class="btn custom-add" type="button" aria-label="Add a custom course">＋</button>
      </div>
      <div class="custom-builders">${builders}</div>
      <div class="custom-list">${courses}${empty}</div>
    </div>
  `;
}

function renderCustomBuilder(draft) {
  const subjectOptions = CUSTOM_SUBJECT_OPTIONS.map((option) => {
    const selected = option.value === draft.subject ? "selected" : "";
    return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
  }).join("");

  return `
    <div class="custom-builder" data-builder-id="${escapeHtml(draft.id)}">
      <label>
        <span>Course code</span>
        <input class="custom-code-input" type="text" placeholder="e.g., TGV3M" value="${escapeHtml(
          draft.code ?? ""
        )}" />
      </label>
      <label>
        <span>Course name</span>
        <input class="custom-name-input" type="text" placeholder="Course name" value="${escapeHtml(
          draft.name ?? ""
        )}" />
      </label>
      <label>
        <span>Department</span>
        <select class="custom-subject-select">${subjectOptions}</select>
      </label>
      <div class="custom-builder-actions">
        <button class="btn custom-create" type="button">Create</button>
        <button class="btn custom-remove" type="button" aria-label="Remove this custom course form">Remove</button>
      </div>
    </div>
  `;
}

function renderCustomCourseCard(course) {
  const subject = course.subject ?? "other";
  const prereqText = formatPrereqText(course);

  return `
    <button class="custom-course-card subject-${escapeHtml(subject)}"
      draggable="true"
      data-code="${escapeHtml(course.code)}">
      <div class="course-top">
        <div class="course-code">${escapeHtml(course.code)}</div>
        <div class="course-level">${escapeHtml(course.level ?? "")}</div>
      </div>
      <div class="course-name">${escapeHtml(course.name ?? "")}</div>
      <div class="course-meta">${escapeHtml(prereqText)}</div>
    </button>
  `;
}

function normalizeCourseCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

function guessSubjectFromCode(code) {
  const upper = normalizeCourseCode(code);
  if (!upper) return "";
  if (upper.startsWith("ENG") || upper.startsWith("ENL") || upper.startsWith("EMS")) return "english";
  if (upper.startsWith("MTH") || upper.startsWith("MPM") || upper.startsWith("MFM")) return "math";
  if (upper.startsWith("MCR") || upper.startsWith("MCV") || upper.startsWith("MAT")) return "math";
  if (upper.startsWith("SNC")) return "science";
  if (upper.startsWith("ICS")) return "compsci";
  if (upper.startsWith("B")) return "business";
  if (upper.startsWith("FSF")) return "fsl";
  if (upper.startsWith("PPL")) return "hpe";
  if (upper.startsWith("CHC") || upper.startsWith("CGC")) return "social-science-humanities";
  if (upper.startsWith("GLC") || upper.startsWith("CHV")) return "guidance";
  if (upper.startsWith("COP") || upper.startsWith("COOP")) return "coop";
  if (upper.startsWith("T")) return "tech-ed";
  if (upper.startsWith("ADA") || upper.startsWith("AVI") || upper.startsWith("AMU")) return "arts";
  return "";
}

function guessTargetGradeFromCode(code) {
  const match = normalizeCourseCode(code).match(/[1-4]/);
  if (match) {
    const digit = Number(match[0]);
    const grade = 8 + digit;
    if ([9, 10, 11, 12].includes(grade)) return grade;
  }
  return getRoomiestGrade();
}

function getRoomiestGrade() {
  let bestGrade = 9;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const grade of [9, 10, 11, 12]) {
    const count = state.plannedByGrade.get(grade)?.size ?? 0;
    if (count < bestCount) {
      bestCount = count;
      bestGrade = grade;
    }
  }
  return bestGrade;
}

function showLoadingOverlay() {
  if (!els.loadingOverlay) return;
  els.loadingOverlay.classList.add("is-visible");
  els.loadingOverlay.setAttribute("aria-hidden", "false");
}

function hideLoadingOverlaySoon() {
  if (!els.loadingOverlay) return;
  requestAnimationFrame(() => {
    setTimeout(() => {
      els.loadingOverlay.classList.remove("is-visible");
      els.loadingOverlay.setAttribute("aria-hidden", "true");
    }, 180);
  });
}

// ----------------------
// OSSD checklist helpers
// ----------------------

function updateOssdChecklist() {
  if (!els.ossdList) return;
  const status = computeOssdStatus();
  for (const item of els.ossdList.querySelectorAll(".ossd-item")) {
    const key = item.dataset.req;
    const isComplete = Boolean(status[key]);
    item.classList.toggle("is-complete", isComplete);
    const check = item.querySelector(".ossd-check");
    if (check) check.textContent = isComplete ? "✅" : "⬜";
  }
}

function computeOssdStatus() {
  const plannedEntries = getPlannedEntries();

  const englishByGrade = { 9: 0, 10: 0, 11: 0, 12: 0 };
  let englishCredits = 0;
  let eslCredits = 0;
  let hasGrade12CompEnglish = false;

  const mathByGrade = { 9: 0, 10: 0, 11: 0, 12: 0 };
  let mathCredits = 0;

  let scienceCredits = 0;
  let techCredits = 0;
  let historyCredits = 0;
  let geographyCredits = 0;
  let artsCredits = 0;
  let hpeCredits = 0;
  let frenchCredits = 0;
  let careerCredits = 0;
  let civicsCredits = 0;

  let businessCredits = 0;
  let compsciCredits = 0;
  let coopCredits = 0;

  for (const entry of plannedEntries) {
    const { course, plannedGrade } = entry;
    const credit = getCourseCredit(course);

    if (isEnglishCourse(course)) {
      englishCredits += credit;
      if (englishByGrade[plannedGrade] !== undefined) {
        englishByGrade[plannedGrade] += credit;
      }
      if (isGrade12CompEnglish(course)) hasGrade12CompEnglish = true;
    } else if (isEnglishSpecialG11(course)) {
      // Assumption: NBE3* satisfies the Grade 11 English requirement.
      englishCredits += credit;
      if (englishByGrade[plannedGrade] !== undefined) {
        englishByGrade[plannedGrade] += credit;
      }
    } else if (isEslEldCourse(course)) {
      // Assumption: ESL/ELD credits count toward total English, but not grade-by-grade checks.
      eslCredits += credit;
    }

    if (isMathCourse(course)) {
      mathCredits += credit;
      if (mathByGrade[plannedGrade] !== undefined) {
        mathByGrade[plannedGrade] += credit;
      }
    }

    if (isScienceCourse(course)) scienceCredits += credit;
    if (isTechCourse(course) && (plannedGrade === 9 || plannedGrade === 10)) techCredits += credit;
    if (isHistoryCourse(course)) historyCredits += credit;
    if (isGeographyCourse(course)) geographyCredits += credit;
    if (isArtsCourse(course)) artsCredits += credit;
    if (isHpeCourse(course)) hpeCredits += credit;
    if (isFrenchCourse(course)) frenchCredits += credit;
    if (isCareerStudies(course)) careerCredits += credit;
    if (isCivics(course)) civicsCredits += credit;

    if (isBusinessCourse(course)) businessCredits += credit;
    if (isCompSciCourse(course)) compsciCredits += credit;
    if (isCoopCourse(course)) coopCredits += credit;
  }

  const cappedEslCredits = Math.min(eslCredits, 3);
  const totalEnglishCredits = englishCredits + cappedEslCredits;
  const englishComplete =
    totalEnglishCredits >= 4 &&
    englishByGrade[9] >= 1 &&
    englishByGrade[10] >= 1 &&
    englishByGrade[11] >= 1 &&
    englishByGrade[12] >= 1 &&
    hasGrade12CompEnglish;

  const mathGrade11Plus = (mathByGrade[11] ?? 0) + (mathByGrade[12] ?? 0);
  const mathComplete =
    mathCredits >= 3 && mathByGrade[9] >= 1 && mathByGrade[10] >= 1 && mathGrade11Plus >= 1;

  const scienceComplete = scienceCredits >= 2;
  const techComplete = techCredits >= 1;
  const historyComplete = historyCredits >= 1;
  const geographyComplete = geographyCredits >= 1;
  const artsComplete = artsCredits >= 1;
  const hpeComplete = hpeCredits >= 1;
  const frenchComplete =
    frenchCredits >= 1 ||
    (OSSD_CONFIG.allowNativeLanguagesForFrench && hasNativeLanguageCredit(plannedEntries));
  const careerComplete = careerCredits >= 0.5;
  const civicsComplete = civicsCredits >= 0.5;

  const requiredMathCredits =
    Math.min(1, mathByGrade[9]) + Math.min(1, mathByGrade[10]) + Math.min(1, mathGrade11Plus);
  const extraMathCredits = Math.max(0, mathCredits - requiredMathCredits);
  const extraScienceCredits = Math.max(0, scienceCredits - 2);
  const extraTechCredits = Math.max(0, techCredits - 1);
  const stemCredits =
    businessCredits + compsciCredits + coopCredits + extraMathCredits + extraScienceCredits + extraTechCredits;
  const stemComplete = stemCredits >= 1;

  return {
    english: englishComplete,
    math: mathComplete,
    science: scienceComplete,
    tech: techComplete,
    history: historyComplete,
    geography: geographyComplete,
    arts: artsComplete,
    hpe: hpeComplete,
    french: frenchComplete,
    career: careerComplete,
    civics: civicsComplete,
    stem: stemComplete,
  };
}

function getPlannedEntries() {
  const entries = [];
  for (const grade of [9, 10, 11, 12]) {
    const set = state.plannedByGrade.get(grade) ?? new Set();
    for (const code of set) {
      const course = state.byCode.get(code);
      if (!course) continue;
      entries.push({ course, plannedGrade: grade });
    }
  }
  return entries;
}

function getCourseCredit(course) {
  const code = String(course.code ?? "").toUpperCase();
  // Assumption: Civics (CHV2*) and Careers (GLC2*) are 0.5 credits; others are 1.0.
  if (code.startsWith("CHV2") || code.startsWith("GLC2")) return 0.5;
  return 1;
}

function isEnglishCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "english" || code.startsWith("ENG") || code.startsWith("ENL") || code.startsWith("EMS");
}

function isEnglishSpecialG11(course) {
  const code = String(course.code ?? "").toUpperCase();
  return code.startsWith("NBE3");
}

function isEslEldCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  return code.startsWith("ESL") || code.startsWith("ELD");
}

function isGrade12CompEnglish(course) {
  const code = String(course.code ?? "").toUpperCase();
  // Assumption: Grade 12 compulsory English courses start with ENG4.
  return course.grade === 12 && code.startsWith("ENG4");
}

function isMathCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return (
    subject === "math" ||
    code.startsWith("MTH") ||
    code.startsWith("MPM") ||
    code.startsWith("MFM") ||
    code.startsWith("MCR") ||
    code.startsWith("MCV") ||
    code.startsWith("MAT")
  );
}

function isScienceCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "science" || code.startsWith("SNC");
}

function isTechCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject.includes("tech") || code.startsWith("T");
}

function isHistoryCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  return code.startsWith("CHC2");
}

function isGeographyCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  return code.startsWith("CGC1");
}

function isArtsCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "arts" || code === "NAC1O";
}

function isHpeCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "health" || code.startsWith("PPL");
}

function isFrenchCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "fsl" || code.startsWith("FSF");
}

function isCareerStudies(course) {
  const code = String(course.code ?? "").toUpperCase();
  return code.startsWith("GLC2");
}

function isCivics(course) {
  const code = String(course.code ?? "").toUpperCase();
  return code.startsWith("CHV2");
}

function isBusinessCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "business" || code.startsWith("B");
}

function isCompSciCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "compsci" || code.startsWith("ICS");
}

function isCoopCourse(course) {
  const code = String(course.code ?? "").toUpperCase();
  const subject = String(course.subject ?? "").toLowerCase();
  return subject === "coop" || code.startsWith("COP") || code.startsWith("COOP");
}

function hasNativeLanguageCredit(entries) {
  // Assumption: Native Languages Level 1 or 2 will include "Native Languages"
  // in the name or start with LN.. in the course code.
  for (const entry of entries) {
    const course = entry.course;
    const code = String(course.code ?? "").toUpperCase();
    const name = String(course.name ?? "").toLowerCase();
    if (name.includes("native languages") || code.startsWith("LN")) {
      if (code.includes("1") || code.includes("2")) return true;
    }
  }
  return false;
}
