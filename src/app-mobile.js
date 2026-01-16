const SHARE_PARAM = "share";
const SAVE_KEY = "pathway-mobile-saves";
const CUSTOM_KEY = "pathway-mobile-custom";
const STATUS_TIMEOUT_MS = 2400;

const OSSD_REQUIREMENTS = [
  { key: "english", label: "4 English credits (incl. Gr.12)" },
  { key: "math", label: "3 Math credits (1 in Gr.11/12)" },
  { key: "science", label: "2 Science credits" },
  { key: "history", label: "1 Canadian History credit" },
  { key: "geography", label: "1 Canadian Geography credit" },
  { key: "arts", label: "1 Arts credit" },
  { key: "hpe", label: "1 Health & PE credit" },
  { key: "french", label: "1 French credit" },
  { key: "career", label: "0.5 Career Studies" },
  { key: "civics", label: "0.5 Civics" },
  { key: "stem", label: "1 STEM-related credit" },
];

const state = {
  courses: [],
  byCode: new Map(),
  plannedByGrade: new Map([
    [9, []],
    [10, []],
    [11, []],
    [12, []],
  ]),
  customCourses: [],
  savedPaths: [],
  search: "",
  pathway: "all",
  activeCourse: null,
};

const els = {
  search: document.getElementById("course-search"),
  pathway: document.getElementById("pathway-filter"),
  courseList: document.getElementById("course-list"),
  plan: {
    9: document.getElementById("plan-9"),
    10: document.getElementById("plan-10"),
    11: document.getElementById("plan-11"),
    12: document.getElementById("plan-12"),
  },
  credits: {
    9: document.getElementById("credits-9"),
    10: document.getElementById("credits-10"),
    11: document.getElementById("credits-11"),
    12: document.getElementById("credits-12"),
  },
  status: document.getElementById("status"),
  savedList: document.getElementById("saved-list"),
  customForm: document.getElementById("custom-form"),
  ossdList: document.getElementById("ossd-list"),
  newPath: document.getElementById("new-path"),
  savePath: document.getElementById("save-path"),
  sharePath: document.getElementById("share-path"),
  printPath: document.getElementById("print-path"),
  sheet: document.getElementById("course-sheet"),
  sheetScrim: document.getElementById("sheet-scrim"),
  sheetCode: document.getElementById("sheet-code"),
  sheetTitle: document.getElementById("sheet-title"),
  sheetMeta: document.getElementById("sheet-meta"),
  sheetPrereqs: document.getElementById("sheet-prereqs"),
  sheetGrade: document.getElementById("sheet-grade"),
  sheetAdd: document.getElementById("sheet-add"),
  sheetClose: document.getElementById("close-sheet"),
};

boot();

async function boot() {
  const res = await fetch("./data/ontario_courses.json");
  const payload = await res.json();
  state.courses = Array.isArray(payload) ? payload : payload.courses ?? [];
  state.customCourses = loadCustomCourses();
  state.courses = [...state.courses, ...state.customCourses];
  state.byCode = new Map(state.courses.map((course) => [course.code, course]));
  state.savedPaths = loadSavedPaths();

  const shared = readSharedPlan();
  if (shared) {
    applySharedPlan(shared);
  }

  renderOssdChecklist();
  renderPlan();
  renderSavedList();
  renderCourseList();
  wireEvents();
}

