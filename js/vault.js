/* vault.js — vault storage, import, permissions, address book, tx history */

const state = {
    vaultData: { mnemonic: null, mnemonics: [], privKeys: [], permissions: {}, addressBook: [], customTokens: [], txHistory: [] },
    accounts: [],
    currentAccountId: null,
    pendingDomain: null,
    scanRunning: false,
    scanQueued: false,
    keyCache: {},
    networkHealth: {},
    balanceHealth: {},
    currency: 'usd',
    assetCurrency: 'usd'
};

function persistVault() {
    localStorage.setItem(CONSTANTS.VAULT_STORAGE_KEY, JSON.stringify(state.vaultData));
}

function parseImports(mnemoLines, pkLines) {
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
    return { data: newData, count: Math.max(totalCount, mergedMnemonics.length + mergedPrivKeys.length) };
}

async function saveVault(newData) {
    state.vaultData = newData;
    await persistVault();
}

const saveVaultDirect = saveVault;

async function loadVault() {
    const stored = localStorage.getItem(CONSTANTS.VAULT_STORAGE_KEY);
    if (!stored) throw new Error("No vault found.");
    const data = JSON.parse(stored);
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
}

function hasStoredVault() {
    return Boolean(localStorage.getItem(CONSTANTS.VAULT_STORAGE_KEY));
}

async function grantSitePermission(domain, autoSign) {
    state.vaultData.permissions = state.vaultData.permissions || {};
    state.vaultData.permissions[domain] = { granted: true, autoSign, timestamp: Date.now() };
    await persistVault();
}

async function revokeSitePermission(domain) {
    delete state.vaultData.permissions[domain];
    await persistVault();
}

async function clearSitePermissions() {
    state.vaultData.permissions = {};
    await persistVault();
}

async function addAddressBookEntry(name, address) {
    state.vaultData.addressBook = state.vaultData.addressBook || [];
    const existing = state.vaultData.addressBook.findIndex(e => e.address === address);
    if (existing >= 0) {
        state.vaultData.addressBook[existing].name = name;
    } else {
        state.vaultData.addressBook.push({ id: Date.now(), name, address });
    }
    await persistVault();
    return state.vaultData.addressBook;
}

async function deleteAddressBookEntry(id) {
    state.vaultData.addressBook = (state.vaultData.addressBook || []).filter(e => e.id !== id);
    await persistVault();
    return state.vaultData.addressBook;
}

async function addCustomToken(chainKey, symbol, contractAddress, decimals) {
    state.vaultData.customTokens = state.vaultData.customTokens || [];
    state.vaultData.customTokens.push({
        id: Date.now(),
        symbol: symbol.toUpperCase(),
        chainKey,
        contractAddress,
        decimals: Number(decimals)
    });
    await persistVault();
    return state.vaultData.customTokens;
}

async function deleteCustomTokenEntry(id) {
    state.vaultData.customTokens = (state.vaultData.customTokens || []).filter(t => t.id !== id);
    await persistVault();
    return state.vaultData.customTokens;
}

function addTransactionHistory(tx) {
    state.vaultData.txHistory = state.vaultData.txHistory || [];
    state.vaultData.txHistory.unshift({
        id: Date.now() + Math.random(),
        ...tx,
        timestamp: tx.timestamp || Date.now(),
        status: tx.status || 'pending'
    });
    if (state.vaultData.txHistory.length > 200) {
        state.vaultData.txHistory = state.vaultData.txHistory.slice(0, 200);
    }
    persistVault();
}

async function exportVault() {
    const stored = localStorage.getItem(CONSTANTS.VAULT_STORAGE_KEY);
    if (!stored) throw new Error("No vault found.");
    return {
        data: stored,
        timestamp: new Date().toISOString(),
        version: '1.0'
    };
}

async function importVaultFile(vaultDataStr) {
    const data = JSON.parse(vaultDataStr);
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
    state.vaultData = data;
    await persistVault();
    return data;
}