/* ================================================
   PanganTrack — script.js
   Revisi terbaru:
   - Model utama: LightGBM
   - Insight otomatis AI-style
   - Grafik tren nasional + daerah
   - Tooltip hover, toggle layer, highlight selisih
   Data dibaca dari data.js
   ================================================ */

/* Endpoint FastAPI. Default kosong = same-origin (frontend di-serve oleh
   FastAPI di port yang sama). Ganti ke 'http://127.0.0.1:8000' kalau
   frontend dibuka langsung dari file:// atau dari live-server lain. */
const API_CONFIG = {
  BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : 'https://pangantrack-production.up.railway.app',
  ENDPOINTS: {
    bootstrap:    '/api/bootstrap',
    predict:      '/api/predict',
    predictBulk:  '/api/predict-bulk',
    history:      '/api/history',
    wilayah:      '/api/wilayah',
    komoditas:    '/api/komoditas',
  }
};

/* Cache hasil prediksi LightGBM dari API supaya tidak hit endpoint berulang.
   Key = `${wilayah}|${komoditas}|${periods}`. Diisi via prefetchPredictions(). */
const predictionCache = new Map();
const predKey = (wilayah, kom, periods) => `${wilayah}|${kom}|${periods}`;

async function apiFetch(path, options = {}) {
  const url = API_CONFIG.BASE_URL + path;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`API ${path} ${res.status}: ${txt}`);
  }
  return res.json();
}

async function bootstrapFromAPI() {
  const data = await apiFetch(API_CONFIG.ENDPOINTS.bootstrap);
  // Populate global PANGAN_DATA dengan response API.
  Object.assign(window.PANGAN_DATA, data);
}

async function prefetchPredictions(periods, specificDaerah = null) {
  /* Pre-fetch prediksi LightGBM untuk komoditas terpilih (nasional + daerah aktif)
     + semua komoditas untuk tabel (daerah terpilih jika ada, fallback ke nasional). */
  const kom    = state.komoditas;
  const daerah = specificDaerah || state.daerah;
  const nasionalLabel = PANGAN_DATA.nasional_label || 'Nasional';

  const requests = [];
  // Untuk panel ringkasan & chart utama: 1 nasional + 1 daerah pilihan.
  requests.push({ wilayah: nasionalLabel, komoditas: kom, n_bulan: periods });
  if (PANGAN_DATA.daerah[daerah]?.[kom]) {
    requests.push({ wilayah: daerah, komoditas: kom, n_bulan: periods });
  }
  // Untuk tabel: prediksi daerah terpilih (atau nasional jika data tidak ada) semua komoditas.
  PANGAN_DATA.komoditas_list.forEach(k => {
    if (k !== kom) {
      if (PANGAN_DATA.daerah[daerah]?.[k]) {
        requests.push({ wilayah: daerah, komoditas: k, n_bulan: periods });
      } else {
        requests.push({ wilayah: nasionalLabel, komoditas: k, n_bulan: periods });
      }
    }
  });

  const need = requests.filter(r => !predictionCache.has(predKey(r.wilayah, r.komoditas, r.n_bulan)));
  if (!need.length) return;

  try {
    const resp = await apiFetch(API_CONFIG.ENDPOINTS.predictBulk, {
      method: 'POST',
      body: JSON.stringify(need),
    });
    (resp.results || []).forEach(r => {
      if (r.error) return;
      const arr = (r.prediksi || []).map(p => p.harga_prediksi);
      predictionCache.set(predKey(r.wilayah, r.komoditas, r.n_bulan), arr);
    });
  } catch (e) {
    console.error('predict-bulk gagal:', e);
  }
}

let state = {
  sortDir: 'desc',
  komoditas: null,
  daerah: null,
  periods: 6,
  trendLayers: {
    nasional: true,
    daerah: true,
    prediksi: true,
    selisih: true
  }
};

function rp(num) {
  if (num === null || num === undefined || isNaN(num)) return '—';
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}
function rpShort(num) {
  if (!num && num !== 0) return '—';
  if (num >= 1000000) return 'Rp ' + (num / 1000000).toFixed(1) + ' jt';
  if (num >= 1000) return 'Rp ' + (num / 1000).toFixed(1) + ' rb';
  return 'Rp ' + num;
}
function pct(a, b) {
  if (!a || !b) return null;
  return ((a - b) / b * 100);
}
function changeLabel(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const v = Number(val);
  const sign = v >= 0 ? '▲ +' : '▼ ';
  return sign + Math.abs(v).toFixed(1) + '%';
}
function changeClass(val) {
  const v = Number(val);
  if (v > 1) return 'up';
  if (v < -1) return 'down';
  return 'warn';
}
function last(arr) {
  return arr?.[arr.length - 1] ?? null;
}
function avg(arr) {
  const clean = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}
function gotoSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

/* Animasi angka bertahap (Smooth Counter Animation) */
function animateCounter(elementOrId, targetValue, duration = 800, formatFn = null) {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!el || targetValue === null || targetValue === undefined || isNaN(targetValue)) {
    if (el) el.textContent = formatFn ? formatFn(targetValue) : (targetValue ?? '—');
    return;
  }

  const target = Number(targetValue);
  const start = el._currentVal !== undefined ? el._currentVal : 0;
  el._currentVal = target;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = formatFn ? formatFn(target) : target.toLocaleString('id-ID');
    return;
  }

  const startTime = performance.now();
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * easeProgress;

    if (formatFn) {
      el.textContent = formatFn(Math.round(current));
    } else {
      el.textContent = Math.round(current).toLocaleString('id-ID');
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = formatFn ? formatFn(target) : target.toLocaleString('id-ID');
    }
  }
  requestAnimationFrame(update);
}

