/* ui.js — rendering, events, modals, theme, address book, custom tokens */

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
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
        warning: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
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
    }
    if (tabId === 'balance') {
        if (typeof initAllBalance === 'function') {
            initAllBalance();
            refreshAllBalances(true);
        }
    }
    if (tabId === 'send') {
        renderPermissions();
        if (typeof populateSignAccountSelect === 'function') {
            populateSignAccountSelect();
        }
    }
    if (tabId === 'settings') {
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
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyAddress(acc.address, copyBtn);
    });
    addrRow.append(addr, copyBtn);

    const bal = document.createElement('div');
    bal.className = 'bal';
    if (acc.isLoading) {
        const skeleton = document.createElement('span');
        skeleton.className = 'skeleton';
        bal.appendChild(skeleton);
    } else if (acc.scanError) {
        bal.textContent = 'Unavailable';
    } else {
        bal.textContent = formatBalance(acc.nativeBal) + ' ';
        const sym = document.createElement('span');
        sym.className = 'symbol';
        sym.textContent = acc.chainObj.symbol;
        bal.appendChild(sym);
    }

    card.append(chainTag, addrRow, bal);

    if (acc.scanError) {
        const err = document.createElement('div');
        err.className = 'scan-error';
        err.textContent = 'Scan failed: ' + acc.scanError;
        card.appendChild(err);
    } else {
        Object.entries(acc.tokens).forEach(([sym, b]) => {
            if (b > 0) {
                const row = document.createElement('div');
                row.className = 'token-row';
                const s = document.createElement('span');
                s.className = 'token-symbol';
                s.textContent = sym;
                const v = document.createElement('span');
                v.className = 'token-bal';
                v.textContent = formatBalance(b, 4);
                row.append(s, v);
                card.appendChild(row);
            }
        });
    }
    return card;
}

function renderAccounts() {
    const container = document.getElementById('global-account-list');
    if (!container) return;
    
    const hideZero = document.getElementById('hide-zero-toggle')?.checked || false;
    const active = getActiveAccounts();
    const filtered = hideZero
        ? active.filter(a => a.nativeBal > 0 || Object.values(a.tokens).some(b => b > 0))
        : active;

    const fragment = document.createDocumentFragment();
    const accountCount = document.getElementById('account-count');
    if (accountCount) accountCount.textContent = filtered.length;
    
    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = active.length === 0 ? 'Import accounts in Settings to get started.' : 'No accounts found or all balances are zero.';
        fragment.appendChild(empty);
    } else {
        filtered.forEach(acc => fragment.appendChild(buildAccountCard(acc)));
    }
    container.replaceChildren(fragment);
}

function updateAccountCard(acc) {
    const container = document.getElementById('global-account-list');
    if (!container) return;
    
    const existing = container.querySelector(`[data-account-id="${acc.id}"]`);
    if (!existing) return;
    
    const hideZero = document.getElementById('hide-zero-toggle')?.checked || false;
    const shouldShow = !hideZero || acc.nativeBal > 0 || Object.values(acc.tokens).some(b => b > 0);
    if (!shouldShow) {
        existing.remove();
    } else {
        existing.replaceWith(buildAccountCard(acc));
    }
}

