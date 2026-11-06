// Contract: data/latest.json = LatestPayload, data/history/<id>.json = HistoryPayload
// (see src/water_export.py).

const TEMP_MIN = 0;
const TEMP_MAX = 26;
// ColorBrewer RdYlBu (reversed), 9 classes — colour-blind-safe cold→warm.
const STOPS = ["#313695", "#4575b4", "#74add1", "#abd9e9", "#fee090", "#fdae61", "#f46d43", "#d73027", "#a50026"];
const STALE_COLOR = "#9e9e9e";
const STALE_AFTER_S = 24 * 3600; // keep in sync with water_export.STALE_AFTER_S
const OUTDATED_AFTER_S = 3 * 3600; // publishing is hourly; this long without an update is a problem
const TZ = "Europe/Berlin";

const fmtTemp = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtTime = new Intl.DateTimeFormat("de-DE", {
  timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

const state = { kind: "all", query: "", stations: [], markers: new Map(), map: null };
const historyCache = new Map();

function tempColor(t) {
  if (t == null) return STALE_COLOR;
  const x = Math.min(Math.max((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0), 1);
  return STOPS[Math.round(x * (STOPS.length - 1))];
}

const formatTime = (ts) => fmtTime.format(new Date(ts * 1000));
const formatTemp = (t) => `${fmtTemp.format(t)} °C`;

function showBanner(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.hidden = false;
}

// The export's own `stale` flag is frozen at publish time; if publishing stops, only the
// browser's clock can tell that a reading has become old.
const nowSeconds = () => Date.now() / 1000;
const isStale = (s) => s.stale || s.measured_at == null || nowSeconds() - s.measured_at > STALE_AFTER_S;

function popupContent(s) {
  const el = document.createElement("div");
  el.className = "popup";
  el.innerHTML = `
    <h3></h3><p class="body"></p><p class="temp"></p><p class="when"></p>
    <div class="range" role="group" aria-label="Zeitraum">
      <button type="button" data-days="7" aria-pressed="true">7 Tage</button>
      <button type="button" data-days="30" aria-pressed="false">30 Tage</button>
    </div>
    <div class="chart"></div>`;
  el.querySelector("h3").textContent = s.label;
  el.querySelector(".body").textContent = `${s.body} · ${s.kind === "lake" ? "See" : "Fluss"}`;
  el.querySelector(".temp").textContent = s.temp_c == null ? "Kein Messwert" : formatTemp(s.temp_c);
  el.querySelector(".when").textContent =
    s.measured_at == null ? "" : `gemessen ${formatTime(s.measured_at)} Uhr${s.stale ? " · veraltet" : ""}`;
  return el;
}

async function loadHistory(id) {
  if (!historyCache.has(id)) {
    const res = await fetch(`data/history/${id}.json`);
    if (!res.ok) throw new Error(`history ${res.status}`);
    historyCache.set(id, await res.json());
  }
  return historyCache.get(id);
}

function drawChart(box, hist, days) {
  box.replaceChildren();
  // Window ends at the last measurement, so stale stations still show their last days.
  const cutoff = (hist.t.at(-1) ?? 0) - days * 86400;
  const start = hist.t.findIndex((t) => t >= cutoff);
  const t = start < 0 ? [] : hist.t.slice(start);
  const y = start < 0 ? [] : hist.temp_c.slice(start);
  if (y.filter((v) => v != null).length < 2) {
    box.textContent = "Noch zu wenige Messwerte";
    return;
  }
  new uPlot(
    {
      width: 260,
      height: 140,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), TZ),
      legend: { show: false },
      series: [{}, { stroke: "#2563eb", width: 2, spanGaps: false }],
      axes: [{ size: 28 }, { size: 40, values: (u, vals) => vals.map((v) => fmtTemp.format(v)) }],
    },
    [t, y],
    box,
  );
}

async function onPopupOpen(s, popup) {
  const el = popup.getElement();
  const box = el.querySelector(".chart");
  let hist;
  try {
    hist = await loadHistory(s.id);
  } catch {
    box.textContent = "Verlauf nicht verfügbar";
    return;
  }
  const buttons = el.querySelectorAll(".range button");
  buttons.forEach((b) => {
    b.onclick = () => {
      buttons.forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      drawChart(box, hist, Number(b.dataset.days));
    };
  });
  drawChart(box, hist, 7);
}

function makeMarker(s) {
  const lake = s.kind === "lake";
  const m = L.circleMarker([s.lat, s.lon], {
    radius: 9,
    weight: lake ? 3 : 1.5,
    color: lake ? "#1f2933" : "#ffffff",
    fillColor: s.stale ? STALE_COLOR : tempColor(s.temp_c),
    fillOpacity: 0.92,
  });
  // A DOM node, not a string: Leaflet renders string tooltips with innerHTML.
  const tip = document.createElement("span");
  tip.textContent = s.temp_c == null || s.stale ? s.label : `${s.label}: ${formatTemp(s.temp_c)}`;
  m.bindTooltip(tip);
  m.bindPopup(popupContent(s), { minWidth: 280, maxWidth: 320 });
  m.on("popupopen", (e) => onPopupOpen(s, e.popup));
  return m;
}

// Lower-case, strip diacritics ("Tölz" -> "tolz"), ß -> ss.
const normalize = (text) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").toLowerCase();

const matchesQuery = (s) => {
  const words = normalize(state.query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalize(`${s.label} ${s.body}`);
  return words.every((w) => haystack.includes(w));
};

const isVisible = (s) => (state.kind === "all" || s.kind === state.kind) && matchesQuery(s);

function openStation(id) {
  const m = state.markers.get(id);
  if (!m) return;
  const map = state.map;
  const target = m.getLatLng();
  const zoom = Math.max(map.getZoom(), 10);
  if (map.getZoom() === zoom && map.getCenter().equals(target, 1e-5)) {
    m.openPopup();
    return;
  }
  // Open only once the view settles: a popup's auto-pan computed mid-animation gets overridden.
  map.once("moveend", () => m.openPopup());
  map.setView(target, zoom);
}
window.__openStation = openStation; // used by browser tests

// Isar stations by distance along the river from Bad Tölz (upstream first on ties).
const ISAR_ORDER = ["16003207", "16003003", "16004403", "16000708", "16005701", "16007004", "16008007"];
const isarRank = (s) => {
  const i = ISAR_ORDER.indexOf(s.id);
  return i === -1 ? ISAR_ORDER.length : i;
};

// Warmest first; stations without a current value last, alphabetically.
// With an empty search, the Isar stations come first, Bad Tölz on top.
function sortedVisible() {
  const hasValue = (s) => !s.stale && s.temp_c != null;
  const isarFirst = !state.query.trim();
  return state.stations.filter(isVisible).sort((a, b) => {
    if (isarFirst) {
      const d = isarRank(a) - isarRank(b);
      if (d) return d;
    }
    if (hasValue(a) !== hasValue(b)) return hasValue(a) ? -1 : 1;
    return hasValue(a) ? b.temp_c - a.temp_c : a.label.localeCompare(b.label, "de");
  });
}

function renderList() {
  const ol = document.getElementById("stations");
  ol.replaceChildren();
  const rows = sortedVisible();
  document.getElementById("list-heading").textContent = `Messstellen (${rows.length})`;
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Keine Messstelle gefunden";
    ol.append(li);
    return;
  }
  for (const s of rows) {
    const current = !s.stale && s.temp_c != null;
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = '<span class="swatch"></span><span class="name"></span><span class="val"></span>';
    btn.querySelector(".swatch").style.background = current ? tempColor(s.temp_c) : STALE_COLOR;
    btn.querySelector(".name").textContent = s.label;
    btn.querySelector(".val").textContent = current
      ? formatTemp(s.temp_c)
      : s.temp_c == null
        ? "kein Wert"
        : "veraltet";
    if (!current) li.className = "no-value";
    btn.addEventListener("click", () => openStation(s.id));
    li.append(btn);
    ol.append(li);
  }
}

function applyFilter() {
  for (const s of state.stations) {
    const m = state.markers.get(s.id);
    if (isVisible(s)) m.addTo(state.map);
    else m.remove();
  }
  renderList();
}

function bindFilter() {
  const buttons = document.querySelectorAll(".filter button");
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      state.kind = b.dataset.kind;
      buttons.forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      applyFilter();
    }),
  );
}