/* Inisialisasi progress bar scroll dan tombol back-to-top */
function initScrollFeatures() {
  const progressBar = document.getElementById('scroll-progress');
  const backToTopBtn = document.getElementById('btn-back-to-top');
  if (!progressBar && !backToTopBtn) return;

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const winScroll = document.documentElement.scrollTop || document.body.scrollTop;
        const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = height > 0 ? (winScroll / height) * 100 : 0;

        if (progressBar) {
          progressBar.style.width = Math.min(Math.max(scrolled, 0), 100) + '%';
        }
        if (backToTopBtn) {
          if (winScroll > 320) {
            backToTopBtn.classList.add('show');
          } else {
            backToTopBtn.classList.remove('show');
          }
        }
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

/* Sistem Toast Notifikasi Modern */
function showToast(message, type = 'success', duration = 3200) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;

  const iconMap = {
    success: '✅',
    info: 'ℹ️',
    warn: '⚠️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || 'ℹ️'}</span>
    <span class="toast-body">${safeText(message)}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 320);
  }, duration);
}

function labelPretty(label) {
  if (!label) return '—';
  const [y, m] = label.split('-');
  const nama = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${nama[Number(m) - 1] || m} ${y}`;
}
function futureLabels(periods = state.periods) {
  const base = PANGAN_DATA.labels[PANGAN_DATA.labels.length - 1] || '2026-01';
  const [by, bm] = base.split('-').map(Number);
  const nama = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const labels = [];
  for (let i = 1; i <= periods; i++) {
    const d = new Date(by, (bm - 1) + i, 1);
    labels.push(`${nama[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`);
  }
  return labels;
}
function periodLabel(periods = state.periods) {
  if (periods === 1) return '1 bulan';
  if (periods === 3) return '3 bulan';
  if (periods === 6) return '6 bulan';
  if (periods === 12) return '1 tahun';
  return `${periods} bulan`;
}
function iconFor(kom) {
  return PANGAN_DATA.komoditas_icon[kom] || '📦';
}
function safeText(txt) {
  return String(txt).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
function highlightQuery(text, query) {
  if (!query || !query.trim()) return safeText(text);
  const safeStr = safeText(text);
  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${q})`, 'gi');
  return safeStr.replace(regex, '<mark class="search-highlight">$1</mark>');
}
function modelLabel(kom) {
  const mt = PANGAN_DATA.model_types?.[kom] || 'lgbm';
  if (mt === 'ridge') return 'Ridge';
  if (mt === 'naive') return 'Naive';
  return 'LightGBM';
}
function updateModelBadge(kom) {
  const el = document.getElementById('model-label');
  if (el) el.textContent = modelLabel(kom);
}

/* Wrapper sinkron untuk akses prediksi LightGBM yang sudah di-prefetch dari API.
   Saat cache miss, fallback ke flat-line dari nilai terakhir series — supaya
   render tidak error sebelum prefetchPredictions() selesai. */
function lightGBMForecast(series, periods = 6, wilayah = null, komoditas = null) {
  const _wilayah   = wilayah   || (PANGAN_DATA.nasional_label || 'Nasional');
  const _komoditas = komoditas || state.komoditas;
  if (_komoditas) {
    const cached = predictionCache.get(predKey(_wilayah, _komoditas, periods));
    if (cached && cached.length) return cached.slice(0, periods);
  }
  const clean = (series || []).filter(v => v !== null && v !== undefined && !isNaN(v));
  const lastVal = last(clean) || 0;
  return Array(periods).fill(lastVal);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await bootstrapFromAPI();
  } catch (e) {
    console.error('Gagal bootstrap dari API:', e);
    alert('Gagal memuat data dari API.\nPastikan FastAPI berjalan di ' +
          (API_CONFIG.BASE_URL || window.location.origin) + '.');
    return;
  }
  initSelects();
  renderQuickChips();
  initScrollFeatures();
  loadHero();
  loadStats();
  await prefetchPredictions(state.periods);
  runPrediction();
  renderDaerahBars();
  renderTable();
});

function initSelects() {
  const komOptions = PANGAN_DATA.komoditas_list
    .map(k => `<option value="${safeText(k)}">${iconFor(k)} ${safeText(k)}</option>`).join('');
  ['sel-komoditas', 'sel-kom-daerah'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = komOptions;
  });

  const daerahOptions = PANGAN_DATA.areas
    .map(a => `<option value="${safeText(a)}">${safeText(a)}</option>`).join('');
  ['sel-daerah', 'tbl-daerah'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = daerahOptions;
  });

  const defaultKom = PANGAN_DATA.komoditas_list.includes('Beras') ? 'Beras' : PANGAN_DATA.komoditas_list[0];
  const defaultDaerah = PANGAN_DATA.areas.includes('Jawa Timur') ? 'Jawa Timur' : PANGAN_DATA.areas[0];

  document.getElementById('sel-komoditas').value = defaultKom;
  document.getElementById('sel-kom-daerah').value = defaultKom;
  document.getElementById('sel-daerah').value = defaultDaerah;
  document.getElementById('tbl-daerah').value = defaultDaerah;
  const periodSelect = document.getElementById('sel-period');
  if (periodSelect) periodSelect.value = String(state.periods);

  state.komoditas = defaultKom;
  state.daerah = defaultDaerah;
}

function loadHero() {
  const firstLabel = PANGAN_DATA.labels[0];
  const lastLabel = PANGAN_DATA.labels[PANGAN_DATA.labels.length - 1];
  animateCounter('hero-daerah', PANGAN_DATA.areas.length);
  animateCounter('hero-komoditas', PANGAN_DATA.komoditas_list.length);
  document.getElementById('hero-periode').textContent = `${firstLabel.slice(0, 4)}–${lastLabel.slice(0, 4)}`;
  document.getElementById('hero-last-label').textContent = `● ${labelPretty(lastLabel)}`;

  const list = document.getElementById('hero-price-list');
  const featured = ['Beras', 'Bawang Merah', 'Cabai Merah', 'Daging Ayam', 'Minyak Goreng', 'Telur Ayam Ras Segar']
    .filter(k => PANGAN_DATA.nasional[k])
    .slice(0, 4);

  list.innerHTML = featured.map(kom => {
    const series = PANGAN_DATA.nasional[kom];
    const c = pct(last(series), series[0]);
    return `
      <div class="p-row" onclick="selectCommodity('${kom.replace(/'/g, "\\'")}')">
        <div class="p-left">
          <div class="p-icon">${iconFor(kom)}</div>
          <div><div class="p-name">${safeText(kom)}</div><div class="p-unit">per kg/lt</div></div>
        </div>
        <div class="p-right">
          <div class="p-price">${rp(last(series))}</div>
          <div class="p-chg ${changeClass(c)}">${changeLabel(c)} total</div>
        </div>
      </div>`;
  }).join('');
}

