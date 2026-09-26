/* signing.js — message signing and verification for EVM, Solana, Tron */

function getAccountForSigning(chainKey, derivationPath) {
    const accounts = getActiveAccounts().filter(a => 
        (chainKey === 'evm' ? a.type === 'evm' : 
         chainKey === 'solana' ? a.type === 'solana' : 
         a.type === chainKey)
    );
    return accounts;
}

function populateSignAccountSelect() {
    const select = document.getElementById('sign-account-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">Select account...</option>';
    getActiveAccounts().forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = `${acc.chainObj.name} • ${acc.address.slice(0, 6)}...${acc.address.slice(-4)}`;
        select.appendChild(opt);
    });
}

async function signMessage() {
    const accountId = document.getElementById('sign-account-select').value;
    const message = document.getElementById('sign-message-input').value.trim();
    const signType = document.getElementById('sign-type-select').value;
    const output = document.getElementById('signature-output');
    
    if (!accountId) {
        showToast('Please select an account', 'error');
        return;
    }
    if (!message) {
        showToast('Please enter a message to sign', 'error');
        return;
    }
    
    const acc = state.accounts.find(a => a.id === parseInt(accountId));
    if (!acc) {
        showToast('Account not found', 'error');
        return;
    }
    
    try {
        let signature;
        
        if (signType === 'evm-personal' && acc.type === 'evm') {
            const signer = getEvmSigner(acc, getWorkingProvider(acc.chainKey, acc.chainObj));
            signature = await signer.signMessage(message);
        } else if (signType === 'evm-typed' && acc.type === 'evm') {
            const signer = getEvmSigner(acc, getWorkingProvider(acc.chainKey, acc.chainObj));
            const domain = {
                name: 'OmniChain Wallet',
                version: '1',
                chainId: acc.chainObj.chainId,
            };
            const types = {
                Message: [
                    { name: 'content', type: 'string' },
                    { name: 'timestamp', type: 'uint256' }
                ]
            };
            const value = { content: message, timestamp: Math.floor(Date.now() / 1000) };
            signature = await signer.signTypedData(domain, types, value);
        } else if (signType === 'solana' && acc.type === 'solana') {
            const kp = await getSolanaKeypair(acc);
            if (!kp) throw new Error("No Solana key available");
            const msgBytes = new TextEncoder().encode(message);
            const sigResult = await window.crypto.subtle.sign(
                { name: 'ECDSA', hash: { name: 'SHA-256' } },
                await window.crypto.subtle.importKey('raw', kp.secretKey.slice(0, 32), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
                msgBytes
            );
            const sigBytes = new Uint8Array(sigResult);
            signature = Array.from(sigBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        } else if (signType === 'tron' && acc.type === 'tron') {
            const tw = getTronWeb(acc);
            if (!tw) throw new Error("No Tron key available");
            const msgBytes = new TextEncoder().encode(message);
            const hash = window.TronWeb.utils.crypto.sha256(msgBytes);
            signature = window.TronWeb.utils.crypto.sign(hash, tw.privateKey);
        } else {
            throw new Error(`Type ${signType} not supported for ${acc.chainObj.name}`);
        }
        
        output.value = signature;
        showToast('Message signed', 'success');
        log(`Signed message with ${acc.chainObj.name}: ${signature.slice(0, 20)}...`, 'info');
        
        addTransactionHistory({
            type: 'sign',
            chainKey: acc.chainKey,
            asset: 'message',
            amount: 0,
            txHash: 'sig_' + Math.random().toString(36).slice(2, 10),
            from: acc.address,
            to: '',
            signType,
            message,
            signature,
            status: 'confirmed'
        });
    } catch (e) {
        showToast('Signing failed: ' + e.message, 'error');
        log('Signing error: ' + e.message, 'error');
    }
}

async function openVerifyModal() {
    document.getElementById('verify-address-input').value = '';
    document.getElementById('verify-message-input').value = '';
    document.getElementById('verify-signature-input').value = '';
    document.getElementById('verify-type-select').value = 'evm';
    document.getElementById('verify-modal-result').textContent = '';
    document.getElementById('verify-modal').classList.remove('hidden');
    document.getElementById('verify-address-input').focus();
}

async function verifySignature() {
    const address = document.getElementById('verify-address-input').value.trim();
    const message = document.getElementById('verify-message-input').value.trim();
    const signature = document.getElementById('verify-signature-input').value.trim();
    const sigType = document.getElementById('verify-type-select').value;
    const result = document.getElementById('verify-modal-result');
    
    if (!address || !message || !signature) {
        result.textContent = "All fields are required.";
        result.className = "status-msg error";
        return;
    }
    
    try {
        let isValid = false;
        
        if (sigType === 'evm') {
            const recovered = window.ethers.verifyMessage(message, signature);
            isValid = recovered.toLowerCase() === address.toLowerCase();
        } else if (sigType === 'solana') {
            try {
                const pubkey = new window.solana.web3.PublicKey(address);
                const msgBytes = new TextEncoder().encode(message);
                const sigBytes = Uint8Array.from(window.Buffer.from(signature, 'hex'));
                isValid = window.solana.web3.Ed25519Program.verify(sigBytes, msgBytes, pubkey);
            } catch (e) {
                isValid = false;
            }
        } else if (sigType === 'tron') {
            const msgBytes = new TextEncoder().encode(message);
            const hash = window.TronWeb.utils.crypto.sha256(msgBytes);
            const recovered = window.TronWeb.utils.crypto.ecrecover(signature, hash);
            isValid = recovered.toLowerCase() === address.toLowerCase();
        }
        
        if (isValid) {
            result.textContent = "✓ Signature verified — addresses match";
            result.className = "status-msg success";
            showToast('Signature verified', 'success');
        } else {
            result.textContent = "✗ Signature verification failed — addresses do not match";
            result.className = "status-msg error";
            showToast('Signature verification failed', 'error');
        }
    } catch (e) {
        result.textContent = "Verification error: " + e.message;
        result.className = "status-msg error";
    }
}

function closeVerifyModal() {
    document.getElementById('verify-modal').classList.add('hidden');
    document.getElementById('verify-modal-result').textContent = '';
}

function initSigning() {
    const signSelect = document.getElementById('sign-account-select');
    if (signSelect) {
        signSelect.addEventListener('change', () => {
            const accId = signSelect.value;
            if (accId) {
                const acc = state.accounts.find(a => a.id === parseInt(accId));
                if (acc) {
                    const signType = document.getElementById('sign-type-select');
                    if (signType && acc.type === 'evm') {
                        signType.querySelectorAll('option').forEach(opt => opt.disabled = false);
                    }
                }
            }
        });
    }
    
    const signBtn = document.getElementById('sign-message-btn');
    if (signBtn) {
        signBtn.addEventListener('click', signMessage);
    }
    
    const verifyBtn = document.getElementById('verify-signature-btn');
    if (verifyBtn) {
        verifyBtn.addEventListener('click', openVerifyModal);
    }
    
    const verifyModalBtn = document.getElementById('verify-modal-btn');
    if (verifyModalBtn) {
        verifyModalBtn.addEventListener('click', verifySignature);
    }
    
    const verifyCancelBtn = document.getElementById('verify-modal-cancel-btn');
    if (verifyCancelBtn) {
        verifyCancelBtn.addEventListener('click', closeVerifyModal);
    }
}
