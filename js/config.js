/* config.js — chain/token configuration and shared constants */

const API_KEY_TOKEN = '{API_KEY}';

const ALCHEMY_SLUGS = {
    ethereum: 'eth-mainnet', bnb: 'bnb-mainnet', polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet', optimism: 'opt-mainnet',
    base: 'base-mainnet', avalanche: 'avax-mainnet',
    gnosis: 'gnosis-mainnet'
};

function resolveRpcUrl(url) {
    if (typeof url !== 'string' || !url.includes(API_KEY_TOKEN)) return url;
    const key = (CONSTANTS.NETWORK_API_KEY || '').trim();
    if (!key) return null;
    return url.replace(API_KEY_TOKEN, key);
}

function infuraRpcs(chainKey) {
    const net = INFURA_NETWORKS[chainKey];
    const key = (CONSTANTS.INFURA_KEY || '').trim();
    if (!net || !key) return [];
    return [`https://${net}.infura.io/v3/${key}`];
}

function chainRpcs(chainObj) {
    const out = [];
    for (const url of chainObj.rpc || []) {
        const resolved = resolveRpcUrl(url);
        if (resolved) out.push(resolved);
    }
    return out;
}

function alchemyRpcs(chainKey) {
    const slug = ALCHEMY_SLUGS[chainKey];
    const key = (CONSTANTS.ALCHEMY_KEY || '').trim();
    if (!slug || !key) return [];
    return [`https://${slug}.g.alchemy.com/v2/${key}`];
}

const CHAINS = {
    ethereum: { kind: 'evm', chainId: 1, rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://rpc.flashbots.net'], alchemy: true, symbol: 'ETH', name: 'Ethereum', path: "m/44'/60'/0'/0/", color: '#627eea', usdPrice: 2000, explorerApi: 'https://api.etherscan.io/api', explorerUrl: 'https://etherscan.io' },
    bnb:      { kind: 'evm', chainId: 56, rpc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io', 'https://bsc.publicnode.com'], alchemy: true, symbol: 'BNB', name: 'BNB Chain', path: "m/44'/60'/0'/0/", color: '#f3ba2f', usdPrice: 600, explorerApi: 'https://api.bscscan.com/api', explorerUrl: 'https://bscscan.com' },
    polygon:  { kind: 'evm', chainId: 137, rpc: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'], alchemy: true, symbol: 'POL', name: 'Polygon', path: "m/44'/60'/0'/0/", color: '#8247e5', usdPrice: 0.50, explorerApi: 'https://api.polygonscan.com/api', explorerUrl: 'https://polygonscan.com' },
    arbitrum: { kind: 'evm', chainId: 42161, rpc: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://arb.drpc.org'], alchemy: true, symbol: 'ETH', name: 'Arbitrum', path: "m/44'/60'/0'/0/", color: '#28a0f0', usdPrice: 2000, explorerApi: 'https://api.arbiscan.io/api', explorerUrl: 'https://arbiscan.io' },
    optimism: { kind: 'evm', chainId: 10, rpc: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io', 'https://op-pokt.nodies.app', 'https://optimism.drpc.org'], alchemy: true, symbol: 'ETH', name: 'Optimism', path: "m/44'/60'/0'/0/", color: '#ff0420', usdPrice: 2000, explorerApi: 'https://api-optimistic.etherscan.io/api', explorerUrl: 'https://optimistic.etherscan.io' },
    base:     { kind: 'evm', chainId: 8453, rpc: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'], alchemy: true, symbol: 'ETH', name: 'Base', path: "m/44'/60'/0'/0/", color: '#0052ff', usdPrice: 2000, explorerApi: 'https://api.basescan.org/api', explorerUrl: 'https://basescan.org' },
    avalanche:{ kind: 'evm', chainId: 43114, rpc: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc', 'https://avalanche.drpc.org'], alchemy: true, symbol: 'AVAX', name: 'Avalanche', path: "m/44'/60'/0'/0/", color: '#e84142', usdPrice: 40, explorerApi: 'https://api.snowtrace.io/api', explorerUrl: 'https://snowtrace.io' },
    solana:   { kind: 'solana', rpc: ['https://solana-rpc.publicnode.com'], symbol: 'SOL', name: 'Solana', path: "m/44'/501'/0'/0'/0", color: '#14f195', tokenSymbol: 'SOL', usdPrice: 150, explorerApi: 'https://api.solscan.io', explorerUrl: 'https://solscan.io' },
    tron:     { kind: 'tron', rpc: ['https://api.trongrid.io', 'https://tron-rpc.publicnode.com', 'https://api.tronstack.io'], symbol: 'TRX', name: 'Tron', path: "m/44'/195'/0'/0/0", color: '#ff060a', usdPrice: 0.06, explorerApi: 'https://api.trongrid.io/v1', explorerUrl: 'https://tronscan.org' }
};

const TOKENS = {
    ethereum: { usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    bnb:      { usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580e', usdt: '0x55d398326f99059fF775485246999027B3197955', weth: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' },
    polygon:  { usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' },
    arbitrum: { usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
    optimism: { usdc: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', weth: '0x4200000000000000000000000000000000000006' },
    base:     { usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', usdt: '0xfde4C96c8593536E31F229EA1f3721D5b3800000', weth: '0x4200000000000000000000000000000000000006' },
    avalanche:{ usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', usdt: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', weth: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB' },
    tron:     { usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
};

const TRC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
    { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
    { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function transfer(address to, uint256 amount) returns (bool)"
];

const TOKEN_PRICES = {
    usdc: 1.0, usdt: 1.0, weth: 2000
};

const TOKEN_NAMES = {
    usdc: 'USD Coin', usdt: 'Tether USD', weth: 'Wrapped Ether'
};

const CONSTANTS = {
    DERIVATION_COUNT: 3,
    NATIVE_GAS_LIMIT: 21000n,
    TRON_SUN_PER_TRX: 1e6,
    SCAN_CONCURRENCY: 10,
    VAULT_STORAGE_KEY: 'omni_vault',
    THEME_STORAGE_KEY: 'omni_theme',
    DEFAULT_CURRENCY: 'usd',
    PRICE_CACHE_DURATION: 10000,
    MAX_RPC_RETRIES: 5,
    RPC_TIMEOUT: 12000,
    NETWORK_API_KEY: '',
    ALCHEMY_KEY: 'KedNAmevgHvaNnMRCnWDq',
    INFURA_KEY: 'f67ee0c6843b441787ed722460b29b7c',
    TRONGRID_KEY: '825d994a-594b-4439-9118-9948ccdb273c',
    CORS_PROXY: '',
    USE_PROXY: false,
    DUST_USD: 0.01
};

const INFURA_NETWORKS = {
    ethereum: 'mainnet', bnb: 'bsc', polygon: 'polygon',
    arbitrum: 'arbitrum', optimism: 'optimism',
    base: 'base', avalanche: 'avalanche'
};

const CURRENCY_SYMBOLS = {
    usd: '$', eur: '€', gbp: '£', jpy: '¥', btc: '₿', eth: 'Ξ'
};
