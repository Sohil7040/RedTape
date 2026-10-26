/** Describe actual bridge results; acknowledgement is distinct from stored-file verification. */
export interface TransferResult {
 success?: boolean; verification?: string; filename?: string; error?: string; warning?: string
 bytesSent?: number; totalBytes?: number; fileIndex?: string|number; ip?: string; port?: number
}
export function transferProgress(sent: number, total: number): number {
 return Number.isFinite(sent)&&Number.isFinite(total)&&total>0?Math.max(0,Math.min(100,Math.round(sent/total*100))):0
}
export function transferOutcome(result: TransferResult): {tone:'success'|'warning'|'error';title:string;message:string} {
 const name=result.filename??'Job',location=result.ip?` on ${result.ip}${result.port?`:${result.port}`:''}`:''
 if(result.verification==='mismatch')return {tone:'error',title:'Upload completed; stored-file verification failed',message:`${name}${location}: ${result.error??'Stored bytes differ from the uploaded data.'} Check controller storage before retrying. Job not started.`}
 if(result.success&&result.verification==='matched')return {tone:'success',title:'Uploaded and readback verified',message:`${name}${result.fileIndex!==undefined&&result.fileIndex!==null&&result.fileIndex!==''?` · file ${result.fileIndex}`:''}${location}. Job not started. Cutter: Esc → File → select ${name}.`}
 if(result.success)return {tone:'warning',title:'Upload acknowledged; stored file unverified',message:`${name}${location}. ${result.warning??'Readback did not confirm the stored bytes.'} Check the cutter before retrying. Job not started.`}
 return {tone:'error',title:'Upload failed or could not be confirmed',message:`${result.error??'No confirmed completion result.'} Check controller storage before retrying. No automatic retry was sent.`}
}
