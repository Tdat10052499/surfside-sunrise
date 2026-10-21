# Hướng dẫn đưa website lên GitHub Pages

Repo: https://github.com/Tdat10052499/surfside-sunrise
Link website sau khi bật Pages: https://tdat10052499.github.io/surfside-sunrise/

## Bước 1: Tải code website lên repo (một lần)

1. Giải nén file `surfside-sunrise-site.zip`. Bạn sẽ có thư mục `surfside-sunrise` gồm `index.html`, `favicon.svg` và thư mục `assets`.
2. Mở repo trên GitHub, bấm **Add file → Upload files**.
3. Mở thư mục `surfside-sunrise` vừa giải nén. Chọn **tất cả** những gì bên trong (`index.html`, `favicon.svg`, thư mục `assets`), rồi kéo thả vào trang upload. GitHub giữ nguyên cấu trúc thư mục khi bạn kéo cả thư mục.
4. Ở ô "Commit changes", ghi `Add website files`, chọn **Commit directly to the main branch**, rồi bấm **Commit changes**.

Lưu ý: cần kéo **nội dung bên trong** thư mục, không kéo chính thư mục `surfside-sunrise`. Nếu kéo cả thư mục, link web sẽ thành `.../surfside-sunrise/surfside-sunrise/`.

## Bước 2: Bật GitHub Pages

1. Trong repo, vào **Settings → Pages**.
2. Mục **Build and deployment → Source**, chọn **Deploy from a branch**.
3. Branch chọn **main**, thư mục chọn **/ (root)**, rồi bấm **Save**.
4. Đợi 1–2 phút rồi tải lại trang. GitHub sẽ hiện "Your site is live at…". Mở link để kiểm tra.

## Bước 3: Điền thông tin liên hệ (khuyên làm)

1. Trong repo, mở `assets/js/main.js` và bấm biểu tượng bút chì (Edit).
2. Ở đầu file, điền vào `CONFIG`:
   - `whatsapp`: số có mã quốc gia, chỉ gồm chữ số, ví dụ `'84901234567'`
   - `email`: ví dụ `'stay@example.com'`
   - `phone`: số hiển thị, ví dụ `'+84 90 123 4567'`
3. Bấm **Commit changes**. Website tự cập nhật sau khoảng 1 phút.

## Cập nhật sau này

- **Thay ảnh:** vào `assets/img`, chọn **Add file → Upload files**, tải ảnh mới lên với **cùng tên file** (ví dụ `deck.webp`) để thay ảnh cũ.
- **Dùng AI để sửa hoặc phát triển tiếp:** mở repo bằng Claude Code hoặc Cursor. Assistant sẽ đọc `CLAUDE.md` để hiểu thiết kế và quy tắc.
- **Dựng lại bằng framework (Astro):** dán nội dung `docs/PROMPT_REBUILD.md` vào Claude Code hoặc Cursor.
