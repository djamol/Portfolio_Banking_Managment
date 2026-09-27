const officeCrypto = require('officecrypto-tool');

async function decryptOfficeFile(buffer, password) {
  if (!password) {
    throw new Error('This Excel statement is password-protected. Enter the statement password and try again.');
  }

  try {
    const decrypted = await officeCrypto.decrypt(buffer, { password: String(password) });
    if (!Buffer.isBuffer(decrypted)) {
      throw new Error('Excel decryption returned an invalid file');
    }
    return decrypted;
  } catch (error) {
    const message = String(error?.message || error);
    if (/wrong password|incorrect password|invalid password|bad password/i.test(message)) {
      throw new Error('Incorrect Excel statement password or unsupported Excel encryption format.');
    }
    throw new Error(`Could not decrypt the Excel statement: ${message}`);
  }
}

module.exports = { decryptOfficeFile };