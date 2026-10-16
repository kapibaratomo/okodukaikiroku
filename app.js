// State management
let transactions = [];
let githubSha = null; // To keep track of the file SHA for updates
let githubToken = localStorage.getItem('okodukai_github_token') || '';

// DOM Elements
const pasmoBalanceEl = document.getElementById('pasmoBalance');
const cashBalanceEl = document.getElementById('cashBalance');
const form = document.getElementById('transactionForm');
const historyList = document.getElementById('historyList');
const filterBtns = document.querySelectorAll('.filter-btn');
const dateInput = document.getElementById('transactionDate');

// New DOM Elements for GitHub Sync
const settingsBtn = document.getElementById('settingsBtn');
const settingsSection = document.getElementById('settingsSection');
const tokenInput = document.getElementById('githubToken');
const saveTokenBtn = document.getElementById('saveTokenBtn');
const syncStatus = document.getElementById('syncStatus');
const loadingOverlay = document.getElementById('loadingOverlay');

// New PDF Export DOM Elements
const reportMonthEl = document.getElementById('reportMonth');
const reportTypeEl = document.getElementById('reportType');
const printBtn = document.getElementById('printBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const printArea = document.getElementById('printArea');

// Analytics & Chart Elements
const chartTabCategory = document.getElementById('chartTabCategory');
const chartTabMonthly = document.getElementById('chartTabMonthly');
const chartPeriodSelect = document.getElementById('chartPeriodSelect');
const analyticsChartEl = document.getElementById('analyticsChart');
const chartSummaryEl = document.getElementById('chartSummary');
let analyticsChart = null;
let currentChartTab = 'category';
let currentChartPeriod = 'all';

// Helper: get today's date string (YYYY-MM-DD)
function getTodayStr() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

// Initialize
async function init() {
    dateInput.value = getTodayStr();

    // Set default report month (current YYYY-MM)
    const now = new Date();
    reportMonthEl.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    if (githubToken) {
        tokenInput.value = githubToken;
        await loadDataFromGitHub();
    } else {
        settingsSection.classList.remove('hidden');
        loadDataFromLocalFallback();
    }
    updateUI('all');
}

// Show loading
function showLoading(show) {
    if(show) loadingOverlay.classList.remove('hidden');
    else loadingOverlay.classList.add('hidden');
}

// Show sync status
function showSyncStatus(message, isError = false) {
    syncStatus.textContent = message;
    syncStatus.className = `sync-status text-sm mt-3 text-center ${isError ? 'text-error' : 'text-success'}`;
    setTimeout(() => { syncStatus.textContent = ''; }, 3000);
}

// Generate UUID for transactions
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
}

// Format date (date only, no time)
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
}

