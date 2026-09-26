/* allbalance.js — live multichain balance viewer for all connected wallets */

let balanceScanInterval = null;
let balanceScanRunning = false;

function scanConcurrency() {
    const n = (state.accounts || []).length;
    if (n > 200) return 2;
    if (n > 100) return 3;
    if (n > 40) return 5;
    if (n > 20) return 8;
    return CONSTANTS.SCAN_CONCURRENCY;
}

function scanIntervalMs() {
    const n = (state.accounts || []).length;
    let base = 60000;
    if (state.scanIntervalSec) base = state.scanIntervalSec * 1000;
    if (n > 200) return Math.max(base, 600000);
    if (n > 100) return Math.max(base, 300000);
    if (n > 40) return Math.max(base, 180000);
    if (n > 20) return Math.max(base, 120000);
    return base;
}

function restartBalanceScanTimer() {
    if (balanceScanInterval) clearInterval(balanceScanInterval);
    balanceScanInterval = setInterval(refreshAllBalances, scanIntervalMs());
}

function initAllBalance() {
    if (!balanceScanInterval) {
        const refreshBtn = document.getElementById('refresh-all-balance-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => refreshAllBalances(true));

        const hideZeroToggle = document.getElementById('all-balance-hide-zero');
        if (hideZeroToggle) {
            hideZeroToggle.addEventListener('change', () => {
                renderAllBalanceGrid();
                updateBalanceStats();
            });
        }
    }

    state.balanceHealth = {};

    if (getActiveAccounts().length > 0) {
        refreshAllBalances(true);
    }

    restartBalanceScanTimer();
}

async function refreshAllBalances(force = false) {
    if (balanceScanRunning && !force) return;
    const active = getActiveAccounts();
    if (active.length === 0) return;

    balanceScanRunning = true;
    updateBalanceStatus('scanning');

    try {
        await mapLimit(active, scanConcurrency(), async (acc) => {
            await scanAccount(acc);
        });

        renderAllBalanceGrid();
        updateBalanceStats();
        const failed = active.filter(a => a.scanError).length;
        updateBalanceStatus(failed > 0 && failed === active.length ? 'offline' : 'online');

        if (typeof refreshPrices === 'function') {
            refreshPrices();
        }
    } catch (e) {
        console.error("Balance scan failed:", e);
        updateBalanceStatus('offline');
    } finally {
        balanceScanRunning = false;
        if (balanceScanInterval) restartBalanceScanTimer();
    }
}

function renderAllBalanceGrid() {
    const container = document.getElementById('all-balance-grid');
    if (!container) return;

    const hideZero = document.getElementById('all-balance-hide-zero')?.checked || false;
    const active = getActiveAccounts();
    const accounts = hideZero
        ? active.filter(a => a.nativeBal > 0 || Object.values(a.tokens).some(b => b > 0))
        : active;

    const fragment = document.createDocumentFragment();

    accounts.forEach(acc => {
        const card = document.createElement('div');
        card.className = 'all-balance-card';
        card.dataset.accountId = acc.id;

        const chainColor = acc.chainObj.color || 'var(--primary)';
        const shortAddr = acc.address.slice(0, 6) + '...' + acc.address.slice(-4);
        const nativeSymbol = acc.chainObj.symbol;
        const balanceValue = acc.scanError ? '—' : formatBalance(acc.nativeBal);
        const tokenTotal = Object.entries(acc.tokens).filter(([_, v]) => v > 0);

        let tokenHtml = '';
        if (tokenTotal.length > 0) {
            tokenHtml = `<div class="balance-token-list">${tokenTotal.map(([sym, val]) => {
                const price = getCachedPrice(sym) || TOKEN_PRICES[sym] || 0;
                const usdValue = val * price;
                const fullName = TOKEN_NAMES[sym] || sym.toUpperCase();
                return `<div class="balance-token-row">
                    <div style="display:flex; flex-direction:column">
                        <span class="token-symbol">${escapeHtml(sym.toUpperCase())}</span>
                        <span class="token-name muted" style="font-size:0.65rem; color:var(--muted)">Token • ${escapeHtml(fullName)}</span>
                    </div>
                    <span class="token-balance mono">${formatBalance(val, 4)}</span>
                    <span class="token-value muted">${usdValue > 0 ? formatCurrency(usdValue, state.currency || 'usd') : ''}</span>
                </div>`;
            }).join('')}</div>`;
        } else {
            tokenHtml = '<div class="balance-no-tokens muted" style="font-size:0.72rem; color:var(--muted)">No token balances</div>';
        }

        const lastUpdated = acc.lastScan ? new Date(acc.lastScan).toLocaleTimeString() : '';

        const nativeLabel = acc.chainObj.chainId ? `Native ${acc.chainObj.symbol}` : acc.chainObj.symbol;

        card.innerHTML = `
            <div class="balance-card-header">
                <span class="balance-chain-tag">
                    <span class="chain-dot" style="background:${chainColor}"></span>
                    ${escapeHtml(acc.chainObj.name)}
                </span>
                <span class="balance-type-tag" style="font-size:0.62rem; color:var(--muted); background:var(--surface-2); padding:2px 6px; border-radius:3px">Native</span>
            </div>
            <div class="balance-card-body">
                <div class="balance-address mono">${shortAddr}</div>
                <div class="balance-amount">
                    <span class="balance-value">${balanceValue}</span>
                    <span class="balance-symbol">${nativeSymbol}</span>
                </div>
                <div class="balance-native-label muted" style="font-size:0.65rem; color:var(--muted)">${escapeHtml(nativeLabel)}</div>
                ${tokenHtml}
            </div>
            <div class="balance-card-footer">
                <span class="balance-updated mono">${lastUpdated || 'Never'}</span>
                <div style="display:flex; gap:4px">
                    <button class="wallet-scan-btn icon-btn" type="button" title="Refresh balance" style="width:22px; height:22px" data-acc-id="${acc.id}">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9M3 12l6 6 6-6-6-6"/></svg>
                    </button>
                    <button class="wallet-history-btn icon-btn" type="button" title="View on explorer" style="width:22px; height:22px" data-acc-id="${acc.id}" data-address="${acc.address}" data-chain="${acc.chainObj.explorerUrl}">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6L8 8l2 2"/><path d="M15 12l-2-2-2 2"/><path d="M10 6l-2 2 2 2m5 0l2-2 2 2"/></svg>
                    </button>
                </div>
            </div>
        `;

        fragment.appendChild(card);
    });

    container.replaceChildren(fragment);
}

function updateBalanceStats() {
    const active = getActiveAccounts();
    const totalAccounts = active.length;
    const chainSet = new Set(active.map(a => a.chainKey));
    const chainCount = chainSet.size;

    let totalUsd = 0;
    active.forEach(acc => {
        if (acc.scanError) return;
        const price = getCachedPrice(acc.chainObj.symbol) || acc.chainObj.usdPrice || 0;
        totalUsd += acc.nativeBal * price;
        Object.entries(acc.tokens).forEach(([sym, bal]) => {
            if (bal > 0) {
                const tPrice = getCachedPrice(sym) || TOKEN_PRICES[sym] || 0;
                totalUsd += bal * tPrice;
            }
        });
    });

    const rate = getExchangeRate(state.currency || 'usd');
    const totalEl = document.getElementById('all-balance-total');
    const accountsEl = document.getElementById('all-balance-accounts-count');
    const chainsEl = document.getElementById('all-balance-chains-count');
    if (totalEl) totalEl.textContent = formatCurrency(totalUsd * rate, state.currency || 'usd');
    if (accountsEl) accountsEl.textContent = totalAccounts;
    if (chainsEl) chainsEl.textContent = chainCount;
}

function updateBalanceStatus(status) {
    const pill = document.getElementById('all-balance-status');
    if (!pill) return;

    const dot = pill.querySelector('.pulse-dot');
    const text = pill.querySelector('span:last-child');

    if (status === 'online' || status === 'idle') {
        pill.classList.remove('status-pill--scanning');
        pill.classList.add('status-pill--online');
        if (dot) dot.className = 'pulse-dot pulse-dot--online';
        if (text) text.textContent = 'Live';
    } else if (status === 'scanning') {
        pill.classList.remove('status-pill--online');
        pill.classList.add('status-pill--scanning');
        if (dot) dot.className = 'pulse-dot pulse-dot--scanning';
        if (text) text.textContent = 'Scanning...';
    } else if (status === 'offline' || status === 'error') {
        pill.classList.remove('status-pill--online');
        pill.classList.add('status-pill--error');
        if (dot) dot.className = 'pulse-dot pulse-dot--warning';
        if (text) text.textContent = 'Issues';
    }
}

function stopAllBalanceScan() {
    if (balanceScanInterval) {
        clearInterval(balanceScanInterval);
        balanceScanInterval = null;
    }
    balanceScanRunning = false;
}

window.initAllBalance = initAllBalance;
window.refreshAllBalances = refreshAllBalances;
window.stopAllBalanceScan = stopAllBalanceScan;

document.getElementById('all-balance-grid')?.addEventListener('click', function(e) {
    const scanBtn = e.target.closest('.wallet-scan-btn');
    if (scanBtn) {
        const accId = scanBtn.getAttribute('data-acc-id');
        const acc = state.accounts.find(a => a.id === accId);
        if (acc) {
            scanBtn.disabled = true;
            scanBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';
            scanAccount(acc).then(() => {
                scanBtn.disabled = false;
                scanBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9M3 12l6 6 6-6-6-6"/></svg>';
                renderAllBalanceGrid();
            }).catch(() => {
                scanBtn.disabled = false;
                scanBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9M3 12l6 6 6-6-6-6"/></svg>';
            });
        }
    }

    const histBtn = e.target.closest('.wallet-history-btn');
    if (histBtn) {
        const address = histBtn.getAttribute('data-address');
        const explorerUrl = histBtn.getAttribute('data-chain');
        if (explorerUrl && address) {
            window.open(`${explorerUrl.replace(/\/$/, '')}/address/${address}`, '_blank', 'noopener,noreferrer');
        }
    }
});
