/* =========================
   配置與狀態
========================= */
const CONFIG = {
  CLIENT_ID: "562713250943-6ajkqf7jjck39d461phec23eo0setbe3.apps.googleusercontent.com",
  SPREADSHEET_ID: "1XEwbx44Z7hCzgqP1jdep20O6rGrbC7cRGBv2MikNKiI",
  SHEET_RECORDS: "記帳紀錄",
  SHEET_FIELDS: "欄位表",
  SCOPES: "https://www.googleapis.com/auth/spreadsheets"
};

let accessToken = "";
let tokenClient = null;
let gisReady = false;

// 圖表實例儲存
let catChart = null; 
let dailyChart = null;

let fieldOptions = { typeToCategories: {}, typeToPayments: {} };
let currentMonth = "";
let records = [];

const $ = (sel) => document.querySelector(sel);

/* =========================
   初始化
========================= */
initDefaults();
bindEvents();

window.onGisLoaded = function() {
  gisReady = true;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (resp) => {
      if (resp.access_token) {
        accessToken = resp.access_token;
        afterSignedIn();
      }
    }
  });
  $("#btnSignIn").disabled = false;
  setStatus("已就緒，請登入", false);
};

function initDefaults() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  $("#fDate").value = `${yyyy}-${mm}-${dd}`;
  currentMonth = `${yyyy}-${mm}`;
  $("#monthPicker").value = currentMonth;
}

function bindEvents() {
  $("#btnSignIn").addEventListener("click", () => tokenClient.requestAccessToken({ prompt: "consent" }));
  $("#btnSignOut").addEventListener("click", resetAll);
  $("#fType").addEventListener("change", () => applySelectOptionsForType($("#fType").value));
  $("#monthPicker").addEventListener("change", (e) => { currentMonth = e.target.value; reloadMonth(); });
  $("#btnReload").addEventListener("click", reloadMonth);
  $("#btnRefresh").addEventListener("click", reloadMonth);
  $("#recordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitRecord();
  });
}

/* =========================
   資料核心邏輯
========================= */
async function afterSignedIn() {
  setUiEnabled(true);
  await loadFieldTable();
  applySelectOptionsForType($("#fType").value);
  await reloadMonth();
}

async function reloadMonth() {
  try {
    setStatus("讀取中...", false);
    const res = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG.SHEET_RECORDS + "!A:G")}`);
    const rows = res.values || [];
    
    records = rows.slice(1).map(r => ({
      Date: (r[1] || "").trim(),
      Type: (r[2] || "").trim(),
      Category: (r[3] || "").trim(),
      Amount: Number(r[4] || 0)
    })).filter(r => r.Date.startsWith(currentMonth));

    renderSummary(records);
    renderBreakdown(records);
    renderCategoryChart(records);
    renderDailyBarChart(records); // 渲染新的長條圖

    setStatus(`本月已載入 ${records.length} 筆資料`, false);
  } catch (err) {
    setStatus("讀取失敗", true);
  }
}

async function submitRecord() {
  const row = [Date.now(), $("#fDate").value, $("#fType").value, $("#fCategory").value, Number($("#fAmount").value), $("#fDescription").value.trim(), $("#fPayment").value];
  try {
    setStatus("儲存中...", false);
    await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG.SHEET_RECORDS + "!A:G")}:append?valueInputOption=USER_ENTERED`, {
      method: "POST",
      body: JSON.stringify({ values: [row] })
    });
    $("#fAmount").value = "";
    $("#fDescription").value = "";
    await reloadMonth();
  } catch (err) {
    setStatus("儲存失敗", true);
  }
}

/* =========================
   圖表與渲染
========================= */

