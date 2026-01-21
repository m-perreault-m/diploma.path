const state = {
  courses: [],
  byCode: new Map(),
  completed: new Set(),
  target: null,
  gradeFilters: new Set([9, 10, 11, 12])
};

const elements = {
  targetSelect: document.getElementById("target-course"),
  completedSelect: document.getElementById("completed-courses"),
  addInput: document.getElementById("add-course"),
  addButton: document.getElementById("add-course-button"),
  clearButton: document.getElementById("clear-completed"),
  courseList: document.getElementById("course-list"),
  gradeFilters: document.getElementById("grade-filters"),
  summary: document.getElementById("summary"),
  chain: document.getElementById("chain"),
  unlocked: document.getElementById("unlocked"),
  alternatives: document.getElementById("alternatives")
};

function labelFor(course) {
  return `${course.code} · ${course.name} (Gr ${course.grade}${course.level})`;
}

function normalizeCode(value) {
  return value.trim().toUpperCase();
}

function getCourse(code) {
  return state.byCode.get(code);
}

function courseHasPrereqs(course) {
  return (course.prereqs && course.prereqs.length > 0) ||
    (course.prereq_any_of && course.prereq_any_of.length > 0);
}

function isCompleted(code) {
  return state.completed.has(code);
}

function isUnlocked(course) {
  if (!courseHasPrereqs(course)) {
    return true;
  }
  const prereqsMet = (course.prereqs || []).every((req) => state.completed.has(req));
  const anyOfMet = (course.prereq_any_of || []).every((group) =>
    group.some((req) => state.completed.has(req))
  );
  return prereqsMet && anyOfMet;
}

function collectRequirements(code, needed, visiting, alternatives) {
  if (state.completed.has(code)) {
    return;
  }
  if (visiting.has(code)) {
    return;
  }
  const course = getCourse(code);
  if (!course) {
    return;
  }
  visiting.add(code);

  (course.prereqs || []).forEach((req) => {
    if (!state.completed.has(req)) {
      needed.add(req);
      collectRequirements(req, needed, visiting, alternatives);
    }
  });

  (course.prereq_any_of || []).forEach((group, index) => {
    const satisfied = group.some((req) => state.completed.has(req));
    if (!satisfied) {
      const pick = group[0];
      if (pick) {
        needed.add(pick);
        collectRequirements(pick, needed, visiting, alternatives);
      }
      alternatives.push({
        course,
        group,
        index
      });
    }
  });

  visiting.delete(code);
}

function groupByGrade(codes) {
  const grouped = new Map();
  codes.forEach((code) => {
    const course = getCourse(code);
    if (!course) {
      return;
    }
    const bucket = grouped.get(course.grade) || [];
    bucket.push(course);
    grouped.set(course.grade, bucket);
  });
  return grouped;
}

function renderSummary({ needed, unlocked }) {
  elements.summary.innerHTML = "";
  const completedCount = state.completed.size;
  const cards = [
    { label: "Completed", value: completedCount },
    { label: "Needed for target", value: needed.size },
    { label: "Unlocked now", value: unlocked.length }
  ];
  cards.forEach((card) => {
    const div = document.createElement("div");
    div.className = "summary-card";
    div.innerHTML = `<strong>${card.value}</strong><span>${card.label}</span>`;
    elements.summary.appendChild(div);
  });
}

function renderChain(needed) {
  elements.chain.innerHTML = "";
  if (!state.target) {
    elements.chain.innerHTML = "<p class=\"hint\">Select a target course to see the chain.</p>";
    return;
  }
  if (needed.size === 0) {
    elements.chain.innerHTML = "<p class=\"hint\">All prerequisites are satisfied. You are ready to enroll.</p>";
    return;
  }
  const grouped = groupByGrade(needed);
  const grades = Array.from(grouped.keys()).sort((a, b) => a - b);
  grades.forEach((grade) => {
    const section = document.createElement("div");
    section.className = "list";
    const heading = document.createElement("h3");
    heading.textContent = `Grade ${grade}`;
    section.appendChild(heading);
    grouped.get(grade)
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((course) => {
        section.appendChild(renderCourseCard(course, "needed"));
      });
    elements.chain.appendChild(section);
  });
}

function renderUnlocked(unlocked) {
  elements.unlocked.innerHTML = "";
  if (unlocked.length === 0) {
    elements.unlocked.innerHTML = "<p class=\"hint\">No unlocked courses yet. Add completed courses to unlock options.</p>";
    return;
  }
  const filtered = unlocked.filter((course) => state.gradeFilters.has(course.grade));
  if (filtered.length === 0) {
    elements.unlocked.innerHTML = "<p class=\"hint\">No unlocked courses match the selected grades.</p>";
    return;
  }
  filtered.slice(0, 30).forEach((course) => {
    elements.unlocked.appendChild(renderCourseCard(course, "ready"));
  });
}

