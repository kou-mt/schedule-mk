import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);

// 自分のパソコン(localhost)で開いたときは、本番ではなくエミュレーター
// (`firebase emulators:start` で起動する偽物のログイン・データベース)につなぐ。
// こうしておけば、手元でどれだけいじっても本番のデータには一切触れない。
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
if (isLocal) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
}

// -----------------------------------------------------------------
// Firestore を、以前の db capability と同じ形の薄いラッパーで包む。
// (collection.add / collection.doc(id).update / collection.onSnapshot ...)
// -----------------------------------------------------------------
function makeCollectionRef(pathSegments) {
  const colRef = collection(firestore, ...pathSegments);
  return {
    doc(id) {
      const docRef = id ? doc(firestore, ...pathSegments, id) : doc(colRef);
      return {
        id: docRef.id,
        async get() {
          const snap = await getDoc(docRef);
          return { id: docRef.id, exists: snap.exists(), data: () => snap.data() };
        },
        async set(data) { await setDoc(docRef, data); },
        async update(data) { await updateDoc(docRef, data); },
        async delete() { await deleteDoc(docRef); },
      };
    },
    async add(data) {
      const ref = await addDoc(colRef, data);
      return { id: ref.id };
    },
    onSnapshot(next, errorCb) {
      return onSnapshot(
        colRef,
        snap => next({ docs: snap.docs.map(d => ({ id: d.id, data: () => d.data() })) }),
        errorCb
      );
    },
  };
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const COLORS = [
  { key: "seal", label: "赤" },
  { key: "indigo", label: "青" },
  { key: "moss", label: "緑" },
  { key: "plum", label: "紫" },
  { key: "amber", label: "オレンジ" },
  { key: "teal", label: "ティール" },
];
const DEFAULT_COLOR = "indigo";
function colorStyle(key) {
  const c = COLORS.some(c => c.key === key) ? key : DEFAULT_COLOR;
  return `--c-wash:var(--${c}-wash);--c-fg:var(--${c});`;
}

// ---- live state ----
let people = [];   // [{id, name, initial}]
let events = [];   // [{id, date:"YYYY-MM-DD", time, title, note, peopleIds:[]}]
let peopleCol = null;
let eventsCol = null;
let writable = false;
let selectedPersonId = null;
let unsubPeople = null;
let unsubEvents = null;

const TODAY = new Date();
let viewYear = TODAY.getFullYear();
let viewMonth = TODAY.getMonth(); // 0-11
let selectedISO = toISO(TODAY);

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}/${d}(${WEEKDAYS[dt.getDay()]})`;
}
function peopleMap() {
  return Object.fromEntries(people.map(p => [p.id, p]));
}
function buildEventsByDate() {
  const map = {};
  events.forEach(ev => { (map[ev.date] ||= []).push(ev); });
  Object.values(map).forEach(list => list.sort((a, b) => (a.time || "").localeCompare(b.time || "")));
  return map;
}
function timelineForPerson(pid) {
  return events
    .filter(ev => (ev.peopleIds || []).includes(pid))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.time || "").localeCompare(a.time || ""));
}

// モーダル表示中は背景をスクロールさせない(スマホ幅のみ。CSS側で有効/無効を制御)
let openModalCount = 0;
function lockScroll() {
  openModalCount++;
  document.body.classList.add("modal-open");
}
function unlockScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) document.body.classList.remove("modal-open");
}

function renderAll() {
  renderSidebarPeople();
  renderPeopleDirectory();
  renderCalendar();
  renderDayDetail();
  renderPeopleView();
  if (!document.getElementById("modalOverlay").hidden) renderModalPeopleChecks();
  if (!document.getElementById("personTimelineOverlay").hidden && previewPersonId) {
    openPersonTimelineModal(previewPersonId);
  }
  if (!document.getElementById("personPickerOverlay").hidden) renderPersonPicker();
}

function renderSidebarPeople() {
  const pinned = people.filter(p => p.pinned);
  const el = document.getElementById("sidebarPeople");
  el.innerHTML = pinned.length ? pinned.map(p => `
    <button class="person-chip" data-person="${p.id}" style="${colorStyle(p.color)}">
      <span class="avatar">${p.initial}</span>
      <span>${p.name}</span>
      <span class="person-count">${timelineForPerson(p.id).length}</span>
    </button>
  `).join("") : `<p class="empty-note" style="padding:6px 4px;">★で追加できます</p>`;

  el.querySelectorAll(".person-chip").forEach(btn => {
    btn.addEventListener("click", () => openPersonTimelineModal(btn.dataset.person));
  });
}

function sortedPeople() {
  return [...people].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}
function dirRowsHTML(list) {
  return list.map(p => `
    <button type="button" class="dir-row ${p.id === selectedPersonId ? "active" : ""}" data-person="${p.id}" style="${colorStyle(p.color)}">
      <span class="avatar">${p.initial}</span>
      <span class="name">${p.name}</span>
      ${p.pinned ? `<span class="pin-mark">★</span>` : ""}
    </button>
  `).join("");
}

function renderPeopleDirectory() {
  const el = document.getElementById("peopleDirectory");
  el.innerHTML = dirRowsHTML(sortedPeople());
  el.querySelectorAll(".dir-row").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedPersonId = btn.dataset.person;
      renderAll();
    });
  });
}

function renderPersonPicker() {
  const el = document.getElementById("pickerList");
  el.innerHTML = dirRowsHTML(sortedPeople());
  el.querySelectorAll(".dir-row").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedPersonId = btn.dataset.person;
      renderAll();
      closePersonPicker();
    });
  });
}
function openPersonPicker() {
  renderPersonPicker();
  document.getElementById("personPickerOverlay").hidden = false;
  lockScroll();
}
function closePersonPicker() {
  document.getElementById("personPickerOverlay").hidden = true;
  unlockScroll();
}
document.getElementById("choosePersonBtn").addEventListener("click", openPersonPicker);
document.getElementById("pickerClose").addEventListener("click", closePersonPicker);
document.getElementById("personPickerOverlay").addEventListener("click", e => {
  if (e.target.id === "personPickerOverlay") closePersonPicker();
});
document.getElementById("pickerAddPersonBtn").addEventListener("click", () => {
  closePersonPicker();
  openPersonModal();
});

function renderCalendar() {
  const eventsByDate = buildEventsByDate();
  document.getElementById("calMonthLabel").textContent = `${viewYear}年${viewMonth + 1}月`;

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const gridStart = new Date(viewYear, viewMonth, 1 - firstOfMonth.getDay());
  const lastOfMonth = new Date(viewYear, viewMonth + 1, 0);
  const daysToCover = Math.round((lastOfMonth - gridStart) / 86400000) + 1;
  const totalCells = Math.ceil(daysToCover / 7) * 7; // その月に必要な週数分だけ(4〜6週)

  const gridEl = document.getElementById("calGrid");
  let html = WEEKDAYS.map((w, i) => `
    <div class="cal-weekday ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>
  `).join("");
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = toISO(d);
    const inMonth = d.getMonth() === viewMonth;
    const isToday = isSameDay(d, TODAY);
    const isSelected = iso === selectedISO;
    const dow = d.getDay();
    const dayEvents = eventsByDate[iso] || [];
    const shown = dayEvents.slice(0, 3);
    const rest = dayEvents.length - shown.length;

    html += `
      <button class="cal-cell ${inMonth ? "" : "out"} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" data-date="${iso}">
        <span class="cal-date ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""}">${d.getDate()}</span>
        <span class="cal-chips">
          ${shown.map(ev => `<span class="cal-chip" style="${colorStyle(ev.color)}"><span class="chip-label">${ev.title}</span></span>`).join("")}
          ${rest > 0 ? `<span class="cal-more">+${rest}件</span>` : ""}
        </span>
      </button>
    `;
  }
  gridEl.innerHTML = html;

  gridEl.querySelectorAll(".cal-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      selectedISO = cell.dataset.date;
      renderCalendar();
      renderDayDetail();
    });
    cell.addEventListener("dblclick", () => {
      document.getElementById("dayDetailHead").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderDayDetail() {
  const eventsByDate = buildEventsByDate();
  const pMap = peopleMap();
  const [y, m, dNum] = selectedISO.split("-").map(Number);
  const d = new Date(y, m - 1, dNum);
  const isToday = isSameDay(d, TODAY);

  document.getElementById("dayDetailTitle").textContent =
    `${m}月${dNum}日(${WEEKDAYS[d.getDay()]})`;
  document.getElementById("dayDetailToday").style.display = isToday ? "inline-block" : "none";

  const dayEvents = eventsByDate[selectedISO] || [];
  const el = document.getElementById("dayDetailList");
  el.innerHTML = dayEvents.length ? dayEvents.map(ev => `
    <div class="event-card" style="${colorStyle(ev.color)}">
      <div class="bar"></div>
      <div class="event-actions">
        <button type="button" class="event-edit" data-id="${ev.id}" aria-label="編集">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11 2.5l2.5 2.5-8 8-3 .5.5-3 8-8z"/></svg>
        </button>
        <button type="button" class="event-delete" data-id="${ev.id}" aria-label="削除">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>
        </button>
      </div>
      <div class="event-body">
        <div class="event-top">
          ${ev.time ? `<span class="event-time">${ev.time}</span>` : ""}
          <span class="event-title">${ev.title}</span>
        </div>
        ${ev.note ? `<div class="event-note">${ev.note}</div>` : ""}
        ${(ev.peopleIds || []).length ? `
          <div class="event-tags">
            ${ev.peopleIds.filter(pid => pMap[pid]).map(pid => `
              <button type="button" class="tag" data-person="${pid}" style="${colorStyle(pMap[pid].color)}">
                <span class="avatar">${pMap[pid].initial}</span>
                ${pMap[pid].name}
              </button>`).join("")}
          </div>` : ""}
      </div>
    </div>
  `).join("") : `<p class="empty-note">この日の予定はありません</p>`;

  el.querySelectorAll(".event-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteEvent(btn.dataset.id));
  });
  el.querySelectorAll(".event-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const ev = events.find(e => e.id === btn.dataset.id);
      if (ev) openEditEventModal(ev);
    });
  });
  el.querySelectorAll(".tag[data-person]").forEach(btn => {
    btn.addEventListener("click", () => openPersonTimelineModal(btn.dataset.person));
  });
}

// ---------------------------------------------------------------
// 人のタイムライン(プレビュー)モーダル ― その日の予定からワンクリックで
// ---------------------------------------------------------------
let previewPersonId = null;

function openPersonTimelineModal(personId) {
  const person = people.find(p => p.id === personId);
  if (!person) return;
  previewPersonId = personId;
  const overlay = document.getElementById("personTimelineOverlay");
  const wasHidden = overlay.hidden;
  const entries = timelineForPerson(person.id);

  const ptAvatar = document.getElementById("ptAvatar");
  ptAvatar.textContent = person.initial;
  ptAvatar.setAttribute("style", colorStyle(person.color));
  document.getElementById("ptName").textContent = person.name;
  document.getElementById("ptPinBtn").classList.toggle("pinned", !!person.pinned);
  document.getElementById("ptCount").textContent = entries.length;
  document.getElementById("ptLast").textContent = entries.length ? shortDate(entries[0].date) : "—";

  const ptNoteEl = document.getElementById("ptNote");
  if (document.activeElement !== ptNoteEl) ptNoteEl.value = person.note || "";

  document.getElementById("ptTimeline").innerHTML = entries.length ? entries.map(e => `
    <div class="t-entry">
      <span class="t-date">${shortDate(e.date)}</span>
      <span class="t-title">${e.title}</span>
      ${e.note ? `<span class="t-note">${e.note}</span>` : ""}
    </div>
  `).join("") : `<p class="empty-note">まだ記録がありません</p>`;

  overlay.hidden = false;
  if (wasHidden) lockScroll();
}
function closePersonTimelineModal() {
  document.getElementById("personTimelineOverlay").hidden = true;
  unlockScroll();
}
document.getElementById("ptClose").addEventListener("click", closePersonTimelineModal);
document.getElementById("ptPinBtn").addEventListener("click", () => {
  const person = people.find(p => p.id === previewPersonId);
  if (person) togglePinned(person);
});
document.getElementById("ptNote").addEventListener("blur", async () => {
  if (!peopleCol || !previewPersonId) return;
  const noteEl = document.getElementById("ptNote");
  try {
    await peopleCol.doc(previewPersonId).update({ note: noteEl.value });
  } catch (e) {
    // 保存に失敗しても入力内容はそのまま残す
  }
});
document.getElementById("personTimelineOverlay").addEventListener("click", e => {
  if (e.target.id === "personTimelineOverlay") closePersonTimelineModal();
});

function renderPeopleView() {
  const empty = document.getElementById("peopleEmpty");
  const layout = document.getElementById("peopleLayout");

  if (!people.length) {
    empty.hidden = false;
    layout.hidden = true;
    return;
  }
  empty.hidden = true;
  layout.hidden = false;

  if (!selectedPersonId || !people.some(p => p.id === selectedPersonId)) {
    selectedPersonId = people[0].id;
  }
  const person = people.find(p => p.id === selectedPersonId);
  const entries = timelineForPerson(person.id);

  const pHeadAvatar = document.getElementById("pHeadAvatar");
  pHeadAvatar.textContent = person.initial;
  pHeadAvatar.setAttribute("style", colorStyle(person.color));
  document.getElementById("pHeadName").textContent = person.name;
  document.getElementById("pinPersonBtn").classList.toggle("pinned", !!person.pinned);
  document.getElementById("pHeadCount").textContent = entries.length;
  document.getElementById("pHeadLast").textContent = entries.length ? shortDate(entries[0].date) : "—";

  const noteEl = document.getElementById("pNote");
  if (document.activeElement !== noteEl) noteEl.value = person.note || "";

  const tl = document.getElementById("personTimeline");
  tl.innerHTML = entries.length ? entries.map(e => `
    <div class="t-entry">
      <span class="t-date">${shortDate(e.date)}</span>
      <span class="t-title">${e.title}</span>
      ${e.note ? `<span class="t-note">${e.note}</span>` : ""}
    </div>
  `).join("") : `<p class="empty-note">まだ記録がありません</p>`;
}

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.documentElement.classList.toggle("no-scrollbar", name === "schedule");
}

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("prevMonth").addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
});
document.getElementById("gotoToday").addEventListener("click", () => {
  viewYear = TODAY.getFullYear();
  viewMonth = TODAY.getMonth();
  selectedISO = toISO(TODAY);
  renderCalendar();
  renderDayDetail();
});

// ---------------------------------------------------------------
// 月選択ポップオーバー(自作) ― 1900〜2200年
// ---------------------------------------------------------------
const MONTH_MIN_YEAR = 1901;
const MONTH_MAX_YEAR = 2200;
const YEAR_PAGE_SIZE = 12;
let mpYear = viewYear;
let mpMode = "month"; // "month" | "year"
let mpYearPageStart = yearPageStart(viewYear);

function yearPageStart(y) {
  return Math.floor((y - MONTH_MIN_YEAR) / YEAR_PAGE_SIZE) * YEAR_PAGE_SIZE + MONTH_MIN_YEAR;
}

function renderMonthPopover() {
  const grid = document.getElementById("mpGrid");
  const yearLabel = document.getElementById("mpYearLabel");
  const prevBtn = document.getElementById("mpPrevYear");
  const nextBtn = document.getElementById("mpNextYear");

  if (mpMode === "year") {
    const start = mpYearPageStart;
    const end = start + YEAR_PAGE_SIZE - 1;
    yearLabel.textContent = `${start} - ${end}`;
    prevBtn.disabled = start <= MONTH_MIN_YEAR;
    nextBtn.disabled = end >= MONTH_MAX_YEAR;

    grid.innerHTML = Array.from({ length: YEAR_PAGE_SIZE }, (_, i) => start + i)
      .filter(y => y >= MONTH_MIN_YEAR && y <= MONTH_MAX_YEAR)
      .map(y => `<button type="button" class="${y === mpYear ? "current" : ""}" data-year="${y}">${y}</button>`)
      .join("");
    grid.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        mpYear = Number(btn.dataset.year);
        mpMode = "month";
        renderMonthPopover();
      });
    });
    return;
  }

  yearLabel.textContent = `${mpYear}年`;
  prevBtn.disabled = mpYear <= MONTH_MIN_YEAR;
  nextBtn.disabled = mpYear >= MONTH_MAX_YEAR;

  grid.innerHTML = Array.from({ length: 12 }, (_, i) => i).map(m => `
    <button type="button" class="${mpYear === viewYear && m === viewMonth ? "current" : ""}" data-month="${m}">${m + 1}月</button>
  `).join("");
  grid.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      viewYear = mpYear;
      viewMonth = Number(btn.dataset.month);
      renderCalendar();
      closeMonthPopover();
    });
  });
}
function openMonthPopover() {
  mpYear = viewYear;
  mpMode = "month";
  renderMonthPopover();
  document.getElementById("monthPopover").hidden = false;
  document.getElementById("openMonthPicker").setAttribute("aria-expanded", "true");
}
function closeMonthPopover() {
  document.getElementById("monthPopover").hidden = true;
  document.getElementById("openMonthPicker").setAttribute("aria-expanded", "false");
}
document.getElementById("openMonthPicker").addEventListener("click", () => {
  document.getElementById("monthPopover").hidden ? openMonthPopover() : closeMonthPopover();
});
document.getElementById("mpYearLabel").addEventListener("click", () => {
  if (mpMode === "month") {
    mpMode = "year";
    mpYearPageStart = yearPageStart(mpYear);
  } else {
    mpMode = "month";
  }
  renderMonthPopover();
});
document.getElementById("mpPrevYear").addEventListener("click", () => {
  if (mpMode === "year") {
    if (mpYearPageStart > MONTH_MIN_YEAR) { mpYearPageStart -= YEAR_PAGE_SIZE; renderMonthPopover(); }
  } else if (mpYear > MONTH_MIN_YEAR) {
    mpYear--; renderMonthPopover();
  }
});
document.getElementById("mpNextYear").addEventListener("click", () => {
  if (mpMode === "year") {
    if (mpYearPageStart + YEAR_PAGE_SIZE <= MONTH_MAX_YEAR) { mpYearPageStart += YEAR_PAGE_SIZE; renderMonthPopover(); }
  } else if (mpYear < MONTH_MAX_YEAR) {
    mpYear++; renderMonthPopover();
  }
});
document.addEventListener("click", e => {
  const anchor = document.getElementById("monthPopoverAnchor");
  if (!document.getElementById("monthPopover").hidden && !anchor.contains(e.target)) {
    closeMonthPopover();
  }
});

// ---------------------------------------------------------------
// 予定・記録の追加モーダル
// ---------------------------------------------------------------
let modalPeopleSelected = new Set();
let modalColor = DEFAULT_COLOR;
let editingEventId = null;
let fNewPersonColor = DEFAULT_COLOR;

function renderSwatchesInto(containerId, selectedKey, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = COLORS.map(c => `
    <button type="button" class="color-swatch ${c.key === selectedKey ? "selected" : ""}" data-color="${c.key}" style="background:var(--${c.key})" aria-label="${c.label}" title="${c.label}">
      <svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2"><path d="M3.5 8.5l3 3 6-6.5"/></svg>
    </button>
  `).join("");
  el.querySelectorAll(".color-swatch").forEach(btn => {
    btn.addEventListener("click", () => onPick(btn.dataset.color));
  });
}

function renderColorSwatches() {
  renderSwatchesInto("fColorSwatches", modalColor, key => {
    modalColor = key;
    renderColorSwatches();
  });
}

function renderNewPersonColorSwatches() {
  renderSwatchesInto("fNewPersonColorSwatches", fNewPersonColor, key => {
    fNewPersonColor = key;
    renderNewPersonColorSwatches();
  });
}

function renderModalPeopleChecks() {
  const el = document.getElementById("fPeopleChecks");
  if (!people.length) {
    el.innerHTML = `<p class="empty-note" style="padding:2px 0;">下の欄から人を追加できます</p>`;
    return;
  }
  el.innerHTML = people.map(p => `
    <label class="check-chip">
      <input type="checkbox" value="${p.id}" ${modalPeopleSelected.has(p.id) ? "checked" : ""}>
      <span class="avatar" style="${colorStyle(p.color)}">${p.initial}</span>${p.name}
    </label>
  `).join("");
  el.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) modalPeopleSelected.add(cb.value);
      else modalPeopleSelected.delete(cb.value);
    });
  });
}

function showModalError(msg) {
  const el = document.getElementById("modalError");
  el.textContent = msg;
  el.hidden = false;
}

function openEventModal({ title, submitLabel, presetDate, presetTime, presetTitle, presetNote, presetPeopleIds, presetColor, editingId }) {
  if (!writable) return;
  editingEventId = editingId || null;
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("fSubmit").textContent = submitLabel || "保存";
  document.getElementById("modalError").hidden = true;
  document.getElementById("fDate").value = presetDate;
  document.getElementById("fTime").value = presetTime || "";
  document.getElementById("fTitle").value = presetTitle || "";
  document.getElementById("fNote").value = presetNote || "";
  document.getElementById("fNewPersonName").value = "";
  modalPeopleSelected = new Set(presetPeopleIds || []);
  modalColor = presetColor || DEFAULT_COLOR;
  fNewPersonColor = DEFAULT_COLOR;
  renderColorSwatches();
  renderModalPeopleChecks();
  renderNewPersonColorSwatches();
  document.getElementById("modalOverlay").hidden = false;
  document.getElementById("fTitle").focus();
  lockScroll();
}
function closeEventModal() {
  document.getElementById("modalOverlay").hidden = true;
  editingEventId = null;
  unlockScroll();
}

document.getElementById("addEventBtn").addEventListener("click", () => {
  openEventModal({ title: "予定を追加", presetDate: selectedISO, presetPeopleIds: [] });
});
document.getElementById("addRecordBtn").addEventListener("click", () => {
  openEventModal({
    title: "記録を追加",
    presetDate: toISO(TODAY),
    presetPeopleIds: selectedPersonId ? [selectedPersonId] : [],
  });
});
function openEditEventModal(ev) {
  openEventModal({
    title: "予定を編集",
    submitLabel: "更新",
    presetDate: ev.date,
    presetTime: ev.time,
    presetTitle: ev.title,
    presetNote: ev.note,
    presetPeopleIds: ev.peopleIds || [],
    presetColor: ev.color,
    editingId: ev.id,
  });
}
document.getElementById("fCancel").addEventListener("click", closeEventModal);
document.getElementById("modalOverlay").addEventListener("click", e => {
  if (e.target.id === "modalOverlay") closeEventModal();
});

document.getElementById("fAddPersonBtn").addEventListener("click", async () => {
  const nameEl = document.getElementById("fNewPersonName");
  const name = nameEl.value.trim();
  if (!name || !peopleCol) return;
  const btn = document.getElementById("fAddPersonBtn");
  btn.disabled = true;
  try {
    const ref = await peopleCol.add({ name, initial: Array.from(name)[0], color: fNewPersonColor, pinned: false, createdAt: Date.now() });
    modalPeopleSelected.add(ref.id);
    nameEl.value = "";
    fNewPersonColor = DEFAULT_COLOR;
    renderModalPeopleChecks();
    renderNewPersonColorSwatches();
  } catch (e) {
    showModalError("人の追加に失敗しました。もう一度お試しください。");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("fSubmit").addEventListener("click", async () => {
  const title = document.getElementById("fTitle").value.trim();
  const date = document.getElementById("fDate").value;
  if (!date) { showModalError("日付を入力してください。"); return; }
  if (!title) { showModalError("タイトルを入力してください。"); document.getElementById("fTitle").focus(); return; }
  if (!eventsCol) { showModalError("保存できない状態です。"); return; }

  const btn = document.getElementById("fSubmit");
  btn.disabled = true;
  const payload = {
    date,
    time: document.getElementById("fTime").value.trim(),
    title,
    note: document.getElementById("fNote").value.trim(),
    peopleIds: Array.from(modalPeopleSelected),
    color: modalColor,
  };
  try {
    if (editingEventId) {
      await eventsCol.doc(editingEventId).update(payload);
    } else {
      await eventsCol.add({ ...payload, createdAt: Date.now() });
    }
    closeEventModal();
  } catch (e) {
    showModalError("保存に失敗しました。もう一度お試しください。");
  } finally {
    btn.disabled = false;
  }
});

async function deleteEvent(id) {
  if (!eventsCol) return;
  if (!confirm("この予定を削除しますか?")) return;
  try {
    await eventsCol.doc(id).delete();
  } catch (e) {
    alert("削除に失敗しました。もう一度お試しください。");
  }
}

// ---------------------------------------------------------------
// 人の追加・編集モーダル(単独)
// ---------------------------------------------------------------
let editingPersonId = null;
let pmColor = DEFAULT_COLOR;

function renderPersonColorSwatches() {
  renderSwatchesInto("pmColorSwatches", pmColor, key => {
    pmColor = key;
    renderPersonColorSwatches();
  });
}

function openPersonModal({ title, submitLabel, presetName, presetColor, editingId } = {}) {
  if (!writable) return;
  editingPersonId = editingId || null;
  document.getElementById("personModalTitle").textContent = title || "人を追加";
  document.getElementById("pmSubmit").textContent = submitLabel || "追加";
  document.getElementById("personModalError").hidden = true;
  document.getElementById("pmName").value = presetName || "";
  pmColor = presetColor || DEFAULT_COLOR;
  renderPersonColorSwatches();
  document.getElementById("personModalOverlay").hidden = false;
  document.getElementById("pmName").focus();
  lockScroll();
}
function closePersonModal() {
  document.getElementById("personModalOverlay").hidden = true;
  editingPersonId = null;
  unlockScroll();
}
function openEditPersonModal(person) {
  openPersonModal({ title: "名前を編集", submitLabel: "保存", presetName: person.name, presetColor: person.color, editingId: person.id });
}

document.getElementById("addPersonBtnView").addEventListener("click", () => openPersonModal());
document.getElementById("editPersonBtn").addEventListener("click", () => {
  const person = people.find(p => p.id === selectedPersonId);
  if (person) openEditPersonModal(person);
});
async function togglePinned(person) {
  if (!peopleCol) return;
  try {
    await peopleCol.doc(person.id).update({ pinned: !person.pinned });
  } catch (e) {
    alert("更新に失敗しました。もう一度お試しください。");
  }
}
document.getElementById("pinPersonBtn").addEventListener("click", () => {
  const person = people.find(p => p.id === selectedPersonId);
  if (person) togglePinned(person);
});
document.getElementById("pNote").addEventListener("blur", async () => {
  if (!peopleCol || !selectedPersonId) return;
  const noteEl = document.getElementById("pNote");
  try {
    await peopleCol.doc(selectedPersonId).update({ note: noteEl.value });
  } catch (e) {
    // 保存に失敗しても入力内容はそのまま残す
  }
});
document.getElementById("pmCancel").addEventListener("click", closePersonModal);
document.getElementById("personModalOverlay").addEventListener("click", e => {
  if (e.target.id === "personModalOverlay") closePersonModal();
});
document.getElementById("pmSubmit").addEventListener("click", async () => {
  const nameEl = document.getElementById("pmName");
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  if (!peopleCol) return;
  const btn = document.getElementById("pmSubmit");
  btn.disabled = true;
  try {
    if (editingPersonId) {
      await peopleCol.doc(editingPersonId).update({ name, initial: Array.from(name)[0], color: pmColor });
    } else {
      const ref = await peopleCol.add({ name, initial: Array.from(name)[0], color: pmColor, pinned: false, createdAt: Date.now() });
      selectedPersonId = ref.id;
    }
    closePersonModal();
    switchView("people");
  } catch (e) {
    const el = document.getElementById("personModalError");
    el.textContent = "保存に失敗しました。もう一度お試しください。";
    el.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!document.getElementById("modalOverlay").hidden) closeEventModal();
  if (!document.getElementById("personModalOverlay").hidden) closePersonModal();
  if (!document.getElementById("personTimelineOverlay").hidden) closePersonTimelineModal();
  if (!document.getElementById("monthPopover").hidden) closeMonthPopover();
  if (!document.getElementById("personPickerOverlay").hidden) closePersonPicker();
});

// ---------------------------------------------------------------
// サインイン状態に応じてデータ接続を開始/停止
// ---------------------------------------------------------------
function stopSync() {
  if (unsubPeople) { unsubPeople(); unsubPeople = null; }
  if (unsubEvents) { unsubEvents(); unsubEvents = null; }
  peopleCol = null;
  eventsCol = null;
  people = [];
  events = [];
  selectedPersonId = null;
  writable = false;
}

function startSync(uid) {
  writable = true;
  peopleCol = makeCollectionRef(["users", uid, "people"]);
  eventsCol = makeCollectionRef(["users", uid, "events"]);

  unsubPeople = peopleCol.onSnapshot(snap => {
    people = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
  unsubEvents = eventsCol.onSnapshot(snap => {
    events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}

const googleProvider = new GoogleAuthProvider();

// LINE・Instagram・Facebook・WeChatなどのアプリ内ブラウザはGoogleログインを
// ブロックするため、検出して案内を出す(ボタン自体は隠さない: 検出漏れの保険)。
function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /Line\//i.test(ua) || /FBAN|FBAV/i.test(ua) || /Instagram/i.test(ua) || /MicroMessenger/i.test(ua) || /KAKAOTALK/i.test(ua);
}
if (isInAppBrowser()) {
  document.getElementById("inAppWarning").hidden = false;
}

document.getElementById("googleSignInBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("authError");
  errEl.hidden = true;
  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (e) {
    errEl.textContent = "ログインに失敗しました。もう一度お試しください。";
    errEl.hidden = false;
  }
});

getRedirectResult(auth).catch(() => {
  const errEl = document.getElementById("authError");
  errEl.textContent = "ログインに失敗しました。もう一度お試しください。";
  errEl.hidden = false;
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  await signOut(auth);
});
document.getElementById("mobileSignOutBtn").addEventListener("click", async () => {
  if (confirm("サインアウトしますか?")) await signOut(auth);
});

// 読み込み中のまま固まった場合の保険: 一定時間で強制的にログイン画面へ
const authStuckTimer = setTimeout(() => {
  document.getElementById("authLoading").hidden = true;
  document.getElementById("authGate").hidden = false;
}, 8000);

onAuthStateChanged(auth, user => {
  clearTimeout(authStuckTimer);
  document.getElementById("authLoading").hidden = true;

  if (user) {
    document.getElementById("authGate").hidden = true;
    document.getElementById("appRoot").hidden = false;

    document.getElementById("acctName").textContent = user.displayName || user.email || "サインイン済み";
    const acctAvatar = document.getElementById("acctAvatar");
    if (user.photoURL) {
      acctAvatar.innerHTML = `<img src="${user.photoURL}" alt="">`;
    } else {
      acctAvatar.textContent = (user.displayName || user.email || "?").charAt(0);
    }

    renderCalendar();
    renderDayDetail();
    renderPeopleView();
    startSync(user.uid);
  } else {
    document.getElementById("appRoot").hidden = true;
    document.getElementById("authGate").hidden = false;
    stopSync();
  }
});

renderCalendar();
renderDayDetail();
renderPeopleView();