function selectCommodity(kom) {
  document.getElementById('sel-komoditas').value = kom;
  document.getElementById('sel-kom-daerah').value = kom;
  updateActiveQuickChip(kom);
  onParamChange();
  gotoSection('prediksi');
}

/* Quick Filter Chips untuk Pilihan Komoditas Populer */
function renderQuickChips() {
  const container = document.getElementById('quick-chips-list');
  if (!container) return;

  const popular = ['Beras', 'Bawang Merah', 'Cabai Merah', 'Daging Ayam', 'Telur Ayam Ras Segar', 'Minyak Goreng']
    .filter(k => PANGAN_DATA.komoditas_list.includes(k));

  container.innerHTML = popular.map(kom => {
    const isActive = kom === state.komoditas ? 'active' : '';
    return `
      <button type="button" class="quick-chip ${isActive}" data-komoditas="${safeText(kom)}" onclick="selectQuickChip('${kom.replace(/'/g, "\\'")}')">
        <span>${iconFor(kom)}</span>
        <span>${safeText(kom)}</span>
      </button>`;
  }).join('');
}

function selectQuickChip(kom) {
  selectCommodity(kom);
}

function updateActiveQuickChip(kom) {
  document.querySelectorAll('.quick-chip').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-komoditas') === kom);
  });
}


function loadStats() {
  let naik = 0, turun = 0;
  PANGAN_DATA.komoditas_list.forEach(kom => {
    const s = PANGAN_DATA.nasional[kom];
    const c = pct(last(s), s[0]);
    if (c >= 0) naik++; else turun++;
  });
  animateCounter('stat-naik', naik);
  animateCounter('stat-turun', turun);
  animateCounter('stat-daerah', PANGAN_DATA.areas.length);
}

function onParamChange() {
  state.komoditas = document.getElementById('sel-komoditas').value;
  state.daerah = document.getElementById('sel-daerah').value;
  state.periods = Number(document.getElementById('sel-period')?.value || state.periods || 6);
  document.getElementById('sel-kom-daerah').value = state.komoditas;
  document.getElementById('tbl-daerah').value = state.daerah;
  updateActiveQuickChip(state.komoditas);
  updateModelBadge(state.komoditas);
  runPrediction();
  renderDaerahBars();
  renderTable();
}

function setSort(dir) {
  state.sortDir = dir;
  document.getElementById('sort-asc').classList.toggle('active', dir === 'asc');
  document.getElementById('sort-desc').classList.toggle('active', dir === 'desc');
  renderDaerahBars();
}

function toggleTrendLayer(layer) {
  state.trendLayers[layer] = !state.trendLayers[layer];
  const btn = document.getElementById(`tg-${layer}`);
  if (btn) btn.classList.toggle('active', state.trendLayers[layer]);
  renderTrendChart(state.komoditas, state.daerah);
}

async function runPrediction() {
  const kom = document.getElementById('sel-komoditas').value;
  const daerah = document.getElementById('sel-daerah').value;
  state.komoditas = kom;
  state.daerah = daerah;
  state.periods = Number(document.getElementById('sel-period')?.value || state.periods || 6);

  updateModelBadge(kom);

  const btn = document.getElementById('btn-run');
  const txt = document.getElementById('run-txt');
  const spn = document.getElementById('run-spin');
  btn.disabled = true;
  txt.textContent = 'Memproses...';
  spn.classList.remove('hidden');

  try {
    await prefetchPredictions(state.periods);
    updateSummaryCards(kom, daerah);
    updateAutoInsight(kom, daerah);
    renderTrendChart(kom, daerah);
    renderDaerahCompareChart(kom, daerah);
    renderTable();
    showToast(`Prediksi ${kom} (${daerah}) berhasil diperbarui!`, 'success');
  } catch (err) {
    console.error('Gagal memperbarui prediksi:', err);
    showToast(`Gagal memproses: ${err.message || 'Periksa koneksi'}`, 'warn');
  } finally {
    btn.disabled = false;
    txt.textContent = 'Jalankan Prediksi';
    spn.classList.add('hidden');
  }
}