// GitHub API Helper
async function githubRequest(method, body = null) {
    if (!githubToken) throw new Error('Token is missing');
    
    const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.path}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${githubToken}`
    };
    
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    
    const res = await fetch(url, options);
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.message || 'API Error');
    return data;
}

// Load data from GitHub
async function loadDataFromGitHub() {
    showLoading(true);
    try {
        const data = await githubRequest('GET');
        githubSha = data.sha;
        
        const content = decodeURIComponent(escape(atob(data.content)));
        const parsed = JSON.parse(content);
        transactions = parsed.transactions || [];
        transactions.sort((a, b) => b.createdAt - a.createdAt);
        
        localStorage.setItem('okodukai_data_backup', JSON.stringify({ transactions }));
        
    } catch (e) {
        console.error('GitHub Load Error:', e);
        if (e.message.includes('Not Found')) {
            transactions = [];
        } else {
            showSyncStatus('同期に失敗しました（ローカルデータを使用します）', true);
            loadDataFromLocalFallback();
        }
    } finally {
        showLoading(false);
    }
}

// Save data to GitHub
async function saveDataToGitHub() {
    if (!githubToken) {
        alert('設定からGitHub Tokenを入力してください');
        settingsSection.classList.remove('hidden');
        return false;
    }
    
    showLoading(true);
    try {
        transactions.sort((a, b) => b.createdAt - a.createdAt);
        const contentStr = JSON.stringify({ transactions }, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(contentStr)));
        
        const body = {
            message: `Update transactions.json (${new Date().toLocaleString()})`,
            content: encodedContent,
            sha: githubSha
        };
        
        const data = await githubRequest('PUT', body);
        githubSha = data.content.sha;
        
        localStorage.setItem('okodukai_data_backup', JSON.stringify({ transactions }));
        return true;
        
    } catch (e) {
        console.error('GitHub Save Error:', e);
        showSyncStatus('保存に失敗しました: ' + e.message, true);
        return false;
    } finally {
        showLoading(false);
    }
}

// Fallback load
function loadDataFromLocalFallback() {
    const saved = localStorage.getItem('okodukai_data_backup');
    if (saved) {
        try {
            transactions = JSON.parse(saved).transactions || [];
            transactions.sort((a, b) => b.createdAt - a.createdAt);
        } catch (e) {
            transactions = [];
        }
    }
}

// Add transaction
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const type = document.querySelector('input[name="type"]:checked').value;
    const category = document.querySelector('input[name="category"]:checked').value;
    const amount = parseInt(document.getElementById('amount').value, 10);
    const memo = document.getElementById('memo').value;
    const dateVal = document.getElementById('transactionDate').value;

    if (!amount || !memo) return;

    const originalTransactions = [...transactions];
    let createdAt = Date.now();
    if (dateVal) {
        const [y, m, d] = dateVal.split('-');
        createdAt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 12, 0, 0).getTime();
    }

    const transaction = {
        id: generateId(),
        type,
        category,
        amount,
        memo,
        createdAt
    };

    transactions.unshift(transaction);
    
    const success = await saveDataToGitHub();
    if (success) {
        document.getElementById('amount').value = '';
        document.getElementById('memo').value = '';
        dateInput.value = getTodayStr();
        updateUI(document.querySelector('.filter-btn.active').dataset.filter);
    } else {
        transactions = originalTransactions;
        updateUI(document.querySelector('.filter-btn.active').dataset.filter);
    }
});

// Delete transaction
async function deleteTransaction(id) {
    if (confirm('この記録を削除しますか？')) {
        const index = transactions.findIndex(t => t.id === id);
        if (index === -1) return;
        
        const deleted = transactions[index];
        transactions.splice(index, 1);
        
        const success = await saveDataToGitHub();
        if (success) {
            updateUI(document.querySelector('.filter-btn.active').dataset.filter);
        } else {
            transactions.splice(index, 0, deleted);
        }
    }
}

// Edit transaction — show inline edit form
function editTransaction(id) {
    const index = transactions.findIndex(t => t.id === id);
    if (index === -1) return;
    const t = transactions[index];

    // Find the li element and replace its content with an edit form
    const items = historyList.querySelectorAll('.history-item');
    let targetLi = null;
    items.forEach(li => {
        if (li.dataset.id === id) targetLi = li;
    });
    if (!targetLi) return;

    // Build date string from timestamp
    const d = new Date(t.createdAt);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    targetLi.className = 'history-item editing';
    targetLi.innerHTML = `
        <div class="edit-form">
            <div class="edit-row">
                <select class="edit-type">
                    <option value="pasmo" ${t.type === 'pasmo' ? 'selected' : ''}>PASMO</option>
                    <option value="cash" ${t.type === 'cash' ? 'selected' : ''}>現金</option>
                </select>
                <select class="edit-category">
                    <option value="income" ${t.category === 'income' ? 'selected' : ''}>収入</option>
                    <option value="expense" ${t.category === 'expense' ? 'selected' : ''}>支出</option>
                </select>
            </div>
            <div class="edit-row">
                <input type="date" class="edit-date" value="${dateStr}">
                <input type="number" class="edit-amount" value="${t.amount}" min="1">
            </div>
            <div class="edit-row">
                <input type="text" class="edit-memo" value="${t.memo}">
            </div>
            <div class="edit-actions">
                <button class="btn-save-edit" onclick="saveEdit('${id}')">保存</button>
                <button class="btn-cancel-edit" onclick="cancelEdit()">キャンセル</button>
            </div>
        </div>
    `;
}

// Save edited transaction
async function saveEdit(id) {
    const index = transactions.findIndex(t => t.id === id);
    if (index === -1) return;

    const li = historyList.querySelector(`.history-item[data-id="${id}"]`);
    if (!li) return;

    const type = li.querySelector('.edit-type').value;
    const category = li.querySelector('.edit-category').value;
    const amount = parseInt(li.querySelector('.edit-amount').value, 10);
    const memo = li.querySelector('.edit-memo').value.trim();
    const dateVal = li.querySelector('.edit-date').value;

    if (!amount || !memo) {
        alert('金額とメモを入力してください');
        return;
    }

    const originalTransactions = [...transactions];

    // Update values
    transactions[index].type = type;
    transactions[index].category = category;
    transactions[index].amount = amount;
    transactions[index].memo = memo;
    if (dateVal) {
        const [y, m, d] = dateVal.split('-');
        transactions[index].createdAt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 12, 0, 0).getTime();
    }

    const success = await saveDataToGitHub();
    if (success) {
        updateUI(document.querySelector('.filter-btn.active').dataset.filter);
    } else {
        transactions = originalTransactions;
        updateUI(document.querySelector('.filter-btn.active').dataset.filter);
    }
}

// Cancel edit
function cancelEdit() {
    updateUI(document.querySelector('.filter-btn.active').dataset.filter);
}

// Calculate balances
function calculateBalances() {
    let pasmo = 0;
    let cash = 0;

    transactions.forEach(t => {
        const val = t.category === 'income' ? t.amount : -t.amount;
        if (t.type === 'pasmo') {
            pasmo += val;
        } else {
            cash += val;
        }
    });

    pasmoBalanceEl.textContent = formatCurrency(pasmo);
    cashBalanceEl.textContent = formatCurrency(cash);
}

// Render history
function renderHistory(filterType) {
    historyList.innerHTML = '';
    
    let filtered = transactions;
    if (filterType !== 'all') {
        filtered = transactions.filter(t => t.type === filterType);
    }
    
    if (filtered.length === 0) {
        historyList.innerHTML = '<li style="text-align:center; padding: 20px; color:#9ca3af; font-size:14px;">履歴がありません</li>';
        return;
    }

    filtered.forEach(t => {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.dataset.id = t.id;
        
        const isExp = t.category === 'expense';
        const sign = isExp ? '-' : '+';
        const amountClass = isExp ? 'amount-expense' : 'amount-income';
        const typeLabel = t.type === 'pasmo' ? 'PASMO' : '現金';
        
        li.innerHTML = `
            <div class="item-icon icon-${t.type}">
                ${t.type === 'pasmo' ? 'P' : 'C'}
            </div>
            <div class="item-details">
                <div class="item-memo">${t.memo}</div>
                <div class="item-date">${formatDate(t.createdAt)} • ${typeLabel}</div>
            </div>
            <div class="item-amount ${amountClass}">
                ${sign}${formatCurrency(t.amount)}
            </div>
            <button class="btn-edit" onclick="editTransaction('${t.id}')" title="編集">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-delete" onclick="deleteTransaction('${t.id}')" title="削除">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
        `;
        historyList.appendChild(li);
    });
}

// Filter buttons
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderHistory(btn.dataset.filter);
    });
});

// Update entire UI
function updateUI(filterType) {
    transactions.sort((a, b) => b.createdAt - a.createdAt);
    calculateBalances();
    renderHistory(filterType);
    renderCharts();
}

// =========================================================
// Category Classification & Chart.js Analytics
// =========================================================
const CATEGORY_COLORS = {
    '交通費': '#3b82f6',         // 青
    '駐輪場': '#06b6d4',         // シアン
    '娯楽・レジャー': '#8b5cf6', // 紫
    '飲食': '#f59e0b',           // オレンジ
    'サブスク': '#ec4899',       // ピンク
    'ロボット・工作': '#10b981', // 緑
    'その他': '#94a3b8'          // グレー
};

function classifyCategory(memo) {
    const m = (memo || '').toLowerCase();
    if (m.includes('~') || m.includes('～') || m.includes('駅') || m.includes('線')) return '交通費';
    if (m.includes('駐輪場') || m.includes('自転車')) return '駐輪場';
    if (m.includes('ボーリング') || m.includes('ボウリング') || m.includes('カラオケ') || m.includes('エアホッケー') || m.includes('ゴンドラ') || m.includes('映画') || m.includes('ゲーム')) return '娯楽・レジャー';
    if (m.includes('ポテト') || m.includes('クレープ') || m.includes('飲み物') || m.includes('ジュース') || m.includes('アイス') || m.includes('カフェ') || m.includes('ランチ') || m.includes('ご飯')) return '飲食';
    if (m.includes('ネトフリ') || m.includes('netflix') || m.includes('サブスク')) return 'サブスク';
    if (m.includes('秋月') || m.includes('千石') || m.includes('ケーブル') || m.includes('パーツ') || m.includes('基板') || m.includes('ロボ') || m.includes('センサー')) return 'ロボット・工作';
    return 'その他';
}

function renderCharts() {
    if (typeof Chart === 'undefined' || !analyticsChartEl) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let filteredTransactions = transactions;
    if (currentChartPeriod === 'month') {
        filteredTransactions = transactions.filter(t => {
            const d = new Date(t.createdAt);
            return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
        });
    }

    if (analyticsChart) {
        analyticsChart.destroy();
        analyticsChart = null;
    }

    if (currentChartTab === 'category') {
        renderCategoryChart(filteredTransactions);
    } else {
        renderMonthlyChart(filteredTransactions);
    }
}

function renderCategoryChart(data) {
    const expenseData = data.filter(t => t.category === 'expense');
    const categoryTotals = {};
    let totalExpense = 0;

    expenseData.forEach(t => {
        const cat = classifyCategory(t.memo);
        categoryTotals[cat] = (categoryTotals[cat] || 0) + t.amount;
        totalExpense += t.amount;
    });

    const categories = Object.keys(categoryTotals).sort((a, b) => categoryTotals[b] - categoryTotals[a]);
    const values = categories.map(c => categoryTotals[c]);
    const bgColors = categories.map(c => CATEGORY_COLORS[c] || '#94a3b8');

    if (values.length === 0) {
        chartSummaryEl.innerHTML = '<span style="color: #9ca3af;">支出データがありません</span>';
        const ctx = analyticsChartEl.getContext('2d');
        analyticsChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['支出なし'],
                datasets: [{ data: [1], backgroundColor: ['#e5e7eb'] }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    const ctx = analyticsChartEl.getContext('2d');
    analyticsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: values,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 12 }, padding: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const pct = totalExpense > 0 ? ((val / totalExpense) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${formatCurrency(val)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '62%'
        }
    });

    chartSummaryEl.innerHTML = categories.slice(0, 4).map(c => {
        const amt = categoryTotals[c];
        const pct = ((amt / totalExpense) * 100).toFixed(0);
        const color = CATEGORY_COLORS[c] || '#94a3b8';
        return `
            <div class="chart-chip">
                <span class="chart-chip-dot" style="background-color: ${color};"></span>
                <span>${c}</span>
                <strong>${formatCurrency(amt)}</strong>
                <span style="color: #6b7280; font-size: 11px;">(${pct}%)</span>
            </div>
        `;
    }).join('');
}

function renderMonthlyChart(data) {
    const monthlyMap = {};
    data.forEach(t => {
        const d = new Date(t.createdAt);
        const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyMap[key]) monthlyMap[key] = { income: 0, expense: 0 };
        if (t.category === 'income') monthlyMap[key].income += t.amount;
        else if (t.category === 'expense') monthlyMap[key].expense += t.amount;
    });

    const months = Object.keys(monthlyMap).sort();
    if (months.length === 0) {
        chartSummaryEl.innerHTML = '<span style="color: #9ca3af;">データがありません</span>';
        return;
    }

    const incomeValues = months.map(m => monthlyMap[m].income);
    const expenseValues = months.map(m => monthlyMap[m].expense);

    const ctx = analyticsChartEl.getContext('2d');
    analyticsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                {
                    label: '収入 (+)',
                    data: incomeValues,
                    backgroundColor: '#10b981',
                    borderRadius: 4
                },
                {
                    label: '支出 (-)',
                    data: expenseValues,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(val) {
                            return '¥' + val.toLocaleString();
                        }
                    }
                }
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`;
                        }
                    }
                }
            }
        }
    });

    chartSummaryEl.innerHTML = `
        <div style="font-size: 12px; color: #64748b; text-align: center; margin-top: 6px;">
            月ごとの収入（緑）と支出（赤）の比較推移です
        </div>
    `;
}

