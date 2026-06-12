import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import { executeSql } from "@/lib/oracle"; 

// 🛠️ HÀM TIỆN ÍCH KHỬ KÝ TỰ ĐẶC BIỆT TRONG TÊN FILE
function sanitizeFileName(fileName: string, replacement: string = "-"): string {
  if (!fileName) return `file_${Date.now()}`;
  return fileName.replace(/[\\/:*?"<>|]/g, replacement).replace(/\s+/g, "_").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { contract_id, employee_no, signature } = body; 

    // 1. Kiểm tra dữ liệu đầu vào bắt buộc
    if (!contract_id || !employee_no) {
      throw new Error("Thiếu thông tin bộ khóa chính bắt buộc (contract_id hoặc employee_no).");
    }
    if (!signature) {
      throw new Error("Không nhận được dữ liệu hình ảnh chữ ký (signature).");
    }

    // 2. TRUY VẤN ORACLE THEO KHÓA KÉP
    const selectQuery = `
      SELECT CONTRACT_SERIAL, FILE_PATH
      FROM PER_CONTRACT 
      WHERE FACT_NO = '0000' AND PNL_NO = :1 AND CONTRACT_NO = :2
    `;
    const dbResult = await executeSql(selectQuery, [employee_no, contract_id]);
    const contract = dbResult.rows?.[0] as any; 

    if (!contract) {
      throw new Error(`Không tìm thấy dữ liệu hợp đồng tương ứng với Mã HĐ: ${contract_id} và Mã NV: ${employee_no} trong Oracle.`);
    }

    const contract_serial = contract.CONTRACT_SERIAL;
    const pdf_url         = contract.FILE_PATH;

    // 3. XỬ LÝ CHUỖI BASE64 CHỮ KÝ AN TOÀN
    const base64ImageRaw = signature.includes(",") ? signature.split(",")[1] : signature;
    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(base64ImageRaw, "base64");
    } catch (e) {
      throw new Error("Chuỗi chữ ký gửi lên sai định dạng mã hóa Base64.");
    }

    // 🌟 ĐÃ SỬA: XÁC ĐỊNH THƯ MỤC LƯU TRỮ TỔNG NGOÀI PUBLIC TỪ .ENV.LOCAL
    const secureStorageDir = process.env.UPLOAD_DIR 
      ? process.env.UPLOAD_DIR 
      : path.join(process.cwd(), "PER_CONTRACT");
    const targetDir = path.normalize(secureStorageDir);

    // 4. 🌟 ĐÃ SỬA: LƯU FILE HÌNH CHỮ KÝ PNG VÀO THƯ MỤC RIÊNG CÙNG Ổ ĐĨA NGOÀI
    // Thư mục chữ ký sẽ nằm tại: UPLOAD_DIR\signatures
    const signatureDir = path.join(targetDir, "signatures");
    if (!fs.existsSync(signatureDir)) {
      fs.mkdirSync(signatureDir, { recursive: true });
    }
    
    const safeContractSerial = sanitizeFileName(String(contract_serial), "_");
    const signatureFileName = `sig_${safeContractSerial}_${Date.now()}.png`;
    const signatureFilePath = path.join(signatureDir, signatureFileName);
    fs.writeFileSync(signatureFilePath, imageBuffer); 
    
    // 5. ĐỌC FILE PDF VÀ ĐÓNG DẤU CHỮ KÝ
    if (!pdf_url) {
      throw new Error(`Cột FILE_PATH (Đường dẫn PDF gốc) của nhân viên này hiện đang bị trống (null) trong hệ thống Oracle Database.`);
    }

    // Làm sạch dấu gạch chéo đầu chuỗi của pdf_file nếu có
    const cleanPdfName = (pdf_url.startsWith("/") ? pdf_url.substring(1) : pdf_url).replace(/\\/g, "");
    //const cleanPdfName = sanitizeFileName(pdf_url);
    // Xác định đường dẫn file PDF gốc ngoài public
    const originalPdfPath = path.isAbsolute(cleanPdfName) 
      ? path.normalize(cleanPdfName) 
      : path.normalize(path.join(targetDir, cleanPdfName));

    if (!fs.existsSync(originalPdfPath)) {
      throw new Error(`Tệp tin PDF gốc không tồn tại tại vị trí kho lưu trữ bảo mật: ${originalPdfPath}`);
    }

    const existingPdfBytes = fs.readFileSync(originalPdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const embeddedImage = await pdfDoc.embedPng(imageBuffer);
    const imgDims = embeddedImage.scaleToFit(140, 70);

    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1]; 
    const { width } = lastPage.getSize();

    lastPage.drawImage(embeddedImage, {
      x: width - imgDims.width - 60,
      y: 90,
      width: imgDims.width,
      height: imgDims.height,
    });

    const signedPdfBytes = await pdfDoc.save();
    
    // Ghi đè trực tiếp lên file PDF gốc tại thư mục bảo mật ngoài public
    fs.writeFileSync(originalPdfPath, signedPdfBytes); 

    // 6. CẬP NHẬT TRẠNG THÁI VỀ ORACLE THEO KHÓA KÉP
    const updateQuery = `UPDATE PER_CONTRACT 
                            SET STATUS = 'SIGNED_SUCCESS', 
                                SIGNED_PATH = :1, 
                                SIGNED_TIME = TO_CHAR(SYSDATE, 'YYYYMMDDHH24MISS')
                          WHERE FACT_NO = '0000'
                            AND PNL_NO  = :2
                            AND CONTRACT_NO = :3`;
    
    // Lưu đường dẫn tuyệt đối của file PDF đã ký vào database Oracle
    await executeSql(updateQuery, [originalPdfPath, employee_no, contract_id ]);

    console.log(`[Thành công] Nhân viên ${employee_no} đã ký. PDF lưu tại: ${originalPdfPath}. Ảnh chữ ký lưu tại: ${signatureFilePath}`);

    const newPdfBase64 = Buffer.from(signedPdfBytes).toString("base64");
    return NextResponse.json({ 
      success: true, 
      message: "Ký kết hợp đồng và cập nhật hệ thống lưu trữ đồng bộ thành công!",
      pdf_base64: newPdfBase64 
    });

  } catch (err: any) {
    console.error("❌ LỖI API SIGN-PDF:", err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}
