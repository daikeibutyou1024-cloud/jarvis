// USD is stored as exact integer millionths. Missing and explicitly invalid values differ.
export function usdMicro(value){
 if(typeof value!=='string'||!/^\d+(?:\.\d{1,6})?$/.test(value))throw Error('USD金額は小数6桁までの0以上の数値で入力してください');
 const [whole,fraction='']=value.split('.'),amount=Number(whole)*1000000+Number(fraction.padEnd(6,'0'));
 if(!Number.isSafeInteger(amount)||amount<0||amount>1e12)throw Error('USD金額の範囲を確認してください');
 return amount;
}
export function openingMicro(env,month){
 const values=env.AI_OPENING_SPEND_USD_JSON===undefined?{}:JSON.parse(env.AI_OPENING_SPEND_USD_JSON);
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('開始利用額の設定形式が不正です');
 for(const [key,value] of Object.entries(values)){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))throw Error('開始利用額の対象月が不正です');usdMicro(value);}
 return Object.hasOwn(values,month)?usdMicro(values[month]):0;
}
