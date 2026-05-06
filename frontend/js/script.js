/* ================================================
   PanganTrack — script.js
   Revisi terbaru:
   - Model utama: LightGBM
   - Insight otomatis AI-style
   - Grafik tren nasional + daerah
   - Tooltip hover, toggle layer, highlight selisih
   Data dibaca dari data.js
   ================================================ */

const API_CONFIG = {
  USE_MOCK: true,
  BASE_URL: 'http://127.0.0.1:8000',
  ENDPOINTS: {
    predict: '/api/predict-lightgbm/',
    nasional: '/api/nasional/',
    daerah: '/api/daerah/'
  }
};

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

/* LightGBM demo forecast:
   Di frontend ini prediksi dibuat dari pola tren + musiman agar dashboard tetap bisa berjalan offline.
   Saat backend Django aktif, ganti dengan response model LightGBM asli dari endpoint /api/predict-lightgbm/.
*/
function lightGBMForecast(series, periods = 6) {
  const clean = series.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (clean.length < 3) return Array(periods).fill(last(clean) || 0);

  const tail = clean.slice(-12);
  const recent = clean.slice(-6);
  const prev = clean.slice(-12, -6);
  const lastVal = last(clean);
  const avgRecent = avg(recent);
  const avgPrev = prev.length ? avg(prev) : avgRecent;
  const trend = (avgRecent - avgPrev) / 6;

  const preds = [];
  for (let i = 1; i <= periods; i++) {
    const seasonalBase = tail[(tail.length - periods + i - 1 + tail.length) % tail.length] || avgRecent;
    const seasonalEffect = (seasonalBase - avgRecent) * 0.18;
    const momentum = trend * i * 0.85;
    const smooth = lastVal * 0.72 + (lastVal + momentum + seasonalEffect) * 0.28;
    preds.push(Math.max(0, Math.round(smooth)));
  }
  return preds;
}

