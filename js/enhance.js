/**
 * patch.js — Fix for multi-seed import freeze and cache persistence issues
 * 
 * Apply this AFTER kv.js loads
 * Fixes:
 *   1. Browser freeze during multi-seed import
 *   2. Cache not persisting properly
 *   3. Race conditions during vault initialization
 */

(function() {
    'use strict';

    // =========================================================
    // FIX 1: Reduce concurrency during import to prevent freeze
    // =========================================================

    const ORIGINAL_SCAN_CONCURRENCY = CONSTANTS.SCAN_CONCURRENCY;

    function getImportScanConcurrency() {
        // During import, use very conservative concurrency
        const totalMnemonics = state.vaultData?.mnemonics?.length || 0;
        const totalPrivKeys = state.vaultData?.privKeys?.length || 0;
        const totalImports = totalMnemonics + totalPrivKeys;

        if (totalImports > 3) return 2;
        if (totalImports > 1) return 4;
        return Math.min(ORIGINAL_SCAN_CONCURRENCY, 5);
    }

    // Override scanConcurrency temporarily during import
    const ORIGINAL_SCAN_CONCURRENCY_FUNC = window.scanConcurrency || function() {
        const n = (state.accounts || []).length;
        if (n > 200) return 2;
        if (n > 100) return 3;
        if (n > 40) return 5;
        if (n > 20) return 8;
        return CONSTANTS.SCAN_CONCURRENCY;
    };

    function getScanConcurrency(importMode = false) {
        if (importMode) {
            return getImportScanConcurrency();
        }
        return ORIGINAL_SCAN_CONCURRENCY_FUNC();
    }

    // =========================================================
    // FIX 2: Wait for IndexedDB to be ready before operations
    // =========================================================

    let indexedDbReady = false;
    let indexedDbReadyPromise = null;

    async function waitForIndexedDb() {
        if (indexedDbReady) return true;
        if (indexedDbReadyPromise) return indexedDbReadyPromise;

        indexedDbReadyPromise = new Promise((resolve) => {
            if (typeof cacheManager?.indexedDb?.ready !== 'undefined') {
                cacheManager.indexedDb.ready.then(() => {
                    indexedDbReady = true;
                    resolve(true);
                }).catch(() => {
                    indexedDbReady = true; // Even on error, continue
                    resolve(true);
                });
            } else {
                // Fallback - wait 100ms for DB to initialize
                setTimeout(() => {
                    indexedDbReady = true;
                    resolve(true);
                }, 100);
            }
        });

        return indexedDbReadyPromise;
    }

    // =========================================================
    // FIX 3: Staggered account derivation to prevent memory spike
    // =========================================================

    async function staggeredGenerateAccounts() {
        const mnemonics = state.vaultData.mnemonics || [];
        const privKeys = state.vaultData.privKeys || [];
        
        // Derive from one mnemonic at a time with delays
        for (let mIdx = 0; mIdx < mnemonics.length; mIdx++) {
            const mnemonic = mnemonics[mIdx];
            
            for (const chainKey of Object.keys(CHAINS)) {
                const chain = CHAINS[chainKey];
                if (chain.kind !== 'evm' && chain.kind !== 'solana' && chain.kind !== 'tron') continue;

                const startPath = chain.path || `m/44'/60'/0'/0/`;

                for (let i = 0; i < CONSTANTS.DERIVATION_COUNT; i++) {
                    try {
                        if (chain.kind === 'evm') {
                            const wallet = window.ethers.HDNodeWallet.fromPhrase(mnemonic, "", `${startPath}${i}`);
                            addAccountInternal({
                                type: 'evm',
                                address: wallet.address,
                                chainKey,
                                chainObj: chain,
                                nativeBal: 0,
                                tokens: {},
                                isLoading: true,
                                scanError: null,
                                derivationPath: `${startPath}${i}`,
                                privateKey: wallet.privateKey
                            });
                        } else if (chain.kind === 'solana') {
                            const seed = window.ethers.Mnemonic.fromPhrase(mnemonic).computeSeed();
                            const childKey = await slip10DeriveEd25519(seed, `${startPath}${i}`);
                            const kp = window.solana.web3.Keypair.fromSeed(childKey);
                            addAccountInternal({
                                type: 'solana',
                                address: kp.publicKey.toBase58(),
                                chainKey,
                                chainObj: chain,
                                nativeBal: 0,
                                tokens: {},
                                isLoading: true,
                                scanError: null,
                                derivationPath: `${startPath}${i}`,
                                secretKey: Array.from(childKey)
                            });
                        } else if (chain.kind === 'tron') {
                            const wallet = window.ethers.HDNodeWallet.fromPhrase(mnemonic, "", `m/44'/195'/0'/0/${i}`);
                            const tw = new window.TronWeb({
                                fullHost: getWorkingRpcForChain(chainKey, chain),
                                privateKey: wallet.privateKey
                            });
                            addAccountInternal({
                                type: 'tron',
                                address: tw.defaultAddress.base58,
                                chainKey,
                                chainObj: chain,
                                nativeBal: 0,
                                tokens: {},
                                isLoading: true,
                                scanError: null,
                                derivationPath: `m/44'/195'/0'/0/${i}`,
                                privateKey: wallet.privateKey
                            });
                        }
                    } catch (e) {
                        console.warn("Derivation error:", e);
                    }
                }
            }

            // Yield between mnemonics to prevent UI freeze
            if (mIdx < mnemonics.length - 1) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        // Then add private keys
        for (const pk of privKeys) {
            await new Promise(r => setTimeout(r, 50)); // Small delay between each key
            
            if (pk.type === 'evm') {
                const w = new window.ethers.Wallet(pk.key);
                Object.keys(CHAINS).forEach(chainKey => {
                    if (CHAINS[chainKey].kind === 'evm') {
                        addAccountInternal({
                            type: 'evm',
                            address: w.address,
                            chainKey,
                            chainObj: CHAINS[chainKey],
                            nativeBal: 0,
                            tokens: {},
                            isLoading: true,
                            scanError: null,
                            derivationPath: null,
                            privateKey: w.privateKey
                        });
                    }
                });
            } else if (pk.type === 'solana') {
                let kp = null;
                try {
                    kp = window.solana.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk.key)));
                } catch {
                    if (window.Buffer) {
                        kp = window.solana.web3.Keypair.fromSeed(window.Buffer.from(pk.key, 'base58'));
                    }
                }
                if (kp) {
                    addAccountInternal({
                        type: 'solana',
                        address: kp.publicKey.toBase58(),
                        chainKey: 'solana',
                        chainObj: CHAINS.solana,
                        nativeBal: 0,
                        tokens: {},
                        isLoading: true,
                        scanError: null,
                        derivationPath: CHAINS.solana.path + "0",
                        secretKey: Array.from(kp.secretKey)
                    });
                }
            }
        }
    }

    function addAccountInternal(acc) {
        const key = `${acc.chainKey}:${acc.address}`;
        if (state._seenAccounts?.has(key)) return;
        state._seenAccounts?.add(key);
        acc.id = state._idCounter++ || 0;
        state._idCounter = (acc.id || 0) + 1;
        state.accounts.push(acc);
    }

    // =========================================================
    // FIX 4: Delayed scan with progress indication
    // =========================================================

    let importInProgress = false;

    async function delayedScanWithProgress() {
        if (importInProgress) {
            console.log('Scan already queued, skipping');
            return;
        }

        importInProgress = true;
        
        // Wait for IndexedDB
        await waitForIndexedDb();
        
        // Small delay to let UI render
        await new Promise(r => setTimeout(r, 200));

        const activeCount = getActiveAccounts().length;
        
        // Use reduced concurrency during initial import
        const originalConcurrency = CONSTANTS.SCAN_CONCURRENCY;
        CONSTANTS.SCAN_CONCURRENCY = getImportScanConcurrency();

        log(`Starting balance scan for ${activeCount} accounts...`, 'info');
        
        try {
            await scanAllBalances();
            initAllBalance();
            log('Initial balance scan complete', 'success');
        } catch (e) {
            console.error('Initial scan failed:', e);
            log('Initial scan failed: ' + e.message, 'error');
        } finally {
            CONSTANTS.SCAN_CONCURRENCY = originalConcurrency;
            importInProgress = false;
            
            // Schedule periodic snapshots after import completes
            if (getActiveAccounts().length > 0) {
                setTimeout(() => {
                    PortfolioAnalytics?.recordSnapshot?.();
                    setInterval(PortfolioAnalytics?.recordSnapshot.bind(PortfolioAnalytics), 3600000);
                }, 5000);
            }
        }
    }

    // =========================================================
    // FIX 5: Override parseImports to use staggered generation
    // =========================================================

    const ORIGINAL_PARSE_IMPORTS = window.parseImports;

    window.parseImports = async function(mnemoLines, pkLines) {
        const existing = state.vaultData || {};
        const existingMnemonics = existing.mnemonics || (existing.mnemonic ? [existing.mnemonic] : []);
        const existingPrivKeys = existing.privKeys || [];

        const mergedMnemonics = [...new Set([...existingMnemonics, ...mnemoLines.filter(m => window.ethers.Mnemonic.isValidMnemonic(m))])];
        const mergedPrivKeys = [...existingPrivKeys];

        let newCount = 0;

        for (const k of pkLines) {
            const trimmed = k.trim();
            if (/^0x[0-9a-fA-F]{64}$/.test(trimmed) || /^[0-9a-fA-F]{64}$/.test(trimmed)) {
                const alreadyExists = mergedPrivKeys.some(pk => pk.type === 'evm' && pk.key.toLowerCase() === (trimmed.startsWith('0x') ? trimmed : '0x' + trimmed).toLowerCase());
                if (!alreadyExists) {
                    const w = new window.ethers.Wallet(trimmed.startsWith('0x') ? trimmed : '0x' + trimmed);
                    mergedPrivKeys.push({ type: 'evm', key: w.privateKey });
                    newCount++;
                }
            } else if (trimmed.length > 60) {
                try {
                    const arr = JSON.parse(trimmed);
                    const kp = window.solana.web3.Keypair.fromSecretKey(Uint8Array.from(arr));
                    if (!mergedPrivKeys.some(pk => pk.type === 'solana' && pk.key === trimmed)) {
                        mergedPrivKeys.push({ type: 'solana', key: trimmed });
                        newCount++;
                    }
                } catch (e2) {
                    if (window.Buffer) {
                        try {
                            const seed = window.Buffer.from(trimmed, 'base58');
                            if (seed.length === 32) {
                                if (!mergedPrivKeys.some(pk => pk.type === 'solana' && pk.key === trimmed)) {
                                    mergedPrivKeys.push({ type: 'solana', key: trimmed });
                                    newCount++;
                                }
                            }
                        } catch (e3) { }
                    }
                }
            }
        }

        const newMnemonicCount = mergedMnemonics.length - existingMnemonics.length;
        const totalCount = newMnemonicCount + newCount;

        const newData = {
            mnemonic: mergedMnemonics[0] || null,
            mnemonics: mergedMnemonics,
            privKeys: mergedPrivKeys,
            permissions: existing.permissions || {},
            addressBook: existing.addressBook || [],
            customTokens: existing.customTokens || [],
            txHistory: existing.txHistory || []
        };

        if (!newData.mnemonic && !newData.privKeys.length) {
            throw new Error("No valid keys or mnemonics found.");
        }

        // Initialize tracking for staggered derivation
        state._seenAccounts = new Set();
        state._idCounter = 0;
        state.accounts = [];

        // Staggered account generation instead of blocking
        await staggeredGenerateAccounts();

        return { data: newData, count: Math.max(totalCount, mergedMnemonics.length + mergedPrivKeys.length) };
    };

    // =========================================================
    // FIX 6: Override saveVault to ensure persistence
    // =========================================================

    const ORIGINAL_PERSIST_VAULT = window.persistVault;

    window.persistVault = async function() {
        // Ensure we have a small delay for localStorage to be ready
        await new Promise(r => setTimeout(r, 10));
        
        try {
            localStorage.setItem(CONSTANTS.VAULT_STORAGE_KEY, JSON.stringify(state.vaultData));
            // Also update IndexedDB cache if available
            if (cacheManager?.indexedDb) {
                try {
                    await cacheManager.indexedDb.set('vault_backup', state.vaultData, 3600);
                } catch (e) {
                    // Silently fail - localStorage is primary storage
                }
            }
        } catch (e) {
            console.error('Vault persistence failed:', e);
            showToast('Warning: Failed to persist vault data', 'warning');
            throw e;
        }
    };

    // =========================================================
    // FIX 7: Override bootstrapVault to include delays
    // =========================================================

    const ORIGINAL_BOOTSTRAP_VAULT = window.bootstrapVault;

    window.bootstrapVault = async function() {
        if (!hasStoredVault()) {
            switchTab('settings');
            return;
        }

        try {
            // Wait for IndexedDB to be ready first
            await waitForIndexedDb();
            
            // Load vault data
            await loadVault();
            
            // Apply settings
            loadSavedSettings();
            loadAdvancedSettings();

            // Clear old account list
            state.accounts = [];
            state._seenAccounts = new Set();
            state._idCounter = 0;
            state.keyCache = {};

            // Generate accounts (will be staggered via our override above)
            await staggeredGenerateAccounts();

            updateVaultPill();
            log(`Vault loaded — ${state.accounts.length} wallets derived.`, 'success');

            if (state.accounts.length === 0) {
                showToast('Vault loaded but no wallets could be derived', 'warning');
                return;
            }

            // Delayed scan with progress
            await delayedScanWithProgress();

            // Remaining initialization
            initAllBalance();
            populateSignAccountSelect();
            fetchTransactionHistory();

        } catch (e) {
            console.error('Vault load failed:', e);
            showToast('Vault failed to load: ' + e.message, 'error');
            log('Vault load failed: ' + e.message, 'error');
        }
    };

    // =========================================================
    // FIX 8: Improve IndexedDB reliability
    // =========================================================

    const ORIGINAL_INIT_DB = IndexedDBCache.prototype._initDb;

    IndexedDBCache.prototype._initDb = function() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            
            request.onerror = () => {
                console.warn('IndexedDB failed, using memory cache only');
                resolve(null);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };

            // Timeout after 5 seconds if DB takes too long
            setTimeout(() => {
                if (!this.db) {
                    console.warn('IndexedDB open timeout, continuing without it');
                    resolve(null);
                }
            }, 5000);
        });
    };

    // =========================================================
    // FIX 9: Add cleanup for old accounts before re-import
    // =========================================================

    async function cleanupOldAccounts() {
        // Clear account references before new import
        state.accounts = [];
        state.keyCache = {};
        state._seenAccounts = new Set();
        state._idCounter = 0;
        
        // Clear provider pool to avoid stale connections
        clearProviderPool();
        
        // Wait a tick for cleanup to complete
        await new Promise(r => setTimeout(r, 50));
    }

    // Run cleanup before any import
    const originalOnImportClick = window.onImportClick;
    window.onImportClick = async function() {
        await cleanupOldAccounts();
        
        if (originalOnImportClick) {
            await originalOnImportClick();
        }
    };

    // =========================================================
    // FIX 10: Add recovery for corrupted vault
    // =========================================================

    async function recoverCorruptedVault() {
        try {
            const stored = localStorage.getItem(CONSTANTS.VAULT_STORAGE_KEY);
            if (!stored) return null;

            const data = JSON.parse(stored);
            
            // Validate structure
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid vault structure');
            }

            // Ensure all required fields exist
            data.mnemonic = data.mnemonic || null;
            data.mnemonics = data.mnemonics || (data.mnemonic ? [data.mnemonic] : []);
            data.privKeys = Array.isArray(data.privKeys) ? data.privKeys : [];
            data.permissions = data.permissions || {};
            data.addressBook = data.addressBook || [];
            data.customTokens = data.customTokens || [];
            data.txHistory = data.txHistory || [];

            return data;
        } catch (e) {
            console.error('Vault recovery failed:', e);
            return null;
        }
    }

    const ORIGINAL_LOAD_VAULT = window.loadVault;

    window.loadVault = async function() {
        let stored = localStorage.getItem(CONSTANTS.VAULT_STORAGE_KEY);
        
        if (!stored) {
            throw new Error("No vault found.");
        }

        let data;
        try {
            data = JSON.parse(stored);
        } catch (e) {
            console.warn('Vault JSON parse failed, attempting recovery...');
            const recovered = await recoverCorruptedVault();
            if (!recovered) {
                throw new Error("Vault data corrupted and could not be recovered.");
            }
            data = recovered;
        }

        data.permissions = data.permissions || {};
        data.addressBook = data.addressBook || [];
        data.customTokens = data.customTokens || [];
        data.txHistory = data.txHistory || [];

        if (!Array.isArray(data.privKeys)) {
            data.privKeys = data.privKeys.evm ? [{ type: 'evm', key: data.privKeys.evm }] :
                           data.privKeys.solana ? [{ type: 'solana', key: data.privKeys.solana }] : [];
        }

        if (!data.mnemonics) {
            data.mnemonics = data.mnemonic ? [data.mnemonic] : [];
        }

        data.txHistory = (data.txHistory || []).filter(tx => !tx.chainKey || CHAINS[tx.chainKey]);
        data.customTokens = (data.customTokens || []).filter(t => !t.chainKey || CHAINS[t.chainKey]);

        state.vaultData = data;
        return data;
    };

    // =========================================================
    // EXPORT GLOBAL HELPERS
    // =========================================================

    window.waitForIndexedDb = waitForIndexedDb;
    window.staggeredGenerateAccounts = staggeredGenerateAccounts;
    window.delayedScanWithProgress = delayedScanWithProgress;
    window.getImportScanConcurrency = getImportScanConcurrency;

})();
