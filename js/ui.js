/**
 * ui.js — Complete rendering, events, modals, theme control, address book, custom tokens, account actions
 * 
 * All DOM manipulation, accessibility features, tooltips, drag-drop, keyboard shortcuts included
 */

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[ch]));
}

function log(msg, type = 'info') {
    const container = document.getElementById('log-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `log-entry log-${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    container.prepend(div);
}

function showToast(message, type = 'info', duration = 5000) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    
    const iconSvg = {
        success: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13l-6-6"/></svg>',
        error: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        warning: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12.01" y2="17"/></svg>'
    };
    
    toast.innerHTML = `<span class="toast-icon">${iconSvg[type] || iconSvg.info}</span><span class="toast-message">${escapeHtml(message)}</span>`;
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'toast-close';
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.addEventListener('click', () => removeToast(toast));
    toast.appendChild(removeBtn);

    stack.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    if (duration > 0) {
        setTimeout(() => removeToast(toast), duration);
    }
}

function removeToast(toast) {
    toast.classList.remove('show');
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 250);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    const panel = document.getElementById(`tab-${tabId}`);
    if (panel) panel.classList.remove('hidden');
    const activeButton = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (activeButton) activeButton.classList.add('active');

    if (tabId === 'dashboard') {
        renderAccounts();
        if (typeof refreshPrices === 'function') {
            refreshPrices();
        }
    } else if (tabId === 'balance') {
        if (typeof initAllBalance === 'function') {
            initAllBalance();
            refreshAllBalances(true);
        }
    } else if (tabId === 'send') {
        renderPermissions();
        if (typeof populateSignAccountSelect === 'function') {
            populateSignAccountSelect();
        }
    } else if (tabId === 'settings') {
        loadAdvancedSettings();
        renderAddressBook();
        renderCustomTokens();
        if (typeof renderNetworkConfig === 'function' && state.networkHealth) {
            renderNetworkConfig(state.networkHealth);
        } else if (typeof checkAllNetworkHealth === 'function') {
            checkAllNetworkHealth();
        }
    }
}

function updateSendUI() {
    const type = document.getElementById('send-asset-type').value;
    document.getElementById('custom-token-input').classList.toggle('hidden', type !== 'custom');
}

function formatBalance(value, maxDecimals = 6) {
    if (!Number.isFinite(value) || value === 0) return '0';
    if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return value.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

function formatPercent(value) {
    return value.toFixed(1) + '%';
}

function buildAccountCard(acc) {
    const card = document.createElement('div');
    card.className = 'account-card' + (state.currentAccountId === acc.id ? ' active' : '');
    card.dataset.accountId = acc.id;
    card.addEventListener('click', () => selectAccount(acc.id));

    const chainTag = document.createElement('div');
    chainTag.className = 'chain-tag';
    const dot = document.createElement('span');
    dot.className = 'chain-dot';
    dot.style.background = acc.chainObj.color || 'var(--primary)';
    chainTag.appendChild(dot);
    chainTag.appendChild(document.createTextNode(acc.chainObj.name));

    const addrRow = document.createElement('div');
    addrRow.className = 'addr-row';
    const addr = document.createElement('span');
    addr.className = 'addr';
    addr.textContent = acc.address;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyAddress(acc.address, copyBtn); });
    addrRow.append(addr, copyBtn);

    const bal = document.createElement('div');
    bal.className = 'bal';
    if (acc.isLoading) {
        const skeleton = document.createElement('span');
        skeleton.className = 'skeleton';
        bal.appendChild(skeleton);
    } else if (acc.scanError) {
        bal.textContent = '—';
    } else {
        const nativeSymbol = acc.chainObj.symbol;
        bal.textContent = formatBalance(acc.nativeBal) + ' ' + nativeSymbol;
    }
    
    const lastUpdated = acc.lastScan ? new Date(acc.lastScan).toLocaleTimeString() : 'Never';

    const nativeLabel = document.createElement('div');
    nativeLabel.className = 'balance-native-label muted';
    nativeLabel.style.fontSize = '0.65rem';
    nativeLabel.style.color = 'var(--muted)';
    nativeLabel.textContent = escapeHtml(nativeSymbol);

    const nativeInfo = document.createElement('div');
    nativeInfo.className = 'balance-native-info';
    nativeInfo.style.fontSize = '0.62rem';
    nativeInfo.textContent = escapeHtml(acc.chainObj.name);
    
    card.innerHTML = `
        <div class="balance-card-header">
            ${chainTag.outerHTML}
            <div class="balance-type">${nativeInfo.outerHTML}</div>
        </div>
        <div class="balance-card-body">
            ${addrRow.outerHTML}
            <div class="balance-amount">
                <span class="balance-value">${bal.textContent}</span>
                <span class="balance-symbol">${nativeSymbol}</span>
            </div>
            ${tokenHtml}
        </div>
        <div class="balance-card-footer">
            <span class="balance-updated mono">${lastUpdated || 'Never'}</span>
            <div style="display:flex; gap:4px">
                <button class="wallet-scan-btn icon-btn" type="button" title="Refresh balance" style="width:22px; height:22px" data-acc-id="${acc.id}">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9M3 12l6 6 6-6-6-6"/></svg>
                </button>
                <button class="wallet-history-btn icon-btn" type="button" title="View on explorer" style="width:22px; height:22px" data-acc-id="${acc.id}" data-address="${acc.address}" data-chain="${acc.chainObj.explorerUrl}">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6L8 8l2 2 2-2-2 2"/><path d="M15 12l-2-2-2 2"/></svg>
                </button>
            </div>
        </div>
    `;

    return card;
}

