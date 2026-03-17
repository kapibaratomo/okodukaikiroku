// State management
let transactions = [];

// DOM Elements
const totalBalanceEl = document.getElementById('totalBalance');
const pasmoBalanceEl = document.getElementById('pasmoBalance');
const cashBalanceEl = document.getElementById('cashBalance');
const form = document.getElementById('transactionForm');
const historyList = document.getElementById('historyList');
const filterBtns = document.querySelectorAll('.filter-btn');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');

// Initialize
function init() {
    loadData();
    updateUI('all');
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

// Load data from localStorage
function loadData() {
    const saved = localStorage.getItem('okodukai_data');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            transactions = data.transactions || [];
        } catch (e) {
            console.error('Failed to load data', e);
            transactions = [];
        }
    }
}

// Save data to localStorage
function saveData() {
    localStorage.setItem('okodukai_data', JSON.stringify({
        updatedAt: Date.now(),
        transactions
    }));
}

// Add transaction
form.addEventListener('submit', (e) => {
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
    saveData();
    
    // Reset form
    document.getElementById('amount').value = '';
    document.getElementById('memo').value = '';
    
    updateUI(document.querySelector('.filter-btn.active').dataset.filter);
});

// Delete transaction
function deleteTransaction(id) {
    if (confirm('この記録を削除しますか？')) {
        transactions = transactions.filter(t => t.id !== id);
        saveData();
        updateUI(document.querySelector('.filter-btn.active').dataset.filter);
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

// Export data
exportBtn.addEventListener('click', () => {
    const dataStr = JSON.stringify({ transactions }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `okodukai_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Import data
importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data && Array.isArray(data.transactions)) {
                if (confirm('インポートすると現在のデータと結合されます。よろしいですか？')) {
                    // Merge and sort by newest
                    const existingIds = new Set(transactions.map(t => t.id));
                    const newTransactions = data.transactions.filter(t => !existingIds.has(t.id));
                    
                    transactions = [...transactions, ...newTransactions]
                        .sort((a, b) => b.createdAt - a.createdAt);
                    
                    saveData();
                    updateUI(document.querySelector('.filter-btn.active').dataset.filter);
                    alert(`${newTransactions.length}件の履歴をインポートしました！`);
                }
            } else {
                alert('無効なファイル形式です。');
            }
        } catch (err) {
            alert('ファイルの読み込みに失敗しました。');
            console.error(err);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset
});

// Start app
init();
