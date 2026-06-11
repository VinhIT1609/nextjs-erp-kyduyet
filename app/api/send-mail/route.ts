import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import fs from "fs";
import path from "path";
import { createToken } from "@/lib/jwt";
import { executeSql } from "@/lib/oracle"; 

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      email,
      employee_name,
      employee_no,
      contract_no,
      contract_id,
      pdf_file // Tên file hoặc đường dẫn tương đối gửi lên (VD: "demo.pdf" hoặc "/contracts/demo.pdf")
    } = body;

    // 1. Kiểm tra dữ liệu đầu vào bắt buộc
    if (!email || !contract_id || !employee_no || !pdf_file) {
      throw new Error("Thiếu thông tin gửi mail bắt buộc (Email, Contract ID, Employee No hoặc File PDF).");
    }

    // 2. 🌟 ĐÃ SỬA: XÁC ĐỊNH ĐƯỜNG DẪN FILE TỪ THƯ MỤC NGOÀI PUBLIC TỪ .ENV.LOCAL
    const secureStorageDir = process.env.UPLOAD_DIR 
      ? process.env.UPLOAD_DIR 
      : path.join(process.cwd(), "storage", "PER_CONTRACT"); // Thư mục dự phòng nội bộ

    const targetDir = path.normalize(secureStorageDir);

    // Làm sạch dấu gạch chéo đầu chuỗi của pdf_file nếu có
    const cleanPdfName = pdf_file.startsWith("/") ? pdf_file.substring(1) : pdf_file;

    // Tính toán đường dẫn tuyệt đối trỏ tới kho lưu trữ ngoài
    const pdfPath = path.isAbsolute(cleanPdfName)
      ? path.normalize(cleanPdfName)
      : path.normalize(path.join(targetDir, cleanPdfName));

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Không tìm thấy file PDF gốc tại kho lưu trữ bảo mật ngoại vi: ${pdfPath}`);
    }

    // 3. Đọc dữ liệu file thành Buffer an toàn từ ổ đĩa ngoài public
    const pdfBuffer = fs.readFileSync(pdfPath);

    // 4. 🌟 ĐÃ SỬA: LOẠI BỎ BIẾN GLOBAL NGUY HIỂM - TẠO TOKEN MÃ HÓA CHỨA BỘ KHÓA KÉP
    // Ép kiểu truyền vào đúng cấu trúc mã hóa bảo mật thời gian thực
    const token = createToken({ 
      contract_id: String(contract_id), 
      employee_no: String(employee_no) 
    });

    // Cấu hình link dẫn đến trang ký tên của người dùng (Token tự mang thông tin bóc tách động)
    //const signUrl = `http://localhost:3000/sign/${token}`;
    // 🌟 ĐÃ SỬA: Tự động bóc tách domain hiện tại của server (Bất kể localhost hay domain máy chủ thật)
    const { origin } = new URL(req.url); 
    const signUrl = `${origin}/sign/${token}`;

    // 5. Cấu hình dịch vụ gửi Email (Nodemailer)
    const transporter = nodemailer.createTransport({
      /*service: "gmail",*/
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSS, // Mã ứng dụng Gmail của bạn
      }
    }as SMTPTransport.Options);

    console.log("Đang tiến hành gửi email tới:", email);

    // 6. Thực hiện gửi Email kèm file đính kèm thô
    await transporter.sendMail({
      from: `"Hệ thống ERP" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `[Hệ thống] Yêu cầu ký hợp đồng điện tử số ${contract_no}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
            Ký hợp đồng điện tử
          </h2>
          <p>Xin chào: <b>${employee_name}</b></p>
          <p>Mã nhân viên: <b>${employee_no}</b></p>
          <p>Mã hợp đồng: <b>${contract_no}</b></p>
          
          <p style="margin-top: 20px;">
            Bạn nhận được một yêu cầu ký xác nhận hợp đồng lao động trực tuyến. Vui lòng bấm vào nút dưới đây để kiểm tra nội dung file và tiến hành ký điện tử.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${signUrl}" style="background: #2563eb; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: bold; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">
              Đi đến trang ký hợp đồng
            </a>
          </div>
          
          <p style="font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 15px; margin-top: 30px;">
            * Lưu ý: File đính kèm bên dưới email này chỉ mang tính chất sao lưu thông tin thô chưa có chữ ký. Bản ký kết hợp lệ cuối cùng sẽ được cập nhật sau khi bạn hoàn tất ký tên.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `${contract_no}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    });
    
    // 🌟 ĐÃ SỬA: Đồng bộ tên bảng PER_CONTRACT (Bỏ chữ S thừa ở cuối để tránh lỗi không tìm thấy bảng Oracle)
    await executeSql(
      "UPDATE PER_CONTRACT SET STATUS = 'SENT_MAIL_SUCCESS' WHERE FACT_NO = '0000' AND PNL_NO = :1 AND CONTRACT_NO = :2",
      [employee_no, contract_id]
    );

    console.log(`[Thành công] Đã gửi mail thông báo gửi link ký tới: ${email}`);
    return NextResponse.json({
      success: true,
      message: "Gửi mail thông báo ký hợp đồng và lưu vết Oracle thành công!"
    });

  } catch (err: any) {
    console.error("❌ Lỗi gửi mail API:", err.message);
    return NextResponse.json({
      success: false,
      error: err.message
    }, { status: 400 });
  }
}