function wireEvents() {
  els.search.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderCourseList();
  });

  els.pathway.addEventListener("change", (event) => {
    state.pathway = event.target.value;
    renderCourseList();
  });

  els.courseList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-course]");
    if (!card) return;
    const code = card.dataset.course;
    const course = state.byCode.get(code);
    if (!course) return;
    openCourseSheet(course);
  });

  els.sheetClose.addEventListener("click", closeSheet);
  els.sheetScrim.addEventListener("click", closeSheet);
  els.sheetAdd.addEventListener("click", () => {
    if (!state.activeCourse) return;
    const grade = Number(els.sheetGrade.value);
    addCourseToPlan(state.activeCourse.code, grade);
    closeSheet();
  });

  Object.entries(els.plan).forEach(([grade, container]) => {
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove]");
      if (button) {
        const code = button.dataset.remove;
        removeCourseFromPlan(code);
        return;
      }
      const card = event.target.closest("[data-course]");
      if (!card) return;
      const code = card.dataset.course;
      const course = state.byCode.get(code);
      if (course) openCourseSheet(course, Number(grade));
    });
  });

  els.customForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const course = {
      code: String(formData.get("code")).trim().toUpperCase(),
      name: String(formData.get("name")).trim(),
      grade: Number(formData.get("grade")),
      level: String(formData.get("level")),
      subject: String(formData.get("subject")).trim().toLowerCase() || "other",
      prereqs: parsePrereqs(String(formData.get("prereqs"))),
    };

    if (!course.code || !course.name) {
      setStatus("Please provide a course code and name.");
      return;
    }

    if (state.byCode.has(course.code)) {
      setStatus("A course with that code already exists.");
      return;
    }

    state.customCourses.push(course);
    state.courses.push(course);
    state.byCode.set(course.code, course);
    persistCustomCourses();
    renderCourseList();
    setStatus(`Added custom course ${course.code}.`);
    event.target.reset();
  });

  els.newPath.addEventListener("click", () => {
    if (!confirm("Start a new plan? This clears your current pathway.")) return;
    state.plannedByGrade.forEach((_, grade) => state.plannedByGrade.set(grade, []));
    renderPlan();
    setStatus("Started a fresh pathway.");
  });

  els.savePath.addEventListener("click", () => {
    const name = prompt("Name this pathway (max 24 characters):", "My Mobile Pathway");
    if (!name) return;
    const trimmed = name.trim().slice(0, 24);
    const entry = {
      id: `${Date.now()}`,
      name: trimmed,
      planned: serializePlan(),
    };
    state.savedPaths.unshift(entry);
    state.savedPaths = state.savedPaths.slice(0, 8);
    persistSavedPaths();
    renderSavedList();
    setStatus(`Saved pathway: ${trimmed}`);
  });

  els.sharePath.addEventListener("click", async () => {
    const link = buildShareLink();
    if (navigator.share) {
      try {
        await navigator.share({
          title: "My Mobile Pathway",
          url: link,
        });
        setStatus("Shared pathway.");
        return;
      } catch (error) {
        setStatus("Share canceled.");
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      setStatus("Share link copied to clipboard.");
    } catch (error) {
      prompt("Copy this share link:", link);
    }
  });

  els.printPath.addEventListener("click", () => {
    window.print();
  });
}