function renderAlternatives(alternatives) {
  elements.alternatives.innerHTML = "";
  if (!state.target) {
    elements.alternatives.innerHTML = "<p class=\"hint\">Choose a target to see alternative prerequisite groups.</p>";
    return;
  }
  if (alternatives.length === 0) {
    elements.alternatives.innerHTML = "<p class=\"hint\">No alternative prerequisite groups detected for this target.</p>";
    return;
  }
  alternatives.forEach((alt) => {
    const div = document.createElement("div");
    div.className = "alt-group";
    div.innerHTML = `<strong>${alt.course.code}</strong> has multiple prerequisite options:`;
    const list = document.createElement("ul");
    alt.group.forEach((code) => {
      const course = getCourse(code);
      const item = document.createElement("li");
      item.textContent = course ? labelFor(course) : code;
      list.appendChild(item);
    });
    div.appendChild(list);
    elements.alternatives.appendChild(div);
  });
}

function renderCourseCard(course, status) {
  const card = document.createElement("div");
  card.className = "course-card";
  const title = document.createElement("h3");
  title.textContent = `${course.code} · ${course.name}`;
  const meta = document.createElement("div");
  meta.className = "badge-row";
  const gradeBadge = document.createElement("span");
  gradeBadge.className = "badge";
  gradeBadge.textContent = `Grade ${course.grade}`;
  const levelBadge = document.createElement("span");
  levelBadge.className = "badge";
  levelBadge.textContent = `Level ${course.level}`;
  const subjectBadge = document.createElement("span");
  subjectBadge.className = "badge";
  subjectBadge.textContent = course.subject;
  const statusBadge = document.createElement("span");
  statusBadge.className = `badge ${status}`;
  statusBadge.textContent = status === "needed" ? "Needed" : "Ready";
  meta.append(gradeBadge, levelBadge, subjectBadge, statusBadge);

  card.append(title, meta);
  return card;
}

function updateCompletedSelect() {
  elements.completedSelect.innerHTML = "";
  const selected = Array.from(state.completed)
    .map((code) => getCourse(code))
    .filter(Boolean)
    .sort((a, b) => a.code.localeCompare(b.code));
  selected.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.code;
    option.textContent = labelFor(course);
    option.selected = true;
    elements.completedSelect.appendChild(option);
  });
}

function updateGradeFilters() {
  elements.gradeFilters.innerHTML = "";
  [9, 10, 11, 12].forEach((grade) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.gradeFilters.has(grade);
    input.addEventListener("change", () => {
      if (input.checked) {
        state.gradeFilters.add(grade);
      } else {
        state.gradeFilters.delete(grade);
      }
      render();
    });
    label.append(input, `Grade ${grade}`);
    elements.gradeFilters.appendChild(label);
  });
}

function render() {
  if (!state.target) {
    renderSummary({ needed: new Set(), unlocked: [] });
    renderChain(new Set());
    renderUnlocked([]);
    renderAlternatives([]);
    return;
  }

  const needed = new Set();
  const alternatives = [];
  collectRequirements(state.target, needed, new Set(), alternatives);

  const unlocked = state.courses
    .filter((course) => !state.completed.has(course.code))
    .filter((course) => isUnlocked(course))
    .sort((a, b) => a.grade - b.grade || a.code.localeCompare(b.code));

  renderSummary({ needed, unlocked });
  renderChain(needed);
  renderUnlocked(unlocked);
  renderAlternatives(alternatives);
}

function populateSelects() {
  const sortedCourses = [...state.courses].sort(
    (a, b) => a.grade - b.grade || a.code.localeCompare(b.code)
  );

  elements.targetSelect.innerHTML = "";
  sortedCourses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.code;
    option.textContent = labelFor(course);
    elements.targetSelect.appendChild(option);
  });

  elements.courseList.innerHTML = "";
  sortedCourses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.code;
    option.textContent = labelFor(course);
    elements.courseList.appendChild(option);
  });

  elements.targetSelect.addEventListener("change", (event) => {
    state.target = event.target.value;
    render();
  });

  elements.completedSelect.addEventListener("change", () => {
    const selected = Array.from(elements.completedSelect.selectedOptions).map(
      (option) => option.value
    );
    state.completed = new Set(selected);
    updateCompletedSelect();
    render();
  });
}

function setupButtons() {
  elements.addButton.addEventListener("click", () => {
    const code = normalizeCode(elements.addInput.value);
    if (!code || !state.byCode.has(code)) {
      return;
    }
    state.completed.add(code);
    elements.addInput.value = "";
    updateCompletedSelect();
    render();
  });

  elements.clearButton.addEventListener("click", () => {
    state.completed.clear();
    updateCompletedSelect();
    render();
  });
}

function init() {
  fetch("data/ontario_courses.json")
    .then((response) => response.json())
    .then((data) => {
      state.courses = data.courses || [];
      state.byCode = new Map(state.courses.map((course) => [course.code, course]));
      populateSelects();
      updateGradeFilters();
      setupButtons();
      state.target = state.courses[0]?.code || null;
      elements.targetSelect.value = state.target;
      render();
    });
}

init();