function renderPermissions() {
    const container = document.getElementById('permissions-list');
    const empty = document.getElementById('permissions-empty');
    const countEl = document.getElementById('permission-count');

    if (!container || !state.vaultData.permissions) return;

    const perms = Object.entries(state.vaultData.permissions);
    if (countEl) countEl.textContent = perms.length;
    if (empty) empty.style.display = perms.length === 0 ? 'flex' : 'none';

    const fragment = document.createDocumentFragment();

    perms.forEach(([domain, perm]) => {
        const date = perm.timestamp ? new Date(perm.timestamp).toLocaleDateString() : 'Never';
        const autoSign = perm.autoSign ? ' (auto-sign enabled)' : '';

        const item = document.createElement('div');
        item.className = 'permission-item';
        item.innerHTML = `
            <div class="permission-domain">
                <span class="permission-icon">${domain.charAt(0).toUpperCase()}</span>
                <span class="domain-text">${escapeHtml(domain)}</span>
                <span class="permission-meta muted" style="font-size:0.8rem">${autoSign}</span>
            </div>
            <div class="permission-meta">
                <span class="permission-date muted">${date}</span>
                <button class="revoke-btn" onclick="revokeSitePermission('${escapeHtml(domain)}')" type="button">Revoke</button>
            </div>
        `;
        fragment.appendChild(item);
    });

    const existingContainer = document.getElementById('permissions-table-container');
    if (existingContainer) existingContainer.remove();
    container.replaceChildren(fragment);
}

function loadAdvancedSettings() {
    const settings = state.vaultData.settings || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('api-key-input', settings.apiKey || '');
    setVal('alchemy-key-input', settings.alchemyKey || '');
    setVal('infura-key-input', settings.infuraKey || '');
    setVal('trongrid-key-input', settings.trongridKey || '');
    setVal('proxy-url-input', settings.corsProxy || '');
    setVal('rpc-timeout-input', settings.rpcTimeout || CONSTANTS.RPC_TIMEOUT);
    setVal('scan-concurrency-input', settings.scanConcurrency || CONSTANTS.SCAN_CONCURRENCY);
    setVal('derivation-count-input', settings.derivationCount || CONSTANTS.DERIVATION_COUNT);
    setVal('scan-interval-input', settings.scanInterval || 60);
    setVal('dust-usd-input', settings.dustUsd ?? CONSTANTS.DUST_USD);
    setVal('max-rpc-retries-input', settings.maxRpcRetries ?? CONSTANTS.MAX_RPC_RETRIES);
    setVal('price-cache-input', settings.priceCacheDuration ?? CONSTANTS.PRICE_CACHE_DURATION);
    setVal('default-currency-input', settings.defaultCurrency || CONSTANTS.DEFAULT_CURRENCY);
    const proxyToggle = document.getElementById('use-proxy-toggle');
    if (proxyToggle) proxyToggle.checked = settings.useProxy || false;
}

function applySettings(settings) {
    if (!settings) return;
    CONSTANTS.RPC_TIMEOUT = settings.rpcTimeout || CONSTANTS.RPC_TIMEOUT;
    CONSTANTS.SCAN_CONCURRENCY = settings.scanConcurrency || CONSTANTS.SCAN_CONCURRENCY;
    CONSTANTS.NETWORK_API_KEY = settings.apiKey || '';
    CONSTANTS.ALCHEMY_KEY = settings.alchemyKey || '';
    CONSTANTS.INFURA_KEY = settings.infuraKey || '';
    CONSTANTS.TRONGRID_KEY = settings.trongridKey || '';
    if (settings.derivationCount) CONSTANTS.DERIVATION_COUNT = settings.derivationCount;
    if (settings.dustUsd !== undefined) CONSTANTS.DUST_USD = settings.dustUsd;
    if (settings.maxRpcRetries !== undefined) CONSTANTS.MAX_RPC_RETRIES = settings.maxRpcRetries;
    if (settings.priceCacheDuration !== undefined) CONSTANTS.PRICE_CACHE_DURATION = settings.priceCacheDuration;
    if (settings.defaultCurrency) CONSTANTS.DEFAULT_CURRENCY = settings.defaultCurrency;
    if (typeof settings.scanInterval === 'number') state.scanIntervalSec = settings.scanInterval;
    CONSTANTS.CORS_PROXY = settings.corsProxy || '';
    CONSTANTS.USE_PROXY = Boolean(settings.useProxy && settings.corsProxy);
    clearProviderPool();
}

function loadSavedSettings() {
    applySettings(state.vaultData?.settings);
}

