const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = 'ERP_ORACLE_SIGN_CONTRACT_KEY_202'; // Khóa bí mật (32 ký tự)
const IV = Buffer.alloc(16, 0); // IV cố định cho môi trường local

const passwordRaw = "noah_hr"; // Mật khẩu thô

function encrypt(text) {
  const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
  const cipher = crypto.createCipheriv(ALGORITHM, key, IV);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

const encryptedPassword = encrypt(passwordRaw);
console.log("\n=======================================================");
console.log("MẬT KHẨU ĐÃ MÃ HÓA CỦA BẠN:");
console.log(encryptedPassword);
console.log("=======================================================\n");
console.log("👉 Hãy copy chuỗi ký tự trên gán vào biến ORACLE_PASSWORD_ENCRYPTED trong file .env.local");