function renderAccounts() {
    const container = document.getElementById('global-account-list');
    if (!container) return;
    
    const hideZero = document.getElementById('hide-zero-toggle').checked || false;
    const active = getActiveAccounts();
    const filtered = hideZero
        ? active.filter(a => a.nativeBal > 0 || Object.values(a.tokens).some(b => b > 0))
        : active;

    const fragment = document.createDocumentFragment();

    filtered.forEach(acc => {
        const card = buildAccountCard(acc);
        fragment.appendChild(card);
    });

    container.replaceChildren(fragment);

    const assetsCount = document.getElementById('total-assets-count');
    const chainsCount = document.getElementById('total-active-chains');
    if (assetsCount) assetsCount.textContent = filtered.length;
    if (chainsCount) chainsCount.textContent = new Set(filtered.map(a => a.chainKey)).size;

    if (filtered.length === 0) {
        const empty = document.getElementById('global-empty');
        if (empty) empty.classList.remove('hidden');
    } else if (!empty) {
        empty.classList.add('hidden');
    }
}

function updateAccountCard(acc) {
    const container = document.getElementById('global-account-list');
    if (!container) return;
    
    const existing = container.querySelector(`[data-account-id="${acc.id}"]`);
    if (!existing) return;
    
    const hideZero = document.getElementById('hide-zero-toggle')?.checked || false;
    const shouldShow = !hideZero || (acc.nativeBal > 0 || Object.values(acc.tokens).some(b => b > 0));
    
    if (!shouldShow) {
        existing.remove();
    } else {
        existing.replaceWith(buildAccountCard(acc));
    }
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

function initTheme() {
    const saved = localStorage.getItem(CONSTANTS.THEME_STORAGE_KEY);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = saved || (prefersLight ? 'light' : 'dark');
    applyTheme(theme);
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = theme === 'dark' ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(CONSTANTS.THEME_STORAGE_KEY, next);
    applyTheme(next);
}

// =========================================================
// ADDRESS BOOK MANIPULATIONS
// =========================================================

function renderAddressBook() {
    const container = document.getElementById('address-book-list');
    if (!container) return;

    const empty = document.getElementById('address-book-empty');
    const countEl = document.getElementById('address-count');
    const accounts = state.vaultData?.addressBook || [];

    if (accounts.length === 0) {
        if (empty) empty.classList.remove('hidden');
        container.innerHTML = '';
        return;
    }

    if (empty) empty.classList.add('hidden');

    const fragment = document.createDocumentFragment();

    accounts.forEach((contact, index) => {
        const card = document.createElement('div');
        card.className = 'address-book-card';
        card.dataset.id = contact.id;

        const name = document.createElement('div');
        name.className = 'address-name';
        name.textContent = escapeHtml(contact.name);

        const addr = document.createElement('div');
        addr.className = 'address-address';
        addr.textContent = escapeHtml(contact.address);

        card.appendChild(name);
        card.appendChild(addr);

        fragment.appendChild(card);
    });

    container.replaceChildren(fragment);

    if (countEl) countEl.textContent = accounts.length;
}

function onAddContact() {
    document.getElementById('address-book-modal').classList.remove('hidden');
    document.getElementById('ab-name-input').value = '';
    document.getElementById('ab-address-input').value = '';
    document.getElementById('ab-error').textContent = '';
    document.getElementById('ab-name-input').focus();
}

function onSaveContact() {
    const name = document.getElementById('ab-name-input').value.trim();
    const address = document.getElementById('ab-address-input').value.trim();
    const errorEl = document.getElementById('ab-error');

    if (!name || !address) {
        errorEl.textContent = "Name and address are required.";
        return;
    }

    if (!/^[a-zA-Z0-9]+$/.test(address.replace(/\s+/g, ''))) {
        errorEl.textContent = "Invalid address format.";
        return;
    }

    addAddressBookEntry(name, address).then(() => {
        renderAddressBook();
        showToast('Contact added', 'success');
        document.getElementById('address-book-modal').classList.add('hidden');
    }).catch(() => {
        errorEl.textContent = "Failed to save address.";
    });
}

function onDeleteContact(id) {
    if (confirm('Delete this contact?')) {
        deleteAddressBookEntry(id).then(() => {
            renderAddressBook();
            showToast('Contact deleted', 'info');
        });
    }
}

// =========================================================
// CUSTOM TOKENS
// =========================================================

function renderCustomTokens() {
    const container = document.getElementById('custom-tokens-list');
    if (!container) return;

    const tokens = state.vaultData?.customTokens || [];
    if (tokens.length === 0) {
        if (document.getElementById('custom-token-empty')) {
            document.getElementById('custom-token-empty').classList.remove('hidden');
        }
        container.innerHTML = '';
        return;
    }

    container.innerHTML = tokens.map(t => `
        <div class="custom-token-card" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-radius:8px; margin-bottom:8px;">
            <div>
                <span class="custom-token-symbol">${escapeHtml(t.symbol.toUpperCase())}</span>
                <span class="custom-token-name muted" style="font-size:0.72rem;">${escapeHtml(t.contractAddress)}</span>
            </div>
            <div class="custom-token-balance">${formatBalance(t.decimals ? Number(t.decimals) : 0, 4)} ${t.symbol.toUpperCase()}</div>
            <div style="display:flex; gap:6px">
                <button class="btn-secondary" type="button" onclick="onDeleteCustomToken(${t.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

function onAddCustomToken() {
    document.getElementById('custom-token-modal').classList.remove('hidden');
    document.getElementById('ct-symbol-input').value = '';
    document.getElementById('ct-chain-select').value = '';
    document.getElementById('ct-contract-input').value = '';
    document.getElementById('ct-decimals-input').value = '18';
    document.getElementById('ct-error').textContent = '';
    document.getElementById('ct-symbol-input').focus();
}

function onSaveCustomToken() {
    const symbol = document.getElementById('ct-symbol-input').value.trim().toUpperCase();
    const chainKey = document.getElementById('ct-chain-select').value;
    const contract = document.getElementById('ct-contract-input').value.trim();
    const decimals = document.getElementById('ct-decimals-input').value.trim();

    if (!symbol || !chainKey || !contract || !decimals) {
        document.getElementById('ct-error').textContent = "All fields are required.";
        return;
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
        document.getElementById('ct-error').textContent = "Invalid contract address.";
        return;
    }

    addCustomToken(chainKey, symbol, contract, Number(decimals)).then(() => {
        renderCustomTokens();
        showToast('Token added', 'success');
        document.getElementById('custom-token-modal').classList.add('hidden');
    }).catch(() => {
        document.getElementById('ct-error').textContent = "Invalid parameters.";
    });
}

function onDeleteCustomToken(id) {
    if (confirm('Delete this custom token?')) {
        deleteCustomTokenEntry(id).then(() => {
            renderCustomTokens();
            showToast('Token deleted', 'info');
        });
    }
}

// =========================================================
// SETTINGS & ACTION BUTTONS
// =========================================================

function loadAdvancedSettings() {
    applySettings(state.vaultData?.settings || {});
    const setVals = {
        apiKey: document.getElementById('api-key-input').value.trim(),
        alchemyKey: document.getElementById('alchemy-key-input').value.trim(),
        infuraKey: document.getElementById('infura-key-input').value.trim(),
        trongridKey: document.getElementById('trongrid-key-input').value.trim(),
        rpcTimeout: Number(document.getElementById('rpc-timeout-input').value),
        scanConcurrency: Number(document.getElementById('scan-concurrency-input').value) || CONSTANTS.SCAN_CONCURRENCY,
        derivationCount: Math.min(20, Number(document.getElementById('derivation-count-input').value) || CONSTANTS.DERIVATION_COUNT),
        scanInterval: Number(document.getElementById('scan-interval-input').value) || CONSTANTS.SCAN_INTERVAL_SEC,
        dustUsd: Number(document.getElementById('dust-usd-input').value) || CONSTANTS.DUST_USD,
        priceCacheDuration: Number(document.getElementById('price-cache-input').value) || CONSTANTS.PRICE_CACHE_DURATION,
        defaultCurrency: document.getElementById('default-currency-input').value.trim() || CONSTANTS.DEFAULT_CURRENCY,
        useProxy: document.getElementById('use-proxy-toggle').checked || false
    };

    saveAdvancedSettings(setVals);
}

function onExportVault() {
    exportVault().then(({ data, timestamp, version }) => {
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `omni-vault-${timestamp.slice(0, 10)}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }).catch(e => {
        showToast('Export failed: ' + e.message, 'error');
    });
}

