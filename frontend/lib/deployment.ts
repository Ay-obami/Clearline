/** Validate public deployment inputs without inventing contract addresses. */
const addressFields = ['token', 'registry', 'identity', 'directBurn', 'requestLock', 'compliance', 'signer', 'breaker', 'settlement'] as const;
type AddressField = typeof addressFields[number];
export function deploymentConfig(values: Record<string, string | undefined>) {
  const issues: string[] = [];
  const addresses = {} as Record<AddressField, `0x${string}` | undefined>;
  for (const field of addressFields) {
    const value = values[field]?.trim();
    const valid = !!value && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
    addresses[field] = valid ? value as `0x${string}` : undefined;
    if (!valid) issues.push(`${field} address missing or invalid`);
  }
  const chainId = Number(values.chainId);
  if (![133, 177, 31337].includes(chainId)) issues.push('Chain ID must be 133, 177 or 31337');
  const rpcUrl = values.rpcUrl?.trim();
  try { if (!rpcUrl || !['http:', 'https:'].includes(new URL(rpcUrl).protocol)) throw new Error(); }
  catch { issues.push('HTTP(S) RPC URL missing or invalid'); }
  return { ...addresses, chainId, rpcUrl, issues, ready: issues.length === 0 };
}
export function requireDeploymentReady(config: ReturnType<typeof deploymentConfig>, version: unknown, walletChainId: number | undefined) {
  if (!config.ready) throw new Error('Deployment is unconfigured: ' + config.issues.join('; '));
  if (version !== '2') throw new Error('InstructionSigner version 2 must be verified before transactions');
  if (walletChainId !== config.chainId) throw new Error(`Switch wallet to chain ${config.chainId}`);
}
