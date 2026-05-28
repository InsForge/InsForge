import { EncryptionManager } from './src/infra/security/encryption.manager.js';

const ciphertext = "d6ee74c1a7b87176d45480d2586cdacd:5952b73a98d833461a7b59f3ca121706:3b1775a8e4ceb92957f445ca63ff21dfa4fd1e4ef71a98";
try {
  const decrypted = EncryptionManager.decrypt(ciphertext);
  console.log('decrypted:', decrypted);
} catch (e) {
  console.error('DECRYPT ERROR:', e);
}
