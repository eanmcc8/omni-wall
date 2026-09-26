/* pricing.js — price fetching, caching, currency conversion, allocation chart */

function formatCurrency(amount, currency = CONSTANTS.DEFAULT_CURRENCY) {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currency.toUpperCase(),
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(amount);
    } catch (_) {
        const symbols = CURRENCY_SYMBOLS[currency] || '$';
        return symbols + Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
}

const priceCache = new Map();

function initPricing() {
    const selector = document.getElementById('currency-selector');
    if (selector) {
        selector.addEventListener('change', () => {
            state.currency = selector.value;
            localStorage.setItem('omni_currency', selector.value);
            refreshPrices();
        });
        const saved = localStorage.getItem('omni_currency');
        state.currency = saved || selector.value || CONSTANTS.DEFAULT_CURRENCY;
        selector.value = state.currency;
    }

    const assetSelector = document.getElementById('asset-currency-selector');
    if (assetSelector) {
        assetSelector.addEventListener('change', () => {
            state.assetCurrency = assetSelector.value;
            refreshPrices();
        });
        state.assetCurrency = assetSelector.value || state.currency;
    }

    return fetchPrices();
}

function isPriceCached(symbol) {
    const cached = priceCache.get(symbol.toLowerCase());
    if (!cached) return false;
    return (Date.now() - cached.timestamp) < CONSTANTS.PRICE_CACHE_DURATION;
}

function getCachedPrice(symbol) {
    const cached = priceCache.get(symbol.toLowerCase());
    return cached ? cached.price : null;
}

function setCachedPrice(symbol, price) {
    priceCache.set(symbol.toLowerCase(), { price, timestamp: Date.now() });
}

const COINGECKO_IDS = {
    eth: 'ethereum', bnb: 'binancecoin', pol: 'polygon-ecosystem-token',
    avax: 'avalanche-2', sol: 'solana', trx: 'tron',
    gno: 'gnosis', celo: 'celo', glmr: 'moonbeam',
    mnt: 'mantle',
    usdc: 'usd-coin', usdt: 'tether', weth: 'weth'
};

async function fetchPrices() {
    const symbols = new Set();
    Object.values(CHAINS).forEach(chain => {
        symbols.add(chain.symbol.toLowerCase());
    });
    Object.keys(TOKENS).forEach(chainKey => {
        const tokens = TOKENS[chainKey];
        if (tokens) Object.keys(tokens).forEach(t => symbols.add(t.toLowerCase()));
    });

    const uncached = [...symbols].filter(s => !isPriceCached(s));
    if (uncached.length === 0) return;

    try {
        const ids = [...new Set(uncached.map(s => COINGECKO_IDS[s]))].filter(Boolean);

        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
        const resp = await fetchWithTimeout(url);
        if (!resp.ok) throw new Error(`Price API error: ${resp.status}`);
        const data = await resp.json();

        Object.entries(data).forEach(([id, prices]) => {
            const symbol = Object.keys(COINGECKO_IDS).find(k => COINGECKO_IDS[k] === id);
            if (symbol && typeof prices.usd === 'number' && prices.usd > 0) {
                setCachedPrice(symbol, prices.usd);
            }
        });
    } catch (e) {
        console.warn("Price fetch failed:", e);
    }
}

const EXCHANGE_RATES = {
    usd: 1, eur: 0.92, gbp: 0.79, jpy: 150, btc: 1 / 60000, eth: 1 / 3000
};

function getExchangeRate(currency) {
    return EXCHANGE_RATES[currency] || 1;
}

