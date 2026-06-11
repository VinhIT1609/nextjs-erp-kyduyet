"use client";

import { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { useParams } from "next/navigation";

export default function SignPage() {
  const sigRef = useRef<any>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [rejectReason, setRejectReason] = useState("");
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // 🌟 NÂNG CẤP: State lưu trữ thông tin lỗi khi đường dẫn bị chặn/đóng
  const [pageError, setPageError] = useState<{
    reason: "SIGNED_SUCCESS" | "REJECTED" | "NOT_FOUND" | "ERROR" | null;
    message: string;
  } | null>(null);

  // NÂNG CẤP: Tạo thêm một state để lưu đường dẫn ảo Blob URL cho iframe
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string>("");
  
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";

  // Hàm chuyển đổi chuỗi Base64 thành Blob URL (Giúp sửa lỗi trình duyệt chặn iframe)
  const convertBase64ToBlobUrl = (base64String: string) => {
    try {
      // Làm sạch chuỗi đề phòng API trả về thừa tiền tố
      const cleanBase64 = base64String.includes(",") ? base64String.split(",")[1] : base64String;

      const byteCharacters = atob(cleanBase64); // 👈 dùng cleanBase64
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      return URL.createObjectURL(blob); // Tạo ra đường dẫn dạng: blob:http://localhost:3000/...
    } catch (e) {
      console.error("Lỗi chuyển đổi Base64 sang Blob:", e);
      return "";
    }
  };

  // Tạo hàm xử lý nạp/đổi PDF riêng để tránh loop hoặc rò rỉ bộ nhớ trong useEffect
  const updatePdfView = (base64Data: string) => {
    setPdfBlobUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl); // Giải phóng vùng nhớ của Blob cũ trước đó
      return convertBase64ToBlobUrl(base64Data);
    });
  };

  useEffect(() => {
    const updateWidth = () => {
      setCanvasWidth(
        window.innerWidth >= 1024
          ? window.innerWidth - 120
          : window.innerWidth >= 768
          ? window.innerWidth - 80
          : window.innerWidth - 40
      );
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    if (!token) {
      setPageError({
        reason: "NOT_FOUND",
        message: "Thiếu mã cấu hình token bảo mật truy cập."
      });
      setLoading(false);
      return;
    }

    setLoading(true);

    fetch(`/api/get-contract?token=${token}`)
      .then((res) => res.json())
      .then((contractRes) => {
        if (!contractRes.success || contractRes.valid === false) {
          setPageError({
            reason: contractRes.reason || "ERROR",
            message: contractRes.message || "Đường liên kết này đã đóng hoặc không khả dụng."
          });
          return;
        }

        if (contractRes.data?.pdf_base64) {
          setContract(contractRes.data);
          const blobUrl = convertBase64ToBlobUrl(contractRes.data.pdf_base64);
          setPdfBlobUrl(blobUrl);
        } else {
          setPageError({
            reason: "NOT_FOUND",
            message: contractRes.message || "Không thể tìm thấy thông tin dữ liệu hợp đồng."
          });
        }
      })
      .catch((err) => {
        console.error("Lỗi quy trình xác thực dữ liệu:", err);
        setPageError({
          reason: "ERROR",
          message: "Không thể kết nối đến máy chủ hệ thống."
        });
      })
      .finally(() => {
        setLoading(false);
      });

    // Cleanup khi unmount
    return () => {
      window.removeEventListener("resize", updateWidth);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [token]);

  const clearSign = () => sigRef.current?.clear();

  // GỬI CHỮ KÝ LÊN SERVER
  const saveSign = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      alert("Vui lòng vẽ chữ ký của bạn lên khung hình trước!");
      return;
    }

    const signatureImage = sigRef.current.getTrimmedCanvas().toDataURL("image/png");

    try {
      const response = await fetch("/api/sign-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: contract.contract_id,
          employee_no: contract.employee_no,
          signature: signatureImage,
        }),
      });

      const result = await response.json();

      if (result.success && result.pdf_base64) {
        alert("Ký hợp đồng thành công!");
        
        // Giải phóng Blob URL cũ trước khi tạo cái mới
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);

        // 🌟 ĐÃ SỬA: Cập nhật lại UI bằng chuỗi Base64 mới đã đóng dấu thông qua Blob URL mới
        setContract((prev: any) => ({
          ...prev,
          pdf_base64: result.pdf_base64
        }));
        
        const newBlobUrl = convertBase64ToBlobUrl(result.pdf_base64);
        setPdfBlobUrl(newBlobUrl);

        updatePdfView(result.pdf_base64);
        clearSign(); // Xóa sạch khung chữ ký sau khi hoàn thành
      } else {
        alert("Lỗi từ máy chủ: " + (result.error || "Không thể xử lý chữ ký"));
      }
    } catch (error) {
      alert("Lỗi kết nối API.");
    }
  };
  // Từ chối ký hợp đồng
  const rejectContract = async () => {
    if (!rejectReason.trim()) {
      alert("Vui lòng điền cụ thể lý do không ký hợp đồng!");
      return;
    }

    try {
      const response = await fetch("/api/reject-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: contract.contract_id,
          employee_no: contract.employee_no,
          reason: rejectReason,
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert("Hệ thống đã ghi nhận lý do từ chối ký hợp đồng của bạn.");
        setRejectReason(""); // Reset ô nhập liệu
      } else {
        alert("Lỗi: " + result.error);
      }
    } catch (error) {
      alert("Đã xảy ra lỗi kết nối khi từ chối ký.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 margin-auto mb-3"></div>
          <p className="text-lg font-medium text-gray-600">
            Đang tải thông tin và mã hóa tài liệu hợp đồng...
          </p>
        </div>
      </div>
    );
  }
  // 2. 🌟 ĐÃ SỬA: GIAO DIỆN CHẶN TRUY CẬP (Nếu đã ký thành công hoặc đã bấm từ chối ký)
  if (pageError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-2xl shadow-xl border-t-4 border-amber-500 text-center">
          {pageError.reason === "SIGNED_SUCCESS" ? (
            <div className="text-green-500 text-5xl mb-4">✅</div>
          ) : (
            <div className="text-amber-500 text-5xl mb-4">⚠️</div>
          )}
          <h2 className="text-xl font-bold text-gray-800 mb-2">Liên kết không khả dụng</h2>
          <p className="text-gray-600 mb-6 text-sm leading-relaxed">{pageError.message}</p>
          <div className="text-xs text-gray-400 bg-gray-50 p-2 rounded">
            Hệ thống quản lý hợp đồng điện tử ERP
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gray-100 p-2 md:p-5">
      {/* Khung thông tin nhân viên */}
      <div className="bg-white rounded-2xl shadow-lg p-4 md:p-6 mb-5 ">
        <h1 className="text-2xl font-bold text-center text-slate-800">Ký hợp đồng điện tử</h1>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-gray-50 border rounded-xl p-3">
            <span className="text-gray-500 text-sm">Họ và tên:</span> <b className="text-slate-800">{contract.employee_name}</b>
          </div>
          <div className="bg-gray-50 border rounded-xl p-3">
            <span className="text-gray-500 text-sm">Mã NV:</span> <b className="text-slate-800">{contract.employee_no}</b>
          </div>
          <div className="bg-gray-50 border rounded-xl p-3">
            <span className="text-gray-500 text-sm">Mã HĐ:</span> <b className="text-slate-800">{contract.contract_no}</b>
          </div>
        </div>
      </div>

      {/* HIỂN THỊ PDF BẰNG BLOB URL AN TOÀN */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-6">
      {pdfBlobUrl ? (
        /* THAY IFRAME BẰNG OBJECT CỰC KỲ ỔN ĐỊNH */
        <object
          data={pdfBlobUrl}
          type="application/pdf"
          className="w-full h-[500px] md:h-[700px] lg:h-[900px]"
        >
          {/* Khung dự phòng hiển thị nếu trình duyệt chặn hoàn toàn render PDF inline */}
          <div className="p-10 text-center text-gray-700 bg-gray-50">
            <p className="mb-4 font-medium">Trình duyệt của bạn không hỗ trợ xem trực tiếp file PDF này.</p>
            <a 
              href={pdfBlobUrl} 
              download={`${contract?.contract_no || 'hop_dong'}.pdf`}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-xl transition shadow-md"
            >
              Tải file PDF về xem trực tiếp
            </a>
          </div>
        </object>
      ) : (
        <div className="p-10 text-center text-gray-500">Đang khởi tạo trình đọc file PDF...</div>
      )}
    </div>

      {/* Vùng vẽ Chữ ký */}
      <div className="bg-white rounded-2xl shadow-lg p-3 md:p-5">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">Chữ ký xác nhận</h2>
        <SignatureCanvas
          ref={sigRef}
          penColor="#003366"
          canvasProps={{ width: canvasWidth, height: 220, className: "border-2 rounded-xl bg-white mb-4" }}
        />
        
        <div className="mb-6" style={{ width: canvasWidth }}>
          <label className="block text-sm md:text-base font-semibold text-gray-700 mb-2">
            Lý do không ký hợp đồng
          </label>
          <textarea
            placeholder="Nhập lý do không ký hợp đồng..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full border-2 border-gray-300 rounded-xl p-3 text-gray-800 bg-gray-50 mb-5 outline-none focus:border-red-500" 
            rows={4}
          />
        </div>

        <div className="flex gap-3">
          <button onClick={clearSign} className="bg-red-500 text-white px-4 py-2 rounded-xl">Xóa chữ ký</button>
          <button onClick={saveSign} className="bg-blue-600 text-white px-4 py-2 rounded-xl">Xác nhận ký</button>
          <button onClick={rejectContract} className="bg-red-600 hover:bg-red-700 text-white font-semibold px-5 py-2.5 rounded-xl transition shadow-sm">
            Không xác nhận ký
          </button>
        </div>
      </div>
    </div>
  );
}