function renderCourseList() {
  const filtered = state.courses.filter((course) => {
    const matchesPathway =
      state.pathway === "all" ? true : course.level === state.pathway;
    const haystack = `${course.code} ${course.name} ${course.subject}`.toLowerCase();
    const matchesSearch = state.search ? haystack.includes(state.search) : true;
    return matchesPathway && matchesSearch;
  });

  if (!filtered.length) {
    els.courseList.innerHTML = `<p class=\"muted\">No courses match your search yet.</p>`;
    return;
  }

  els.courseList.innerHTML = filtered
    .map((course) => {
      const prereqText = course.prereqs?.length
        ? `${course.prereqs.length} prereq${course.prereqs.length === 1 ? "" : "s"}`
        : "No prereqs";
      return `
        <article class="course-card" data-course="${course.code}">
          <div>
            <p class="eyebrow">${course.code} • Grade ${course.grade} • ${course.level}</p>
            <h3>${course.name}</h3>
          </div>
          <div class="course-meta">
            <span class="pill">${course.subject}</span>
            <span class="pill">${prereqText}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPlan() {
  for (const [grade, container] of Object.entries(els.plan)) {
    const items = state.plannedByGrade.get(Number(grade)) ?? [];
    container.innerHTML = items
      .map((code) => {
        const course = state.byCode.get(code);
        if (!course) return "";
        return `
          <article class="course-chip" data-course="${course.code}">
            <div>
              <p class="eyebrow">${course.code} • ${course.level}</p>
              <h4>${course.name}</h4>
            </div>
            <button class="icon" data-remove="${course.code}" aria-label="Remove">
              ✕
            </button>
          </article>
        `;
      })
      .join("");

    const credits = items.length;
    els.credits[grade].textContent = `${credits} credit${credits === 1 ? "" : "s"}`;
  }

  updateOssdStatus();
}

function addCourseToPlan(code, grade) {
  const course = state.byCode.get(code);
  if (!course) return;

  if (isCoursePlanned(code)) {
    setStatus(`${code} is already in your pathway.`);
    return;
  }

  const list = state.plannedByGrade.get(grade) ?? [];
  state.plannedByGrade.set(grade, [...list, code]);
  renderPlan();
  setStatus(`Added ${code} to Grade ${grade}.`);
}

function removeCourseFromPlan(code) {
  for (const grade of state.plannedByGrade.keys()) {
    const list = state.plannedByGrade.get(grade) ?? [];
    if (list.includes(code)) {
      state.plannedByGrade.set(
        grade,
        list.filter((item) => item !== code)
      );
    }
  }
  renderPlan();
  setStatus(`Removed ${code} from your pathway.`);
}

function openCourseSheet(course, grade = course.grade) {
  state.activeCourse = course;
  els.sheetCode.textContent = `${course.code} • Grade ${course.grade} • ${course.level}`;
  els.sheetTitle.textContent = course.name;
  els.sheetMeta.innerHTML = `
    <span class="pill">${course.subject}</span>
    <span class="pill">Pathway ${course.level}</span>
  `;
  els.sheetGrade.value = String(grade);
  const prereqs = course.prereqs ?? [];
  els.sheetPrereqs.innerHTML = prereqs.length
    ? prereqs.map((code) => renderPrereq(code)).join("")
    : "<li>No prerequisites listed.</li>";
  els.sheet.setAttribute("aria-hidden", "false");
  els.sheetScrim.setAttribute("aria-hidden", "false");
  els.sheet.classList.add("is-open");
  els.sheetScrim.classList.add("is-open");
}

function closeSheet() {
  els.sheet.setAttribute("aria-hidden", "true");
  els.sheetScrim.setAttribute("aria-hidden", "true");
  els.sheet.classList.remove("is-open");
  els.sheetScrim.classList.remove("is-open");
  state.activeCourse = null;
}

function renderPrereq(code) {
  const course = state.byCode.get(code);
  const label = course ? `${code} — ${course.name}` : code;
  const met = isCoursePlanned(code);
  return `<li class="${met ? "met" : ""}">${label} ${met ? "✓" : ""}</li>`;
}

function renderSavedList() {
  if (!state.savedPaths.length) {
    els.savedList.innerHTML = `<p class="muted">No saved plans yet.</p>`;
    return;
  }

  els.savedList.innerHTML = state.savedPaths
    .map(
      (item) => `
        <button class="saved-card" data-saved="${item.id}">
          <div>
            <p class="eyebrow">Saved Pathway</p>
            <h4>${item.name}</h4>
          </div>
          <span class="pill">Load</span>
        </button>
      `
    )
    .join("");

  els.savedList.querySelectorAll("[data-saved]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.savedPaths.find((item) => item.id === button.dataset.saved);
      if (!entry) return;
      applyPlan(entry.planned);
      setStatus(`Loaded pathway: ${entry.name}`);
    });
  });
}

function renderOssdChecklist() {
  els.ossdList.innerHTML = OSSD_REQUIREMENTS.map(
    (item) => `
      <div class="ossd-item" data-req="${item.key}">
        <span class="ossd-check">⬜</span>
        <div>
          <h4>${item.label}</h4>
        </div>
      </div>
    `
  ).join("");
}

function updateOssdStatus() {
  const status = computeOssdStatus();
  els.ossdList.querySelectorAll(".ossd-item").forEach((item) => {
    const key = item.dataset.req;
    const complete = Boolean(status[key]);
    item.classList.toggle("is-complete", complete);
    const check = item.querySelector(".ossd-check");
    if (check) check.textContent = complete ? "✅" : "⬜";
  });
}

function computeOssdStatus() {
  const plannedCourses = getPlannedCourses();
  const english = plannedCourses.filter((course) => course.subject === "english");
  const math = plannedCourses.filter((course) => course.subject === "math");
  const science = plannedCourses.filter((course) => course.subject === "science");
  const arts = plannedCourses.filter((course) => course.subject === "arts");
  const hpe = plannedCourses.filter((course) => course.subject === "hpe");
  const french = plannedCourses.filter((course) => course.subject === "fsl");
  const tech = plannedCourses.filter((course) => course.subject === "tech-ed");
  const business = plannedCourses.filter((course) => course.subject === "business");
  const compsci = plannedCourses.filter((course) => course.subject === "compsci");
  const coop = plannedCourses.filter((course) => course.subject === "coop");

  const englishGrades = new Set(
    english.map((course) => Number(getPlannedGrade(course.code)))
  );
  const hasGrade12English = englishGrades.has(12);
  const mathSenior = math.some((course) => {
    const grade = getPlannedGrade(course.code);
    return grade === 11 || grade === 12;
  });

  const history = plannedCourses.some((course) => course.code.startsWith("CHC"));
  const geography = plannedCourses.some((course) => course.code.startsWith("CGC"));
  const career = plannedCourses.some((course) => course.code.startsWith("GLC"));
  const civics = plannedCourses.some((course) => course.code.startsWith("CHV"));

  return {
    english: english.length >= 4 && hasGrade12English,
    math: math.length >= 3 && mathSenior,
    science: science.length >= 2,
    history,
    geography,
    arts: arts.length >= 1,
    hpe: hpe.length >= 1,
    french: french.length >= 1,
    career,
    civics,
    stem: tech.length + business.length + compsci.length + coop.length >= 1,
  };
}

function getPlannedCourses() {
  const courses = [];
  for (const codes of state.plannedByGrade.values()) {
    codes.forEach((code) => {
      const course = state.byCode.get(code);
      if (course) courses.push(course);
    });
  }
  return courses;
}

function getPlannedGrade(code) {
  for (const [grade, list] of state.plannedByGrade.entries()) {
    if (list.includes(code)) return grade;
  }
  return null;
}

function isCoursePlanned(code) {
  return Boolean(getPlannedGrade(code));
}

function serializePlan() {
  const planned = {};
  for (const [grade, codes] of state.plannedByGrade.entries()) {
    planned[grade] = [...codes];
  }
  return planned;
}

function applyPlan(planned) {
  state.plannedByGrade.forEach((_, grade) => {
    state.plannedByGrade.set(grade, planned?.[grade] ?? []);
  });
  renderPlan();
}

function loadSavedPaths() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function persistSavedPaths() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state.savedPaths));
}

function loadCustomCourses() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function persistCustomCourses() {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(state.customCourses));
}

function parsePrereqs(value) {
  return value
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

function setStatus(message) {
  els.status.textContent = message;
  if (setStatus.timer) window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    els.status.textContent = "Ready to plan your pathway.";
  }, STATUS_TIMEOUT_MS);
}

function buildShareLink() {
  const payload = {
    planned: serializePlan(),
    customCourses: state.customCourses,
  };
  const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
  const url = new URL(window.location.href);
  url.searchParams.set(SHARE_PARAM, encoded);
  return url.toString();
}

function readSharedPlan() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get(SHARE_PARAM);
  if (!encoded) return null;
  try {
    const decoded = decodeURIComponent(atob(encoded));
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

function applySharedPlan(payload) {
  if (payload.customCourses?.length) {
    payload.customCourses.forEach((course) => {
      if (!course?.code || state.byCode.has(course.code)) return;
      state.customCourses.push(course);
      state.courses.push(course);
      state.byCode.set(course.code, course);
    });
    persistCustomCourses();
  }
  if (payload.planned) {
    applyPlan(payload.planned);
  }
}