function updateSummaryCards(kom, daerah) {
  const nas = PANGAN_DATA.nasional[kom];
  const ds = PANGAN_DATA.daerah[daerah]?.[kom];
  const nasionalLabel = PANGAN_DATA.nasional_label || 'Nasional';

  // Gunakan data daerah jika tersedia untuk prediksi, jika tidak gunakan data nasional
  const hasDaerahData = ds && ds.length > 0;
  const activeSeries = hasDaerahData ? ds : nas;
  const activeWilayah = hasDaerahData ? daerah : nasionalLabel;

  const pred = lightGBMForecast(activeSeries, state.periods, activeWilayah, kom);
  const lastActive = last(activeSeries);
  const lastNas = last(nas);
  const lastDaerah = ds ? last(ds) : null;
  const trendNas = pct(lastNas, nas[0]);
  const diffDaerah = ds ? pct(lastDaerah, lastNas) : null;
  const predFinal = pred[pred.length - 1];
  const predChange = (predFinal !== null && lastActive !== null) ? pct(predFinal, lastActive) : null;
  const lastLabel = labelPretty(PANGAN_DATA.labels[PANGAN_DATA.labels.length - 1]);

  animateCounter('sc-nas-now', lastNas, 600, rp);
  document.getElementById('sc-nas-trend').innerHTML = `<span class="${changeClass(trendNas)}">${changeLabel(trendNas)}</span> dari awal data`;
  document.getElementById('sc-nas-date').textContent = lastLabel;

  document.getElementById('sc-daerah-tag').textContent = `${daerah} · ${lastLabel}`;
  if (lastDaerah !== null) {
    animateCounter('sc-daerah-price', lastDaerah, 600, rp);
  } else {
    document.getElementById('sc-daerah-price').textContent = '—';
  }
  document.getElementById('sc-daerah-vs').innerHTML = ds
    ? `<span class="${changeClass(diffDaerah)}">${changeLabel(diffDaerah)}</span> vs nasional`
    : 'Data daerah tidak tersedia';

  const predTagEl = document.getElementById('sc-pred-tag');
  if (predTagEl) {
    predTagEl.textContent = hasDaerahData ? `Prediksi ${daerah}` : `Prediksi Nasional`;
  }
  if (predFinal !== null) {
    animateCounter('sc-pred-price', predFinal, 600, rp);
  } else {
    document.getElementById('sc-pred-price').textContent = '—';
  }
  document.getElementById('sc-pred-change').innerHTML = `<span class="${changeClass(predChange)}">${changeLabel(predChange)}</span> dari harga terakhir`;
  document.getElementById('sc-pred-period').textContent = `${futureLabels()[0]} → ${futureLabels()[futureLabels().length - 1]} (${periodLabel()})`;

  let status = 'Stabil';
  let detail = 'Pantau berkala';
  if (predChange > 5 || diffDaerah > 8) {
    status = 'Waspada';
    detail = 'Potensi kenaikan / harga daerah tinggi';
  } else if (predChange < -5) {
    status = 'Turun';
    detail = 'Prediksi harga cenderung melemah';
  }
  document.getElementById('sc-status').textContent = status;
  document.getElementById('sc-status-detail').textContent = detail;

  document.getElementById('chart-nas-title').textContent = `Tren Harga Nasional & Daerah — ${kom}`;
  document.getElementById('chart-daerah-title').textContent = `${daerah} vs Nasional — ${kom}`;
}

function updateAutoInsight(kom, daerah) {
  const nas = PANGAN_DATA.nasional[kom];
  const ds = PANGAN_DATA.daerah[daerah]?.[kom];
  const nasionalLabel = PANGAN_DATA.nasional_label || 'Nasional';
  const predNas    = lightGBMForecast(nas, state.periods, nasionalLabel, kom);
  const predDaerah = ds ? lightGBMForecast(ds, state.periods, daerah, kom) : [];
  const lastNas = last(nas);
  const lastDaerah = ds ? last(ds) : null;
  const predNasFinal = last(predNas);
  const predDaerahFinal = predDaerah.length ? last(predDaerah) : null;
  const predChangeNas = pct(predNasFinal, lastNas);
  const predChangeDaerah = predDaerahFinal ? pct(predDaerahFinal, lastDaerah) : null;
  const diffNow = ds ? pct(lastDaerah, lastNas) : null;
  const recentNas = pct(lastNas, nas[Math.max(0, nas.length - 12)]);
  const recentDaerah = ds ? pct(lastDaerah, ds[Math.max(0, ds.length - 12)]) : null;

  const arahNas = predChangeNas >= 0 ? 'naik' : 'turun';
  const arahDaerah = predChangeDaerah === null ? '' : (predChangeDaerah >= 0 ? 'naik' : 'turun');
  const kondisiDaerah = diffNow === null ? 'belum memiliki data pembanding daerah' :
    diffNow > 3 ? `lebih mahal ${Math.abs(diffNow).toFixed(1)}% dari nasional` :
    diffNow < -3 ? `lebih murah ${Math.abs(diffNow).toFixed(1)}% dari nasional` :
    'relatif dekat dengan harga nasional';

  let rekom = 'Harga masih relatif terkendali, tetapi tetap perlu dipantau karena fluktuasi pangan bisa berubah cepat.';
  if (predChangeNas > 5 || diffNow > 8) rekom = 'Sebaiknya stok dan anggaran disiapkan lebih awal karena ada sinyal kenaikan atau harga daerah yang tinggi.';
  if (predChangeNas < -5 && diffNow < 0) rekom = 'Momentum pembelian bisa lebih baik karena prediksi melemah dan harga daerah masih di bawah nasional.';

  const text = `Harga ${kom} diprediksi ${arahNas} ${Math.abs(predChangeNas || 0).toFixed(1)}% secara nasional hingga ${futureLabels()[futureLabels().length - 1]}. Di ${daerah}, harga saat ini ${kondisiDaerah}${predChangeDaerah !== null ? ` dan proyeksi daerah cenderung ${arahDaerah} ${Math.abs(predChangeDaerah).toFixed(1)}%` : ''}. Tren 12 periode terakhir: nasional ${changeLabel(recentNas)}, daerah ${recentDaerah === null ? '—' : changeLabel(recentDaerah)}. ${rekom}`;

  const insightEl = document.getElementById('auto-insight');
  if (insightEl) insightEl.textContent = text;
}

function showTooltip(evt, html) {
  const tip = document.getElementById('chart-tooltip');
  if (!tip) return;
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  tip.style.left = `${evt.pageX + 14}px`;
  tip.style.top = `${evt.pageY + 14}px`;
}
function hideTooltip() {
  document.getElementById('chart-tooltip')?.classList.add('hidden');
}