document.addEventListener('DOMContentLoaded', () => {
  initSelects();
  loadHero();
  loadStats();
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
  document.getElementById('hero-daerah').textContent = PANGAN_DATA.areas.length;
  document.getElementById('hero-komoditas').textContent = PANGAN_DATA.komoditas_list.length;
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
  onParamChange();
  gotoSection('prediksi');
}

function loadStats() {
  let naik = 0, turun = 0;
  PANGAN_DATA.komoditas_list.forEach(kom => {
    const s = PANGAN_DATA.nasional[kom];
    const c = pct(last(s), s[0]);
    if (c >= 0) naik++; else turun++;
  });
  document.getElementById('stat-naik').textContent = naik;
  document.getElementById('stat-turun').textContent = turun;
  document.getElementById('stat-daerah').textContent = PANGAN_DATA.areas.length;
}

function onParamChange() {
  state.komoditas = document.getElementById('sel-komoditas').value;
  state.daerah = document.getElementById('sel-daerah').value;
  state.periods = Number(document.getElementById('sel-period')?.value || state.periods || 6);
  document.getElementById('sel-kom-daerah').value = state.komoditas;
  document.getElementById('tbl-daerah').value = state.daerah;
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

  const btn = document.getElementById('btn-run');
  const txt = document.getElementById('run-txt');
  const spn = document.getElementById('run-spin');
  btn.disabled = true;
  txt.textContent = 'Memproses...';
  spn.classList.remove('hidden');

  try {
    await new Promise(r => setTimeout(r, 250));
    updateSummaryCards(kom, daerah);
    updateAutoInsight(kom, daerah);
    renderTrendChart(kom, daerah);
    renderDaerahCompareChart(kom, daerah);
    renderTable();
  } finally {
    btn.disabled = false;
    txt.textContent = 'Jalankan Prediksi';
    spn.classList.add('hidden');
  }
}

function updateSummaryCards(kom, daerah) {
  const nas = PANGAN_DATA.nasional[kom];
  const ds = PANGAN_DATA.daerah[daerah]?.[kom];
  const pred = lightGBMForecast(nas, state.periods);
  const lastNas = last(nas);
  const lastDaerah = ds ? last(ds) : null;
  const trendNas = pct(lastNas, nas[0]);
  const diffDaerah = ds ? pct(lastDaerah, lastNas) : null;
  const predFinal = pred[pred.length - 1];
  const predChange = pct(predFinal, lastNas);
  const lastLabel = labelPretty(PANGAN_DATA.labels[PANGAN_DATA.labels.length - 1]);

  document.getElementById('sc-nas-now').textContent = rp(lastNas);
  document.getElementById('sc-nas-trend').innerHTML = `<span class="${changeClass(trendNas)}">${changeLabel(trendNas)}</span> dari awal data`;
  document.getElementById('sc-nas-date').textContent = lastLabel;

  document.getElementById('sc-daerah-tag').textContent = `${daerah} · ${lastLabel}`;
  document.getElementById('sc-daerah-price').textContent = rp(lastDaerah);
  document.getElementById('sc-daerah-vs').innerHTML = ds
    ? `<span class="${changeClass(diffDaerah)}">${changeLabel(diffDaerah)}</span> vs nasional`
    : 'Data daerah tidak tersedia';

  document.getElementById('sc-pred-price').textContent = rp(predFinal);
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
  const predNas = lightGBMForecast(nas, state.periods);
  const predDaerah = ds ? lightGBMForecast(ds, state.periods) : [];
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
  const predNas = lightGBMForecast(histNas, state.periods);
  const predDaerah = histDaerah.length ? lightGBMForecast(histDaerah, state.periods) : [];
  const labels = PANGAN_DATA.labels;
  document.getElementById('load-nas').style.display = 'none';

  const W = 640, H = 260, P = { t: 24, r: 20, b: 38, l: 68 };
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
  let xLabels = '';
  for (let i = 0; i < total; i += labelStep) {
    const lbl = i < histNas.length ? labelPretty(labels[i]) : futureLabels()[i - histNas.length];
    xLabels += `<text x="${sx(i).toFixed(1)}" y="${H - 8}" font-size="9" fill="#bbb" text-anchor="middle">${lbl || ''}</text>`;
  }

  const histNasPts = histNas.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const histDaerahPts = histDaerah.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const predNasFull = [last(histNas), ...predNas];
  const predDaerahFull = histDaerah.length ? [last(histDaerah), ...predDaerah] : [];
  const predNasPts = predNasFull.map((v, i) => `${sx(histNas.length - 1 + i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const predDaerahPts = predDaerahFull.map((v, i) => `${sx(histDaerah.length - 1 + i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

  const areaNas = `M${sx(0).toFixed(1)},${P.t + CH} ${histNas.map((v, i) => `L${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')} L${sx(histNas.length - 1).toFixed(1)},${P.t + CH} Z`;
  const areaPred = `M${sx(histNas.length - 1).toFixed(1)},${P.t + CH} ${predNasFull.map((v, i) => `L${sx(histNas.length - 1 + i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')} L${sx(total - 1).toFixed(1)},${P.t + CH} Z`;

  let selisihArea = '';
  if (histDaerah.length && state.trendLayers.selisih) {
    const n = Math.min(histNas.length, histDaerah.length);
    const upper = [];
    const lower = [];
    for (let i = 0; i < n; i++) {
      const yN = sy(histNas[i]);
      const yD = sy(histDaerah[i]);
      upper.push(`${sx(i).toFixed(1)},${Math.min(yN, yD).toFixed(1)}`);
      lower.unshift(`${sx(i).toFixed(1)},${Math.max(yN, yD).toFixed(1)}`);
    }
    selisihArea = `<polygon points="${upper.concat(lower).join(' ')}" fill="#8E5CF7" opacity="0.10"/>`;
  }

  const divX = sx(histNas.length - 1).toFixed(1);
  let dots = '';
  const dStep = Math.max(1, Math.floor(histNas.length / 12));
  for (let i = 0; i < histNas.length; i += dStep) {
    const label = labelPretty(labels[i]);
    if (state.trendLayers.nasional) {
      dots += `<circle class="hover-dot" cx="${sx(i).toFixed(1)}" cy="${sy(histNas[i]).toFixed(1)}" r="5" fill="#1D9E75" opacity="0.0" onmousemove="showTooltip(event, '<strong>${safeText(kom)}</strong><br>Nasional · ${label}<br>${rp(histNas[i])}')" onmouseleave="hideTooltip()"/>`;
    }
    if (histDaerah[i] && state.trendLayers.daerah) {
      const diff = pct(histDaerah[i], histNas[i]);
      dots += `<circle class="hover-dot" cx="${sx(i).toFixed(1)}" cy="${sy(histDaerah[i]).toFixed(1)}" r="5" fill="#378ADD" opacity="0.0" onmousemove="showTooltip(event, '<strong>${safeText(kom)}</strong><br>${safeText(daerah)} · ${label}<br>${rp(histDaerah[i])}<br>Selisih: ${changeLabel(diff)}')" onmouseleave="hideTooltip()"/>`;
    }
  }
  predNas.forEach((v, i) => {
    if (!state.trendLayers.prediksi) return;
    const label = futureLabels()[i];
    dots += `<circle class="hover-dot" cx="${sx(histNas.length + i).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="5" fill="#EF9F27" opacity="0.0" onmousemove="showTooltip(event, '<strong>Prediksi LightGBM</strong><br>Nasional · ${label}<br>${rp(v)}')" onmouseleave="hideTooltip()"/>`;
  });
  predDaerah.forEach((v, i) => {
    if (!state.trendLayers.prediksi || !state.trendLayers.daerah) return;
    const label = futureLabels()[i];
    dots += `<circle class="hover-dot" cx="${sx(histDaerah.length + i).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="5" fill="#7C9CFF" opacity="0.0" onmousemove="showTooltip(event, '<strong>Prediksi LightGBM</strong><br>${safeText(daerah)} · ${label}<br>${rp(v)}')" onmouseleave="hideTooltip()"/>`;
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
    ${state.trendLayers.nasional ? `<polyline points="${histNasPts}" fill="none" stroke="#1D9E75" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${state.trendLayers.daerah && histDaerah.length ? `<polyline points="${histDaerahPts}" fill="none" stroke="#378ADD" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${state.trendLayers.prediksi && state.trendLayers.nasional ? `<polyline points="${predNasPts}" fill="none" stroke="#EF9F27" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7,3"/>` : ''}
    ${state.trendLayers.prediksi && state.trendLayers.daerah && predDaerahPts ? `<polyline points="${predDaerahPts}" fill="none" stroke="#7C9CFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5,3"/>` : ''}
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
  const all = [...nas12, ...ds12];
  const mn = Math.min(...all) * 0.98, mx = Math.max(...all) * 1.02;
  const sx = i => P.l + (i / (n - 1)) * CW;
  const sy = v => P.t + CH - ((v - mn) / (mx - mn)) * CH;

  let yGrid = '';
  for (let s = 0; s <= 4; s++) {
    const v = mn + (mx - mn) * (s / 4), y = sy(v);
    yGrid += `<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}" stroke="#f0f0ec"/>`;
    yGrid += `<text x="${P.l - 5}" y="${y.toFixed(1)}" font-size="9" fill="#bbb" text-anchor="end" dominant-baseline="middle">${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)}</text>`;
  }
  const nasPts = nas12.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const dsPts = ds12.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  let xLabels = '';
  [0, Math.floor((n - 1) / 2), n - 1].forEach(i => {
    xLabels += `<text x="${sx(i).toFixed(1)}" y="${H - 8}" font-size="9" fill="#888" text-anchor="middle">${labelPretty(labels[i])}</text>`;
  });

  let hit = '';
  for (let i = 0; i < n; i++) {
    const diff = pct(ds12[i], nas12[i]);
    hit += `<circle class="hover-dot" cx="${sx(i).toFixed(1)}" cy="${sy(ds12[i]).toFixed(1)}" r="6" fill="#378ADD" opacity="0" onmousemove="showTooltip(event, '<strong>${safeText(daerah)}</strong><br>${safeText(kom)} · ${labelPretty(labels[i])}<br>Daerah: ${rp(ds12[i])}<br>Nasional: ${rp(nas12[i])}<br>Selisih: ${changeLabel(diff)}')" onmouseleave="hideTooltip()"/>`;
  }

  document.getElementById('svg-daerah-compare').innerHTML = `
    ${yGrid}
    <polyline points="${nasPts}" fill="none" stroke="#D85A30" stroke-width="2" stroke-linecap="round"/>
    <polyline points="${dsPts}" fill="none" stroke="#378ADD" stroke-width="2" stroke-linecap="round"/>
    <circle cx="${sx(n - 1).toFixed(1)}" cy="${sy(last(nas12)).toFixed(1)}" r="3" fill="#D85A30"/>
    <circle cx="${sx(n - 1).toFixed(1)}" cy="${sy(last(ds12)).toFixed(1)}" r="3" fill="#378ADD"/>
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

function renderTable() {
  const daerah = document.getElementById('tbl-daerah')?.value || state.daerah;
  const predFinalHead = document.getElementById('th-pred-final');
  if (predFinalHead) predFinalHead.textContent = `Pred. ${periodLabel()}`;
  const tableSub = document.getElementById('table-subtitle');
  if (tableSub) tableSub.textContent = `Data nasional terbaru, prediksi ${periodLabel()}, dan selisih harga daerah pilihan terhadap nasional.`;
  const search = (document.getElementById('tbl-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('tbl-body');

  const rows = PANGAN_DATA.komoditas_list
    .filter(kom => !search || kom.toLowerCase().includes(search))
    .map(kom => {
      const ns = PANGAN_DATA.nasional[kom];
      const ds = PANGAN_DATA.daerah[daerah]?.[kom];
      const pred = lightGBMForecast(ns, state.periods);
      const tr = pct(last(ns), ns[0]);
      const diff = ds ? pct(last(ds), last(ns)) : null;
      const spark = buildSparkline(ns.slice(-12), changeClass(tr));
      return `
        <tr>
          <td><strong>${iconFor(kom)} ${safeText(kom)}</strong></td>
          <td>${rp(ns[0])}</td>
          <td><strong>${rp(last(ns))}</strong></td>
          <td>${ds ? rp(last(ds)) : '—'}</td>
          <td class="${changeClass(diff)}">${diff === null ? '—' : changeLabel(diff)}</td>
          <td class="${changeClass(pct(pred[0], last(ns)))}">${rp(pred[0])}</td>
          <td class="${changeClass(pct(pred[pred.length - 1], last(ns)))}">${rp(pred[pred.length - 1])}</td>
          <td>${spark}<span class="badge badge-${changeClass(tr)}" style="margin-left:6px">${changeLabel(tr)}</span></td>
        </tr>`;
    });
  tbody.innerHTML = rows.join('') || `<tr><td colspan="8" class="tbl-loading">Tidak ditemukan</td></tr>`;
}

function buildSparkline(series, cls) {
  const mn = Math.min(...series), mx = Math.max(...series);
  const color = cls === 'up' ? '#1D9E75' : cls === 'down' ? '#E24B4A' : '#EF9F27';
  const bars = series.map(v => {
    const h = mx === mn ? 50 : Math.round(((v - mn) / (mx - mn)) * 14 + 4);
    return `<div class="spark-bar" style="height:${h}px;background:${color};opacity:0.7"></div>`;
  }).join('');
  return `<span class="sparkline">${bars}</span>`;
}

/*
  Integrasi backend LightGBM:
  1. Latih model LightGBM di Django/Python.
  2. Buat endpoint: GET /api/predict-lightgbm/?komoditas=Beras&periods=1|3|6|12&daerah=Jawa%20Timur
  3. Return JSON: { "predictions_nasional": [..], "predictions_daerah": [..], "labels": [..] }
  4. Set API_CONFIG.USE_MOCK = false dan pakai response backend di runPrediction().
*/
