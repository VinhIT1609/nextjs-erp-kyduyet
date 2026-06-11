import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "ERP_SIGN_SECRET_KEY_2026";

// Định nghĩa cấu trúc dữ liệu khóa kép bắt buộc có trong Token
interface ContractPayload {
  contract_id: string;
  employee_no: string;
  [key: string]: any; 
}

/**
 * Hàm tạo Token (Named Export) - ĐÃ SỬA LỖI ÉP KIỂU BIÊN DỊCH
 */
export function createToken(data: ContractPayload, expiresIn: string = "1d") {
  return jwt.sign(data, SECRET, {
    expiresIn: expiresIn as any, // 🌟 ĐÃ SỬA: Ép kiểu 'as any' để khớp với overload định dạng thời gian của jwt
  });
}

/**
 * Hàm xác thực và giải mã Token (Named Export)
 */
export function verifyToken(token: string): ContractPayload {
  try {
    const decoded = jwt.verify(token, SECRET) as ContractPayload;
    
    // Kiểm tra tính toàn vẹn của dữ liệu sau giải mã
    if (!decoded.contract_id || !decoded.employee_no) {
      throw new Error("Cấu trúc mã xác thực thiếu thông tin khóa chính (contract_id/employee_no).");
    }
    
    return decoded;
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Đường liên kết xác nhận này đã hết hạn sử dụng.");
    }
    if (error.name === "JsonWebTokenError") {
      throw new Error("Mã xác thực không hợp lệ hoặc liên kết đã bị can thiệp.");
    }
    throw new Error(error.message || "Token không hợp lệ");
  }
}
