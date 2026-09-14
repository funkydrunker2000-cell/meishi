/* 営業名刺帳 — 接続先の設定
 * Supabase ダッシュボード → Project Settings → API（または「Connect」ボタン）で確認できる値を入れてください。
 * ここに入れるキーは「公開してよいキー」（anon key / publishable key）です。
 * service_role key・secret key は絶対に入れないでください（全データを無制限に操作できてしまいます）。
 * データはテーブル側のアクセス権（RLS）で、招待した社員以外は読めないよう守られています。
 */
window.MEISHI_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseKey: "YOUR-ANON-OR-PUBLISHABLE-KEY",
};
