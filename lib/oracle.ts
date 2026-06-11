import oracledb from "oracledb";
import crypto from "crypto";

// Đảm bảo driver chạy ở chế độ thuần JS (Thin mode), không cần cài Oracle Instant Client
//oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH});
// ÉP BUỘC CHẠY THICK MODE CHO ORACLE 11G
// ÉP BUỘC KÍCH HOẠT THICK MODE CHO ORACLE 11G
// ÉP BUỘC CHẠY THICK MODE CHO ORACLE 11G (Cấu hình bản v6)
if (typeof window === "undefined") {
  try {
    // Gọi hàm initOracleClient tới thư mục Instant Client trên ổ F
    oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });
    console.log("🚀 [Oracle v6] Đã kích hoạt Thick Mode thành công với Instant Client!");
  } catch (err: any) {
    // Ngăn crash ứng dụng khi Next.js tự động quét lại file (Hot Reload)
    if (!err.message.includes("NJS-011") && !err.message.includes("already initialized")) {
      console.error("❌ [Oracle v6] Lỗi nạp Instant Client DLL:", err.message);
    }
  }
}

console.log("📦 Driver Version:", oracledb.versionString);

// ---- HÀM GIẢI MÃ MẬT KHẨU TỰ ĐỘNG ----
function decryptPassword(): string {
  try {
    const encryptedText = process.env.ORACLE_PASSWORD_ENCRYPTED || "";
    const secretKey = process.env.DB_CRYPTO_SECRET || "ERP_ORACLE_SIGN_CONTRACT_KEY_202";
    
    if (!encryptedText) {
      console.warn("⚠️ Cảnh báo: Chưa cấu hình biến ORACLE_PASSWORD_ENCRYPTED trong .env.local");
      return "";
    }
    
    const algorithm = 'aes-256-cbc';
    const iv = Buffer.alloc(16, 0); // Khởi tạo IV trùng khớp với công cụ mã hóa
    // Chuẩn hóa key thành 32 bytes
    const key = crypto.createHash('sha256').update(secretKey).digest();
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    //const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    console.log("Connect User:", process.env.ORACLE_USER);
    console.log("Connect Password:", decrypted);
    console.log("Connect String:", process.env.ORACLE_CONN_STR);

    return decrypted;
  } catch (error) {
    console.error("❌ Lỗi nghiêm trọng: Không thể giải mã mật khẩu cơ sở dữ liệu. Hãy kiểm tra lại cấu hình mật khẩu mã hóa hoặc khóa bí mật.");
    return "";
  }
}
// ---- ĐỌC ĐỘNG TOÀN BỘ CẤU HÌNH TỪ FILE .ENV ----
const dbConfig = {
  user: process.env.ORACLE_USER,
  password: decryptPassword(), // Tự động gọi giải mã mật khẩu thô để truyền vào driver
  connectString: process.env.ORACLE_CONN_STR,
};

/*const dbConfig = await oracledb.createPool({
  user: process.env.ORACLE_USER,
  password: decryptPassword(), // Tự động gọi giải mã mật khẩu thô để truyền vào driver
  connectString: process.env.ORACLE_CONN_STR,
});*/

interface GlobalWithOracle {
  oraclePool?: oracledb.Pool;
}

const globalPool = global as unknown as GlobalWithOracle;

async function getPool(): Promise<oracledb.Pool> {
  if (!globalPool.oraclePool) {
    // Kiểm tra an toàn trước khi khởi tạo kết nối
    if (!dbConfig.user || !dbConfig.password || !dbConfig.connectString) {
      throw new Error("❌ Thiếu thông tin cấu hình kết nối Oracle Database trong file .env.local");
    }

    globalPool.oraclePool = await oracledb.createPool({
      ...dbConfig,
      poolMax: 2,
      poolMin: 1,
      poolIncrement: 1
    });
    console.log("=== Đã khởi tạo Oracle Connection Pool thành công từ biến môi trường ===");
  }
  return globalPool.oraclePool;
}

// Hàm thực thi câu lệnh SQL an toàn
export async function executeSql(sql: string, binds: any[] = [], autoCommit: boolean = true) {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    const result = await connection.execute(sql, binds, {
      autoCommit,
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return result;
  } finally {
    await connection.close(); // Luôn luôn giải phóng kết nối trả lại cho Pool kể cả khi lỗi
  }
}