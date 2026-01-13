// src/graph.js

export function buildIndex(courses) {
  const byCode = new Map();
  const dependents = new Map(); // code -> Set(codes that require it)

  for (const c of courses) {
    byCode.set(c.code, c);
    dependents.set(c.code, new Set());
  }

  // IMPORTANT: include both AND prereqs and OR prereqs for dependents graph
  for (const c of courses) {
    const prereqSet = new Set();

    for (const p of (c.prereqs ?? [])) prereqSet.add(p);
    for (const group of (c.prereq_any_of ?? [])) {
      for (const p of group) prereqSet.add(p);
    }

    for (const p of prereqSet) {
      if (!dependents.has(p)) dependents.set(p, new Set());
      dependents.get(p).add(c.code);
    }
  }

  return { byCode, dependents };
}

export function dependentClosure(startCode, dependents) {
  const visited = new Set();
  const stack = [startCode];

  while (stack.length) {
    const cur = stack.pop();
    const kids = dependents.get(cur);
    if (!kids) continue;

    for (const k of kids) {
      if (!visited.has(k)) {
        visited.add(k);
        stack.push(k);
      }
    }
  }
  return visited;
}

export function getPrereqCodesForHighlight(course) {
  const out = new Set(course.prereqs ?? []);
  const any = course.prereq_any_of ?? [];
  for (const group of any) for (const code of group) out.add(code);
  return [...out];
}

export function prereqClosure(targetCode, byCode) {
  const visited = new Set();
  const stack = [targetCode];

  while (stack.length) {
    const cur = stack.pop();
    const course = byCode.get(cur);
    if (!course) continue;

    const prereqCodes = getPrereqCodesForHighlight(course);
    for (const p of prereqCodes) {
      if (!visited.has(p)) {
        visited.add(p);
        stack.push(p);
      }
    }
  }
  return visited;
}

export function courseIsUnlocked(course, completedSet) {
  const all = course.prereqs ?? [];
  if (!all.every(p => completedSet.has(p))) return false;

  const anyGroups = course.prereq_any_of ?? [];
  for (const group of anyGroups) {
    if (!group.some(p => completedSet.has(p))) return false;
  }
  return true;
}

export function forwardUnlocked(completedSet, courses) {
  const unlocked = new Set();
  for (const c of courses) {
    if (courseIsUnlocked(c, completedSet)) unlocked.add(c.code);
  }
  return unlocked;
}