function onImportVaultFile() {
    document.getElementById('vault-file-input').value = '';
    document.getElementById('if-error').textContent = '';
    document.getElementById('import-file-modal').classList.remove('hidden');
    document.getElementById('vault-file-input').focus();
}

function onImportFileConfirm() {
    const fileInput = document.getElementById('vault-file-input');
    const errorEl = document.getElementById('if-error');

    if (!fileInput.files || fileInput.files.length === 0) {
        errorEl.textContent = "Please select a vault backup file.";
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
        const vaultData = JSON.parse(reader.result);
        importVaultFile(vaultData.data || reader.result).then(() => {
            document.getElementById('import-file-modal').classList.add('hidden');
            generateAccountsList();
            switchTab('dashboard');
            scanAllBalances().then(() => {
                initAllBalance();
                fetchTransactionHistory();
                showToast('Vault imported', 'success');
            });
        }).catch(() => {
            errorEl.textContent = "Invalid vault format.";
        });
    };

    reader.onerror = () => {
        errorEl.textContent = "Unable to read vault file.";
    };
    reader.readAsText(file);
}

function onClearVault() {
    if (confirm('Are you sure you want to clear the vault? This cannot be undone.')) {
        localStorage.removeItem(CONSTANTS.VAULT_STORAGE_KEY);
        state.vaultData = {
            mnemonic: null,
            mnemonics: [],
            privKeys: [],
            permissions: {},
            addressBook: [],
            customTokens: [],
            txHistory: []
        };
        state.accounts = [];
        location.reload();
    }
}