// Chart tab listeners
if (chartTabCategory && chartTabMonthly) {
    chartTabCategory.addEventListener('click', () => {
        chartTabCategory.classList.add('active');
        chartTabMonthly.classList.remove('active');
        currentChartTab = 'category';
        renderCharts();
    });
    chartTabMonthly.addEventListener('click', () => {
        chartTabMonthly.classList.add('active');
        chartTabCategory.classList.remove('active');
        currentChartTab = 'monthly';
        renderCharts();
    });
}

if (chartPeriodSelect) {
    chartPeriodSelect.addEventListener('change', (e) => {
        currentChartPeriod = e.target.value;
        renderCharts();
    });
}

// Settings Toggle
settingsBtn.addEventListener('click', () => {
    settingsSection.classList.toggle('hidden');
});

// Save Token and Sync
saveTokenBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
        showSyncStatus('Tokenを入力してください', true);
        return;
    }
    
    githubToken = token;
    localStorage.setItem('okodukai_github_token', token);
    
    await loadDataFromGitHub();
    updateUI(document.querySelector('.filter-btn.active').dataset.filter);
    showSyncStatus('同期が完了しました');
});

// =========================================================
// PDF Report Generation (iPhone & Desktop Compatible)
// =========================================================
function generateReportHTML(year, month, typeVal) {
    const targetTransactions = transactions.filter(t => {
        const d = new Date(t.createdAt);
        const y = String(d.getFullYear());
        const m = String(d.getMonth() + 1).padStart(2, '0');
        
        if (y !== year || m !== month) return false;
        if (typeVal !== 'all' && t.type !== typeVal) return false;
        
        return true;
    });
    
    const sortedForPrint = [...targetTransactions].sort((a, b) => a.createdAt - b.createdAt);
    
    let typeLabel = 'すべて';
    if (typeVal === 'pasmo') typeLabel = 'PASMO';
    if (typeVal === 'cash')  typeLabel = '現金';

    let totalIncome = 0;
    let totalExpense = 0;
    let tableRows = '';

    sortedForPrint.forEach(t => {
        const d = new Date(t.createdAt);
        const dateStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const isExp = t.category === 'expense';
        
        if (isExp) {
            totalExpense += t.amount;
        } else {
            totalIncome += t.amount;
        }

        const typeStr = t.type === 'pasmo' ? 'PASMO' : '現金';
        const sign = isExp ? '-' : '+';
        const colorStyle = isExp ? 'color: #ef4444;' : 'color: #10b981;';
        
        tableRows += `
            <tr>
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb;">${dateStr}</td>
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb;">${typeStr}</td>
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb;">${t.memo}</td>
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600; ${colorStyle}">${sign}${formatCurrency(t.amount)}</td>
            </tr>
        `;
    });
    
    if (sortedForPrint.length === 0) {
        tableRows = '<tr><td colspan="4" style="text-align: center; padding: 24px; border: 1px solid #e5e7eb; color: #9ca3af;">この条件の履歴はありません</td></tr>';
    }

    const balance = totalIncome - totalExpense;
    const balanceColor = balance >= 0 ? '#10b981' : '#ef4444';

    return `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #1f2937; background: #ffffff;">
            <div style="text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 16px;">
                <h1 style="margin: 0 0 6px 0; font-size: 22px; color: #1e3a8a;">お小遣い記録レポート</h1>
                <div style="font-size: 14px; color: #4b5563;">対象月: ${year}年${parseInt(month)}月 ｜ 決済方法: ${typeLabel}</div>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; font-size: 13px;">
                <div>収入合計: <strong style="color: #10b981;">+${formatCurrency(totalIncome)}</strong></div>
                <div>支出合計: <strong style="color: #ef4444;">-${formatCurrency(totalExpense)}</strong></div>
                <div>収支差引: <strong style="color: ${balanceColor};">${formatCurrency(balance)}</strong></div>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="background-color: #f1f5f9; text-align: left;">
                        <th style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600;">日時</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600;">方法</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600;">メモ</th>
                        <th style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600; text-align: right;">金額</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>

            <div style="margin-top: 20px; text-align: right; font-size: 11px; color: #94a3b8;">
                出力日時: ${new Date().toLocaleString('ja-JP')}
            </div>
        </div>
    `;
}

