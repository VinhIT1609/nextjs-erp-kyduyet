import { NextResponse } from "next/server";
import { executeSql } from "@/lib/oracle"; // Import hàm chạy SQL Oracle từ file lib/db.ts của bạn

// 1. ĐỊNH NGHĨA CẤU TRÚC JSON ĐẦU VÀO CỐ ĐỊNH TỪ ERP
interface IContractInput {
  email: string;
  employee_name: string;
  employee_no: string;
  contract_no: string;
  contract_id: string;
  pdf_file: string;
  is_resend?: boolean; // Trường điều khiển gửi lại mail (Mặc định không truyền là false)
}

export async function POST(req: Request) {
  try {
    const contractsArray: IContractInput[] = await req.json();

    // 2. KIỂM TRA ĐỊNH DẠNG MẢNG ĐẦU VÀO
    if (!Array.isArray(contractsArray) || contractsArray.length === 0) {
      throw new Error(
        "Dữ liệu gửi lên phải là một danh sách (Array) và không được rỗng.",
      );
    }

    // 3. VÒNG LẶP KIỂM TRA CHI TIẾT CẤU TRÚC CỦA TỪNG DÒNG (VALIDATION)
    for (let i = 0; i < contractsArray.length; i++) {
      const item = contractsArray[i];
      const rowNum = i + 1;

      if (!item.contract_id || typeof item.contract_id !== "string") {
        throw new Error(
          `Dòng số ${rowNum}: Thiếu trường 'contract_id' hoặc sai định dạng.`,
        );
      }
      if (
        !item.email ||
        typeof item.email !== "string" ||
        !item.email.includes("@")
      ) {
        throw new Error(
          `Dòng số ${rowNum}: Trường 'email' không hợp lệ hoặc thiếu ký tự @.`,
        );
      }
      if (!item.employee_name || typeof item.employee_name !== "string") {
        throw new Error(
          `Dòng số ${rowNum}: Trường 'employee_name' bắt buộc là chuỗi văn bản.`,
        );
      }
      if (!item.employee_no || typeof item.employee_no !== "string") {
        throw new Error(
          `Dòng số ${rowNum}: Trường 'employee_no' bắt buộc là chuỗi văn bản.`,
        );
      }
      if (!item.contract_no || typeof item.contract_no !== "string") {
        throw new Error(
          `Dòng số ${rowNum}: Trường 'contract_no' bắt buộc là chuỗi văn bản.`,
        );
      }
      if (!item.pdf_file || typeof item.pdf_file !== "string") {
        throw new Error(
          `Dòng số ${rowNum}: Trường 'pdf_file' bắt buộc chứa đường dẫn file dạng chuỗi.`,
        );
      }
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host")}`;
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalResent = 0;

    // ================================================================
    // 4. VÒNG LẶP CHÍNH: KIỂM TRA TRÙNG LẶP & CẬP NHẬT ORACLE DATABASE
    // ================================================================
    for (const item of contractsArray) {
      try {
        const isUserWantResend = item.is_resend === true;

        // 🌟 BƯỚC 1: TRUY VẤN XEM BẢN GHI ĐÃ TỒN TẠI TRONG ORACLE CHƯA
        const checkQuery =
          "SELECT STATUS FROM PER_CONTRACT WHERE FACT_NO = '0000' AND PNL_NO = :1 AND CONTRACT_NO = :2 AND STATUS = 'RECEIVED'";
        const checkResult = await executeSql(checkQuery, [
          item.employee_no,
          item.contract_id,
        ]);

        // Oracle trả về mảng các dòng kết quả dạng Object (do ta cấu hình OUT_FORMAT_OBJECT)
        const existingContract = checkResult.rows?.[0] as any;

        if (existingContract) {
          const currentStatus = existingContract.STATUS; // Lấy thuộc tính viết HOA theo chuẩn Oracle

          // TRƯỜNG HỢP 1: Luồng gửi mail cũ VẪN ĐANG CHẠY ngầm (status là RECEIVED) -> Khóa chặn
          if (currentStatus === "RECEIVED") {
            console.log(
              `[BỎ QUA] Mã HĐ ${item.contract_id} đang trong tiến trình gửi thư cũ, từ chối lệnh gửi đè.`,
            );
            totalSkipped++;
            continue;
          }

          // TRƯỜNG HỢP 2: Đã xử lý xong lượt trước, Admin chủ động nhấn nút Gửi lại (is_resend = true)
          if (isUserWantResend) {
            console.log(
              `[GỬI LẠI] Đồng ý kích hoạt lại mail mới cho mã HĐ: ${item.contract_id}`,
            );
            totalResent++;
          }
          // TRƯỜNG HỢP 3: Bị trùng ID do API trùng lặp ngẫu nhiên thông thường (is_resend = false)
          else {
            console.log(
              `[CHẶN TRÙNG LẶP] Bỏ qua mã HĐ ${item.contract_id} do đã tồn tại trong cơ sở dữ liệu Oracle.`,
            );
            totalSkipped++;
            continue;
          }
        } else {
          // Bản ghi hoàn toàn mới tinh, chưa từng xuất hiện trong DB
          totalProcessed++;
        }

        // 🌟 BƯỚC 2: TIẾN HÀNH MERGE DỮ LIỆU VÀ ĐƯA TRẠNG THÁI VỀ 'RECEIVED' ĐỂ KHÓA TIẾN TRÌNH
        const mergeQuery =
          "UPDATE PER_CONTRACT SET STATUS ='RECEIVED' WHERE FACT_NO = '0000' AND PNL_NO = :1 AND CONTRACT_NO = :2";

        await executeSql(mergeQuery, [item.employee_no, item.contract_id]);

        // 🌟 BƯỚC 3: KÍCH HOẠT CHẠY NGẦM GỬI MAIL QUA SETTIMEOUT (ERP KHÔNG PHẢI CHỜ)
        setTimeout(async () => {
          try {
            const workerResponse = await fetch(`${baseUrl}/api/send-mail`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: item.email,
                employee_name: item.employee_name,
                employee_no: item.employee_no,
                contract_no: item.contract_no,
                contract_id: item.contract_id,
                pdf_file: item.pdf_file,
              }),
            });

            if (!workerResponse.ok) {
              const workerErrorData = await workerResponse
                .json()
                .catch(() => ({}));
              console.error(
                `[Lỗi Worker ngầm tại ID ${item.contract_id}]:`,
                workerErrorData.error,
              );
            }
          } catch (fetchErr: any) {
            console.error(
              `[Lỗi kết nối Worker ngầm cho ID ${item.contract_id}]:`,
              fetchErr.message,
            );
          }
        }, 0);
      } catch (innerError: any) {
        console.error(
          `❌ Sự cố khi ghi nhận Oracle cho mã ${item.contract_id}:`,
          innerError.message,
        );
      }
    }

    console.log(
      `=== ĐỒNG BỘ ORACLE HOÀN TẤT: Nhận mới: ${totalProcessed}, Gửi lại: ${totalResent}, Chặn trùng: ${totalSkipped} ===`,
    );

    // 5. PHẢN HỒI KẾT QUẢ ĐỒNG BỘ NGAY LẬP TỨC VỀ CHO ERP
    return NextResponse.json(
      {
        success: true,
        message: `Đồng bộ dữ liệu Oracle hoàn tất. Nhận mới: ${totalProcessed} bản ghi. Gửi lại: ${totalResent} bản ghi. Chặn trùng/Đang xử lý: ${totalSkipped} bản ghi.`,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 400 },
    );
  }
}
