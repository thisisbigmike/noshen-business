// Exports NosHen's EVM test-network keys so a wallet app (MetaMask, Rabby) can import them. Writes them to
// .evm-testnet-keys.txt (never committed) and prints only the addresses.
//
// Usage: pnpm evm:keys               → NosHen's wallet and the demo wallet
//        pnpm evm:keys <deal id>     → also that deal's own USDC and USDT deposit addresses
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const root = new URL("../../../", import.meta.url);
const vars = Object.fromEntries(readFileSync(new URL(".evm-testnet.vars", root), "utf8").split("\n")
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const dealId = process.argv[2];
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// The same derivation as the site (packages/engine/src/partner/evm.ts).
function depositKey(coin) {
  const h = (data) => `0x${createHmac("sha256", vars.EVM_DEPOSIT_SECRET).update(data).digest("hex")}`;
  let key = h(`noshen:evm-deposit:v1:${coin}:${dealId}`);
  while (BigInt(key) === 0n || BigInt(key) >= N) key = h(key);
  return key;
}

const keys = [
  ["NosHen's wallet (pays gas, mints the test tokens, receives released coin)", vars.EVM_WALLET],
  ["Demo wallet (behind \"Send from NosHen's demo wallet\")", vars.EVM_DEMO_WALLET],
  ...(dealId ? [[`Deal ${dealId}: USDC deposit address`, depositKey("usdc")], [`Deal ${dealId}: USDT deposit address`, depositKey("usdt")]] : []),
].map(([label, key]) => ({ label, key, address: privateKeyToAccount(key).address }));

const tokens = vars.EVM_TESTNETS ? JSON.parse(vars.EVM_TESTNETS) : {};
const out = [
  "NosHen EVM TEST-NETWORK keys (BNB testnet, Base Sepolia, Ethereum Sepolia). Private: never share, commit or paste these anywhere.",
  "Test networks only: test tokens, no real money. Each key is the same account on all three networks.",
  "Import into MetaMask: Add account → Import account → paste the private key. Switch MetaMask to the test network to see balances.",
  ...Object.entries(tokens).map(([n, t]) => `Test tokens on ${n}: USDC ${t.usdc}, USDT ${t.usdt}`),
  "",
  ...keys.flatMap((k) => [k.label, `  address:     ${k.address}`, `  private key: ${k.key}`, ""]),
].join("\n");
writeFileSync(new URL(".evm-testnet-keys.txt", root), out, { mode: 0o600 });
for (const k of keys) console.log(`${k.label}\n  ${k.address}`);
console.log("\nPrivate keys written to .evm-testnet-keys.txt (not shown here, never committed).");
