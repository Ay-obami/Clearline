"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.integer = integer;
exports.envInteger = envInteger;
exports.validateConfig = validateConfig;
exports.verifyChain = verifyChain;
const ethers_1 = require("ethers");
function integer(name, value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}
function envInteger(name, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    const raw = process.env[name];
    if (raw !== undefined && !/^\d+$/.test(raw))
        throw new Error(`${name} must contain decimal digits`);
    return integer(name, raw === undefined ? fallback : Number(raw), minimum, maximum);
}
function validateConfig(cfg) {
    integer("chainId", cfg.chainId, 1);
    try {
        const url = new URL(cfg.rpcUrl);
        if (!["http:", "https:"].includes(url.protocol))
            throw new Error();
    }
    catch {
        throw new Error("rpcUrl must be a valid HTTP or HTTPS URL");
    }
    for (const name of ["registryAddress", "signerContract", "settlementAddress"]) {
        const value = cfg[name];
        if (value === undefined && name === "settlementAddress")
            continue;
        try {
            if ((0, ethers_1.getAddress)(value) === ethers_1.ZeroAddress)
                throw new Error();
        }
        catch {
            throw new Error(`${name} must be a nonzero Ethereum address`);
        }
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.privateKey))
        throw new Error("privateKey must be a 32-byte hexadecimal key");
    try {
        new ethers_1.Wallet(cfg.privateKey);
    }
    catch {
        throw new Error("privateKey is not a valid secp256k1 key");
    }
    if (cfg.delayMs !== undefined)
        integer("delayMs", cfg.delayMs, 0, 2147483647);
}
async function verifyChain(wallet, chainId) {
    const network = await wallet.provider.getNetwork();
    if (network.chainId !== BigInt(chainId))
        throw new Error(`RPC chain ID ${network.chainId} does not match configured chainId ${chainId}`);
}