async function saveAdvancedSettings() {
    const num = (id, fallback) => {
        const v = parseInt(document.getElementById(id)?.value, 10);
        return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    const flt = (id, fallback) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) && v >= 0 ? v : fallback;
    };
    state.vaultData.settings = {
        apiKey: document.getElementById('api-key-input')?.value.trim() || '',
        alchemyKey: document.getElementById('alchemy-key-input')?.value.trim() || '',
        infuraKey: document.getElementById('infura-key-input')?.value.trim() || '',
        trongridKey: document.getElementById('trongrid-key-input')?.value.trim() || '',
        corsProxy: document.getElementById('proxy-url-input')?.value.trim() || '',
        rpcTimeout: num('rpc-timeout-input', CONSTANTS.RPC_TIMEOUT),
        scanConcurrency: num('scan-concurrency-input', CONSTANTS.SCAN_CONCURRENCY),
        derivationCount: Math.min(20, num('derivation-count-input', CONSTANTS.DERIVATION_COUNT)),
        scanInterval: Math.min(3600, num('scan-interval-input', 60)),
        dustUsd: flt('dust-usd-input', CONSTANTS.DUST_USD),
        maxRpcRetries: Math.min(10, num('max-rpc-retries-input', CONSTANTS.MAX_RPC_RETRIES)),
        priceCacheDuration: num('price-cache-input', CONSTANTS.PRICE_CACHE_DURATION),
        defaultCurrency: document.getElementById('default-currency-input')?.value || CONSTANTS.DEFAULT_CURRENCY,
        useProxy: document.getElementById('use-proxy-toggle')?.checked || false
    };
    applySettings(state.vaultData.settings);
    await persistVault();
    showToast('Advanced settings saved', 'success');
}

function updateStats() {
    const activeChains = new Set();
    let totalAssets = 0;
    state.accounts.forEach(acc => {
        if (acc.nativeBal > 0 || Object.values(acc.tokens).some(b => b > 0)) {
            activeChains.add(acc.chainKey);
            totalAssets++;
        }
    });
    const assetsCount = document.getElementById('total-assets-count');
    const chainsCount = document.getElementById('total-active-chains');
    if (assetsCount) assetsCount.textContent = totalAssets;
    if (chainsCount) chainsCount.textContent = activeChains.size;
    
    if (typeof refreshPrices === 'function') {
        refreshPrices();
    }
}

function selectAccount(id) {
    state.currentAccountId = id;
    const acc = state.accounts.find(a => a.id === id);
    if (!acc) return;
    
    const label = document.getElementById('selected-account-label');
    if (label) label.textContent = `${acc.chainObj.name} • ${acc.address}`;
    
    const balanceEl = document.getElementById('selected-balance');
    if (balanceEl) balanceEl.textContent = `${formatBalance(acc.nativeBal)} ${acc.chainObj.symbol}`;
    
    const sendStatus = document.getElementById('send-status');
    if (sendStatus) sendStatus.textContent = '';
    
    const sendType = document.getElementById('send-asset-type');
    if (sendType) {
        const nativeOption = sendType.querySelector('option[value="native"]');
        if (nativeOption) {
            nativeOption.textContent = `Native ${acc.chainObj.symbol} (${acc.chainObj.name})`;
        }
    }
    
    updateSendUI();
    renderAccounts();
}

async function copyAddress(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
    
    showToast('Address copied to clipboard', 'info', 2000);
    
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1200);
}

