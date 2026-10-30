// Sets up NosHen's wallet on the BNB Smart Chain and Base test networks (BNB testnet, Base Sepolia):
// NosHen's wallet (pays gas, mints the test tokens, receives released coin), the demo wallet,
// the secret that turns each deal into its own address, and NosHen's test USDC and USDT on each network that has gas.
// Safe to run again: it keeps what's there and only does what's missing.
//
// Usage: pnpm evm:setup     → writes .evm-testnet.vars (never committed; the keys are never printed)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import solc from "solc";
import { createPublicClient, createWalletClient, formatEther, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia, bscTestnet } from "viem/chains";

const NETWORKS = {
  bsc: { chain: bscTestnet, rpcUrl: "https://bsc-testnet-rpc.publicnode.com", coin: "tBNB", explorer: "https://testnet.bscscan.com" },
  base: { chain: baseSepolia, rpcUrl: "https://base-sepolia-rpc.publicnode.com", coin: "Base Sepolia ETH", explorer: "https://sepolia.basescan.org" },
};
const FILE = new URL("../../../.evm-testnet.vars", import.meta.url);
const ERC20 = parseAbi(["function mint(address to, uint256 value)", "function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);

const vars = {};
if (existsSync(FILE)) for (const line of readFileSync(FILE, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) vars[m[1]] = m[2].trim();
}
const save = () => writeFileSync(FILE, [
  "# NosHen's EVM test-network setup (pnpm evm:setup). Secrets: never commit or paste this file.",
  ...Object.entries(vars).map(([k, v]) => `${k}=${v}`), "",
].join("\n"), { mode: 0o600 });
vars.EVM_WALLET ??= generatePrivateKey();
vars.EVM_DEMO_WALLET ??= generatePrivateKey();
vars.EVM_DEPOSIT_SECRET ??= Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
save();
const wallet = privateKeyToAccount(vars.EVM_WALLET);
const demo = privateKeyToAccount(vars.EVM_DEMO_WALLET);
console.log(`NosHen's EVM wallet: ${wallet.address}  (the same address on all three networks)`);
console.log(`Demo wallet:         ${demo.address}\n`);

// NosHen's test token, compiled here (packages/engine/scripts/NosHenTestToken.sol).
const source = readFileSync(new URL("./NosHenTestToken.sol", import.meta.url), "utf8");
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity", sources: { "NosHenTestToken.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
})));
const errors = (compiled.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
const token = compiled.contracts["NosHenTestToken.sol"].NosHenTestToken;
const bytecode = `0x${token.evm.bytecode.object}`;

const ready = {};
const unfunded = [];
for (const [id, n] of Object.entries(NETWORKS)) {
  const pub = createPublicClient({ chain: n.chain, transport: http(n.rpcUrl) });
  const send = createWalletClient({ account: wallet, chain: n.chain, transport: http(n.rpcUrl) });
  const balance = await pub.getBalance({ address: wallet.address });
  const gas = await pub.getGasPrice();
  const need = gas * 3_000_000n; // two token deployments, a mint each, and gas for the demo wallet
  console.log(`${n.chain.name}: ${formatEther(balance)} ${n.coin}`);
  const keyOf = (coin) => `EVM_${id.toUpperCase()}_${coin.toUpperCase()}`;
  const deployed = async (coin) => vars[keyOf(coin)] && (await pub.getCode({ address: vars[keyOf(coin)] }))?.length > 2;
  if (balance < need && !((await deployed("usdc")) && (await deployed("usdt")))) {
    unfunded.push([id, n]);
    console.log(`  needs about ${formatEther(need)} ${n.coin} for gas first\n`);
    continue;
  }
  for (const coin of ["usdc", "usdt"]) {
    if (await deployed(coin)) { console.log(`  test ${coin.toUpperCase()}: ${vars[keyOf(coin)]}`); continue; }
    const hash = await send.deployContract({ abi: token.abi, bytecode, args: [`NosHen Test ${coin.toUpperCase()}`, `t${coin.toUpperCase()}`] });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (r.status !== "success" || !r.contractAddress) throw new Error(`deploying test ${coin} on ${id} failed`);
    vars[keyOf(coin)] = r.contractAddress;
    save();
    console.log(`  test ${coin.toUpperCase()}: ${r.contractAddress} (new)  ${n.explorer}/address/${r.contractAddress}`);
  }
  // Stock the demo wallet with test coin and a little gas, so "Send from NosHen's demo wallet" works straight away.
  for (const coin of ["usdc", "usdt"]) {
    const address = vars[keyOf(coin)];
    if (await pub.readContract({ address, abi: ERC20, functionName: "balanceOf", args: [demo.address] }) < 100_000_000_000n) {
      const hash = await send.writeContract({ address, abi: ERC20, functionName: "mint", args: [demo.address, 1_000_000_000_000n] });
      await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    }
  }
  const demoGas = gas * 70_000n * 20n;
  if (await pub.getBalance({ address: demo.address }) < demoGas / 2n) {
    const hash = await send.sendTransaction({ to: demo.address, value: demoGas });
    await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  }
  ready[id] = { rpcUrl: n.rpcUrl, usdc: vars[keyOf("usdc")], usdt: vars[keyOf("usdt")] };
  console.log("  demo wallet stocked with test coin and gas\n");
}

vars.EVM_TESTNETS = JSON.stringify(ready);
save();
console.log(`Ready: ${Object.keys(ready).join(", ") || "none yet"}.`);
if (unfunded.length) {
  console.log(`\nTo add the rest, send test coin for gas to ${wallet.address} on:`);
  for (const [, n] of unfunded) console.log(`  - ${n.chain.name} (${n.coin})`);
  console.log("then run pnpm evm:setup again.");
}
console.log("\nSaved to .evm-testnet.vars. Secrets in it: EVM_WALLET, EVM_DEMO_WALLET, EVM_DEPOSIT_SECRET.");
