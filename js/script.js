/* script.js — bootstrap, dependency check, error boundary */

function checkDependencies() {
    const missing = [];
    if (!window.ethers) missing.push('ethers');
    if (!window.solana || !window.solana.web3) missing.push('@solana/web3.js');
    if (!window.TronWeb) missing.push('TronWeb');
    if (!window.Buffer) missing.push('buffer');
    return missing;
}

function showInitError(message) {
    const banner = document.getElementById('init-error');
    if (banner) {
        banner.textContent = message;
        banner.classList.remove('hidden');
    }
}

function setVaultStateFromStorage() {
    if (!hasStoredVault()) {
        updateVaultPill('no-vault');
    } else {
        updateVaultPill();
    }
}

async function bootstrapVault() {
    if (!hasStoredVault()) {
        switchTab('settings');
        return;
    }
    try {
        await loadVault();
        loadSavedSettings();
        loadAdvancedSettings();
        await generateAccountsList();
        updateVaultPill();
        log(`Vault loaded — ${state.accounts.length} wallets derived.`, 'success');
        if (state.accounts.length === 0) {
            showToast('Vault loaded but no wallets could be derived', 'warning');
            return;
        }
        await scanAllBalances();
        initAllBalance();
        populateSignAccountSelect();
        fetchTransactionHistory();
    } catch (e) {
        console.error('Vault load failed:', e);
        showToast('Vault failed to load: ' + e.message, 'error');
        log('Vault load failed: ' + e.message, 'error');
    }
}

async function init() {
    try {
        const missing = checkDependencies();
        if (missing.length > 0) {
            showInitError('Failed to load required libraries: ' + missing.join(', ') + '. Check your internet connection and reload.');
            return;
        }
        
        initTheme();
        initPricing();
        initNetwork();
        wireEvents();
        initTransactions();
        initSigning();
        initAllBalance();
        populateSignAccountSelect();
        
        refreshPrices();
        setInterval(refreshPrices, 5 * 60 * 1000);
        
        setVaultStateFromStorage();
        await bootstrapVault();
        
        log('OmniChain Wallet ready.', 'success');
        showToast('Wallet initialized successfully', 'success');
        
    } catch (e) {
        showInitError('Startup error: ' + e.message);
        console.error('Startup error:', e);
    }
}

window.addEventListener('error', (e) => {
    try { log('Uncaught error: ' + e.message, 'error'); } catch (_) {}
});

window.addEventListener('unhandledrejection', (e) => {
    try { log('Unhandled promise: ' + (e.reason?.message || e.reason), 'error'); } catch (_) {}
});

document.addEventListener('DOMContentLoaded', init);