// Workers Free was confirmed by the owner on 2026-11-17.
// D1 CREATE was denied with code 7500. Do not activate until the Preview-only
// migration succeeds with authorized D1 Write access and release verification passes.
// No environment/Binding change is needed. No runtime request can enable this switch.
export const CLOUD_STORAGE_ENABLED = false;

export const CLOUD_STORAGE_DISABLED_REASON = 'Workers Free契約は本人確認済みです。D1書き込み権限不足で新規テーブルが未作成のため、クラウド保存は未有効です。端末データは保持します。';