function setSetupMsg(text, type) {
    const msg = document.getElementById('setup-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'status-msg ' + (type || '');
}

function onImportClick() {
    const mnemoLines = document.getElementById('mnemonic-input').value.split('\n').map(l => l.trim()).filter(Boolean);
    const pkLines = document.getElementById('pk-input').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (mnemoLines.length === 0 && pkLines.length === 0) {
        setSetupMsg('No data to import.', 'error');
        return;
    }
    let parsed;
    try {
        parsed = parseImports(mnemoLines, pkLines);
    } catch (e) {
        setSetupMsg('Error: ' + e.message, 'error');
        return;
    }
    setSetupMsg(`Importing ${parsed.count} accounts...`, 'success');
         saveVaultDirect(parsed.data).then(() => {
            loadSavedSettings();
            generateAccountsList().then(() => {
                switchTab('dashboard');
                scanAllBalances().then(() => {
                    initAllBalance();
                    fetchTransactionHistory();
                    setSetupMsg(`Imported ${parsed.count} accounts. Scanning...`, 'success');
                    showToast('Accounts imported', 'success');
                    updateVaultPill();
                });
            });
        }).catch(e => {
            setSetupMsg('Error: ' + e.message, 'error');
        });
}

function initTheme() {
    const saved = localStorage.getItem(CONSTANTS.THEME_STORAGE_KEY);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
}

const SUN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(CONSTANTS.THEME_STORAGE_KEY, next);
    applyTheme(next);
}