function bindSearch() {
  document.getElementById("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    applyFilter();
  });
}

function renderLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = `
    <div class="ramp">${STOPS.map((c) => `<span style="background:${c}"></span>`).join("")}</div>
    <div class="ticks"><span>${TEMP_MIN} °C</span><span>${TEMP_MAX / 2} °C</span><span>${TEMP_MAX} °C</span></div>
    <p class="keys"><span><span class="key lake"></span>See</span>
      <span><span class="key river"></span>Fluss</span>
      <span><span class="key stale"></span>veraltet</span></p>`;
}

async function main() {
  const map = L.map("map").setView([47.9, 11.6], 8);
  state.map = map;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  }).addTo(map);
  renderLegend();

  let data;
  try {
    const res = await fetch("data/latest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`latest ${res.status}`);
    data = await res.json();
  } catch {
    document.getElementById("stand").textContent = "";
    showBanner("error", "Daten konnten nicht geladen werden. Bitte später erneut versuchen.");
    return;
  }

  document.getElementById("stand").textContent = `Stand: ${formatTime(data.generated_at)} Uhr`;
  state.stations = data.stations.map((s) => ({ ...s, stale: isStale(s) }));
  if (nowSeconds() - data.generated_at > OUTDATED_AFTER_S) {
    showBanner("notice", `Daten sind nicht aktuell (Stand ${formatTime(data.generated_at)} Uhr).`);
  }
  for (const s of state.stations) state.markers.set(s.id, makeMarker(s));
  if (state.stations.length) {
    map.fitBounds(L.latLngBounds(state.stations.map((s) => [s.lat, s.lon])), {
      padding: [24, 24],
      animate: false,
    });
  }
  bindFilter();
  bindSearch();
  applyFilter();
}

main();
