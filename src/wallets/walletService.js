import { HDNodeWallet, JsonRpcProvider, parseUnits } from "ethers";

/**
 * Derives a deposit address for a user based on their unique index.
 * Uses BIP-44 path for Ethereum: m/44'/60'/0'/0/index
 * @param {string} mnemonic - The master mnemonic
 * @param {number} index - The derivation index (incremented per user)
 * @returns {string} - The derived Ethereum address
 */
export const deriveDepositAddress = (mnemonic, index) => {
  // We use the BIP-44 standard path for Ethereum, with the last index being unique per user
  const basePath = "m/44'/60'/0'/0";
  const wallet = HDNodeWallet.fromPhrase(
    mnemonic,
    null,
    `${basePath}/${index}`
  );
  return wallet.address;
};

/**
 * Sends crypto from a user's derived wallet to an external address.
 * @param {string} mnemonic - Master mnemonic
 * @param {number} index - User's derivation index
 * @param {string} toAddress - Destination address
 * @param {number} amount - Amount in ETH/Native token
 * @returns {Promise<string>} - Transaction hash
 */
export const sendCrypto = async (mnemonic, index, toAddress, amount) => {
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const basePath = "m/44'/60'/0'/0";
  const wallet = HDNodeWallet.fromPhrase(
    mnemonic,
    null,
    `${basePath}/${index}`
  ).connect(provider);

  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: parseUnits(amount.toString(), "ether"),
  });

  return tx.hash;
};

/**
 * Creates a new master mnemonic (one-time use for setup)
 */
export const generateMasterMnemonic = () => {
  const wallet = HDNodeWallet.createRandom();
  return wallet.mnemonic.phrase;
};
