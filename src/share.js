const SHARE_PAYLOAD_VERSION = 2;

export function buildSharePayload(pathwayData, customCourses) {
  return {
    v: SHARE_PAYLOAD_VERSION,
    d: compactSharePathway(pathwayData),
    u: compactCustomCourses(customCourses),
  };
}

export function encodeSharePayload(payload) {
  try {
    const json = JSON.stringify(payload);
    return toBase64Url(json);
  } catch {
    return "";
  }
}

export function decodeSharePayload(encoded) {
  if (!encoded) return null;
  try {
    const json = fromBase64Url(encoded);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v === SHARE_PAYLOAD_VERSION) {
      return {
        version: parsed.v,
        data: expandSharePathway(parsed.d ?? {}),
        customCourses: expandSharedCustomCourses(parsed.u ?? []),
      };
    }
    if (parsed.version === 1) {
      return parsed;
    }
    if (parsed.d || parsed.u) {
      return {
        version: parsed.v ?? parsed.version ?? 0,
        data: expandSharePathway(parsed.d ?? {}),
        customCourses: expandSharedCustomCourses(parsed.u ?? []),
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readSharedPayloadFromLocation() {
  const shareParam = getShareParamFromLocation();
  if (!shareParam) return null;
  return decodeSharePayload(shareParam);
}

export function getShareParamFromLocation() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(location.search);
  return hashParams.get("share") ?? searchParams.get("share");
}

export function clearShareParamFromLocation() {
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

export function normalizeSharedCustomCourses(courses) {
  if (!Array.isArray(courses)) return [];
  return courses.map((course) => normalizeCustomCourse(course)).filter(Boolean);
}

function compactSharePathway(data) {
  const compact = {};
  if (data?.mode && data.mode !== "backward") {
    compact.m = data.mode;
  }
  if (Array.isArray(data?.completed) && data.completed.length) {
    compact.c = data.completed;
  }
  const plannedByGrade = data?.plannedByGrade ?? {};
  const plannedCompact = {};
  for (const grade of [9, 10, 11, 12]) {
    const list = plannedByGrade[grade] ?? plannedByGrade[String(grade)] ?? [];
    if (Array.isArray(list) && list.length) {
      plannedCompact[grade] = list;
    }
  }
  if (Object.keys(plannedCompact).length) {
    compact.p = plannedCompact;
  }
  return compact;
}

function expandSharePathway(compact) {
  const data = {
    mode: compact?.m ?? "backward",
    completed: Array.isArray(compact?.c) ? compact.c : [],
    plannedByGrade: { 9: [], 10: [], 11: [], 12: [] },
  };
  const planned = compact?.p ?? {};
  for (const grade of [9, 10, 11, 12]) {
    const list = planned[grade] ?? planned[String(grade)] ?? [];
    if (Array.isArray(list)) {
      data.plannedByGrade[grade] = list;
    }
  }
  return data;
}

function compactCustomCourses(courses) {
  if (!Array.isArray(courses)) return [];
  return courses
    .map((course) => {
      if (!course?.code || !course?.name) return null;
      return [course.code, course.name, course.subject ?? "other"];
    })
    .filter(Boolean);
}

function expandSharedCustomCourses(courses) {
  if (!Array.isArray(courses)) return [];
  return courses
    .map((course) => {
      if (Array.isArray(course)) {
        const [code, name, subject] = course;
        return { code, name, subject };
      }
      return course;
    })
    .filter(Boolean);
}

function normalizeCustomCourse(course) {
  if (!course || typeof course !== "object") return null;
  const code = String(course.code ?? "").trim();
  const name = String(course.name ?? "").trim();
  if (!code || !name) return null;
  return { code, name, subject: course.subject ?? "other" };
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
  return decodeURIComponent(
    value
      .split("")
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
}
