// オンライン部屋（同時編集）用の Firebase 設定（プロジェクト rust-d3d5e / Firestore asia-northeast1 / 匿名認証）。
// Web 用 API キーは公開前提の識別子で、データの保護は Firestore セキュリティルールで行っている（manual.html 8章）。
// null にするとオンライン機能は非表示になり、ローカル＋共有リンクだけで動く。
// マスターアカウント（すべての投稿・グループ・部屋を編集できる Firebase Auth の UID）。Firestore ルール側にも同じ UID を登録済み。
window.RRP_MASTERS = ["N6ptNPAqlEakhWxZZSH93qTKiuo2"];   // basketseasound0422@gmail.com（ちゃいる）
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDv4QLS7-tbxWCGvdt6WG6qtofKY_O0QrE",
  authDomain: "rust-d3d5e.firebaseapp.com",
  projectId: "rust-d3d5e",
  storageBucket: "rust-d3d5e.firebasestorage.app",
  messagingSenderId: "509547682556",
  appId: "1:509547682556:web:05acc288e56f32ef561579"
};