async function onExportVault() {
    try {
        const exportData = await exportVault();
        const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `omni-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Vault exported successfully', 'success');
    } catch (e) {
        showToast('Export failed: ' + e.message, 'error');
    }
}

function onImportVaultFile() {
    document.getElementById('vault-file-input').value = '';
    document.getElementById('if-error').textContent = '';
    document.getElementById('import-file-modal').classList.remove('hidden');
    document.getElementById('vault-file-input').focus();
}

async function onImportFileConfirm() {
    const fileInput = document.getElementById('vault-file-input');
    const errorEl = document.getElementById('if-error');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        errorEl.textContent = "Please select a vault backup file.";
        return;
    }
    
    const file = fileInput.files[0];
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const vaultDataStr = parsed.data || text;
        
        try {
            await importVaultFile(vaultDataStr);
            document.getElementById('import-file-modal').classList.add('hidden');
            await generateAccountsList();
            switchTab('dashboard');
            scanAllBalances().then(() => {
                initAllBalance();
            });
            updateVaultPill();
            showToast('Vault imported successfully', 'success');
            log('Vault imported from file', 'success');
        } catch (e) {
            errorEl.textContent = "Import failed: " + e.message;
        }
    } catch (e) {
        errorEl.textContent = "Invalid file format.";
    }
}

function onAddContact() {
    document.getElementById('ab-modal-title').textContent = 'Add Contact';
    document.getElementById('ab-name-input').value = '';
    document.getElementById('ab-address-input').value = '';
    document.getElementById('ab-error').textContent = '';
    document.getElementById('address-book-modal').classList.remove('hidden');
    document.getElementById('ab-name-input').focus();
}

async function onSaveContact() {
    const name = document.getElementById('ab-name-input').value.trim();
    const address = document.getElementById('ab-address-input').value.trim();
    const errorEl = document.getElementById('ab-error');
    
    if (!name || !address) {
        errorEl.textContent = "Name and address are required.";
        return;
    }
    
    if (!validateAnyAddress(address)) {
        errorEl.textContent = "Invalid address format.";
        return;
    }
    
    await addAddressBookEntry(name, address);
    document.getElementById('address-book-modal').classList.add('hidden');
    renderAddressBook();
    showToast(`Contact "${name}" added`, 'success');
}

function validateAnyAddress(address) {
    try {
        if (window.ethers.isAddress(address)) return true;
        try { new window.solana.web3.PublicKey(address); return true; } catch (_) {}
        if (window.TronWeb && window.TronWeb.isAddress(address)) return true;
    } catch (_) {}
    return false;
}

function renderAddressBook() {
    const list = document.getElementById('address-book-list');
    const empty = document.getElementById('address-book-empty');
    if (!list) return;
    
    const contacts = state.vaultData?.addressBook || [];
    if (contacts.length === 0) {
        if (empty) empty.classList.remove('hidden');
        list.innerHTML = '';
        return;
    }
    
    if (empty) empty.classList.add('hidden');
    list.innerHTML = contacts.map(c => `
        <div class="perm-row">
            <div class="perm-info">
                <span><strong>${escapeHtml(c.name)}</strong></span>
                <div class="perm-auto mono" style="color:var(--muted); font-size:0.72rem">${escapeHtml(c.address)}</div>
            </div>
            <div style="display:flex; gap:6px">
                <button class="secondary" type="button" onclick="copyAddressFromBook('${c.address}')">Copy</button>
                <button class="secondary" type="button" onclick="deleteContact(${c.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

async function copyAddressFromBook(address) {
    try {
        await navigator.clipboard.writeText(address);
        showToast('Address copied', 'info', 2000);
    } catch (_) {
        showToast('Failed to copy', 'error');
    }
}

async function deleteContact(id) {
    if (confirm('Delete this contact?')) {
        await deleteAddressBookEntry(id);
        renderAddressBook();
        showToast('Contact deleted', 'info');
    }
}

function onAddCustomToken() {
    document.getElementById('ct-modal-title').textContent = 'Add Custom Token';
    document.getElementById('ct-symbol-input').value = '';
    document.getElementById('ct-chain-select').innerHTML = '';
    document.getElementById('ct-contract-input').value = '';
    document.getElementById('ct-decimals-input').value = '18';
    document.getElementById('ct-error').textContent = '';
    document.getElementById('custom-token-modal').classList.remove('hidden');
    populateChainSelect();
    document.getElementById('ct-symbol-input').focus();
}

function populateChainSelect() {
    const select = document.getElementById('ct-chain-select');
    if (!select) return;
    select.innerHTML = '';
    Object.entries(CHAINS).forEach(([key, chain]) => {
        if (chain.kind === 'evm') {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = chain.name;
            select.appendChild(opt);
        }
    });
}

async function onSaveCustomToken() {
    const symbol = document.getElementById('ct-symbol-input').value.trim().toUpperCase();
    const chainKey = document.getElementById('ct-chain-select').value;
    const contract = document.getElementById('ct-contract-input').value.trim();
    const decimals = document.getElementById('ct-decimals-input').value.trim();
    const errorEl = document.getElementById('ct-error');
    
    if (!symbol || !chainKey || !contract || !decimals) {
        errorEl.textContent = "All fields are required.";
        return;
    }
    
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
        errorEl.textContent = "Invalid EVM contract address.";
        return;
    }
    
    await addCustomToken(chainKey, symbol, contract, Number(decimals));
    document.getElementById('custom-token-modal').classList.add('hidden');
    renderCustomTokens();
    showToast(`Token ${symbol} added`, 'success');
}

function renderCustomTokens() {
    const list = document.getElementById('custom-tokens-list');
    const empty = document.getElementById('custom-token-empty');
    if (!list) return;
    
    const tokens = state.vaultData?.customTokens || [];
    if (tokens.length === 0) {
        if (empty) empty.classList.remove('hidden');
        list.innerHTML = '';
        return;
    }
    
    if (empty) empty.classList.add('hidden');
    list.innerHTML = tokens.map(t => `
        <div class="perm-row">
            <div class="perm-info">
                <span><strong>${escapeHtml(t.symbol)}</strong> <span class="perm-auto">${escapeHtml(t.chainKey)} • ${escapeHtml(t.contractAddress)}</span></span>
                <div class="perm-auto">Decimals: ${t.decimals}</div>
            </div>
            <button class="btn-secondary" type="button" onclick="onDeleteCustomToken(${t.id})">Delete</button>
        </div>
    `).join('');
}

async function onDeleteCustomToken(id) {
    if (confirm('Delete this custom token?')) {
        await deleteCustomTokenEntry(id);
        renderCustomTokens();
        showToast('Token deleted', 'info');
    }
}

function updateSendAddressBookAutocomplete() {
    const toInput = document.getElementById('send-to');
    const contacts = state.vaultData?.addressBook || [];
    if (contacts.length === 0) return;
    
    let dataList = document.getElementById('address-datalist');
    if (!dataList) {
        dataList = document.createElement('datalist');
        dataList.id = 'address-datalist';
        document.body.appendChild(dataList);
        if (toInput) toInput.setAttribute('list', 'address-datalist');
    }
    
    dataList.innerHTML = contacts.map(c => 
        `<option value="${escapeHtml(c.address)}" data-name="${escapeHtml(c.name)}"></option>`
    ).join('');
}

function onClearVault() {
    if (confirm('Are you sure you want to clear the vault? This cannot be undone.')) {
        showToast('Vault cleared', 'warning');
        localStorage.removeItem(CONSTANTS.VAULT_STORAGE_KEY);
        state.vaultData = { mnemonic: null, mnemonics: [], privKeys: [], permissions: {}, addressBook: [], customTokens: [], txHistory: [] };
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

function onMaxAmount() {
    const selectedAccId = state.currentAccountId;
    if (!selectedAccId) {
        showToast('Select an account first', 'error');
        return;
    }
    const acc = state.accounts.find(a => a.id === selectedAccId);
    if (!acc) return;
    
    const sendType = document.getElementById('send-asset-type')?.value;
    if (sendType === 'native') {
        document.getElementById('send-amount').value = formatBalance(acc.nativeBal, 6);
    } else {
        const sym = sendType;
        const tokenBal = acc.tokens[sym] || 0;
        document.getElementById('send-amount').value = formatBalance(tokenBal, 6);
    }
}

async function onSaveNetworkConfig() {
    const inputs = document.querySelectorAll('.rpc-input');
    let changed = false;
    
    Object.keys(CHAINS).forEach(chainKey => {
        const chain = CHAINS[chainKey];
        const inputs = document.querySelectorAll(`.network-rpc-row[data-chain="${chainKey}"] .rpc-input`);
        const newRpcs = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
        
        if (JSON.stringify(newRpcs) !== JSON.stringify(chain.rpc)) {
            chain.rpc = newRpcs;
            changed = true;
        }
    });
    
    if (changed) {
        persistVault();
        showToast('Network configuration saved', 'success');
        checkAllNetworkHealth();
    } else {
        showToast('No changes to save', 'info');
    }
}

function wireEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    
    const hideZero = document.getElementById('hide-zero-toggle');
    if (hideZero) hideZero.addEventListener('change', renderAccounts);
    
    const sendType = document.getElementById('send-asset-type');
    if (sendType) sendType.addEventListener('change', updateSendUI);
    
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.addEventListener('click', handleSend);
    
    const importBtn = document.getElementById('import-btn');
    if (importBtn) importBtn.addEventListener('click', onImportClick);
    
    const exportVaultBtn = document.getElementById('export-vault-btn');
    if (exportVaultBtn) exportVaultBtn.addEventListener('click', onExportVault);
    
    const importVaultBtn = document.getElementById('import-vault-btn');
    if (importVaultBtn) importVaultBtn.addEventListener('click', onImportVaultFile);
    
    const importFileBtn = document.getElementById('if-import-btn');
    if (importFileBtn) importFileBtn.addEventListener('click', onImportFileConfirm);
    
    const importFileCancelBtn = document.getElementById('if-cancel-btn');
    if (importFileCancelBtn) importFileCancelBtn.addEventListener('click', () => {
        document.getElementById('import-file-modal').classList.add('hidden');
    });
    
    const addContactBtn = document.getElementById('add-contact-btn');
    if (addContactBtn) addContactBtn.addEventListener('click', onAddContact);
    
    const abSaveBtn = document.getElementById('ab-save-btn');
    if (abSaveBtn) abSaveBtn.addEventListener('click', onSaveContact);
    
    const abCancelBtn = document.getElementById('ab-cancel-btn');
    if (abCancelBtn) abCancelBtn.addEventListener('click', () => {
        document.getElementById('address-book-modal').classList.add('hidden');
    });
    
    const addressBookBtn = document.getElementById('address-book-btn');
    if (addressBookBtn) addressBookBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderAddressBook();
        showToast('Address book opened', 'info');
    });
    
    const addCustomTokenBtn = document.getElementById('add-custom-token-btn');
    if (addCustomTokenBtn) addCustomTokenBtn.addEventListener('click', onAddCustomToken);
    
    const ctSaveBtn = document.getElementById('ct-save-btn');
    if (ctSaveBtn) ctSaveBtn.addEventListener('click', onSaveCustomToken);
    
    const ctCancelBtn = document.getElementById('ct-cancel-btn');
    if (ctCancelBtn) ctCancelBtn.addEventListener('click', () => {
        document.getElementById('custom-token-modal').classList.add('hidden');
    });
    
    const signMessageBtn = document.getElementById('sign-message-btn');
    if (signMessageBtn) signMessageBtn.addEventListener('click', signMessage);
    
    const verifySignatureBtn = document.getElementById('verify-signature-btn');
    if (verifySignatureBtn) verifySignatureBtn.addEventListener('click', openVerifyModal);
    
    const verifyModalBtn = document.getElementById('verify-modal-btn');
    if (verifyModalBtn) verifyModalBtn.addEventListener('click', verifySignature);
    
    const verifyModalCancelBtn = document.getElementById('verify-modal-cancel-btn');
    if (verifyModalCancelBtn) verifyModalCancelBtn.addEventListener('click', closeVerifyModal);
    
    const maxBtn = document.getElementById('max-btn');
    if (maxBtn) maxBtn.addEventListener('click', onMaxAmount);
    
    const saveAdvancedBtn = document.getElementById('save-advanced-btn');
    if (saveAdvancedBtn) saveAdvancedBtn.addEventListener('click', saveAdvancedSettings);
    
    const clearVaultBtn = document.getElementById('clear-vault-btn');
    if (clearVaultBtn) clearVaultBtn.addEventListener('click', onClearVault);
    
    const resetAppBtn = document.getElementById('reset-app-btn');
    if (resetAppBtn) resetAppBtn.addEventListener('click', onResetApp);
    
    const saveNetworkBtn = document.getElementById('save-network-btn');
    if (saveNetworkBtn) saveNetworkBtn.addEventListener('click', onSaveNetworkConfig);
    
    const refreshPricesBtn = document.getElementById('refresh-prices-btn');
    if (refreshPricesBtn) refreshPricesBtn.addEventListener('click', async () => {
        refreshPricesBtn.disabled = true;
        await refreshPrices();
        refreshPricesBtn.disabled = false;
    });
    
    const refreshAssetsBtn = document.getElementById('refresh-assets-btn');
    if (refreshAssetsBtn) refreshAssetsBtn.addEventListener('click', () => {
        refreshAssetsBtn.disabled = true;
        scanAllBalances();
        setTimeout(() => { refreshAssetsBtn.disabled = false; }, 1000);
    });
    
    const revokeAllPermsBtn = document.getElementById('revoke-all-permissions-btn');
    if (revokeAllPermsBtn) revokeAllPermsBtn.addEventListener('click', async () => {
        if (confirm('Revoke all permissions?')) {
            await clearSitePermissions();
            renderPermissions();
        }
    });
    
    const scConfirmBtn = document.getElementById('sc-confirm-btn');
    if (scConfirmBtn) scConfirmBtn.addEventListener('click', () => {
        if (window.sendConfirmCallback) {
            window.sendConfirmCallback();
            document.getElementById('send-confirm-modal').classList.add('hidden');
        }
    });
    
    const scCancelBtn = document.getElementById('sc-cancel-btn');
    if (scCancelBtn) scCancelBtn.addEventListener('click', () => {
        document.getElementById('send-confirm-modal').classList.add('hidden');
    });
    
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
        }
    });
}

window.copyAddressFromBook = copyAddressFromBook;
window.deleteContact = deleteContact;
window.onDeleteCustomToken = onDeleteCustomToken;