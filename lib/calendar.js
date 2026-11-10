export function japanDay(value){
 const date=value||new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('日付はYYYY-MM-DD形式です');
 const start=Date.parse(date+'T00:00:00+09:00');
 if(!Number.isFinite(start)||new Date(start+9*3600000).toISOString().slice(0,10)!==date)throw Error('日付が不正です');
 return {date,start,end:start+86400000,timezone:'Asia/Tokyo'};
}