function renderTrendChart(kom, daerah) {
  const histNas = PANGAN_DATA.nasional[kom] || [];
  const histDaerah = PANGAN_DATA.daerah[daerah]?.[kom] || [];
  const nasionalLabel = PANGAN_DATA.nasional_label || 'Nasional';
  const predNas    = lightGBMForecast(histNas, state.periods, nasionalLabel, kom);
  const predDaerah = histDaerah.length ? lightGBMForecast(histDaerah, state.periods, daerah, kom) : [];
  const labels = PANGAN_DATA.labels;
  document.getElementById('load-nas').style.display = 'none';

  const W = 640, H = 260, P = { t: 24, r: 20, b: 56, l: 68 };
  const CW = W - P.l - P.r, CH = H - P.t - P.b;
  const all = [...histNas, ...histDaerah, ...predNas, ...predDaerah].filter(v => v !== null && v !== undefined && !isNaN(v));
  const mn = Math.min(...all) * 0.985, mx = Math.max(...all) * 1.015;
  const total = histNas.length + Math.max(predNas.length, predDaerah.length);
  const sx = i => P.l + (i / (total - 1)) * CW;
  const sy = v => P.t + CH - ((v - mn) / (mx - mn)) * CH;

  let yGrid = '';
  for (let s = 0; s <= 5; s++) {
    const v = mn + (mx - mn) * (s / 5), y = sy(v);
    yGrid += `<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}" stroke="#f0f0ec" stroke-width="1"/>`;
    yGrid += `<text x="${P.l - 6}" y="${y.toFixed(1)}" font-size="9" fill="#bbb" text-anchor="end" dominant-baseline="middle">${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)}</text>`;
  }

  const labelStep = Math.max(1, Math.floor(total / 9));
  const xLabelY = P.t + CH + 22;   // jarak ~22px di bawah plot area, masih dalam P.b
  let xLabels = '';
  for (let i = 0; i < total; i += labelStep) {
    const lbl = i < histNas.length ? labelPretty(labels[i]) : futureLabels()[i - histNas.length];
    const anchor = i === 0 ? 'start' : (i + labelStep >= total ? 'end' : 'middle');
    xLabels += `<text x="${sx(i).toFixed(1)}" y="${xLabelY}" font-size="9" fill="#bbb" text-anchor="${anchor}">${lbl || ''}</text>`;
  }

  // Helper: bangun path SVG yang putus pada nilai null/NaN supaya garis
  // tidak "jatuh" ke bawah plot area.
  const isValid = v => v !== null && v !== undefined && !isNaN(v);
  const linePath = (arr, indexOffset = 0) => {
    let d = '';
    let inSeg = false;
    arr.forEach((v, i) => {
      if (!isValid(v)) { inSeg = false; return; }
      const cmd = inSeg ? 'L' : 'M';
      d += `${cmd}${sx(indexOffset + i).toFixed(1)},${sy(v).toFixed(1)} `;
      inSeg = true;
    });
    return d.trim();
  };
  // Path area gradient: untuk tiap segmen kontigu, tarik turun ke baseline.
  const areaPath = (arr, indexOffset = 0) => {
    const baseY = (P.t + CH).toFixed(1);
    let d = '';
    let segStart = -1;
    arr.forEach((v, i) => {
      const valid = isValid(v);
      if (valid && segStart < 0) {
        segStart = i;
        d += `M${sx(indexOffset + i).toFixed(1)},${baseY} L${sx(indexOffset + i).toFixed(1)},${sy(v).toFixed(1)} `;
      } else if (valid) {
        d += `L${sx(indexOffset + i).toFixed(1)},${sy(v).toFixed(1)} `;
      } else if (segStart >= 0) {
        d += `L${sx(indexOffset + (i - 1)).toFixed(1)},${baseY} Z `;
        segStart = -1;
      }
    });
    if (segStart >= 0) d += `L${sx(indexOffset + arr.length - 1).toFixed(1)},${baseY} Z`;
    return d.trim();
  };

  const histNasPath    = linePath(histNas);
  const histDaerahPath = linePath(histDaerah);

  // Untuk segmen prediksi, awali dari titik valid terakhir histori supaya nyambung.
  const lastHistNas    = [...histNas].reverse().find(isValid) ?? null;
  const lastHistDaerah = [...histDaerah].reverse().find(isValid) ?? null;
  const predNasFull    = isValid(lastHistNas)    ? [lastHistNas, ...predNas]       : predNas;
  const predDaerahFull = isValid(lastHistDaerah) ? [lastHistDaerah, ...predDaerah] : predDaerah;
  const predOffset     = isValid(lastHistNas)    ? histNas.length - 1              : histNas.length;
  const predDaerahOff  = isValid(lastHistDaerah) ? histDaerah.length - 1           : histDaerah.length;

  const predNasPath    = linePath(predNasFull, predOffset);
  const predDaerahPath = linePath(predDaerahFull, predDaerahOff);

  const areaNas  = areaPath(histNas);
  const areaPred = areaPath(predNasFull, predOffset);

  let selisihArea = '';
  if (histDaerah.length && state.trendLayers.selisih) {
    const n = Math.min(histNas.length, histDaerah.length);
    let segUpper = [];
    let segLower = [];
    let polys = [];
    const flush = () => {
      if (segUpper.length >= 2) {
        polys.push(`<polygon points="${segUpper.concat(segLower).join(' ')}" fill="#8E5CF7" opacity="0.10"/>`);
      }
      segUpper = []; segLower = [];
    };
    for (let i = 0; i < n; i++) {
      if (!isValid(histNas[i]) || !isValid(histDaerah[i])) { flush(); continue; }
      const yN = sy(histNas[i]);
      const yD = sy(histDaerah[i]);
      segUpper.push(`${sx(i).toFixed(1)},${Math.min(yN, yD).toFixed(1)}`);
      segLower.unshift(`${sx(i).toFixed(1)},${Math.max(yN, yD).toFixed(1)}`);
    }
    flush();
    selisihArea = polys.join('');
  }

  const divX = sx(histNas.length - 1).toFixed(1);
  let dots = '';
  const dStep = Math.max(1, Math.floor(histNas.length / 12));
  for (let i = 0; i < histNas.length; i += dStep) {
    const label = labelPretty(labels[i]);
    if (state.trendLayers.nasional && isValid(histNas[i])) {
      dots += `<circle class="hover-dot" cx="${sx(i).toFixed(1)}" cy="${sy(histNas[i]).toFixed(1)}" r="5" fill="#1D9E75" opacity="0.0" onmousemove="showTooltip(event, '<strong>${safeText(kom)}</strong><br>Nasional · ${label}<br>${rp(histNas[i])}')" onmouseleave="hideTooltip()"/>`;
    }
    if (state.trendLayers.daerah && isValid(histDaerah[i])) {
      const diff = pct(histDaerah[i], histNas[i]);
      dots += `<circle class="hover-dot" cx="${sx(i).toFixed(1)}" cy="${sy(histDaerah[i]).toFixed(1)}" r="5" fill="#378ADD" opacity="0.0" onmousemove="showTooltip(event, '<strong>${safeText(kom)}</strong><br>${safeText(daerah)} · ${label}<br>${rp(histDaerah[i])}<br>Selisih: ${changeLabel(diff)}')" onmouseleave="hideTooltip()"/>`;
    }
  }
  const mLabel = modelLabel(kom);
  predNas.forEach((v, i) => {
    if (!state.trendLayers.prediksi) return;
    const label = futureLabels()[i];
    dots += `<circle class="hover-dot" cx="${sx(histNas.length + i).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="5" fill="#EF9F27" opacity="0.0" onmousemove="showTooltip(event, '<strong>Prediksi ${mLabel}</strong><br>Nasional · ${label}<br>${rp(v)}')" onmouseleave="hideTooltip()"/>`;
  });
  predDaerah.forEach((v, i) => {
    if (!state.trendLayers.prediksi || !state.trendLayers.daerah) return;
    const label = futureLabels()[i];
    dots += `<circle class="hover-dot" cx="${sx(histDaerah.length + i).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="5" fill="#7C9CFF" opacity="0.0" onmousemove="showTooltip(event, '<strong>Prediksi ${mLabel}</strong><br>${safeText(daerah)} · ${label}<br>${rp(v)}')" onmouseleave="hideTooltip()"/>`;
  });

  const latestDiff = histDaerah.length ? pct(last(histDaerah), last(histNas)) : null;
  const latestDiffLabel = latestDiff === null ? '' : `<text x="${Math.max(P.l + 10, parseFloat(divX) - 130)}" y="${P.t + 16}" font-size="10" fill="#8E5CF7">Selisih terbaru: ${changeLabel(latestDiff)}</text>`;

  document.getElementById('svg-nasional').innerHTML = `
    <defs>
      <linearGradient id="gH" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1D9E75" stop-opacity=".14"/>
        <stop offset="100%" stop-color="#1D9E75" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#EF9F27" stop-opacity=".14"/>
        <stop offset="100%" stop-color="#EF9F27" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${yGrid}
    <line x1="${P.l}" y1="${P.t + CH}" x2="${W - P.r}" y2="${P.t + CH}" stroke="#e0e0dc"/>
    ${state.trendLayers.nasional ? `<path d="${areaNas}" fill="url(#gH)"/>` : ''}
    ${state.trendLayers.prediksi ? `<path d="${areaPred}" fill="url(#gP)"/>` : ''}
    ${selisihArea}
    ${state.trendLayers.nasional && histNasPath ? `<path class="chart-line-draw" d="${histNasPath}" fill="none" stroke="#1D9E75" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${state.trendLayers.daerah && histDaerahPath ? `<path class="chart-line-draw" d="${histDaerahPath}" fill="none" stroke="#378ADD" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${state.trendLayers.prediksi && state.trendLayers.nasional && predNasPath ? `<path class="chart-line-draw line-dashed" d="${predNasPath}" fill="none" stroke="#EF9F27" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7,3"/>` : ''}
    ${state.trendLayers.prediksi && state.trendLayers.daerah && predDaerahPath ? `<path class="chart-line-draw line-dashed" d="${predDaerahPath}" fill="none" stroke="#7C9CFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5,3"/>` : ''}
    <line x1="${divX}" y1="${P.t}" x2="${divX}" y2="${P.t + CH}" stroke="#ccc" stroke-dasharray="4,3"/>
    <text x="${parseFloat(divX) + 4}" y="${P.t + 10}" font-size="8.5" fill="#aaa">Data terakhir</text>
    ${latestDiffLabel}
    ${dots}
    ${xLabels}`;
}

function renderDaerahCompareChart(kom, daerah) {
  const nas = PANGAN_DATA.nasional[kom];
  const ds = PANGAN_DATA.daerah[daerah]?.[kom];
  document.getElementById('load-daerah').style.display = 'none';

  if (!ds) {
    document.getElementById('svg-daerah-compare').innerHTML =
      `<text x="160" y="130" font-size="13" fill="#aaa" text-anchor="middle">Data daerah tidak tersedia</text>`;
    return;
  }

  const n = Math.min(12, nas.length, ds.length);
  const nas12 = nas.slice(-n);
  const ds12 = ds.slice(-n);
  const labels = PANGAN_DATA.labels.slice(-n);
  const W = 320, H = 260, P = { t: 20, r: 16, b: 46, l: 58 };
  const CW = W - P.l - P.r, CH = H - P.t - P.b;
  const isValid = v => v !== null && v !== undefined && !isNaN(v);
  const all = [...nas12, ...ds12].filter(isValid);
  const mn = Math.min(...all) * 0.98, mx = Math.max(...all) * 1.02;
  const sx = i => P.l + (i / (n - 1)) * CW;
  const sy = v => P.t + CH - ((v - mn) / (mx - mn)) * CH;
  const linePath = (arr) => {
    let d = '', inSeg = false;
    arr.forEach((v, i) => {
      if (!isValid(v)) { inSeg = false; return; }
      d += `${inSeg ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)} `;
      inSeg = true;
    });
    return d.trim();
  };

  let yGrid = '';
  for (let s = 0; s <= 4; s++) {
    const v = mn + (mx - mn) * (s / 4), y = sy(v);
    yGrid += `<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}" stroke="#f0f0ec"/>`;
    yGrid += `<text x="${P.l - 5}" y="${y.toFixed(1)}" font-size="9" fill="#bbb" text-anchor="end" dominant-baseline="middle">${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)}</text>`;
  }
  const nasPath = linePath(nas12);
  const dsPath  = linePath(ds12);
  let xLabels = '';
  [0, Math.floor((n - 1) / 2), n - 1].forEach(i => {
    const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
    xLabels += `<text x="${sx(i).toFixed(1)}" y="${H - 8}" font-size="9" fill="#888" text-anchor="${anchor}">${labelPretty(labels[i])}</text>`;
  });

  let hit = '';
  for (let i = 0; i < n; i++) {
    if (!isValid(ds12[i]) || !isValid(nas12[i])) continue;
    const diff = pct(ds12[i], nas12[i]);
    hit += `<circle class="hover-dot" cx="${sx(i).toFixed(1)}" cy="${sy(ds12[i]).toFixed(1)}" r="6" fill="#378ADD" opacity="0" onmousemove="showTooltip(event, '<strong>${safeText(daerah)}</strong><br>${safeText(kom)} · ${labelPretty(labels[i])}<br>Daerah: ${rp(ds12[i])}<br>Nasional: ${rp(nas12[i])}<br>Selisih: ${changeLabel(diff)}')" onmouseleave="hideTooltip()"/>`;
  }

  const lastNasValid = [...nas12].reverse().find(isValid);
  const lastDsValid  = [...ds12].reverse().find(isValid);
  const lastNasIdx   = isValid(lastNasValid) ? nas12.lastIndexOf(lastNasValid) : -1;
  const lastDsIdx    = isValid(lastDsValid)  ? ds12.lastIndexOf(lastDsValid)  : -1;

  document.getElementById('svg-daerah-compare').innerHTML = `
    ${yGrid}
    ${nasPath ? `<path class="chart-line-draw" d="${nasPath}" fill="none" stroke="#D85A30" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${dsPath  ? `<path class="chart-line-draw" d="${dsPath}"  fill="none" stroke="#378ADD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${lastNasIdx >= 0 ? `<circle cx="${sx(lastNasIdx).toFixed(1)}" cy="${sy(lastNasValid).toFixed(1)}" r="3" fill="#D85A30"/>` : ''}
    ${lastDsIdx  >= 0 ? `<circle cx="${sx(lastDsIdx).toFixed(1)}"  cy="${sy(lastDsValid).toFixed(1)}"  r="3" fill="#378ADD"/>` : ''}
    ${hit}
    ${xLabels}`;
}

