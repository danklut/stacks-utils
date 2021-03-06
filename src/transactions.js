import btc from "bitcoinjs-lib";
import bigi from "bigi";
import { b58ToC32 } from "c32check";
import { microToStacks } from "./units";

/**
 * lookupValue
 *
 * @param {String} hashBuffer
 * @param {Number} index
 * @returns {Promise} the Number represents the value of each output of a given hash
 */
const lookupValue = async (hashBuffer, index) => {
  try {
    const txHash = Buffer.from(hashBuffer)
      .reverse()
      .toString("hex");
    const response = await fetch(
      `https://blockchain.info/rawtx/${txHash}?format=hex`
    );
    const rawTx = await response.text();
    const tx = btc.Transaction.fromHex(rawTx);
    const value = tx.outs[index].value;

    return value;
  } catch (e) {
    console.error(e);
  }
};

/**
 * getFees
 *
 * @param {Object} tx - the BTC transaction
 * @returns {Promise} the Number represents the difference of inputValues and outputValues (totalFeesPaid)
 */
const getFees = async tx => {
  const inputValues = await Promise.all(
    tx.ins.map(async x => lookupValue(x.hash, x.index))
  ).then(results => results.reduce((a, b) => a + b, 0));
  const outputValues = tx.outs.map(x => x.value).reduce((a, b) => a + b, 0);
  const totalFeesPaid = inputValues - outputValues;
  return totalFeesPaid;
};

/**
 * getOperationType
 *
 * Returns a readable operation type
 * see: https://docs.blockstack.org/core/wire-format.html
 *
 * @param {String} opCode - the ascii character
 * @returns {String} operation - the readable operation for a given opCode
 */
const getOperationType = opCode => {
  if (opCode === "$") {
    return "TOKEN_TRANSFER";
  }
  if (opCode === "?") {
    return "NAME_PREORDER";
  }
  if (opCode === ":") {
    return "NAME_REGISTRATION";
  }
  if (opCode === "+") {
    return "NAME_UPDATE";
  }
  if (opCode === ">") {
    return "NAME_TRANSFER";
  }
  if (opCode === "~") {
    return "NAME_REVOKE";
  }
  if (opCode === "#") {
    return "ANNOUNCE";
  }
  if (opCode === "*") {
    return "NAMESPACE_PREORDER";
  }
  if (opCode === "&") {
    return "NAMESPACE_REVEAL";
  }
  if (opCode === ";") {
    return "NAME_IMPORT";
  }
  if (opCode === "!") {
    return "NAMESPACE_READY";
  }
  // console.error("stacks-utils: getOperationType -- Unknown Stacks Operation");
  return null;
};

/**
 * decodeRawTx
 *
 * This will decode a raw Bitcoin hex transaction
 * and provide stacks transaction information.
 *
 * @param {String} rawTx - the hex tx to decode
 * @param {Boolean} fetchFees - bool to fetch fees or not
 * @returns {Promise} tx - the decompiled Stacks transaction
 */
const decodeRawTx = async (rawTx, fetchFees = true) => {
  const tx = btc.Transaction.fromHex(rawTx);
  const data = btc.script.decompile(tx.outs[0].script)[1];

  if (!data.slice) {
    // not a blockstack transaction
    return;
  }
  const operationType = data.slice(2, 3).toString();
  if (getOperationType(operationType) === null) {
    // not a currently supported operation
    return;
  }
  const consensusHash = data.slice(3, 19).toString("hex");

  const tokenTypeHex = data.slice(19, 38).toString("hex");
  const tokenTypeStart = tokenTypeHex.search(/[1-9]/);

  const tokenType = Buffer.from(
    tokenTypeHex.slice(tokenTypeStart - (tokenTypeStart % 2)),
    "hex"
  ).toString();

  const tokenSentHex = data.slice(38, 46).toString("hex");
  const tokenSentBigI = bigi.fromHex(tokenSentHex);

  const scratchData = data.slice(46, 80).toString();

  const recipientBitcoinAddress = btc.address.fromOutputScript(
    tx.outs[1].script
  );
  const recipientC32Address = b58ToC32(recipientBitcoinAddress);

  const inputData = btc.script.decompile(tx.ins[0].script);

  const hash = btc.crypto.hash160(inputData[inputData.length - 1]);

  const isPubKey = btc.script.isCanonicalPubKey(
    inputData[inputData.length - 1]
  );
  const version = isPubKey
    ? btc.networks.bitcoin.pubKeyHash
    : btc.networks.bitcoin.scriptHash;
  const senderBitcoinAddress = btc.address.toBase58Check(hash, version);
  const senderStacksAddress = b58ToC32(senderBitcoinAddress);

  // fetch our fees
  const fees = fetchFees ? await getFees(tx) : undefined;

  return {
    sender: senderStacksAddress,
    senderBitcoinAddress,
    recipient: recipientC32Address,
    recipientBitcoinAddress,
    opcode: operationType,
    operation: getOperationType(operationType),
    consensusHash,
    tokenType,
    tokenAmount: tokenSentBigI,
    tokenAmountReadable: microToStacks(tokenSentBigI.toString()),
    memo: scratchData,
    fees
  };
};

export { decodeRawTx };