// 1. 本月每日趨勢長條圖 (取代原本的明細表格)
function renderDailyBarChart(items) {
  const ctx = document.getElementById('dailyBarChart').getContext('2d');
  
  // 按日期彙整資料
  const dailyMap = {};
  items.forEach(r => {
    if (!dailyMap[r.Date]) dailyMap[r.Date] = { 收入: 0, 支出: 0 };
    dailyMap[r.Date][r.Type] += r.Amount;
  });

  // 排序日期
  const sortedDates = Object.keys(dailyMap).sort();
  const incomeData = sortedDates.map(d => dailyMap[d].收入);
  const expenseData = sortedDates.map(d => dailyMap[d].支出);

  if (dailyChart) dailyChart.destroy();

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedDates.map(d => d.split('-')[2] + '日'), // 僅顯示日
      datasets: [
        {
          label: '支出',
          data: expenseData,
          backgroundColor: '#ff5d5d',
          borderRadius: 5,
        },
        {
          label: '收入',
          data: incomeData,
          backgroundColor: '#3dd598',
          borderRadius: 5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: false, grid: { display: false }, ticks: { color: '#a9b6d3' } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a9b6d3' } }
      },
      plugins: {
        legend: { labels: { color: '#e8eefc' } },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: $${context.parsed.y.toLocaleString()}`
          }
        }
      }
    }
  });
}

// 2. 分類圓餅圖
function renderCategoryChart(items) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  const cats = {};
  items.filter(r => r.Type === "支出").forEach(r => {
    cats[r.Category] = (cats[r.Category] || 0) + r.Amount;
  });

  if (catChart) catChart.destroy();
  if (Object.keys(cats).length === 0) return;

  catChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(cats),
      datasets: [{
        data: Object.values(cats),
        backgroundColor: ['#4f7cff', '#ff5d5d', '#3dd598', '#ffc542', '#a461ff'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#a9b6d3' } } }
    }
  });
}

function renderSummary(items) {
  let inc = 0, exp = 0;
  items.forEach(r => r.Type === "收入" ? inc += r.Amount : exp += r.Amount);
  $("#sumIncome").textContent = inc.toLocaleString();
  $("#sumExpense").textContent = exp.toLocaleString();
  $("#sumNet").textContent = (inc - exp).toLocaleString();
}

function renderBreakdown(items) {
  const map = new Map();
  let total = 0;
  items.filter(r => r.Type === "支出").forEach(r => {
    total += r.Amount;
    map.set(r.Category, (map.get(r.Category) || 0) + r.Amount);
  });
  const list = Array.from(map.entries()).sort((a,b) => b[1]-a[1]);
  $("#categoryBreakdown").innerHTML = list.map(([cat, amt]) => `
    <div class="barRow">
      <div>${cat}</div>
      <div class="bar"><div style="width:${total > 0 ? (amt/total*100) : 0}%"></div></div>
      <div class="right">$${amt.toLocaleString()}</div>
    </div>
  `).join("");
}

/* =========================
   其他工具
========================= */
async function apiFetch(url, opt = {}) {
  const headers = new Headers(opt.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...opt, headers });
  return res.json();
}

async function loadFieldTable() {
  const res = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG.SHEET_FIELDS + "!A:C")}`);
  const rows = res.values || [];
  const types = ["支出", "收入"];
  const typeToCategories = { 支出: new Set(), 收入: new Set() };
  const typeToPayments = { 支出: new Set(), 收入: new Set() };
  rows.slice(1).forEach(r => {
    const [t, c, p] = r.map(v => (v || "").trim());
    const targets = types.includes(t) ? [t] : types;
    if (c) targets.forEach(tt => typeToCategories[tt].add(c));
    if (p) targets.forEach(tt => typeToPayments[tt].add(p));
  });
  fieldOptions = { typeToCategories, typeToPayments };
}

function applySelectOptionsForType(type) {
  const cats = Array.from(fieldOptions.typeToCategories[type] || []);
  const pays = Array.from(fieldOptions.typeToPayments[type] || []);
  $("#fCategory").innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join("");
  $("#fPayment").innerHTML = pays.map(p => `<option value="${p}">${p}</option>`).join("");
}

function setUiEnabled(enabled) {
  const btns = ["#btnSignOut", "#btnReload", "#btnRefresh", "#btnSubmit", "#monthPicker"];
  btns.forEach(s => $(s).disabled = !enabled);
}

function resetAll() {
  accessToken = "";
  if (catChart) catChart.destroy();
  if (dailyChart) dailyChart.destroy();
  setUiEnabled(false);
  setStatus("已登出", false);
}

function setStatus(msg, err) {
  $("#status").textContent = msg;
  $("#status").style.color = err ? "var(--danger)" : "var(--muted)";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"}[m]));
}