function refreshPrices() {
    const currency = state.currency || CONSTANTS.DEFAULT_CURRENCY;
    const assetCurrency = state.assetCurrency || currency;

    let totalUsd = 0;
    let assetCount = 0;
    const activeChains = new Set();
    const allocationData = {};
    const dust = CONSTANTS.DUST_USD || 0.01;

    getActiveAccounts().forEach(acc => {
        if (acc.nativeBal > 0) {
            const price = getCachedPrice(acc.chainObj.symbol) || acc.chainObj.usdPrice || 0;
            const usd = acc.nativeBal * price;
            if (usd > dust) {
                allocationData[acc.chainObj.name] = (allocationData[acc.chainObj.name] || 0) + usd;
                totalUsd += usd;
                assetCount++;
                activeChains.add(acc.chainKey);
            }
        }
        Object.entries(acc.tokens).forEach(([sym, bal]) => {
            if (bal > 0) {
                const price = getCachedPrice(sym) || TOKEN_PRICES[sym] || 0;
                const usd = bal * price;
                if (usd > dust) {
                    allocationData[sym.toUpperCase()] = (allocationData[sym.toUpperCase()] || 0) + usd;
                    totalUsd += usd;
                    assetCount++;
                    activeChains.add(acc.chainKey);
                }
            }
        });
    });

    const rate = getExchangeRate(currency);
    const assetsCountEl = document.getElementById('total-assets-count');
    const chainsCountEl = document.getElementById('total-active-chains');
    const totalUsdEl = document.getElementById('total-usd-value');
    if (assetsCountEl) assetsCountEl.textContent = assetCount;
    if (chainsCountEl) chainsCountEl.textContent = activeChains.size;
    if (totalUsdEl) totalUsdEl.textContent = formatCurrency(totalUsd * rate, currency);

    renderAllocationChart(allocationData);
    renderAssetsTable(totalUsd, assetCurrency);

    return totalUsd;
}

