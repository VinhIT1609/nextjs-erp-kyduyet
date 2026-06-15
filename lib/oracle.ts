import oracledb from "oracledb";
import crypto from "crypto";

// 🌟 1. XỬ LÝ ĐỘNG THICK MODE THEO MÔI TRƯỜNG (NÉ CRASH VERCEL)
if (typeof window === "undefined") {
  // Chỉ nạp Instant Client khi KHÔNG chạy trên Vercel (Tức là đang chạy ở máy local Windows)
  if (!process.env.VERCEL) {
    try {
      if (process.env.ORACLE_CLIENT_PATH) {
        oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });
        console.log(
          "🚀 [Local Windows] Đã kích hoạt Thick Mode thành công với Instant Client!",
        );
      }
    } catch (err: any) {
      if (
        !err.message.includes("NJS-011") &&
        !err.message.includes("already initialized")
      ) {
        console.error(
          "❌ [Local Windows] Lỗi nạp Instant Client DLL:",
          err.message,
        );
      }
    }
  } else {
    // Khi chạy trên Vercel, driver tự động rơi về Thin Mode (Thuần JS)
    console.log(
      "☁️ [Vercel Cloud] Phát hiện môi trường Serverless. Tự động chạy Thin Mode.",
    );
  }
}

console.log("📦 Driver Version:", oracledb.versionString);

// ---- HÀM GIẢI MÃ MẬT KHẨU TỰ ĐỘNG (Đã dọn dẹp log nhạy cảm) ----
function decryptPassword(): string {
  try {
    const encryptedText = process.env.ORACLE_PASSWORD_ENCRYPTED || "";
    const secretKey =
      process.env.DB_CRYPTO_SECRET || "ERP_ORACLE_SIGN_CONTRACT_KEY_202";

    if (!encryptedText) {
      // Trả về chuỗi rỗng khi Next.js quét file lúc build hoặc thiếu biến
      return "";
    }

    const algorithm = "aes-256-cbc";
    const iv = Buffer.alloc(16, 0);
    const key = crypto.createHash("sha256").update(secretKey).digest();
    const decipher = crypto.createDecipheriv(algorithm, key, iv);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    // Chỉ hiển thị log kỹ thuật an toàn, ĐÃ XÓA dòng log Connect Password thô để bảo mật ERP
    console.log(
      "🔒 [Security] Giải mã cấu hình thành công cho User:",
      process.env.ORACLE_USER,
    );
    console.log("🔗 Connect String:", process.env.ORACLE_CONN_STR);

    return decrypted;
  } catch (error) {
    console.error(
      "❌ Lỗi nghiêm trọng: Không thể giải mã mật khẩu cơ sở dữ liệu.",
    );
    return "";
  }
}

interface GlobalWithOracle {
  oraclePool?: oracledb.Pool;
}

const globalPool = global as unknown as GlobalWithOracle;

// 🌟 2. CHUYỂN TOÀN BỘ LOGIC KHỞI TẠO VÀO TRONG HÀM ĐỂ CHẠY LAZY-LOADING
async function getPool(): Promise<oracledb.Pool> {
  if (!globalPool.oraclePool) {
    // Thu thập cấu hình động tại thời điểm kết nối, tránh chạy global lúc build
    const user = process.env.ORACLE_USER;
    const password = decryptPassword();
    const connectString = process.env.ORACLE_CONN_STR;

    if (!user || !password || !connectString) {
      throw new Error(
        "❌ Thiếu thông tin cấu hình kết nối Oracle Database trong biến môi trường.",
      );
    }

    globalPool.oraclePool = await oracledb.createPool({
      user,
      password,
      connectString,
      poolMax: 15, // Nâng pool lên để chịu tải khi sếp duyệt đồng thời qua Internet
      poolMin: 2,
      poolIncrement: 1,
    });
    console.log("=== Đã khởi tạo Oracle Connection Pool thành công ===");
  }
  return globalPool.oraclePool;
}

// Hàm thực thi câu lệnh SQL an toàn
export async function executeSql(
  sql: string,
  binds: any[] = [],
  autoCommit: boolean = true,
) {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    const result = await connection.execute(sql, binds, {
      autoCommit,
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return result;
  } finally {
    await connection.close(); // Giải phóng connection về pool
  }
}
