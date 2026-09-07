// オンライン部屋（同時編集）用の Firebase 設定。
// Firebase コンソール → プロジェクトの設定 → マイアプリ → 「SDK の設定と構成」の firebaseConfig を貼り付ける。
// null のままならオンライン機能は非表示で、ローカル＋共有リンクだけで動く。
// ※ この値は公開されても問題ない種類のキー（Web API キー）。データの保護は Firestore のセキュリティルールで行う（manual.html 参照）。
window.FIREBASE_CONFIG = null;
