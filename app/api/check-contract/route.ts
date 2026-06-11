import { NextResponse } from "next/server";
import { executeSql } from "@/lib/oracle";
// 🌟 ĐÃ SỬA: Import hàm verifyToken để giải mã chuỗi token động từ Client gửi lên
import { verifyToken } from "@/lib/jwt"; 

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    // 🌟 ĐÃ SỬA: Kiểm tra và giải mã token thay vì đọc params thô
    if (!token) {
      return NextResponse.json({ 
        valid: false, 
        reason: "INVALID_PARAMS", 
        message: "Thiếu mã cấu hình Token bảo mật truy cập." 
      });
    }

    let contract_id = "";
    let employee_no = "";

    try {
      // Giải mã token thời gian thực (Real-time) để bóc tách bộ khóa kép
      const decoded = verifyToken(token);
      contract_id = decoded.contract_id;
      employee_no = decoded.employee_no;
    } catch (tokenErr: any) {
      // Nếu token hết hạn hoặc bị sửa đổi, hàm verifyToken sẽ ném lỗi qua đây
      return NextResponse.json({
        valid: false,
        reason: "ERROR",
        message: tokenErr.message || "Mã xác thực liên kết đã hết hạn hoặc không hợp lệ."
      });
    }

    // Truy vấn trạng thái hiện tại của hợp đồng trực tiếp từ Oracle
    const query = `
      SELECT STATUS 
      FROM PER_CONTRACT 
      WHERE FACT_NO = '0000' AND PNL_NO = :1 AND CONTRACT_NO = :2
    `;
    const result = await executeSql(query, [employee_no, contract_id]);
    const contract = result.rows?.[0] as any;

    if (!contract) {
      return NextResponse.json({ 
        valid: false, 
        reason: "NOT_FOUND", 
        message: "Tài liệu hợp đồng này không tồn tại trên hệ thống Oracle." 
      });
    }

    const status = contract.STATUS;

    // TRƯỜNG HỢP 1: Nhân viên đã ký kết thành công trước đó
    if (status === "SIGNED_SUCCESS") {
      return NextResponse.json({ 
        valid: false, 
        reason: "SIGNED_SUCCESS", 
        message: "Hợp đồng này đã được ký kết thành công trước đó. Liên kết xác nhận hiện đã đóng." 
      });
    }

    // TRƯỜNG HỢP 2: Nhân viên đã bấm từ chối / Xác nhận không ký
    if (status === "REJECTED" || status === "DECLINED") {
      return NextResponse.json({ 
        valid: false, 
        reason: "REJECTED", 
        message: "Bạn đã xác nhận TỪ CHỐI KÝ hợp đồng này thành công. Đường liên kết đã bị hủy bỏ." 
      });
    }

    // Hợp đồng hoàn toàn hợp lệ, cho phép Client mở trang để vẽ chữ ký
    return NextResponse.json({ valid: true, status });
  } catch (err: any) {
    console.error("❌ LỖI API CHECK-CONTRACT:", err.message);
    return NextResponse.json({ 
      valid: false, 
      reason: "ERROR", 
      message: "Lỗi hệ thống khi xác thực trạng thái tài liệu." 
    }, { status: 500 });
  }
}
