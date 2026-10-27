const id = value => { if(typeof value!=='string'||!/^bug_[a-zA-Z0-9_-]{1,100}$/.test(value))throw Error('Invalid ticket id');return `'${value}'`; };
const quoted = (value,max) => { if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Invalid text');return `'${value.trim().replaceAll("'","''")}'`; };
export const listSupportSql=()=>`SELECT r.report_id,r.category,r.public_reason,r.created_at,r.status,n.status AS notification_status,n.attempts,n.last_error FROM tactics_bug_reports r LEFT JOIN tactics_support_notifications n ON n.report_id=r.report_id WHERE r.status IN ('OPEN','REVIEWING') ORDER BY r.created_at LIMIT 100;`;
export const showSupportSql=reportId=>`SELECT * FROM tactics_bug_reports WHERE report_id=${id(reportId)}; SELECT note_id,actor,kind,body,created_at FROM tactics_support_notes WHERE report_id=${id(reportId)} ORDER BY created_at;`;
export const noteSupportSql=({reportId,actor,text,now,noteId,confirmedSent=false})=>{
 if(!Number.isSafeInteger(now)||now<0||!/^note_[a-f0-9-]{36}$/.test(noteId))throw Error('Invalid metadata');
 return `INSERT INTO tactics_support_notes(note_id,report_id,actor,kind,body,created_at) VALUES('${noteId}',${id(reportId)},${quoted(actor,100)},'${confirmedSent?'EXTERNAL_REPLY_RECORDED':'NOTE'}',${quoted(text,2000)},${now});`;
};
export const resolveSupportSql=reportId=>`UPDATE tactics_bug_reports SET status='RESOLVED',updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE report_id=${id(reportId)} AND status IN ('OPEN','REVIEWING');`;