// Download PDF directly (Recommended for iPhone / Mobile)
if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', async () => {
        const monthStr = reportMonthEl.value;
        const typeVal = reportTypeEl.value;
        
        if (!monthStr) {
            alert('月を選択してください');
            return;
        }
        
        const [year, month] = monthStr.split('-');
        const reportContent = generateReportHTML(year, month, typeVal);

        // Create temporary visible container for high quality capture
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = reportContent;
        tempContainer.style.position = 'fixed';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '0';
        tempContainer.style.width = '700px';
        document.body.appendChild(tempContainer);

        showLoading(true);

        try {
            if (typeof html2pdf !== 'undefined') {
                const opt = {
                    margin:       [8, 8, 8, 8],
                    filename:     `お小遣いレポート_${year}年${parseInt(month)}月.pdf`,
                    image:        { type: 'jpeg', quality: 0.98 },
                    html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
                    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };

                await html2pdf().set(opt).from(tempContainer).save();
            } else {
                // Fallback to window.print() if html2pdf CDN is blocked
                printArea.innerHTML = reportContent;
                window.print();
            }
        } catch (err) {
            console.error('PDF生成エラー:', err);
            alert('PDFの作成に失敗しました: ' + err.message);
        } finally {
            if (document.body.contains(tempContainer)) {
                document.body.removeChild(tempContainer);
            }
            showLoading(false);
        }
    });
}

// Traditional Print dialog (AirPrint compatible)
printBtn.addEventListener('click', () => {
    const monthStr = reportMonthEl.value;
    const typeVal = reportTypeEl.value;
    
    if (!monthStr) {
        alert('月を選択してください');
        return;
    }
    
    const [year, month] = monthStr.split('-');
    printArea.innerHTML = generateReportHTML(year, month, typeVal);
    
    // Call print immediately without timeout for iOS Safari compatibility
    window.print();
});

// Start app
init();

