// State management
let transactions = [];
let githubSha = null; // To keep track of the file SHA for updates
let githubToken = localStorage.getItem('okodukai_github_token') || '';

// DOM Elements
const totalBalanceEl = document.getElementById('totalBalance');
const pasmoBalanceEl = document.getElementById('pasmoBalance');
const cashBalanceEl = document.getElementById('cashBalance');
const form = document.getElementById('transactionForm');
const historyList = document.getElementById('historyList');
const filterBtns = document.querySelectorAll('.filter-btn');

// New DOM Elements for GitHub Sync
const settingsBtn = document.getElementById('settingsBtn');
const settingsSection = document.getElementById('settingsSection');
const tokenInput = document.getElementById('githubToken');
const saveTokenBtn = document.getElementById('saveTokenBtn');
const syncStatus = document.getElementById('syncStatus');
const loadingOverlay = document.getElementById('loadingOverlay');

// Initialize
async function init() {
    if (githubToken) {
        tokenInput.value = githubToken;
        await loadDataFromGitHub();
    } else {
        // Tokenがない場合は設定画面を開く
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

// Format date
function formatDate(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
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
        
        // base64 decode (handles utf-8 properly)
        const content = decodeURIComponent(escape(atob(data.content)));
        const parsed = JSON.parse(content);
        transactions = parsed.transactions || [];
        
        // Backup to local
        localStorage.setItem('okodukai_data_backup', JSON.stringify({ transactions }));
        
    } catch (e) {
        console.error('GitHub Load Error:', e);
        if (e.message.includes('Not Found')) {
            // File doesn't exist yet, we will create it on first save
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
        const contentStr = JSON.stringify({ transactions }, null, 2);
        // base64 encode (handles utf-8 properly)
        const encodedContent = btoa(unescape(encodeURIComponent(contentStr)));
        
        const body = {
            message: `Update transactions.json (${new Date().toLocaleString()})`,
            content: encodedContent,
            sha: githubSha // required for updating existing files
        };
        
        const data = await githubRequest('PUT', body);
        githubSha = data.content.sha; // update SHA for next time
        
        // Backup
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

    if (!amount || !memo) return;

    const transaction = {
        id: generateId(),
        type,
        category,
        amount,
        memo,
        createdAt: Date.now()
    };

    transactions.unshift(transaction); // Add to beginning
    
    const success = await saveDataToGitHub();
    if (success) {
        // Reset form
        document.getElementById('amount').value = '';
        document.getElementById('memo').value = '';
        updateUI(document.querySelector('.filter-btn.active').dataset.filter);
    } else {
        // Rollback on fail
        transactions.shift();
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
            // Rollback
            transactions.splice(index, 0, deleted);
        }
    }
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

    totalBalanceEl.textContent = formatCurrency(pasmo + cash);
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
            <button class="btn-delete" onclick="deleteTransaction('${t.id}')">
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
    calculateBalances();
    renderHistory(filterType);
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

// Start app
init();
