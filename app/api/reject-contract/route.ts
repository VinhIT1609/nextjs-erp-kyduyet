import { NextResponse } from "next/server";
import { executeSql } from "@/lib/oracle"; 

export async function POST(req: Request) {
  try {
    const { contract_id, employee_no, reason } = await req.json();

    if (!contract_id || !employee_no || !reason) {
      throw new Error("Thiếu thông tin ID hợp đồng hoặc lý do từ chối.");
    }

    const dbContracts = (global as any).contracts || {};
    if (!dbContracts[contract_id]) {
      throw new Error("Hợp đồng không tồn tại trên hệ thống.");
    }

    // CẬP NHẬT TÌNH TRẠNG VÀ LÝ DO VỀ DBA
    /*(global as any).contracts[contract_id].status = "REJECTED";
    (global as any).contracts[contract_id].reject_reason = reason;*/
    const updateQuery = `UPDATE PER_CONTRACT 
                            SET STATUS        = 'REJECTED',
                                REJECT_REASON = :1
                          WHERE FACT_NO       = '0000'
                            AND PNL_NO        = :2
                            AND CONTRACT_NO   = :3`;
                            
    await executeSql(updateQuery, [reason, employee_no, contract_id])
    return NextResponse.json({
      success: true,
      message: "Đã ghi nhận trạng thái từ chối ký hợp đồng về hệ thống ERP."
    });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}