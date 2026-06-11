import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { executeSql } from "@/lib/oracle";
// 🌟 ĐÃ SỬA: Import đúng tên hàm verifyToken từ file cấu hình JWT của bạn
import { verifyToken } from "@/lib/jwt"; 

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ 
        success: false, 
        valid: false, 
        message: "Thiếu mã Token bảo mật truy cập." 
      });
    }

    // 1. GIẢI MÃ TOKEN ĐỂ LẤY BỘ KHÓA KÉP ĐỘNG
    // Mỗi nhân viên bấm vào link sẽ bóc tách ra dữ liệu riêng biệt, không bị lẫn lộn
    const decoded = verifyToken(token); 
    const { employee_no, contract_id } = decoded; 

    // 2. TRUY VẤN TRỰC TIẾP TỪ ORACLE - TUYỆT ĐỐI KHÔNG LƯU QUA BIẾN GLOBAL ĐỆM
    const query = `
      SELECT A.CONTRACT_NO, A.CONTRACT_SERIAL, A.PNL_NO, B.PNL_NAME_V EMPLOYEE_NAME, A.FILE_PATH, A.STATUS
      FROM PER_CONTRACT A, PER_PNLM B
      WHERE A.FACT_NO = B.FACT_NO AND A.PNL_NO = B.PNL_NO
        AND A.FACT_NO = '0000' AND A.PNL_NO = :1 AND A.CONTRACT_NO = :2
    `;
    
    const dbResult = await executeSql(query, [employee_no, contract_id]);
    const contract = dbResult.rows?.[0] as any;

    if (!contract) {
      return NextResponse.json({ 
        success: false, 
        valid: false, 
        message: "Không tìm thấy dữ liệu hợp đồng tương ứng trên hệ thống Oracle." 
      });
    }

    // 3. ĐỌC FILE PDF GỐC (Bổ sung chuẩn hóa đường dẫn tránh lỗi dấu gạch chéo)
    // 3. ĐỌC FILE PDF GỐC
    const cleanPdfPath = contract.FILE_PATH.startsWith("/")
      ? contract.FILE_PATH.substring(1)
      : contract.FILE_PATH;

    // Nếu có biến môi trường UPLOAD_DIR thì dùng, nếu không thì fallback về public
    const baseDir = process.env.UPLOAD_DIR
      ? process.env.UPLOAD_DIR
      : path.join(process.cwd(), "public");

    const absolutePdfPath = path.normalize(path.join(baseDir, cleanPdfPath));
    
    if (!fs.existsSync(absolutePdfPath)) {
      return NextResponse.json({ 
        success: false, 
        valid: false,
        message: `Tệp tin PDF gốc không tồn tại trên hệ thống máy chủ.` 
      });
    }

    // Chuyển đổi dữ liệu tệp PDF sang mã Base64 để truyền về Client
    const pdfBytes = fs.readFileSync(absolutePdfPath);
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // 4. TRẢ VỀ DỮ LIỆU ĐỘNG RIÊNG BIỆT CHO LƯỢT REQUEST ĐÓ
    // Thuộc tính 'valid' sẽ trả về false nếu hợp đồng đã được ký (SIGNED_SUCCESS) hoặc đã từ chối (REJECTED)
    const isLinkValid = contract.STATUS !== "SIGNED_SUCCESS" && contract.STATUS !== "REJECTED" && contract.STATUS !== "DECLINED";

    return NextResponse.json({
      success: true,
      valid: isLinkValid,
      reason: contract.STATUS, // Trả về trạng thái hiện tại (Để Client hiển thị đúng icon ✅ hoặc ⚠️)
      data: {
        contract_id: contract.CONTRACT_NO,      // Khóa phụ 1 dùng để update điều kiện SQL
        contract_no: contract.CONTRACT_SERIAL,  // Số seri hợp đồng hiển thị UI
        employee_no: contract.PNL_NO,           // Khóa phụ 2 (Mã nhân viên)
        employee_name: contract.EMPLOYEE_NAME,  // Tên nhân viên hiển thị UI
        pdf_base64: pdfBase64
      }
    });

  } catch (err: any) {
    console.error("❌ LỖI API GET-CONTRACT:", err.message);
    // Nếu token bị hết hạn hoặc sai, hàm verifyToken sẽ ném lỗi và lọt vào đây
    return NextResponse.json({ 
      success: false, 
      valid: false, 
      reason: "ERROR",
      message: err.message || "Xác thực tài liệu thất bại do lỗi hệ thống." 
    });
  }
}