function renderDaerahBars() {
  const kom = document.getElementById('sel-kom-daerah').value;
  const wrap = document.getElementById('daerah-bars-content');
  const nasLast = last(PANGAN_DATA.nasional[kom]);

  let data = PANGAN_DATA.areas.map(daerah => {
    const s = PANGAN_DATA.daerah[daerah]?.[kom];
    return { daerah, val: s ? last(s) : null };
  }).filter(d => d.val !== null);

  data.sort((a, b) => state.sortDir === 'asc' ? a.val - b.val : b.val - a.val);
  const mn = Math.min(...data.map(d => d.val));
  const mx = Math.max(...data.map(d => d.val));

  wrap.innerHTML = data.map(d => {
    const width = mx === mn ? 50 : ((d.val - mn) / (mx - mn) * 100);
    const vsNas = pct(d.val, nasLast);
    const cls = changeClass(vsNas);
    const ratio = mx === mn ? 0.5 : (d.val - mn) / (mx - mn);
    const color = ratio < 0.4 ? '#378ADD' : ratio < 0.65 ? '#1D9E75' : '#D85A30';
    return `
      <div class="pbar-row" onclick="selectDaerah('${d.daerah.replace(/'/g, "\\'")}')">
        <div class="pbar-name" title="${safeText(d.daerah)}">${safeText(d.daerah)}</div>
        <div class="pbar-track">
          <div class="pbar-fill" style="width:${width.toFixed(1)}%;background:${color}"></div>
        </div>
        <div class="pbar-val">
          ${rpShort(d.val)}
          <span class="${cls}" style="font-size:10px;display:block">${changeLabel(vsNas)} nas</span>
        </div>
      </div>`;
  }).join('');
}