function renderAllocationChart(data) {
    const container = document.getElementById('allocation-chart');
    if (!container) return;

    const entries = Object.entries(data).filter(([_, v]) => v > (CONSTANTS.DUST_USD || 0.01));
    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 24px 0"><span>No allocation data yet</span></div>';
        return;
    }

    entries.sort((a, b) => b[1] - a[1]);

    const COLORS = ['#7c5cff', '#38bdf8', '#14f195', '#fbbf24', '#f87171', '#8247e5', '#627eea', '#f3ba2f', '#28a0f0', '#ff0420'];
    const total = entries.reduce((sum, [_, v]) => sum + v, 0);
    const radius = 80;
    const cx = 100;
    const cy = 100;

    let svgParts = [];
    svgParts.push(`<svg class="allocation-svg" viewBox="0 0 200 200" width="200" height="200">`);

    let offset = 0;
    entries.forEach(([label, value], i) => {
        const angle = (value / total) * 360;
        const color = COLORS[i % COLORS.length];
        const largeArc = angle > 180 ? 1 : 0;

        const startAngle = offset * Math.PI / 180;
        const endAngle = (offset + angle) * Math.PI / 180;
        const x1 = cx + radius * Math.sin(startAngle);
        const y1 = cy - radius * Math.cos(startAngle);
        const x2 = cx + radius * Math.sin(endAngle);
        const y2 = cy - radius * Math.cos(endAngle);

        if (Math.abs(angle - 360) < 0.1) {
            svgParts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}" stroke="var(--surface)" stroke-width="2"></circle>`);
        } else {
            svgParts.push(`<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="var(--surface)" stroke-width="2"></path>`);
        }

        offset += angle;
    });

    svgParts.push('</svg>');

    const legendHtml = entries.map(([label, value], i) => {
        const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
        const color = COLORS[i % COLORS.length];
        return `<div class="legend-item">
            <span class="legend-dot" style="background:${color}"></span>
            <span class="legend-label">${escapeHtml(label)}</span>
            <span class="legend-value">${percent}%</span>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="allocation-chart-container">${svgParts.join('')}<div class="allocation-legend">${legendHtml}</div></div>`;
}

function renderAssetsTable(totalUsd, currency) {
    const tbody = document.getElementById('assets-tbody');
    const empty = document.getElementById('assets-empty');
    if (!tbody) return;

    const rows = [];
    const rate = getExchangeRate(currency);
    const dust = CONSTANTS.DUST_USD || 0.01;

    getActiveAccounts().forEach(acc => {
        if (acc.scanError) return;
        if (acc.nativeBal > 0) {
            const price = getCachedPrice(acc.chainObj.symbol) || acc.chainObj.usdPrice || 0;
            const valueUsd = acc.nativeBal * price;
            if (valueUsd > dust) {
                rows.push({
                    symbol: acc.chainObj.symbol,
                    chainKey: acc.chainKey,
                    chainName: acc.chainObj.name,
                    balance: acc.nativeBal,
                    priceUsd: price,
                    valueUsd
                });
            }
        }
        Object.entries(acc.tokens).forEach(([sym, bal]) => {
            if (bal > 0) {
                const price = getCachedPrice(sym) || TOKEN_PRICES[sym] || 0;
                const valueUsd = bal * price;
                if (valueUsd > dust) {
                    rows.push({
                        symbol: sym.toUpperCase(),
                        chainKey: acc.chainKey,
                        chainName: acc.chainObj.name,
                        balance: bal,
                        priceUsd: price,
                        valueUsd
                    });
                }
            }
        });
    });

    const failed = getActiveAccounts().filter(a => a.scanError);
    const failedEl = document.getElementById('assets-scan-warning');
    if (failedEl) {
        if (failed.length > 0) {
            const byChain = {};
            failed.forEach(a => { byChain[a.chainObj.name] = (byChain[a.chainObj.name] || 0) + 1; });
            const detail = Object.entries(byChain)
                .map(([name, n]) => `${name} (${n})`)
                .join(', ');
            const reason = failed[0].scanError || 'RPC error';
            failedEl.textContent = `${failed.length} of ${getActiveAccounts().length} wallet${failed.length > 1 ? 's' : ''} could not be read and ${failed.length > 1 ? 'are' : 'is'} excluded below. Affected: ${detail}. Last error: ${reason}`;
            failedEl.classList.remove('hidden');
        } else {
            failedEl.textContent = '';
            failedEl.classList.add('hidden');
        }
    }

    const emptyText = document.getElementById('assets-empty-text');
    if (rows.length === 0) {
        if (empty) empty.classList.remove('hidden');
        if (emptyText) {
            emptyText.textContent = failed.length > 0
                ? 'No balances could be read. All RPCs are failing — see warning above.'
                : (getActiveAccounts().length === 0
                    ? 'No assets found. Import accounts to see holdings.'
                    : 'No significant holdings — only dust balances remain.');
        }
        tbody.innerHTML = '';
        return;
    }

    if (empty) empty.classList.add('hidden');

    const priceHeader = document.getElementById('assets-price-header');
    if (priceHeader) priceHeader.textContent = `Price (${currency.toUpperCase()})`;
    const valueHeader = document.getElementById('assets-value-header');
    if (valueHeader) valueHeader.textContent = `Value (${currency.toUpperCase()})`;

    tbody.innerHTML = rows.map(r => {
        const percent = totalUsd > 0 ? ((r.valueUsd / totalUsd) * 100).toFixed(1) : '0.0';
        return `<tr>
            <td class="mono"><strong>${escapeHtml(r.symbol)}</strong></td>
            <td><span class="chain-tag mono" style="font-size:0.72rem; padding:2px 8px; background:var(--surface-2); border:1px solid var(--border)">${escapeHtml(r.chainName)}</span></td>
            <td class="mono">${formatBalance(r.balance)}</td>
            <td class="mono">${r.priceUsd > 0 ? formatCurrency(r.priceUsd * rate, currency) : '—'}</td>
            <td class="mono">${formatCurrency(r.valueUsd * rate, currency)}</td>
            <td class="mono">${percent}%</td>
            <td><button class="icon-btn" type="button" style="width:24px; height:24px" title="Send" aria-label="Send"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13l-6-6"/></svg></button></td>
        </tr>`;
    }).join('');
}