function onResetApp() {
    if (confirm('Reset the app? This will clear all data.')) {
        localStorage.clear();
        location.reload();
    }
}

// =========================================================
// KEYBOARD SHORTCUTS & DRAG & DROP SUPPORT
// =========================================================

function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!document.activeElement || document.activeElement.tagName === 'INPUT') return;

        // Ctrl+S – Save settings
        if (e.ctrlKey && e.key === 's') {
            loadAdvancedSettings();
        }

        // Ctrl+R – Refresh balances
        if (e.ctrlKey && e.key === 'r') {
            refreshAllBalances(true);
        }

        // Ctrl+E – Export vault
        if (e.ctrlKey && e.key === 'e') {
            onExportVault();
        }

        // Ctrl+C – Copy address
        if (e.metaKey && e.key === 'c') {
            // Detect selection or focus element
            let address = '';
            const selected = document.getSelection().toString().trim();
            if (selected.length > 0) address = selected;
            else address = document.getElementById('send-to')?.value || '';

            if (address) {
                copyAddress(address, document.createElement('button'));
            }
        }

        // Esc – Close modals
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
        }
    });
}

function enableDragSorting() {
    const list = document.getElementById('global-account-list');
    if (!list) return;

    list.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('itemId', e.target.dataset.accountId);
    });

    list.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    list.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer.getData('itemId');
        const targetId = e.target.dataset.accountId;

        if (!sourceId || !targetId) return;

        const source = state.accounts.find(a => a.id === Number(sourceId));
        const target = state.accounts.find(a => a.id === Number(targetId));

        if (!source || !target) return;
        
        const sourceIndex = state.accounts.findIndex(a => a.id === Number(sourceId));
        const targetIndex = state.accounts.findIndex(a => a.id === Number(targetId));

        state.accounts = [
            ...state.accounts.slice(0, sourceIndex),
            target,
            ...state.accounts.slice(sourceIndex, targetIndex),
            source,
            ...state.accounts.slice(targetIndex + 1)
        ];

        updateAccountCard(source);
        updateAccountCard(target);
        persistVault();
        renderAccounts();
    });
}

function enableKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (!document.activeElement || document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'INPUT') return;

        const accountList = document.getElementById('global-account-list');
        if (!accountList) return;

        const cards = [...accountList.querySelectorAll('.account-card')];
        let focusedCard = cards.find((c, i) => c === document.activeElement ||
                                    (c.classList.contains('active') && !document.activeElement.parentElement?.tagName === 'BODY'));

        if (!focusedCard) focusedCard = cards[0];

        switch (e.key) {
            case 'ArrowDown':
                let nextIndex = focusedCard.dataset.accountId;
                const accounts = state.accounts;
                const accountIds = accounts.map(a => a.id);
                const index = accountIds.indexOf(Number(nextIndex));
                if (index < accountIds.length - 1) {
                    focusedCard = cards[accountIds.indexOf(accountIds[index + 1]] || cards[0];
                }
                break;
            case 'ArrowUp':
                let prevIndex = focusedCard.dataset.accountId;
                const index = accountIds.indexOf(Number(prevIndex));
                if (index > 0) {
                    focusedCard = cards[accountIds.indexOf(accountIds[index - 1]] || cards[cards.length - 1];
                }
                break;
            case 'Enter':
                focusedCard.click();
                break;
        }
    });
}

// =========================================================
// EFFECTS FOR MODALS / TOOLTIPS / INDICATORS
// =========================================================

function animateConnectingIndicator() {
    document.getElementById('connecting-spinner').classList.remove('hidden');
}

function hideConnectingIndicator() {
    document.getElementById('connecting-spinner').classList.add('hidden');
}

function showLoadingOverlay() {
    document.getElementById('loader-overlay').classList.remove('hidden');
}

function hideLoadingOverlay() {
    document.getElementById('loader-overlay').classList.add('hidden');
}

// =========================================================
// EVENT LISTENERS & UTILITIES
// =========================================================

document.addEventListener('keydown', e => {
    // ESC closes modals
    if (e.key === 'Escape' && document.body.classList.contains('modal-open')) {
        document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
});

document.addEventListener('click', (e) => {
    if (e.target.closest('.modal')) {
        document.body.classList.remove('modal-open');
    }
});

// =========================================================
// DEPRECATED / CLEANUP (keep as legacy compatibility)
// =========================================================

/*
function old_importVaultFile() {
    // Legacy import method (still supported for backwards compatibility)
    const reader = new FileReader();
    reader.onload = (e) => {
        importVaultFile(JSON.parse(reader.result));
        switchTab('dashboard');
    };
    reader.readAsText(document.getElementById('old-vault-file').files[0]);
}
*/

// =========================================================
// STARTUP HOOKS
// =========================================================

function initFullUI() {
    // Theme
    initTheme();

    // Shortcuts
    setupShortcuts();

    // Drag & drop
    enableDragSorting();

    // Keyboard nav
    enableKeyboardNavigation();

    // Toast & Events
    showToast('Welcome to OmniChain Wallet', 'info');
}

// Call on DOM ready
document.addEventListener('DOMContentLoaded', initFullUI);
})();