function selectDaerah(daerah) {
  document.getElementById('sel-daerah').value = daerah;
  document.getElementById('tbl-daerah').value = daerah;
  onParamChange();
}

async function onTableDaerahChange() {
  const tblDaerah = document.getElementById('tbl-daerah').value;
  const tbody = document.getElementById('tbl-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="tbl-loading">Memuat prediksi ${safeText(tblDaerah)}...</td></tr>`;
  await prefetchPredictions(state.periods, tblDaerah);
  renderTable();
}

function renderTable() {
  const daerah = document.getElementById('tbl-daerah')?.value || state.daerah;
  const predFinalHead = document.getElementById('th-pred-final');
  if (predFinalHead) predFinalHead.textContent = `Pred. ${periodLabel()}`;
  const tableSub = document.getElementById('table-subtitle');
  if (tableSub) tableSub.textContent = `Data nasional terbaru, prediksi ${periodLabel()}, dan selisih harga daerah pilihan terhadap nasional.`;
  const search = (document.getElementById('tbl-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('tbl-body');

  const nasionalLabel = PANGAN_DATA.nasional_label || 'Nasional';
  const rows = PANGAN_DATA.komoditas_list
    .filter(kom => !search || kom.toLowerCase().includes(search))
    .map(kom => {
      const ns = PANGAN_DATA.nasional[kom];
      const ds = PANGAN_DATA.daerah[daerah]?.[kom];

      // Tampilkan prediksi daerah jika ada, jika tidak, tampilkan nasional
      const hasDaerahData = ds && ds.length > 0;
      const activeSeries = hasDaerahData ? ds : ns;
      const activeWilayah = hasDaerahData ? daerah : nasionalLabel;

      const pred = lightGBMForecast(activeSeries, state.periods, activeWilayah, kom);
      const tr = pct(last(ns), ns[0]);
      const diff = ds ? pct(last(ds), last(ns)) : null;
      const lastActive = last(activeSeries);
      const predPct0 = (pred[0] !== null && lastActive !== null) ? pct(pred[0], lastActive) : null;
      const predPctFinal = (pred[pred.length - 1] !== null && lastActive !== null) ? pct(pred[pred.length - 1], lastActive) : null;

      return `
        <tr>
          <td><strong>${iconFor(kom)} ${highlightQuery(kom, search)}</strong></td>
          <td>${rp(ns[0])}</td>
          <td><strong>${rp(last(ns))}</strong></td>
          <td>${ds ? rp(last(ds)) : '—'}</td>
          <td class="${changeClass(diff)}">${diff === null ? '—' : changeLabel(diff)}</td>
          <td class="${changeClass(predPct0)}">${rp(pred[0])}</td>
          <td class="${changeClass(predPctFinal)}">${rp(pred[pred.length - 1])}</td>
          <td style="white-space:nowrap">${buildSparkline(ns.slice(-12), changeClass(tr))}<span class="badge badge-${changeClass(tr)}" style="display:inline-block;vertical-align:middle;margin-left:4px">${changeLabel(tr)}</span></td>
        </tr>`;
    });
  tbody.innerHTML = rows.join('') || `<tr><td colspan="8" class="tbl-loading">Tidak ditemukan</td></tr>`;
}

/* Ekspor Data Tabel ke File CSV */
function exportTableToCSV() {
  const daerah = document.getElementById('tbl-daerah')?.value || state.daerah;
  const search = (document.getElementById('tbl-search')?.value || '').toLowerCase();
  const nasionalLabel = PANGAN_DATA.nasional_label || 'Nasional';

  const commodities = PANGAN_DATA.komoditas_list.filter(kom => !search || kom.toLowerCase().includes(search));
  if (!commodities.length) {
    showToast('Tidak ada data komoditas untuk diekspor', 'warn');
    return;
  }

  const pLabel = periodLabel();
  const headers = [
    'Komoditas',
    'Nasional Awal (Rp)',
    'Nasional Terakhir (Rp)',
    `Daerah Terakhir (${daerah}) (Rp)`,
    `Selisih vs Nasional (%)`,
    'Prediksi Bulan ke-1 (Rp)',
    `Prediksi Akhir (${pLabel}) (Rp)`,
    'Tren Nasional (%)'
  ];

  const rows = [headers];

  commodities.forEach(kom => {
    const ns = PANGAN_DATA.nasional[kom];
    const ds = PANGAN_DATA.daerah[daerah]?.[kom];
    const hasDaerahData = ds && ds.length > 0;
    const activeSeries = hasDaerahData ? ds : ns;
    const activeWilayah = hasDaerahData ? daerah : nasionalLabel;

    const pred = lightGBMForecast(activeSeries, state.periods, activeWilayah, kom);
    const tr = pct(last(ns), ns[0]);
    const diff = ds ? pct(last(ds), last(ns)) : null;

    const nasAwal = ns && ns[0] !== undefined ? ns[0] : '';
    const nasAkhir = ns ? (last(ns) !== null ? last(ns) : '') : '';
    const daerahAkhir = ds ? (last(ds) !== null ? last(ds) : '') : '';
    const selisihPct = diff !== null ? diff.toFixed(2) + '%' : '';
    const pred1 = pred[0] !== null ? Math.round(pred[0]) : '';
    const predEnd = pred[pred.length - 1] !== null ? Math.round(pred[pred.length - 1]) : '';
    const trenPct = tr !== null ? tr.toFixed(2) + '%' : '';

    rows.push([
      `"${kom.replace(/"/g, '""')}"`,
      nasAwal,
      nasAkhir,
      daerahAkhir,
      selisihPct,
      pred1,
      predEnd,
      trenPct
    ]);
  });

  const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  
  a.href = url;
  a.download = `PanganTrack_${daerah.replace(/\s+/g, '_')}_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Tabel berhasil diekspor (${commodities.length} komoditas)`, 'success');
}

/* Ekspor Grafik SVG ke Format Gambar PNG Resolusi Tinggi */
function exportChartToPNG(svgId, filenamePrefix = 'Grafik_PanganTrack') {
  const svg = document.getElementById(svgId);
  if (!svg) {
    showToast('Elemen grafik tidak ditemukan', 'warn');
    return;
  }

  try {
    const svgClone = svg.cloneNode(true);
    const bbox = svg.getBoundingClientRect();
    const width = bbox.width > 0 ? bbox.width : 640;
    const height = bbox.height > 0 ? bbox.height : 260;

    svgClone.setAttribute('width', width);
    svgClone.setAttribute('height', height);

    // Sematkan font inline agar teks grafik terbaca sempurna
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      text { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 500; }
    `;
    svgClone.prepend(styleEl);

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgClone);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = 2; // Resolusi 2x retina crisp
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');

      // Latar belakang putih bersih
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render gambar dari SVG
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(blobUrl);

      canvas.toBlob((blob) => {
        if (!blob) {
          showToast('Gagal memproses gambar grafik', 'warn');
          return;
        }
        const a = document.createElement('a');
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        const komoditasName = (state.komoditas || 'Komoditas').replace(/\s+/g, '_');
        a.href = URL.createObjectURL(blob);
        a.download = `${filenamePrefix}_${komoditasName}_${dateStr}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        showToast('Grafik berhasil disimpan sebagai gambar PNG!', 'success');
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      showToast('Gagal memuat visualisasi untuk disimpan', 'warn');
    };
    img.src = blobUrl;
  } catch (err) {
    console.error('Error exportChartToPNG:', err);
    showToast('Terjadi kesalahan saat menyimpan grafik', 'warn');
  }
}



function buildSparkline(series, cls) {
  const mn = Math.min(...series), mx = Math.max(...series);
  const color = cls === 'up' ? '#1D9E75' : cls === 'down' ? '#E24B4A' : '#EF9F27';
  const barW = 4, gap = 2, startX = 2;
  const bars = series.map((v, i) => {
    const h = mx === mn ? 10 : Math.round(((v - mn) / (mx - mn)) * 14 + 4);
    return `<rect x="${startX + i*(barW+gap)}" y="${20-h}" width="${barW}" height="${h}" rx="1" fill="${color}" opacity="0.75"/>`;
  }).join('');
  const svgW = startX + series.length * (barW + gap) - gap + 2;
  return `<svg width="${svgW}" height="20" style="display:inline-block;vertical-align:middle">${bars}</svg>`;
}
