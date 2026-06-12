import { NextResponse } from "next/server";
import { executeSql } from "@/lib/oracle";

export async function POST(req: Request) {
  try {
    const { contract_id, employee_no, reason } = await req.json();

    if (!contract_id || !employee_no || !reason) {
      throw new Error("Thiếu thông tin ID hợp đồng hoặc lý do từ chối.");
    }

    // const dbContracts = (global as any).contracts || {};
    const query = `
      SELECT A.CONTRACT_NO
      FROM PER_CONTRACT A, PER_PNLM B
      WHERE A.FACT_NO = B.FACT_NO AND A.PNL_NO = B.PNL_NO
        AND A.FACT_NO = '0000' AND A.PNL_NO = :1 AND A.CONTRACT_NO = :2
    `;

    const dbResult = await executeSql(query, [employee_no, contract_id]);
    const contract = dbResult.rows?.[0] as any;

    // if (!dbContracts[contract_id]) {
    //   throw new Error("Hợp đồng không tồn tại trên hệ thống.");
    // }
    if (!contract) {
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

    await executeSql(updateQuery, [reason, employee_no, contract_id]);
    return NextResponse.json({
      success: true,
      message: "Đã ghi nhận trạng thái từ chối ký hợp đồng về hệ thống ERP.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 400 },
    );
  }
}
